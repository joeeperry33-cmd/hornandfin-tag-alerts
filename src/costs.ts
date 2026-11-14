import type { Env, Source } from './types';
import { checkInterval } from './check';
import { escapeHtml, STATES } from './util';

/**
 * What each state costs to watch, for pricing. Apify runs are billed per run, so their real charges
 * come from Apify's run history. Bright Data runs are estimated per run. Everything else runs inside
 * the Cloudflare plan and only shares the fixed monthly costs.
 *
 * The yearly figure follows each source's own schedule day by day (in season, off season and rush
 * weeks), since most states are only checked often for a few months.
 */

const DAY = 86400_000;
// PayPal's standard US rate for a subscription payment.
const PAYPAL_PCT = 0.0349;
const PAYPAL_FIXED = 0.49;

export interface SourceCost {
  id: string;
  state: string;
  name: string;
  provider: 'Apify' | 'Bright Data' | 'Cloudflare';
  active: boolean;
  /** Runs and dollars over the lookback window (Apify: actual; Bright Data: estimated). */
  runs: number;
  spent: number;
  perRun: number;
  /** Projected runs and dollars for the next 365 days at the current schedule. */
  yearRuns: number;
  yearCost: number;
  /** Projected cost today at today's schedule. */
  today: number;
  estimated: boolean;
  note?: string;
}

export interface CostReport {
  days: number;
  sources: SourceCost[];
  fixed: { name: string; monthly: number }[];
  fixedYear: number;
  usageYear: number;
  totalYear: number;
  paying: number;
  price: number;
  netPerSub: number;
  subsToBreakEven: number;
  priceToBreakEven: number | null;
}

function cfg(src: Source): Record<string, unknown> {
  try {
    return src.parser_config ? JSON.parse(src.parser_config) : {};
  } catch {
    return {};
  }
}

/** Runs per day at the schedule in force on that date. */
function runsOn(src: Source, date: Date): number {
  return 1440 / Math.max(checkInterval(src, date), 1);
}

function yearRuns(src: Source, from = new Date()): number {
  let n = 0;
  for (let d = 0; d < 365; d++) n += runsOn(src, new Date(from.getTime() + d * DAY));
  return n;
}

/** "Cloudflare Workers:5, Apify plan:0" → [{name, monthly}] */
export function parseFixed(raw: string | undefined): { name: string; monthly: number }[] {
  return (raw ?? 'Cloudflare Workers Paid:5')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.lastIndexOf(':');
      return { name: (i > 0 ? p.slice(0, i) : p).trim(), monthly: parseFloat(i > 0 ? p.slice(i + 1) : '0') || 0 };
    });
}

/** Sum of an Apify task's run charges since a date. */
async function apifyUsage(env: Env, task: string, since: number): Promise<{ runs: number; usd: number }> {
  let runs = 0;
  let usd = 0;
  for (let offset = 0; offset < 5000; offset += 1000) {
    const res = await fetch(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(task)}/runs?desc=1&limit=1000&offset=${offset}`, {
      headers: { authorization: `Bearer ${env.APIFY_TOKEN}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Apify runs list: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { items?: { startedAt?: string; usageTotalUsd?: number }[] } };
    const items = body.data?.items ?? [];
    let older = false;
    for (const r of items) {
      const t = r.startedAt ? new Date(r.startedAt).getTime() : 0;
      if (t < since) {
        older = true;
        continue;
      }
      runs++;
      usd += r.usageTotalUsd ?? 0;
    }
    if (older || items.length < 1000) break;
  }
  return { runs, usd };
}

export async function costReport(env: Env, days = 30): Promise<CostReport> {
  const { results } = await env.DB.prepare('SELECT * FROM sources ORDER BY state, id').all<Source>();
  const since = Date.now() - days * DAY;
  const now = new Date();
  const bdPerRun = parseFloat(env.BRIGHTDATA_COST_PER_RUN ?? '') || 0.005;
  const sources: SourceCost[] = [];

  for (const src of results) {
    const active = !!src.active;
    const yr = active ? yearRuns(src, now) : 0;
    const todayRuns = active ? runsOn(src, now) : 0;
    const base = { id: src.id, state: src.state, name: src.name, active };
    if (src.parser === 'apify') {
      const task = String(cfg(src).task ?? '');
      let runs = 0;
      let spent = 0;
      let note: string | undefined;
      try {
        if (env.APIFY_TOKEN && task) ({ runs, usd: spent } = await apifyUsage(env, task, since));
      } catch (err) {
        note = String(err instanceof Error ? err.message : err);
      }
      // Only scheduled checks are projected; test runs made by hand are in the spend but rare.
      const perRun = runs ? spent / runs : 0.05;
      sources.push({ ...base, provider: 'Apify', runs, spent, perRun, yearRuns: yr, yearCost: yr * perRun, today: todayRuns * perRun, estimated: !runs, note });
    } else if (src.parser === 'brightdata_pdf') {
      const runs = active ? Math.round(Array.from({ length: days }, (_, d) => runsOn(src, new Date(now.getTime() - d * DAY))).reduce((a, b) => a + b, 0)) : 0;
      sources.push({ ...base, provider: 'Bright Data', runs, spent: runs * bdPerRun, perRun: bdPerRun, yearRuns: yr, yearCost: yr * bdPerRun, today: todayRuns * bdPerRun, estimated: true });
    } else if (active) {
      sources.push({ ...base, provider: 'Cloudflare', runs: 0, spent: 0, perRun: 0, yearRuns: yr, yearCost: 0, today: 0, estimated: false });
    }
  }

  const fixed = parseFixed(env.FIXED_MONTHLY_COSTS);
  const fixedYear = fixed.reduce((a, f) => a + f.monthly * 12, 0);
  const usageYear = sources.reduce((a, s) => a + s.yearCost, 0);
  const totalYear = fixedYear + usageYear;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM subscribers WHERE tier = 'paid' AND unsubscribed_at IS NULL AND (paid_until IS NULL OR paid_until > ?)`,
  )
    .bind(now.toISOString())
    .first<{ n: number }>();
  const paying = row?.n ?? 0;
  const price = parseFloat((env.PAID_PRICE_LABEL.match(/[\d.]+/) ?? ['0'])[0]) || 0;
  const netPerSub = price * (1 - PAYPAL_PCT) - PAYPAL_FIXED;
  return {
    days,
    sources,
    fixed,
    fixedYear,
    usageYear,
    totalYear,
    paying,
    price,
    netPerSub,
    subsToBreakEven: netPerSub > 0 ? Math.ceil(totalYear / netPerSub) : Infinity,
    priceToBreakEven: paying ? (totalYear / paying + PAYPAL_FIXED) / (1 - PAYPAL_PCT) : null,
  };
}

const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;

export function costsPageBody(r: CostReport): string {
  // One row per state: add up its sources.
  const byState = new Map<string, SourceCost[]>();
  for (const s of r.sources) byState.set(s.state, [...(byState.get(s.state) ?? []), s]);
  const states = [...byState.entries()]
    .map(([st, list]) => ({
      st,
      list,
      spent: list.reduce((a, s) => a + s.spent, 0),
      today: list.reduce((a, s) => a + s.today, 0),
      year: list.reduce((a, s) => a + s.yearCost, 0),
      providers: [...new Set(list.map((s) => s.provider))].join(', '),
      estimated: list.some((s) => s.estimated && s.provider !== 'Cloudflare'),
    }))
    .sort((a, b) => b.year - a.year || a.st.localeCompare(b.st));

  const rows = states
    .map(
      (s) => `<tr><td><strong>${escapeHtml(STATES[s.st] ?? s.st)}</strong><br><span class="muted">${s.list.map((x) => escapeHtml(x.name) + (x.active ? '' : ' (off)')).join('<br>')}</span></td>
<td>${escapeHtml(s.providers)}</td><td class="n">${usd(s.spent)}</td><td class="n">${usd(s.today, 3)}</td><td class="n">${usd(s.year / 365, 3)}</td><td class="n"><strong>${usd(s.year)}</strong>${s.estimated ? '<sup>*</sup>' : ''}</td></tr>`,
    )
    .join('');
  const fixedRows = r.fixed.map((f) => `<tr><td>${escapeHtml(f.name)}</td><td class="n">${usd(f.monthly)}/mo</td><td class="n">${usd(f.monthly * 12)}</td></tr>`).join('');
  const notes = r.sources.filter((s) => s.note).map((s) => `<li>${escapeHtml(s.name)}: ${escapeHtml(s.note!)}</li>`).join('');

  return `<div class="app">
<h1>What it costs to run</h1><p class="muted"><a href="/admin/subscribers">Subscribers</a> &nbsp;|&nbsp; <a href="/admin/costs.json">Raw numbers</a> &nbsp;|&nbsp; <a href="/manage">Your alerts</a></p>
<div class="stats">
<div class="stat"><b>${usd(r.totalYear, 0)}</b>Projected per year</div>
<div class="stat"><b>${usd(r.totalYear / 12, 2)}</b>Per month on average</div>
<div class="stat"><b>${r.paying}</b>Paying subscribers</div>
<div class="stat"><b>${Number.isFinite(r.subsToBreakEven) ? r.subsToBreakEven : '–'}</b>Subscribers needed at ${usd(r.price)}/yr</div>
<div class="stat"><b>${r.priceToBreakEven !== null ? usd(r.priceToBreakEven) : '–'}</b>Break-even price with ${r.paying} subscriber${r.paying === 1 ? '' : 's'}</div>
</div>
<p>Each subscriber at ${usd(r.price)}/yr brings in about <strong>${usd(r.netPerSub)}</strong> after PayPal's fee (${(PAYPAL_PCT * 100).toFixed(2)}% + ${usd(PAYPAL_FIXED)}).</p>
<h2>By state</h2>
<div class="tbl"><table class="subs"><thead><tr><th>State</th><th>Read by</th><th class="n">Spent, last ${r.days} days</th><th class="n">Per day now</th><th class="n">Per day, year average</th><th class="n">Per year</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="muted" style="font-size:14px">States read by Cloudflare cost nothing extra; they share the fixed costs below. Apify figures are Apify's own charges per run; the year projection is the average charge per run times the number of checks each source's schedule makes (in season, off season and rush weeks).
<sup>*</sup> Estimated: Bright Data runs at ${usd(r.sources.find((s) => s.provider === 'Bright Data')?.perRun ?? 0.005, 3)} each, or Apify tasks with no runs yet.</p>
<h2>Fixed costs</h2>
<div class="tbl"><table class="subs"><thead><tr><th>Item</th><th class="n">Monthly</th><th class="n">Yearly</th></tr></thead><tbody>${fixedRows}
<tr><td><strong>Usage (all states)</strong></td><td class="n">${usd(r.usageYear / 12)}/mo</td><td class="n">${usd(r.usageYear)}</td></tr>
<tr><td><strong>Total</strong></td><td class="n"><strong>${usd(r.totalYear / 12)}/mo</strong></td><td class="n"><strong>${usd(r.totalYear)}</strong></td></tr></tbody></table></div>
<p class="muted" style="font-size:14px">Fixed costs come from FIXED_MONTHLY_COSTS in the Worker settings, as "Name:dollars" pairs separated by commas.</p>
${notes ? `<p class="muted">Couldn't read: </p><ul>${notes}</ul>` : ''}
</div>`;
}

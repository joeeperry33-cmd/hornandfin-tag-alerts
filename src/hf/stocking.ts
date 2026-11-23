import type { Env, Subscriber } from '../types';
import { layout, listHeaders, manageUrl, sendEmails, sendSms, unsubscribeUrl, type EmailMessage } from '../notify';
import { robotsAllows } from '../robots';
import { extractTables, parseCsv, type Table } from '../parsers/table';
import { escapeHtml, nowIso, STATES, textsEnabled } from '../util';
import { findOutfitters, waterKey } from './tools';

/** Free trout stocking alerts: read each state's stocking report, alert anglers who follow that water or county. */

export interface StockingSource {
  id: string;
  state: string;
  name: string;
  url: string;
  link_url: string;
  format: 'html' | 'csv' | 'json';
  config: string;
  check_minutes: number;
  active: number;
  last_checked: string | null;
  fail_count: number;
}

export interface StockingConfig {
  /** html/csv: pick the table whose header contains this text, or by index. */
  headerMatch?: string;
  tableIndex?: number;
  /** json: dotted path to the array of rows. */
  items?: string;
  /** Column header (substring, case-insensitive) or json field for each value. */
  water: string;
  county?: string;
  species?: string;
  date?: string;
  quantity?: string;
  /** Fixed species when the report doesn't say. */
  fixedSpecies?: string;
  /** Regex with named groups (water, county) applied to the water cell, for reports that pack both into one cell. */
  waterRegex?: string;
  /** County codes used inside the water cell, e.g. {"CLAR":"Clark"}. */
  countyCodes?: Record<string, string>;
}

/** Split a packed water cell like "BATTLE GROUND LK (CLAR) Clark Region 5" into water and county. */
export function splitWater(cell: string, cfg: StockingConfig): { water: string; county: string | null } {
  if (!cfg.waterRegex) return { water: cell, county: null };
  const m = cell.match(new RegExp(cfg.waterRegex));
  if (!m?.groups) return { water: cell, county: null };
  const water = (m.groups.water ?? cell).replace(/\s+/g, ' ').trim();
  let county = m.groups.county?.trim() || null;
  if (county && cfg.countyCodes?.[county.toUpperCase()]) county = cfg.countyCodes[county.toUpperCase()];
  return { water, county };
}

export interface Stocking {
  water: string;
  county: string | null;
  species: string | null;
  quantity: number | null;
  stocked_on: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Turn the date formats state reports use into YYYY-MM-DD. */
export function parseStockDate(raw: string | null | undefined, now = new Date()): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})?/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mon = MONTHS[m[1].toLowerCase()];
    let y = m[3] ? Number(m[3]) : now.getUTCFullYear();
    if (!m[3] && mon > now.getUTCMonth() + 2) y--; // "Dec 3" read in January is last year
    return `${y}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function col(header: string[], name?: string): number {
  if (!name) return -1;
  const n = name.toLowerCase();
  return header.findIndex((h) => h.toLowerCase().includes(n));
}

export function stockingsFromTable(table: Table, cfg: StockingConfig): Stocking[] {
  if (!table.length) return [];
  const [header, ...rows] = table;
  const w = col(header, cfg.water);
  if (w < 0) throw new Error(`no "${cfg.water}" column in ${header.join(' | ').slice(0, 200)}`);
  const c = col(header, cfg.county);
  const sp = col(header, cfg.species);
  const d = col(header, cfg.date);
  const q = col(header, cfg.quantity);
  const out: Stocking[] = [];
  for (const r of rows) {
    const cell = (r[w] ?? '').replace(/\s+/g, ' ').trim();
    if (!cell) continue;
    const packed = splitWater(cell, cfg);
    const qty = q >= 0 ? parseInt((r[q] ?? '').replace(/[^0-9]/g, ''), 10) : NaN;
    out.push({
      water: packed.water.slice(0, 140),
      county: c >= 0 ? (r[c] ?? '').trim().replace(/ county$/i, '') || null : packed.county,
      species: sp >= 0 ? (r[sp] ?? '').trim() || null : cfg.fixedSpecies ?? null,
      quantity: Number.isFinite(qty) ? qty : null,
      stocked_on: d >= 0 ? parseStockDate(r[d]) : null,
    });
  }
  return out;
}

function at(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function stockingsFromJson(data: unknown, cfg: StockingConfig): Stocking[] {
  const list = at(data, cfg.items);
  if (!Array.isArray(list)) throw new Error(`no array at ${cfg.items ?? '(root)'}`);
  return list
    .map((row) => {
      const v = (k?: string) => (k ? at(row, k) : undefined);
      const water = String(v(cfg.water) ?? '').trim();
      const qty = parseInt(String(v(cfg.quantity) ?? '').replace(/[^0-9]/g, ''), 10);
      return {
        water: water.slice(0, 140),
        county: cfg.county ? String(v(cfg.county) ?? '').replace(/ county$/i, '').trim() || null : null,
        species: cfg.species ? String(v(cfg.species) ?? '').trim() || null : cfg.fixedSpecies ?? null,
        quantity: Number.isFinite(qty) ? qty : null,
        stocked_on: parseStockDate(v(cfg.date) as string | undefined),
      };
    })
    .filter((s) => s.water);
}

export async function readStockingSource(env: Env, src: StockingSource): Promise<Stocking[]> {
  if (!(await robotsAllows(src.url, env.USER_AGENT))) throw new Error('disallowed by robots.txt');
  const res = await fetch(src.url, {
    headers: { 'user-agent': env.USER_AGENT, accept: 'text/html,text/csv,application/json,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cfg = JSON.parse(src.config) as StockingConfig;
  if (src.format === 'json') return stockingsFromJson(await res.json(), cfg);
  const text = await res.text();
  const tables = src.format === 'csv' ? [parseCsv(text)] : extractTables(text);
  const table =
    cfg.tableIndex !== undefined
      ? tables[cfg.tableIndex]
      : tables.find((t) => t[0]?.join(' ').toLowerCase().includes((cfg.headerMatch ?? cfg.water).toLowerCase()));
  if (!table) throw new Error(`no matching table among ${tables.length}`);
  return stockingsFromTable(table, cfg);
}

/** Read every due source and store new stockings. The first read of a source is the baseline: no alerts for it. */
export async function checkStocking(env: Env, onlyId?: string): Promise<{ checked: number; added: number; errors: string[] }> {
  const { results: sources } = await env.DB.prepare(onlyId ? 'SELECT * FROM stocking_sources WHERE id = ?' : 'SELECT * FROM stocking_sources WHERE active = 1')
    .bind(...(onlyId ? [onlyId] : []))
    .all<StockingSource>();
  let checked = 0;
  let added = 0;
  const errors: string[] = [];
  for (const src of sources) {
    const due = !src.last_checked || Date.now() - Date.parse(src.last_checked) >= src.check_minutes * 60_000;
    if (!onlyId && !due) continue;
    checked++;
    try {
      const rows = await readStockingSource(env, src);
      const prior = await env.DB.prepare('SELECT COUNT(*) AS n FROM stocking_reports WHERE source_id = ?').bind(src.id).first<{ n: number }>();
      const baseline = (prior?.n ?? 0) === 0 ? 1 : 0;
      const ts = nowIso();
      const stmts = rows.map((r) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO stocking_reports (source_id, state, water, water_key, county, species, quantity, stocked_on, first_seen, baseline)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(src.id, src.state, r.water, waterKey(r.water), r.county, r.species, r.quantity, r.stocked_on, ts, baseline),
      );
      for (let i = 0; i < stmts.length; i += 50) {
        const res = await env.DB.batch(stmts.slice(i, i + 50));
        added += res.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
      }
      await env.DB.prepare('UPDATE stocking_sources SET last_checked = ?, last_status = 200, last_error = NULL, fail_count = 0 WHERE id = ?').bind(ts, src.id).run();
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
      errors.push(`${src.id}: ${msg}`);
      await env.DB.prepare('UPDATE stocking_sources SET last_checked = ?, last_error = ?, fail_count = fail_count + 1 WHERE id = ?').bind(nowIso(), msg, src.id).run();
    }
  }
  return { checked, added, errors };
}

interface NewStocking {
  id: number;
  state: string;
  water: string;
  water_key: string;
  county: string | null;
  species: string | null;
  quantity: number | null;
  stocked_on: string | null;
  link_url: string;
}

interface Follow {
  subscriber_id: string;
  state: string;
  water_key: string;
  county: string;
}

export function followMatches(f: Follow, s: NewStocking): boolean {
  if (f.state !== s.state) return false;
  if (f.water_key === '*') return !!s.county && f.county.toLowerCase() === s.county.toLowerCase();
  return s.water_key === f.water_key || s.water_key.startsWith(`${f.water_key} `);
}

function line(s: NewStocking): string {
  const what = [s.quantity ? `${s.quantity.toLocaleString('en-US')}` : '', s.species ?? 'fish'].filter(Boolean).join(' ');
  const when = s.stocked_on ? ` on ${new Date(`${s.stocked_on}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : '';
  return `${s.water}${s.county ? ` (${s.county} County)` : ''}: ${what} stocked${when}`;
}

/** Email (and, with consent, text) anglers about new stockings on waters they follow. Dry run until STOCKING_LIVE is "true". */
export async function sendStockingAlerts(env: Env): Promise<{ emails: number; sms: number; dryRun: boolean }> {
  const live = env.STOCKING_LIVE === 'true';
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { results: fresh } = await env.DB.prepare(
    `SELECT r.id, r.state, r.water, r.water_key, r.county, r.species, r.quantity, r.stocked_on, s.link_url
     FROM stocking_reports r JOIN stocking_sources s ON s.id = r.source_id WHERE r.baseline = 0 AND r.first_seen >= ?`,
  )
    .bind(since)
    .all<NewStocking>();
  if (!fresh.length) return { emails: 0, sms: 0, dryRun: !live };
  const { results: follows } = await env.DB.prepare(
    `SELECT f.subscriber_id, f.state, f.water_key, f.county FROM stocking_follows f JOIN subscribers s ON s.id = f.subscriber_id
     WHERE f.confirm_token IS NULL AND s.verified_at IS NOT NULL AND s.unsubscribed_at IS NULL`,
  ).all<Follow>();
  const ids = fresh.map((s) => s.id);
  const { results: doneRows } = await env.DB.prepare(`SELECT report_id, subscriber_id, channel FROM stocking_deliveries WHERE report_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ report_id: number; subscriber_id: string; channel: string }>();
  const done = new Set(doneRows.map((r) => `${r.report_id}:${r.subscriber_id}:${r.channel}`));

  const bySub = new Map<string, NewStocking[]>();
  for (const f of follows) {
    for (const s of fresh) {
      if (!followMatches(f, s) || done.has(`${s.id}:${f.subscriber_id}:email`)) continue;
      const list = bySub.get(f.subscriber_id) ?? [];
      if (!list.some((x) => x.id === s.id)) list.push(s);
      bySub.set(f.subscriber_id, list);
    }
  }
  if (!bySub.size) return { emails: 0, sms: 0, dryRun: !live };
  const subIds = [...bySub.keys()];
  const { results: subs } = await env.DB.prepare(`SELECT * FROM subscribers WHERE id IN (${subIds.map(() => '?').join(',')})`).bind(...subIds).all<Subscriber>();

  const emails: { msg: EmailMessage; sub: Subscriber; list: NewStocking[] }[] = [];
  for (const sub of subs) {
    const list = bySub.get(sub.id)!;
    const first = list[0];
    const nearby = first.county ? (await findOutfitters(env, { state: first.state, county: first.county, directory: 'Fish', limit: 3 })).listings : [];
    const nearbyHtml = nearby.length
      ? `<div style="margin-top:18px;font-size:14px"><strong>Nearby on Horn & Fin</strong><br>${nearby
          .map((l) => `<a href="${escapeHtml(l.url)}" style="color:#1f3d35">${escapeHtml(l.title)}</a>${l.featured ? ' <span style="color:#5b6b5e">(Featured)</span>' : ''}`)
          .join('<br>')}</div>`
      : '';
    const inner = `<div style="font-size:14px;color:#5b6b5e;margin-bottom:14px">Stocking alerts for the waters you follow.</div>
${list.map((s) => `<div style="border-left:4px solid #2f7d5b;padding:8px 12px;margin:0 0 12px;font-size:16px">${escapeHtml(line(s))}<br><a href="${escapeHtml(s.link_url)}" style="font-size:14px;color:#1f3d35">State stocking report</a></div>`).join('')}
${nearbyHtml}
<div style="font-size:12px;color:#5b6b5e;margin-top:14px">From the ${escapeHtml(STATES[first.state] ?? first.state)} stocking report. Check current fishing rules before you go.</div>`;
    emails.push({
      sub,
      list,
      msg: {
        to: sub.email,
        subject: list.length === 1 ? `Just stocked: ${list[0].water}` : `${list.length} of your waters were just stocked`,
        html: layout(env, sub, inner),
        text: `${list.map(line).join('\n')}\n${first.link_url}\nManage alerts: ${manageUrl(env, sub)}\nUnsubscribe: ${unsubscribeUrl(env, sub)}`,
        headers: listHeaders(env, sub),
      },
    });
  }
  const texts = textsEnabled(env)
    ? emails.filter((e) => e.sub.phone && e.sub.sms_consent_at && !e.sub.sms_stopped && !done.has(`${e.list[0].id}:${e.sub.id}:sms`)).slice(0, 60)
    : [];
  if (!live) {
    console.log(`[stocking dry-run] ${fresh.length} new stockings; would email ${emails.length} and text ${texts.length}`);
    return { emails: emails.length, sms: texts.length, dryRun: true };
  }
  const sent = await sendEmails(env, emails.map((e) => e.msg));
  const ts = nowIso();
  const rows: [number, string, string][] = [];
  emails.forEach((e, i) => sent[i] && e.list.forEach((s) => rows.push([s.id, e.sub.id, 'email'])));
  let sms = 0;
  for (const t of texts) {
    const body = `Horn & Fin: just stocked, ${line(t.list[0])}${t.list.length > 1 ? ` +${t.list.length - 1} more` : ''}. Reply STOP to end texts.`;
    if (await sendSms(env, t.sub.phone!, body)) {
      sms++;
      rows.push([t.list[0].id, t.sub.id, 'sms']);
    }
  }
  const stmts = rows.map(([r, s, c]) => env.DB.prepare('INSERT OR IGNORE INTO stocking_deliveries (report_id, subscriber_id, channel, sent_at) VALUES (?, ?, ?, ?)').bind(r, s, c, ts));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { emails: sent.filter(Boolean).length, sms, dryRun: false };
}

/** Waters on file for a state, for the follow box's type-ahead. */
export async function stockedWaters(env: Env, state: string, q: string): Promise<{ water: string; county: string | null }[]> {
  const { results } = await env.DB.prepare(
    'SELECT water, county FROM stocking_reports WHERE state = ? AND water_key LIKE ? GROUP BY water_key ORDER BY MAX(first_seen) DESC LIMIT 15',
  )
    .bind(state, `%${waterKey(q)}%`)
    .all<{ water: string; county: string | null }>();
  return results;
}

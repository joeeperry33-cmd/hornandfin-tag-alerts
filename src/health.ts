import type { Env, Source } from './types';
import { sendEmails } from './notify';
import { escapeHtml, nowIso, STATES } from './util';
import { pausedNow } from './check';

/**
 * Owner alerts when a state source stops working, so it gets fixed before subscribers miss openings.
 * - A source fails twice in a row: one email (then a recovery email when it works again).
 * - A list with hunts suddenly reads empty: a heads-up, at most weekly per source (usually a broken scraper).
 * - Daily: anything still failing or overdue for a check.
 */

const FAIL_THRESHOLD = 2;
const EMPTY_WARN_MIN = 3; // only warn when a list that had at least this many hunts reads empty

function ownerEmails(env: Env): string[] {
  return (env.OWNER_ALERT_EMAIL ?? env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

async function getFlag(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setFlag(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return;
  }
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(key, value, nowIso())
    .run();
}

function label(src: Pick<Source, 'state' | 'name'>): string {
  const state = STATES[src.state] ?? src.state;
  return src.name.toLowerCase().startsWith(state.toLowerCase()) ? src.name : `${state}: ${src.name}`;
}

/** What the owner should look at, by how the source is read. */
export function fixHint(src: Pick<Source, 'parser'>, error: string): string {
  if (/BRIGHTDATA_API_KEY|APIFY_TOKEN/.test(error)) return 'A key is missing in Cloudflare (Workers & Pages → leftover-tag-alerts → Settings → Variables and Secrets).';
  if (src.parser === 'apify') return 'Open the Apify task, check its last run and log. A 401 means the Apify token changed; a 403 in the log means the state is blocking the proxy (try the residential proxy).';
  if (src.parser === 'brightdata_pdf') return 'Open the azgfd.com scraper in Bright Data and check its last run. A 401 means the Bright Data key changed; "No data" means the leftover section moved on the page.';
  if (src.parser === 'snapshot') return 'The Colorado list is copied by a browser on your computer: make sure the computer is on with the Claude app open and the scheduled tasks are running.';
  if (/403|blocked|denied|captcha|just a moment/i.test(error)) return 'The state site is refusing automated checks. It may need a scraper (Apify or Bright Data) like the other blocked states.';
  if (/not readable|no list|no data|unexpected/i.test(error)) return 'The page loaded but the list was not where we expected; the state may have changed its layout.';
  return 'Often a temporary outage on the state site. If it keeps failing, open the page in a browser to see what changed.';
}

async function emailOwner(env: Env, subject: string, html: string, text: string): Promise<void> {
  const to = ownerEmails(env);
  if (!to.length) return;
  const wrap = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#15211c;line-height:1.5;max-width:620px">
${html}
<p style="font-size:12px;color:#5b6b5e;margin-top:24px">Owner alert from Leftover Tag Alerts. Sources: <a href="${env.API_URL}/admin/subscribers">owner pages</a>.</p></body></html>`;
  await sendEmails(env, to.map((addr) => ({ to: addr, subject, html: wrap, text })));
}

/** After a failed check. failCount is the new consecutive-failure count. */
export async function noteFailure(env: Env, src: Source, error: string, failCount: number): Promise<void> {
  if (failCount < FAIL_THRESHOLD) return;
  const key = `health:fail:${src.id}`;
  if (await getFlag(env, key)) return; // already told the owner; the daily summary repeats it
  await setFlag(env, key, nowIso());
  const name = label(src);
  const hint = fixHint(src, error);
  await emailOwner(
    env,
    `⚠ ${name} is failing`,
    `<h2 style="margin:0 0 8px">${escapeHtml(name)} stopped working</h2>
<p>The last ${failCount} checks failed, so subscribers won't get alerts from this list until it's fixed.</p>
<p><strong>Error:</strong> ${escapeHtml(error)}</p>
<p><strong>What to check:</strong> ${escapeHtml(hint)}</p>
<p><a href="${escapeHtml(src.link_url ?? src.url)}">Open the state page</a></p>
<p style="color:#5b6b5e">We'll email again when it's working, and it stays on the daily health report until then.</p>`,
    `${name} stopped working (${failCount} failed checks).\nError: ${error}\nWhat to check: ${hint}\nState page: ${src.link_url ?? src.url}`,
  );
}

/** After a good check: send a recovery note if the owner was told it was failing. */
export async function noteSuccess(env: Env, src: Source): Promise<void> {
  const key = `health:fail:${src.id}`;
  const since = await getFlag(env, key);
  if (!since) return;
  await setFlag(env, key, null);
  const name = label(src);
  await emailOwner(
    env,
    `✓ ${name} is working again`,
    `<h2 style="margin:0 0 8px">${escapeHtml(name)} is working again</h2><p>Checks are succeeding and alerts from this list are flowing to subscribers.</p>`,
    `${name} is working again.`,
  );
}

/** A list that had hunts now reads empty: usually a broken scraper, sometimes a real sell-out. */
export async function noteEmptyList(env: Env, src: Source, previous: number): Promise<void> {
  if (previous < EMPTY_WARN_MIN) return;
  const key = `health:empty:${src.id}`;
  const last = await getFlag(env, key);
  if (last && Date.now() - new Date(last).getTime() < 7 * 86400_000) return;
  await setFlag(env, key, nowIso());
  const name = label(src);
  await emailOwner(
    env,
    `Heads-up: ${name} now reads empty`,
    `<h2 style="margin:0 0 8px">${escapeHtml(name)} went from ${previous} hunts to none</h2>
<p>That can be a real sell-out or the end of a sale, but a sudden drop to zero is more often a scraper that stopped finding the list.</p>
<p><strong>What to check:</strong> ${escapeHtml(fixHint(src, 'no data'))}</p>
<p><a href="${escapeHtml(src.link_url ?? src.url)}">Open the state page</a> and compare.</p>`,
    `${name} went from ${previous} hunts to none. Check the state page: ${src.link_url ?? src.url}`,
  );
}

/** Daily: one summary of everything failing or overdue. Silent when all is well. */
export async function dailyHealth(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT id, state, name, parser, parser_config, url, link_url, check_minutes, season_start, season_end, rush, last_checked, fail_count, last_error FROM sources WHERE active = 1 ORDER BY state',
  ).all<Source>();
  const now = Date.now();
  const failing = results.filter((s) => s.fail_count >= FAIL_THRESHOLD);
  // Overdue: not checked for 3x its interval (at least 6 hours, at most 3 days).
  const overdue = results.filter((s) => {
    if (s.fail_count >= FAIL_THRESHOLD) return false;
    if (pausedNow(s)) return false; // waiting for its season
    if (!s.last_checked) return true;
    const limit = Math.min(Math.max(s.check_minutes * 3, 360), 4320) * 60_000;
    return now - new Date(s.last_checked).getTime() > limit;
  });
  if (!failing.length && !overdue.length) return 0;
  const row = (s: Source, why: string) =>
    `<li><strong>${escapeHtml(label(s))}</strong>: ${escapeHtml(why)}<br><span style="color:#5b6b5e">${escapeHtml(fixHint(s, s.last_error ?? ''))}</span></li>`;
  const html = `<h2 style="margin:0 0 8px">Daily source check: ${failing.length + overdue.length} need attention</h2>
${failing.length ? `<h3>Failing</h3><ul>${failing.map((s) => row(s, `${s.fail_count} failed checks in a row. ${s.last_error ?? ''}`)).join('')}</ul>` : ''}
${overdue.length ? `<h3>Not checked on schedule</h3><ul>${overdue.map((s) => row(s, s.last_checked ? `last checked ${s.last_checked.slice(0, 16).replace('T', ' ')} UTC` : 'never checked')).join('')}</ul>` : ''}`;
  const text = [...failing.map((s) => `FAILING ${label(s)}: ${s.last_error ?? ''}`), ...overdue.map((s) => `OVERDUE ${label(s)}: last checked ${s.last_checked ?? 'never'}`)].join('\n');
  await emailOwner(env, `Leftover Tag Alerts: ${failing.length + overdue.length} source${failing.length + overdue.length === 1 ? '' : 's'} need attention`, html, text);
  return failing.length + overdue.length;
}

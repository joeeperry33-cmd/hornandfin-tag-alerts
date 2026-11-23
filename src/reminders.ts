import type { Env, Subscriber } from './types';
import { layout, listHeaders, manageUrl, sendEmails, sendSms, unsubscribeUrl, type EmailMessage } from './notify';
import { escapeHtml, matchesList, nowIso, SPECIES, STATES, textsEnabled } from './util';

/** Free deadline and draw-result reminders. Dates come only from the deadlines table (verified by hand). */

export type DeadlineKind = 'apply_open' | 'apply_close' | 'results' | 'leftover_sale' | 'points_only';
export const DEADLINE_KINDS: DeadlineKind[] = ['apply_open', 'apply_close', 'results', 'leftover_sale', 'points_only'];

export interface Deadline {
  id: string;
  state: string;
  species: string | null;
  kind: DeadlineKind;
  date: string;
  time_note: string | null;
  title: string;
  link_url: string;
  source: string;
  verified_at: string;
  active: number;
}

/** Days before the date that each kind of reminder goes out. 0 = the day of. */
export const OFFSETS: Record<DeadlineKind, number[]> = {
  apply_open: [0],
  apply_close: [7, 1],
  points_only: [7, 1],
  results: [0],
  leftover_sale: [1, 0],
};

/** Texts only for the reminders that matter most, so free texts stay cheap. */
const TEXT_OFFSETS: Record<DeadlineKind, number[]> = {
  apply_open: [],
  apply_close: [1],
  points_only: [1],
  results: [0],
  leftover_sale: [0],
};

export const FREE_TEXTS_PER_30_DAYS = 6;
const MAX_REMINDER_EMAILS_PER_RUN = 400;
const MAX_REMINDER_TEXTS_PER_RUN = 60;

/** Today's date in Pacific time as YYYY-MM-DD (the daily run is 6:30-7:30 a.m. Pacific). */
export function pacificDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

export interface DueReminder {
  deadline: Deadline;
  offset: number;
}

/** Which reminders go out today. */
export function dueReminders(deadlines: Deadline[], today: string): DueReminder[] {
  const due: DueReminder[] = [];
  for (const d of deadlines) {
    if (!d.active) continue;
    const away = daysBetween(today, d.date);
    if ((OFFSETS[d.kind] ?? []).includes(away)) due.push({ deadline: d, offset: away });
  }
  return due;
}

export function wantsReminder(sub: Subscriber, d: Deadline): boolean {
  if (sub.deadline_reminders === 0) return false;
  if (!sub.verified_at || sub.unsubscribed_at) return false;
  return matchesList(sub.states, d.state) && matchesList(sub.species, d.species);
}

export function canText(sub: Subscriber, r: DueReminder): boolean {
  return !!sub.phone && !!sub.sms_consent_at && !sub.sms_stopped && (TEXT_OFFSETS[r.deadline.kind] ?? []).includes(r.offset);
}

function friendlyDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function whenText(r: DueReminder): string {
  const d = r.deadline;
  const t = d.time_note ? ` (${d.time_note})` : '';
  if (r.offset === 0) return `Today${t}`;
  if (r.offset === 1) return `Tomorrow, ${friendlyDate(d.date)}${t}`;
  return `In ${r.offset} days, ${friendlyDate(d.date)}${t}`;
}

export function reminderSubject(list: DueReminder[]): string {
  if (list.length > 1) return `${list.length} hunting deadlines and draw dates coming up`;
  const r = list[0];
  const when = r.offset === 0 ? 'today' : r.offset === 1 ? 'tomorrow' : `in ${r.offset} days`;
  return `${r.deadline.title} ${when}`;
}

export function reminderSms(r: DueReminder): string {
  const when = r.offset === 0 ? 'today' : 'tomorrow';
  const body = `Horn & Fin: ${r.deadline.title} ${when}${r.deadline.time_note ? ` (${r.deadline.time_note})` : ''}. ${r.deadline.link_url}`;
  return body.length > 300 ? body.slice(0, 299) + '…' : `${body} Reply STOP to end texts.`;
}

function reminderBlock(r: DueReminder): string {
  const d = r.deadline;
  return `<div style="border-left:4px solid #ff6a13;padding:8px 12px;margin:0 0 14px">
<div style="font-size:13px;color:#5b6b5e;text-transform:uppercase;letter-spacing:.4px">${escapeHtml(STATES[d.state] ?? d.state)}</div>
<div style="font-size:17px;font-weight:bold;margin:2px 0">${escapeHtml(d.title)}</div>
<div style="font-size:15px">${escapeHtml(whenText(r))}</div>
<div style="font-size:14px;margin-top:6px"><a href="${escapeHtml(d.link_url)}" style="color:#1f3d35;font-weight:bold">Go to the official page</a></div>
</div>`;
}

export function reminderEmail(env: Env, sub: Subscriber, list: DueReminder[]): EmailMessage {
  const inner = `<div style="font-size:14px;color:#5b6b5e;margin-bottom:16px">Reminders for the states and species you follow.</div>
${list.map(reminderBlock).join('')}
<div style="font-size:12px;color:#5b6b5e">Dates come from each state's wildlife agency. Always confirm on the official page before you apply. We never apply or buy tags for you.</div>`;
  const text =
    list.map((r) => `${STATES[r.deadline.state] ?? r.deadline.state}: ${r.deadline.title}. ${whenText(r)}. ${r.deadline.link_url}`).join('\n') +
    `\nChange reminders: ${manageUrl(env, sub)}\nUnsubscribe: ${unsubscribeUrl(env, sub)}`;
  return { to: sub.email, subject: reminderSubject(list), html: layout(env, sub, inner), text, headers: listHeaders(env, sub) };
}

/** Daily run. Nothing actually goes out until REMINDERS_LIVE is "true"; before that it only logs. */
export async function sendDeadlineReminders(env: Env, today = pacificDate()): Promise<{ emails: number; sms: number; dryRun: boolean }> {
  const live = env.REMINDERS_LIVE === 'true';
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 8 * 86_400_000).toISOString().slice(0, 10);
  const { results: deadlines } = await env.DB.prepare('SELECT * FROM deadlines WHERE active = 1 AND date >= ? AND date <= ?')
    .bind(today, horizon)
    .all<Deadline>();
  const due = dueReminders(deadlines, today);
  if (!due.length) return { emails: 0, sms: 0, dryRun: !live };

  const { results: subs } = await env.DB.prepare(
    'SELECT * FROM subscribers WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL AND deadline_reminders = 1',
  ).all<Subscriber>();
  const ids = [...new Set(due.map((r) => r.deadline.id))];
  const { results: doneRows } = await env.DB.prepare(
    `SELECT deadline_id, subscriber_id, offset_days, channel FROM reminder_deliveries WHERE deadline_id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ deadline_id: string; subscriber_id: string; offset_days: number; channel: string }>();
  const done = new Set(doneRows.map((r) => `${r.deadline_id}:${r.subscriber_id}:${r.offset_days}:${r.channel}`));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { results: textCounts } = await env.DB.prepare(
    "SELECT subscriber_id, COUNT(*) AS n FROM reminder_deliveries WHERE channel = 'sms' AND sent_at >= ? GROUP BY subscriber_id",
  )
    .bind(since)
    .all<{ subscriber_id: string; n: number }>();
  const textsUsed = new Map(textCounts.map((r) => [r.subscriber_id, r.n]));

  const emails: { msg: EmailMessage; subId: string; list: DueReminder[] }[] = [];
  const texts: { to: string; body: string; subId: string; r: DueReminder }[] = [];
  for (const s of subs) {
    const mine = due.filter((r) => wantsReminder(s, r.deadline));
    const toEmail = mine.filter((r) => !done.has(`${r.deadline.id}:${s.id}:${r.offset}:email`));
    if (toEmail.length && emails.length < MAX_REMINDER_EMAILS_PER_RUN) emails.push({ msg: reminderEmail(env, s, toEmail), subId: s.id, list: toEmail });
    if (!textsEnabled(env)) continue;
    let used = textsUsed.get(s.id) ?? 0;
    for (const r of mine) {
      if (used >= FREE_TEXTS_PER_30_DAYS || texts.length >= MAX_REMINDER_TEXTS_PER_RUN) break;
      if (!canText(s, r) || done.has(`${r.deadline.id}:${s.id}:${r.offset}:sms`)) continue;
      texts.push({ to: s.phone!, body: reminderSms(r), subId: s.id, r });
      used++;
    }
  }

  if (!live) {
    console.log(`[reminders dry-run] ${due.length} due today; would email ${emails.length} and text ${texts.length}`);
    return { emails: emails.length, sms: texts.length, dryRun: true };
  }

  const sent = await sendEmails(env, emails.map((e) => e.msg));
  const rows: { id: string; sub: string; off: number; ch: string }[] = [];
  emails.forEach((e, i) => sent[i] && e.list.forEach((r) => rows.push({ id: r.deadline.id, sub: e.subId, off: r.offset, ch: 'email' })));
  let sms = 0;
  for (const t of texts) {
    if (await sendSms(env, t.to, t.body)) {
      sms++;
      rows.push({ id: t.r.deadline.id, sub: t.subId, off: t.r.offset, ch: 'sms' });
    }
  }
  const ts = nowIso();
  const stmts = rows.map((r) =>
    env.DB.prepare('INSERT OR IGNORE INTO reminder_deliveries (deadline_id, subscriber_id, offset_days, channel, sent_at) VALUES (?, ?, ?, ?, ?)').bind(
      r.id,
      r.sub,
      r.off,
      r.ch,
      ts,
    ),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { emails: sent.filter(Boolean).length, sms, dryRun: false };
}

/** Checks one deadline from the admin load. Returns an error message, or null when it's fine. */
export function deadlineProblem(d: Partial<Deadline>): string | null {
  if (!d.id || !/^[a-z0-9-]{3,80}$/.test(d.id)) return 'id must be 3-80 lowercase letters, digits or dashes';
  if (!d.state || !STATES[d.state]) return `unknown state ${d.state}`;
  if (d.species && d.species.split(',').some((s) => !SPECIES.includes(s))) return `unknown species ${d.species}`;
  if (!d.kind || !DEADLINE_KINDS.includes(d.kind)) return `kind must be one of ${DEADLINE_KINDS.join(', ')}`;
  if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(d.date))) return 'date must be YYYY-MM-DD';
  if (!d.title || d.title.length > 140) return 'title is required (140 characters max)';
  if (!d.link_url || !/^https:\/\//.test(d.link_url)) return 'link_url must be the https agency page that states the date';
  if (!d.source || d.source.length < 4) return 'source is required: say where the date was confirmed';
  return null;
}

/** Admin: insert or replace verified deadlines. Body: {"deadlines":[...]} */
export async function loadDeadlines(env: Env, body: { deadlines?: Partial<Deadline>[] }): Promise<{ loaded: number; errors: string[] }> {
  const list = body.deadlines ?? [];
  const errors: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const d of list) {
    const problem = deadlineProblem(d);
    if (problem) {
      errors.push(`${d.id ?? '?'}: ${problem}`);
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO deadlines (id, state, species, kind, date, time_note, title, link_url, source, verified_at, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, species = excluded.species, kind = excluded.kind, date = excluded.date,
           time_note = excluded.time_note, title = excluded.title, link_url = excluded.link_url, source = excluded.source,
           verified_at = excluded.verified_at, active = excluded.active`,
      ).bind(d.id, d.state, d.species ?? null, d.kind, d.date, d.time_note ?? null, d.title, d.link_url, d.source, d.verified_at ?? nowIso(), d.active ?? 1),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { loaded: stmts.length, errors };
}

/** Public list for the Horn & Fin deadlines board and the planner. */
export async function upcomingDeadlines(env: Env, opts: { state?: string; species?: string; days?: number } = {}): Promise<Deadline[]> {
  const today = pacificDate();
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + (opts.days ?? 120) * 86_400_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT * FROM deadlines WHERE active = 1 AND date >= ? AND date <= ? ORDER BY date, state')
    .bind(today, until)
    .all<Deadline>();
  return results.filter((d) => (!opts.state || d.state === opts.state) && (!opts.species || matchesList(opts.species, d.species)));
}

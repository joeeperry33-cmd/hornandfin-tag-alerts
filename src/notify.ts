import type { AlertEvent, Env, EventItem, Subscriber } from './types';
import { facetLabels, tagWanted, type Opening, type TagFacets } from './tagtype';
import { escapeHtml, isIntro, matchesList, nowIso, STATES } from './util';

const INSTANT_WINDOW_HOURS = 6; // never send an "instant" alert about something older than this
const DIGEST_WINDOW_HOURS = 26;
const MAX_EMAILS_PER_RUN = 300;
const MAX_SMS_PER_RUN = 40;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Resend batch endpoint: up to 100 emails per request. */
export async function sendEmails(env: Env, messages: EmailMessage[]): Promise<boolean[]> {
  if (!messages.length) return [];
  if (!env.RESEND_API_KEY) {
    console.log(`[dry-run] would email ${messages.length}:`, messages.map((m) => `${m.to}: ${m.subject}`));
    return messages.map(() => true);
  }
  const results: boolean[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(chunk.map((m) => ({ from: env.FROM_EMAIL, ...m }))),
    });
    if (!res.ok) console.error('resend batch failed', res.status, await res.text());
    results.push(...chunk.map(() => res.ok));
  }
  return results;
}

export async function sendSms(env: Env, to: string, body: string): Promise<boolean> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    console.log(`[dry-run] would text ${to}: ${body}`);
    return true;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body }),
  });
  if (!res.ok) console.error('twilio failed', res.status, await res.text());
  return res.ok;
}

function manageUrl(env: Env, sub: Subscriber): string {
  return `${env.API_URL}/manage?token=${encodeURIComponent(sub.manage_token)}`;
}

function unsubscribeUrl(env: Env, sub: Subscriber): string {
  return `${env.API_URL}/api/unsubscribe?token=${encodeURIComponent(sub.manage_token)}`;
}

function listHeaders(env: Env, sub: Subscriber): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(env, sub)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function layout(env: Env, sub: Subscriber, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#e4e9e1;font-family:Arial,Helvetica,sans-serif;color:#15211c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden">
<tr><td style="background:#1f3d35;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold;letter-spacing:.2px"><a href="${env.SITE_URL}" style="color:#ffffff;text-decoration:none">Leftover Tag Alerts</a></td></tr>
<tr><td style="padding:24px">${inner}</td></tr>
<tr><td style="padding:16px 24px;background:#e4e9e1;font-size:12px;color:#4f5c55;line-height:1.6">
Tag availability changes fast and is set by each state agency. Always confirm on the state's site before you travel.<br>
<a href="${manageUrl(env, sub)}" style="color:#1f3d35">Change states or species</a> &nbsp;|&nbsp; <a href="${unsubscribeUrl(env, sub)}" style="color:#1f3d35">Unsubscribe</a><br>
${escapeHtml(env.SITE_NAME)}, operated by ${escapeHtml(env.BUSINESS_NAME)}<br>${escapeHtml(env.BUSINESS_ADDRESS)}
</td></tr></table></td></tr></table></body></html>`;
}

/** An alert as one subscriber sees it: only the hunts that match their settings, each with its tag type. */
export interface Personal {
  title: string;
  lines: { text: string; tags: string[] }[];
  tags: string[]; // tag type for alerts with no hunt list (a page that changed)
}

const MAX_LINES = 25;

function filterOf(sub: Subscriber) {
  return { openings: sub.openings || '*', weapons: sub.weapons || '*', sexes: sub.sexes || '*', home_state: sub.home_state || null };
}

function facetsOf(x: { weapon?: string | null; sex?: string | null; residency?: string | null }): TagFacets {
  return { weapon: (x.weapon as TagFacets['weapon']) ?? null, sex: (x.sex as TagFacets['sex']) ?? null, residency: (x.residency as TagFacets['residency']) ?? null };
}

function itemText(it: EventItem): string {
  if (it.prev_quantity != null && it.quantity != null) return `${it.label}: ${it.prev_quantity} → ${it.quantity}`;
  return it.quantity != null ? `${it.label} (${it.quantity} available)` : it.label;
}

/** Null when nothing in this alert matches the subscriber. */
export function personalize(sub: Subscriber, e: AlertEvent, items: EventItem[]): Personal | null {
  if (!matchesList(sub.states, e.state)) return null;
  const f = filterOf(sub);
  const opening = (e.opening as Opening) ?? null;
  if (!items.length) {
    if (!matchesList(sub.species, e.species)) return null;
    const facets = facetsOf(e);
    if (!tagWanted(f, e.state, opening, facets)) return null;
    return { title: e.title, lines: e.detail ? e.detail.split('\n').map((text) => ({ text, tags: [] })) : [], tags: facetLabels(opening, facets) };
  }
  const mine = items.filter((it) => matchesList(sub.species, it.species) && tagWanted(f, e.state, opening, facetsOf(it)));
  if (!mine.length) return null;
  const stateName = STATES[e.state] ?? e.state;
  let title = e.title;
  if (mine.length !== items.length) {
    if (mine.length === 1) title = e.kind === 'quantity_up' ? `${stateName}: more tags returned for ${mine[0].label}` : `${stateName}: ${itemText(mine[0])} just opened up`;
    else title = e.kind === 'quantity_up' ? `${stateName}: tags returned in ${mine.length} of your hunts` : `${stateName}: ${mine.length} hunts you follow just opened up`;
  }
  const lines = mine.slice(0, MAX_LINES).map((it) => ({ text: itemText(it), tags: facetLabels(opening, facetsOf(it)) }));
  if (mine.length > MAX_LINES) lines.push({ text: `…and ${mine.length - MAX_LINES} more`, tags: [] });
  return { title, lines, tags: [] };
}

function tagChips(tags: string[]): string {
  return tags
    .map((t) => `<span style="display:inline-block;background:#e4e9e1;color:#1f3d35;border-radius:3px;padding:1px 6px;margin:2px 4px 0 0;font-size:12px;font-weight:bold">${escapeHtml(t)}</span>`)
    .join('');
}

function eventBlock(e: AlertEvent, p: Personal): string {
  const lines = p.lines.length
    ? `<div style="margin:8px 0 12px;font-size:14px;line-height:1.5;color:#33433a">${p.lines
        .map((l) => `<div style="margin:0 0 6px">${escapeHtml(l.text)}${l.tags.length ? `<br>${tagChips(l.tags)}` : ''}</div>`)
        .join('')}</div>`
    : '';
  const head = p.tags.length ? `<div style="margin:6px 0 0">${tagChips(p.tags)}</div>` : '';
  return `<div style="border-left:4px solid #ff6a13;padding:4px 0 4px 12px;margin:0 0 20px">
<div style="font-size:16px;font-weight:bold">${escapeHtml(p.title)}</div>${head}${lines}
<a href="${escapeHtml(e.link_url)}" style="display:inline-block;background:#ff6a13;color:#15211c;text-decoration:none;padding:9px 14px;border-radius:3px;font-size:14px;font-weight:bold">Go to the ${escapeHtml(STATES[e.state] ?? e.state)} site</a></div>`;
}

function eventText(e: AlertEvent, p: Personal): string {
  const tags = p.tags.length ? `[${p.tags.join(', ')}]\n` : '';
  const lines = p.lines.map((l) => (l.tags.length ? `- ${l.text} [${l.tags.join(', ')}]` : `- ${l.text}`)).join('\n');
  return `${p.title}\n${tags}${lines ? lines + '\n' : ''}${e.link_url}\n`;
}

async function itemsFor(env: Env, eventIds: number[]): Promise<Map<number, EventItem[]>> {
  const map = new Map<number, EventItem[]>();
  for (let i = 0; i < eventIds.length; i += 90) {
    const ids = eventIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT * FROM event_items WHERE event_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<EventItem>();
    for (const r of results) {
      const list = map.get(r.event_id) ?? [];
      list.push(r);
      map.set(r.event_id, list);
    }
  }
  return map;
}

async function deliveredSet(env: Env, eventIds: number[], channel: string): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const placeholders = eventIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT event_id, subscriber_id FROM deliveries WHERE channel = ? AND event_id IN (${placeholders})`,
  )
    .bind(channel, ...eventIds)
    .all<{ event_id: number; subscriber_id: string }>();
  return new Set(results.map((r) => `${r.event_id}:${r.subscriber_id}`));
}

async function recordDeliveries(env: Env, rows: { eventId: number; subId: string; channel: string }[]): Promise<void> {
  const ts = nowIso();
  const stmts = rows.map((r) =>
    env.DB.prepare('INSERT OR IGNORE INTO deliveries (event_id, subscriber_id, channel, sent_at) VALUES (?, ?, ?, ?)').bind(
      r.eventId,
      r.subId,
      r.channel,
      ts,
    ),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function recentEvents(env: Env, hours: number): Promise<AlertEvent[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { results } = await env.DB.prepare('SELECT * FROM events WHERE created_at >= ? ORDER BY created_at').bind(since).all<AlertEvent>();
  return results;
}

/** Paid tier (everyone during launch): one email (and one text, if opted in) per event, as soon as it's found. */
export async function sendInstantAlerts(env: Env): Promise<{ emails: number; sms: number }> {
  const events = await recentEvents(env, INSTANT_WINDOW_HOURS);
  if (!events.length) return { emails: 0, sms: 0 };
  const { results: subs } = await env.DB.prepare(
    `SELECT * FROM subscribers WHERE (tier = 'paid' OR ?1 = 1) AND verified_at IS NOT NULL AND unsubscribed_at IS NULL`,
  )
    .bind(isIntro(env) ? 1 : 0)
    .all<Subscriber>();
  const ids = events.map((e) => e.id);
  const items = await itemsFor(env, ids);
  const emailed = await deliveredSet(env, ids, 'email');
  const texted = await deliveredSet(env, ids, 'sms');

  const emails: { msg: EmailMessage; eventId: number; subId: string }[] = [];
  const texts: { to: string; body: string; eventId: number; subId: string }[] = [];
  for (const e of events) {
    for (const s of subs) {
      const p = personalize(s, e, items.get(e.id) ?? []);
      if (!p) continue;
      if (!emailed.has(`${e.id}:${s.id}`) && emails.length < MAX_EMAILS_PER_RUN) {
        emails.push({
          eventId: e.id,
          subId: s.id,
          msg: {
            to: s.email,
            subject: p.title,
            html: layout(env, s, eventBlock(e, p)),
            text: `${eventText(e, p)}\nManage alerts: ${manageUrl(env, s)}\nUnsubscribe: ${unsubscribeUrl(env, s)}`,
            headers: listHeaders(env, s),
          },
        });
      }
      if (s.phone && s.sms_consent_at && !s.sms_stopped && !texted.has(`${e.id}:${s.id}`) && texts.length < MAX_SMS_PER_RUN) {
        texts.push({ to: s.phone, body: smsBody(e, p), eventId: e.id, subId: s.id });
      }
    }
  }

  const sent = await sendEmails(env, emails.map((x) => x.msg));
  await recordDeliveries(env, emails.filter((_, i) => sent[i]).map((x) => ({ eventId: x.eventId, subId: x.subId, channel: 'email' })));

  const smsDone: { eventId: number; subId: string; channel: string }[] = [];
  for (const t of texts) if (await sendSms(env, t.to, t.body)) smsDone.push({ eventId: t.eventId, subId: t.subId, channel: 'sms' });
  await recordDeliveries(env, smsDone);
  return { emails: sent.filter(Boolean).length, sms: smsDone.length };
}

export function smsBody(e: AlertEvent, p: Personal): string {
  const tags = p.lines.length === 1 ? p.lines[0].tags : p.tags;
  const head = `Leftover Tag Alerts: ${p.title}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  const tail = ` ${e.link_url} Reply STOP to end.`;
  const room = 300 - tail.length;
  return (head.length > room ? head.slice(0, room - 1) + '…' : head) + tail;
}

/** Free tier: one morning email covering everything found in the last day. */
export async function sendDigests(env: Env): Promise<number> {
  if (isIntro(env)) return 0; // during launch everyone already gets instant alerts
  const events = await recentEvents(env, DIGEST_WINDOW_HOURS);
  if (!events.length) return 0;
  const { results: subs } = await env.DB.prepare(
    `SELECT * FROM subscribers WHERE tier = 'free' AND verified_at IS NOT NULL AND unsubscribed_at IS NULL`,
  ).all<Subscriber>();
  const done = await deliveredSet(env, events.map((e) => e.id), 'digest');
  const items = await itemsFor(env, events.map((e) => e.id));

  const batch: { msg: EmailMessage; eventIds: number[]; subId: string }[] = [];
  for (const s of subs) {
    const mine = events
      .filter((e) => !done.has(`${e.id}:${s.id}`))
      .map((e) => ({ e, p: personalize(s, e, items.get(e.id) ?? []) }))
      .filter((x): x is { e: AlertEvent; p: Personal } => x.p !== null);
    if (!mine.length) continue;
    const upsell = `<div style="background:#e4e9e1;border-radius:4px;padding:12px 14px;font-size:14px;margin-top:8px">
Leftover and returned tags often sell out within hours. <a href="${manageUrl(env, s)}" style="color:#1f3d35;font-weight:bold">Get instant email and text alerts</a> for ${escapeHtml(env.PAID_PRICE_LABEL)}.</div>`;
    batch.push({
      eventIds: mine.map((x) => x.e.id),
      subId: s.id,
      msg: {
        to: s.email,
        subject: mine.length === 1 ? mine[0].p.title : `${mine.length} tag openings since yesterday`,
        html: layout(env, s, `<div style="font-size:14px;color:#5b6b5e;margin-bottom:16px">Here's what opened up in the last day.</div>${mine.map((x) => eventBlock(x.e, x.p)).join('')}${upsell}`),
        text: mine.map((x) => eventText(x.e, x.p)).join('\n') + `\nInstant alerts: ${manageUrl(env, s)}\nUnsubscribe: ${unsubscribeUrl(env, s)}`,
        headers: listHeaders(env, s),
      },
    });
    if (batch.length >= MAX_EMAILS_PER_RUN) break;
  }
  const sent = await sendEmails(env, batch.map((b) => b.msg));
  await recordDeliveries(
    env,
    batch.flatMap((b, i) => (sent[i] ? b.eventIds.map((eventId) => ({ eventId, subId: b.subId, channel: 'digest' })) : [])),
  );
  return sent.filter(Boolean).length;
}

export async function sendVerification(env: Env, sub: Subscriber): Promise<boolean> {
  const url = `${env.API_URL}/api/verify?token=${encodeURIComponent(sub.verify_token)}`;
  const inner = `<div style="font-size:16px;line-height:1.5">Confirm your email to start getting leftover and returned tag alerts.</div>
<p><a href="${url}" style="display:inline-block;background:#ff6a13;color:#15211c;text-decoration:none;padding:10px 16px;border-radius:3px;font-weight:bold">Confirm my alerts</a></p>
<div style="font-size:13px;color:#5b6b5e">Didn't sign up? Ignore this email and you won't hear from us.</div>`;
  const [ok] = await sendEmails(env, [
    { to: sub.email, subject: 'Confirm your Leftover Tag Alerts sign-up', html: layout(env, sub, inner), text: `Confirm your tag alerts: ${url}` },
  ]);
  return ok;
}

export async function sendSignInLink(env: Env, sub: Subscriber): Promise<boolean> {
  const url = `${env.API_URL}/manage?token=${encodeURIComponent(sub.manage_token)}`;
  const inner = `<div style="font-size:16px;line-height:1.5">Here's your link to sign in and change your tag alerts.</div>
<p><a href="${url}" style="display:inline-block;background:#ff6a13;color:#15211c;text-decoration:none;padding:10px 16px;border-radius:3px;font-weight:bold">Sign in to my alerts</a></p>
<div style="font-size:13px;color:#5b6b5e">Didn't ask for this? You can ignore it. Nothing changes unless you use the link.</div>`;
  const [ok] = await sendEmails(env, [
    { to: sub.email, subject: 'Your Leftover Tag Alerts sign-in link', html: layout(env, sub, inner), text: `Sign in to change your tag alerts: ${url}` },
  ]);
  return ok;
}

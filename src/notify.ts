import type { AlertEvent, Env, Subscriber } from './types';
import { escapeHtml, matchesList, nowIso, STATES } from './util';

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
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d2a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f3a2a;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">Horn &amp; Fin <span style="color:#f07c1b">Tag Alerts</span></td></tr>
<tr><td style="padding:24px">${inner}</td></tr>
<tr><td style="padding:16px 24px;background:#f4f1ea;font-size:12px;color:#5b6b5e;line-height:1.5">
Tag availability changes fast and is set by each state agency. Always confirm on the state's site before you travel.<br>
<a href="${manageUrl(env, sub)}" style="color:#1f3a2a">Change states or species</a> · <a href="${unsubscribeUrl(env, sub)}" style="color:#1f3a2a">Unsubscribe</a><br>
Horn &amp; Fin · Perry Capital LLC · 158 Valley View Dr, Auburn, CA 95603
</td></tr></table></td></tr></table></body></html>`;
}

function eventBlock(e: AlertEvent): string {
  const detail = e.detail
    ? `<div style="margin:8px 0 12px;font-size:14px;line-height:1.5;color:#33433a">${escapeHtml(e.detail).replace(/\n/g, '<br>')}</div>`
    : '';
  return `<div style="border-left:4px solid #f07c1b;padding:4px 0 4px 12px;margin:0 0 20px">
<div style="font-size:16px;font-weight:bold">${escapeHtml(e.title)}</div>${detail}
<a href="${escapeHtml(e.link_url)}" style="display:inline-block;background:#f07c1b;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:14px;font-weight:bold">Go to the ${escapeHtml(STATES[e.state] ?? e.state)} site</a></div>`;
}

function eventText(e: AlertEvent): string {
  return `${e.title}\n${e.detail ? e.detail + '\n' : ''}${e.link_url}\n`;
}

export function wants(sub: Subscriber, e: AlertEvent): boolean {
  return matchesList(sub.states, e.state) && matchesList(sub.species, e.species);
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

/** Paid tier: one email (and one text, if opted in) per event, as soon as it's found. */
export async function sendInstantAlerts(env: Env): Promise<{ emails: number; sms: number }> {
  const events = await recentEvents(env, INSTANT_WINDOW_HOURS);
  if (!events.length) return { emails: 0, sms: 0 };
  const { results: subs } = await env.DB.prepare(
    `SELECT * FROM subscribers WHERE tier = 'paid' AND verified_at IS NOT NULL AND unsubscribed_at IS NULL`,
  ).all<Subscriber>();
  const ids = events.map((e) => e.id);
  const emailed = await deliveredSet(env, ids, 'email');
  const texted = await deliveredSet(env, ids, 'sms');

  const emails: { msg: EmailMessage; eventId: number; subId: string }[] = [];
  const texts: { to: string; body: string; eventId: number; subId: string }[] = [];
  for (const e of events) {
    for (const s of subs) {
      if (!wants(s, e)) continue;
      if (!emailed.has(`${e.id}:${s.id}`) && emails.length < MAX_EMAILS_PER_RUN) {
        emails.push({
          eventId: e.id,
          subId: s.id,
          msg: {
            to: s.email,
            subject: e.title,
            html: layout(env, s, eventBlock(e)),
            text: `${eventText(e)}\nManage alerts: ${manageUrl(env, s)}\nUnsubscribe: ${unsubscribeUrl(env, s)}`,
            headers: listHeaders(env, s),
          },
        });
      }
      if (s.phone && s.sms_consent_at && !s.sms_stopped && !texted.has(`${e.id}:${s.id}`) && texts.length < MAX_SMS_PER_RUN) {
        texts.push({ to: s.phone, body: smsBody(e), eventId: e.id, subId: s.id });
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

export function smsBody(e: AlertEvent): string {
  const head = `Horn & Fin: ${e.title}`;
  const tail = ` ${e.link_url} Reply STOP to end.`;
  const room = 300 - tail.length;
  return (head.length > room ? head.slice(0, room - 1) + '…' : head) + tail;
}

/** Free tier: one morning email covering everything found in the last day. */
export async function sendDigests(env: Env): Promise<number> {
  const events = await recentEvents(env, DIGEST_WINDOW_HOURS);
  if (!events.length) return 0;
  const { results: subs } = await env.DB.prepare(
    `SELECT * FROM subscribers WHERE tier = 'free' AND verified_at IS NOT NULL AND unsubscribed_at IS NULL`,
  ).all<Subscriber>();
  const done = await deliveredSet(env, events.map((e) => e.id), 'digest');

  const batch: { msg: EmailMessage; eventIds: number[]; subId: string }[] = [];
  for (const s of subs) {
    const mine = events.filter((e) => wants(s, e) && !done.has(`${e.id}:${s.id}`));
    if (!mine.length) continue;
    const upsell = `<div style="background:#f4f1ea;border-radius:6px;padding:12px 14px;font-size:14px;margin-top:8px">
Leftover and returned tags often sell out within hours. <a href="${manageUrl(env, s)}" style="color:#1f3a2a;font-weight:bold">Get instant email and text alerts</a> for ${escapeHtml(env.PAID_PRICE_LABEL)}.</div>`;
    batch.push({
      eventIds: mine.map((e) => e.id),
      subId: s.id,
      msg: {
        to: s.email,
        subject: mine.length === 1 ? mine[0].title : `${mine.length} tag openings since yesterday`,
        html: layout(env, s, `<div style="font-size:14px;color:#5b6b5e;margin-bottom:16px">Here's what opened up in the last day.</div>${mine.map(eventBlock).join('')}${upsell}`),
        text: mine.map(eventText).join('\n') + `\nInstant alerts: ${manageUrl(env, s)}\nUnsubscribe: ${unsubscribeUrl(env, s)}`,
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
<p><a href="${url}" style="display:inline-block;background:#f07c1b;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:4px;font-weight:bold">Confirm my alerts</a></p>
<div style="font-size:13px;color:#5b6b5e">Didn't sign up? Ignore this email and you won't hear from us.</div>`;
  const [ok] = await sendEmails(env, [
    { to: sub.email, subject: 'Confirm your Horn & Fin tag alerts', html: layout(env, sub, inner), text: `Confirm your tag alerts: ${url}` },
  ]);
  return ok;
}

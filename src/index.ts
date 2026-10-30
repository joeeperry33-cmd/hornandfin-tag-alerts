import { runChecks } from './check';
import { OPENINGS, SEX_CHOICES, WEAPON_CHOICES } from './tagtype';
import { sendDigests, sendInstantAlerts, sendSignInLink, sendVerification } from './notify';
import { loginPage, managePage, messagePage } from './pages';
import { botPage, faviconSvg, homePage, loadHomeData, privacyPage, robotsTxt, sitemapXml, termsPage } from './site';
import { createCheckout, createPortal, handleStripeEvent, verifyStripeSignature, verifyTwilioSignature } from './stripe';
import type { AlertEvent, Env, Source, Subscriber } from './types';
import { isIntro, json, normalizeEmail, normalizeUsPhone, nowIso, parseList, randomToken, SPECIES, STATES, textsEnabled } from './util';
import { widgetJs } from './widget';

const STATE_CODES = Object.keys(STATES);
const SIGNUPS_PER_IP_PER_HOUR = 5;

/** Origins allowed to call the API from a browser: our own site plus any site embedding the form. */
export function allowedOrigin(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  let host = '';
  try { host = new URL(origin).hostname.replace(/^www\./, ''); } catch { return false; }
  const allowed = [new URL(env.SITE_URL).hostname, ...(env.EMBED_ORIGINS ?? '').split(',')]
    .map((h) => h.trim().replace(/^www\./, ''))
    .filter(Boolean);
  return allowed.includes(host);
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return allowedOrigin(env, origin)
    ? { 'access-control-allow-origin': origin!, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
    : {};
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return {}; }
}

async function byManageToken(env: Env, token: unknown): Promise<Subscriber | null> {
  if (typeof token !== 'string' || token.length < 20) return null;
  return env.DB.prepare('SELECT * FROM subscribers WHERE manage_token = ?').bind(token).first<Subscriber>();
}

const SESSION_COOKIE = 'lta_session';
const SESSION_DAYS = 180;

/** Shared per-IP limit for sign-ups and sign-in requests. Records the attempt. */
async function rateLimited(env: Env, req: Request): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM signup_log WHERE ip = ? AND created_at >= ?').bind(ip, hourAgo).first<{ n: number }>();
  if ((recent?.n ?? 0) >= SIGNUPS_PER_IP_PER_HOUR) return true;
  await env.DB.prepare('INSERT INTO signup_log (ip, created_at) VALUES (?, ?)').bind(ip, nowIso()).run();
  return false;
}

/** Confirmed subscribers get a sign-in link; unconfirmed ones get a fresh confirmation link. */
async function sendAccessEmail(env: Env, sub: Subscriber): Promise<void> {
  if (sub.verified_at) {
    await sendSignInLink(env, sub);
    return;
  }
  const verifyToken = randomToken();
  await env.DB.prepare('UPDATE subscribers SET verify_token = ? WHERE id = ?').bind(verifyToken, sub.id).run();
  await sendVerification(env, { ...sub, verify_token: verifyToken });
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(token: string, url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`;
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
}

async function signInRequest(env: Env, req: Request): Promise<Response> {
  const b = await body(req);
  const email = normalizeEmail(String(b.email ?? ''));
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  if (await rateLimited(env, req)) return json({ error: 'Too many requests from here. Try again in an hour.' }, 429);
  const sub = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first<Subscriber>();
  if (sub) await sendAccessEmail(env, sub);
  // Same answer whether or not the address is subscribed.
  return json({ ok: true });
}

async function subscribe(env: Env, req: Request): Promise<Response> {
  const h = cors(env, req);
  const b = await body(req);
  if (b.website) return json({ ok: true }, 200, h); // honeypot filled: pretend success
  const email = normalizeEmail(String(b.email ?? ''));
  if (!email) return json({ error: 'Enter a valid email address.' }, 400, h);

  if (await rateLimited(env, req)) return json({ error: 'Too many requests from here. Try again in an hour.' }, 429, h);

  const states = parseList(b.states, STATE_CODES, true);
  const species = parseList(b.species, SPECIES, false);
  const existing = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first<Subscriber>();
  if (existing) {
    // Never change an existing account from an unauthenticated form. Confirmed subscribers get a
    // sign-in link instead; unconfirmed ones get a fresh confirmation link. The response is the same
    // either way, so the form never reveals who is subscribed.
    await sendAccessEmail(env, existing);
    return json({ ok: true }, 200, h);
  }
  const sub: Subscriber = {
    id: crypto.randomUUID(),
    email,
    phone: null,
    sms_consent_at: null,
    tier: 'free',
    states,
    species,
    verified_at: null,
    verify_token: randomToken(),
    manage_token: randomToken(),
    stripe_customer: null,
    stripe_sub: null,
    sms_stopped: 0,
    unsubscribed_at: null,
    created_at: nowIso(),
  };
  await env.DB.prepare(
    `INSERT INTO subscribers (id, email, tier, states, species, verify_token, manage_token, created_at) VALUES (?, ?, 'free', ?, ?, ?, ?, ?)`,
  )
    .bind(sub.id, sub.email, sub.states, sub.species, sub.verify_token, sub.manage_token, sub.created_at)
    .run();
  await sendVerification(env, sub);
  return json({ ok: true }, 200, h);
}

async function verify(env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  const sub = token.length >= 20 ? await env.DB.prepare('SELECT * FROM subscribers WHERE verify_token = ?').bind(token).first<Subscriber>() : null;
  if (!sub) return messagePage(env, 'Link expired', 'That confirmation link is no longer valid. Sign up again on the <a href="/">home page</a> to get a fresh one.');
  await env.DB.prepare('UPDATE subscribers SET verified_at = COALESCE(verified_at, ?), unsubscribed_at = NULL, verify_token = ? WHERE id = ?')
    .bind(nowIso(), randomToken(), sub.id)
    .run();
  return Response.redirect(`${env.API_URL}/manage?token=${encodeURIComponent(sub.manage_token)}&welcome=1`, 302);
}

async function unsubscribe(env: Env, url: URL, req: Request): Promise<Response> {
  const sub = await byManageToken(env, url.searchParams.get('token'));
  if (sub) await env.DB.prepare('UPDATE subscribers SET unsubscribed_at = ? WHERE id = ?').bind(nowIso(), sub.id).run();
  if (req.method === 'POST') return new Response(null, { status: 204 }); // one-click from mail clients
  const note = sub?.tier === 'paid' ? ' Your paid plan is still active; use Manage billing on your alerts page to cancel it.' : '';
  return messagePage(env, 'Unsubscribed', `You won't get any more tag alerts.${note}`);
}

async function manageUpdate(env: Env, req: Request): Promise<Response> {
  const b = await body(req);
  const sub = await byManageToken(env, b.token);
  if (!sub) return json({ error: 'This link has expired.' }, 401);
  const states = parseList(b.states, STATE_CODES, true);
  const species = parseList(b.species, SPECIES, false);
  const allOrList = (v: unknown, allowed: readonly string[]) => {
    const list = parseList(v, [...allowed], false);
    return list.split(',').length === allowed.length ? '*' : list;
  };
  const openings = allOrList(b.openings, OPENINGS);
  const weapons = allOrList(b.weapons, WEAPON_CHOICES);
  const sexes = allOrList(b.sexes, SEX_CHOICES);
  const home = String(b.home_state ?? '').trim().toUpperCase();
  const homeState = STATE_CODES.includes(home) ? home : null;
  const pageAlerts = b.page_alerts === true ? 1 : 0;
  let phone = sub.phone;
  let consentAt = sub.sms_consent_at;
  let stopped = sub.sms_stopped;
  if ((sub.tier === 'paid' || isIntro(env)) && textsEnabled(env) && b.phone !== undefined) {
    const raw = String(b.phone ?? '').trim();
    if (raw === '') { phone = null; consentAt = null; }
    else {
      phone = normalizeUsPhone(raw);
      if (!phone) return json({ error: 'Enter a 10-digit US cell number.' }, 400);
      if (b.sms_consent !== true) return json({ error: 'Check the box to agree to text alerts, or clear the number.' }, 400);
      if (!consentAt || phone !== sub.phone || stopped) { consentAt = nowIso(); stopped = 0; }
    }
  }
  await env.DB.prepare('UPDATE subscribers SET states = ?, species = ?, openings = ?, weapons = ?, sexes = ?, home_state = ?, page_alerts = ?, phone = ?, sms_consent_at = ?, sms_stopped = ?, unsubscribed_at = NULL WHERE id = ?')
    .bind(states, species, openings, weapons, sexes, homeState, pageAlerts, phone, consentAt, stopped, sub.id)
    .run();
  return json({ ok: true });
}

async function smsInbound(env: Env, req: Request): Promise<Response> {
  const text = await req.text();
  const params = new URLSearchParams(text);
  if (env.TWILIO_AUTH_TOKEN) {
    const ok = await verifyTwilioSignature(`${env.API_URL}/api/sms/inbound`, params, req.headers.get('x-twilio-signature'), env.TWILIO_AUTH_TOKEN);
    if (!ok) return new Response('bad signature', { status: 403 });
  }
  const from = params.get('From') ?? '';
  const word = (params.get('Body') ?? '').trim().toUpperCase();
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) {
    await env.DB.prepare('UPDATE subscribers SET sms_stopped = 1 WHERE phone = ?').bind(from).run();
  } else if (['START', 'UNSTOP', 'YES'].includes(word)) {
    await env.DB.prepare('UPDATE subscribers SET sms_stopped = 0 WHERE phone = ? AND sms_consent_at IS NOT NULL').bind(from).run();
  }
  // Twilio's built-in opt-out replies handle STOP/HELP wording; send no extra message.
  return new Response('<Response></Response>', { headers: { 'content-type': 'text/xml' } });
}

async function feed(env: Env, url: URL, req: Request): Promise<Response> {
  const state = (url.searchParams.get('state') ?? '').toUpperCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
  const delayHours = 12; // public feed lags so paid alerts keep their head start
  const before = new Date(Date.now() - delayHours * 3600_000).toISOString();
  const q = STATES[state]
    ? env.DB.prepare('SELECT id, state, species, title, detail, link_url, created_at FROM events WHERE kind <> \'page_changed\' AND state = ? AND created_at <= ? ORDER BY created_at DESC LIMIT ?').bind(state, before, limit)
    : env.DB.prepare('SELECT id, state, species, title, detail, link_url, created_at FROM events WHERE kind <> \'page_changed\' AND created_at <= ? ORDER BY created_at DESC LIMIT ?').bind(before, limit);
  const { results } = await q.all<AlertEvent>();
  return json({ events: results, delay_hours: delayHours }, 200, { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
}

function isAdmin(env: Env, req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  return !!env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
    if (path === '/widget.js') return widgetJs(env);
    if (path === '/api/subscribe' && req.method === 'POST') return subscribe(env, req);
    if (path === '/api/verify') return verify(env, url);
    if (path === '/api/unsubscribe') return unsubscribe(env, url, req);
    if (path === '/api/feed') return feed(env, url, req);
    if (path === '/api/manage' && req.method === 'POST') return manageUpdate(env, req);
    if (path === '/api/sms/inbound' && req.method === 'POST') return smsInbound(env, req);

    if (path === '/login') {
      if (await byManageToken(env, readCookie(req, SESSION_COOKIE))) return redirect('/manage');
      return loginPage(env);
    }
    if (path === '/api/login' && req.method === 'POST') return signInRequest(env, req);
    if (path === '/logout') {
      return redirect('/', { 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
    }

    if (path === '/manage') {
      const linkToken = url.searchParams.get('token');
      if (linkToken) {
        // Arrived from an email link: remember the browser, then drop the token from the address bar.
        const sub = await byManageToken(env, linkToken);
        if (!sub) return messagePage(env, 'Link expired', 'That link is no longer valid. <a href="/login">Sign in</a> to get a new one.');
        const clean = new URLSearchParams(url.searchParams);
        clean.delete('token');
        const qs = clean.toString();
        return redirect(`/manage${qs ? `?${qs}` : ''}`, { 'set-cookie': sessionCookie(sub.manage_token, url) });
      }
      const sub = await byManageToken(env, readCookie(req, SESSION_COOKIE));
      if (!sub) return redirect('/login');
      return managePage(env, sub, {
        welcome: url.searchParams.has('welcome'),
        upgraded: url.searchParams.has('upgraded'),
        saved: url.searchParams.has('saved'),
      });
    }

    if ((path === '/api/checkout' || path === '/api/billing') && req.method === 'POST') {
      const b = await body(req);
      const sub = await byManageToken(env, b.token);
      if (!sub) return json({ error: 'This link has expired.' }, 401);
      if (path === '/api/checkout' && isIntro(env)) return json({ error: 'Instant alerts are free during launch. You already have them.' }, 400);
      try {
        const target = path === '/api/checkout' ? await createCheckout(env, sub) : await createPortal(env, sub);
        return json({ url: target });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Billing is unavailable right now.' }, 503);
      }
    }

    if (path === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await req.text();
      if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(raw, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
        return new Response('bad signature', { status: 400 });
      }
      await handleStripeEvent(env, JSON.parse(raw));
      return json({ received: true });
    }

    if (path.startsWith('/admin')) {
      if (!isAdmin(env, req)) return new Response('not found', { status: 404 });
      if (path === '/admin/sources') {
        const { results } = await env.DB.prepare(
          'SELECT id, state, name, active, parser, last_checked, last_changed, last_status, fail_count, last_error FROM sources ORDER BY state, id',
        ).all<Source>();
        return json({ sources: results });
      }
      if (path === '/admin/check' && req.method === 'POST') {
        const result = await runChecks(env, url.searchParams.get('id') ?? undefined);
        ctx.waitUntil(sendInstantAlerts(env));
        return json(result);
      }
      if (path === '/admin/stats') {
        const s = await env.DB.prepare(
          `SELECT tier, COUNT(*) AS n, SUM(verified_at IS NOT NULL AND unsubscribed_at IS NULL) AS active FROM subscribers GROUP BY tier`,
        ).all();
        return json({ subscribers: s.results });
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path === '/') return homePage(env, await loadHomeData(env));
      if (path === '/privacy') return privacyPage(env);
      if (path === '/terms') return termsPage(env);
      if (path === '/bot') return botPage(env);
      if (path === '/robots.txt') return robotsTxt(env);
      if (path === '/sitemap.xml') return sitemapXml(env);
      if (path === '/favicon.svg' || path === '/favicon.ico') return faviconSvg();
    }
    const notFound = messagePage(env, 'Page not found', 'There\'s nothing at this address.');
    return new Response(notFound.body, { status: 404, headers: notFound.headers });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '30 14 * * *') {
      ctx.waitUntil(sendDigests(env).then((n) => console.log(`digests sent: ${n}`)));
      return;
    }
    const result = await runChecks(env);
    const sent = await sendInstantAlerts(env);
    console.log(`checked ${result.checked} sources, ${result.events} new events, ${sent.emails} emails, ${sent.sms} texts`);
  },
};

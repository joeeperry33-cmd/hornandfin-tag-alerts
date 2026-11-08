import type { Env, Subscriber } from './types';
import { sendRenewalNotice } from './notify';
import { nowIso } from './util';

/**
 * PayPal Subscriptions for instant alerts, paid to the Horn & Fin PayPal Business account.
 *
 * Keys: PAYPAL_CLIENT_ID and PAYPAL_SECRET are Worker secrets; PAYPAL_ENV is "sandbox" or "live".
 * The product, plan (price) and webhook are created from the owner's PayPal settings page and stored
 * in the settings table, per environment, so changing the price never needs a redeploy.
 * Raising the price creates a new plan for new sign-ups; existing subscribers keep their plan.
 */

export type PaypalEnv = 'sandbox' | 'live';

export const WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'PAYMENT.SALE.COMPLETED',
];

export function paypalEnv(env: Env): PaypalEnv {
  return env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
}

function apiBase(env: Env): string {
  return paypalEnv(env) === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export function paypalKeysSet(env: Env): boolean {
  return !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_SECRET;
}

// ---- settings (plan id, price, webhook id) ----

export interface PaypalSettings {
  product_id?: string;
  plan_id?: string;
  price?: string; // "19.99"
  interval?: string; // "year" | "month"
  webhook_id?: string;
  /** End-of-season sale: a second plan that charges sale_price for the first year, then the regular price. */
  sale_plan_id?: string;
  sale_price?: string;
  sale_ends?: string; // YYYY-MM-DD, the first day at the regular price (midnight Pacific)
}

export async function loadPaypalSettings(env: Env): Promise<PaypalSettings> {
  const prefix = `paypal:${paypalEnv(env)}:`;
  const { results } = await env.DB.prepare('SELECT key, value FROM settings WHERE key LIKE ?').bind(`${prefix}%`).all<{ key: string; value: string }>();
  const out: PaypalSettings = {};
  for (const r of results) (out as Record<string, string>)[r.key.slice(prefix.length)] = r.value;
  return out;
}

async function saveSetting(env: Env, name: keyof PaypalSettings, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(`paypal:${paypalEnv(env)}:${name}`, value, nowIso())
    .run();
}

async function clearSetting(env: Env, name: keyof PaypalSettings): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`paypal:${paypalEnv(env)}:${name}`).run();
}

/** The sale, if one is set up and it hasn't ended. Ends at midnight Pacific (08:00 UTC) on sale_ends. */
export function currentSale(s: PaypalSettings, now = new Date()): { planId: string; price: string; ends: string } | null {
  if (!s.sale_plan_id || !s.sale_price || !s.sale_ends) return null;
  if (now.getTime() >= new Date(`${s.sale_ends}T08:00:00Z`).getTime()) return null;
  return { planId: s.sale_plan_id, price: s.sale_price, ends: s.sale_ends };
}

/** Paid plans are live only when not in the free launch period and PayPal is fully set up. */
export function paymentsReady(env: Env, s: PaypalSettings): boolean {
  return paypalKeysSet(env) && !!s.plan_id && !!s.webhook_id;
}

export type Interval = 'year' | 'month';

export function asInterval(v: string | undefined): Interval {
  return v === 'month' ? 'month' : 'year';
}

export function priceLabel(price: string | undefined, interval: string | undefined, fallback: string): string {
  return price ? `$${price}/${asInterval(interval)}` : fallback;
}

// ---- API ----

let cachedToken: { env: PaypalEnv; token: string; until: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (!paypalKeysSet(env)) throw new Error('PayPal keys are not set');
  const which = paypalEnv(env);
  if (cachedToken && cachedToken.env === which && cachedToken.until > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`PayPal sign-in failed: ${data.error_description ?? res.status}`);
  cachedToken = { env: which, token: data.access_token, until: Date.now() + (data.expires_in ?? 300) * 1000 };
  return data.access_token;
}

async function api<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken(env)}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(method === 'POST' ? { 'paypal-request-id': crypto.randomUUID(), prefer: 'return=representation' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return {} as T;
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; details?: { description?: string }[] };
  if (!res.ok) throw new Error(`PayPal ${res.status}: ${data.details?.[0]?.description ?? data.message ?? 'request failed'}`);
  return data;
}

/** Create (once) the product, then a yearly (or monthly) plan at this price. New sign-ups use the newest plan. */
export async function createPlan(env: Env, price: string, intervalIn: string = 'year', sale?: { price: string; ends: string }): Promise<PaypalSettings> {
  const interval = asInterval(intervalIn);
  if (!/^\d{1,3}\.\d{2}$/.test(price) || Number(price) < 0.5) throw new Error('Enter a price like 3.99');
  if (sale) {
    if (!/^\d{1,3}\.\d{2}$/.test(sale.price) || Number(sale.price) < 0.5) throw new Error('Enter a sale price like 19.99');
    if (Number(sale.price) >= Number(price)) throw new Error('The sale price has to be lower than the regular price.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sale.ends) || new Date(`${sale.ends}T08:00:00Z`).getTime() <= Date.now()) throw new Error('Pick a sale end date in the future.');
  }
  const s = await loadPaypalSettings(env);
  let productId = s.product_id;
  if (!productId) {
    const p = await api<{ id: string }>(env, 'POST', '/v1/catalogs/products', {
      name: 'Leftover Tag Alerts instant alerts',
      description: 'Instant email and text alerts for leftover and returned hunting tags',
      type: 'SERVICE',
      home_url: env.SITE_URL,
    });
    productId = p.id;
    await saveSetting(env, 'product_id', productId);
  }
  const plan = await api<{ id: string }>(env, 'POST', '/v1/billing/plans', {
    product_id: productId,
    name: `Instant alerts $${price}/${interval}`,
    description: 'Instant leftover and returned tag alerts by email and text',
    status: 'ACTIVE',
    billing_cycles: [
      {
        frequency: { interval_unit: interval === 'year' ? 'YEAR' : 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: price, currency_code: 'USD' } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
  });
  let salePlanId = '';
  if (sale) {
    const unit = interval === 'year' ? 'YEAR' : 'MONTH';
    const sp = await api<{ id: string }>(env, 'POST', '/v1/billing/plans', {
      product_id: productId,
      name: `Sale: $${sale.price} first ${interval}, then $${price}/${interval}`,
      description: `End-of-season sale: $${sale.price} for the first ${interval}, then $${price} each ${interval}`,
      status: 'ACTIVE',
      billing_cycles: [
        { frequency: { interval_unit: unit, interval_count: 1 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: sale.price, currency_code: 'USD' } } },
        { frequency: { interval_unit: unit, interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: price, currency_code: 'USD' } } },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    });
    salePlanId = sp.id;
  }
  await saveSetting(env, 'plan_id', plan.id);
  await saveSetting(env, 'price', price);
  await saveSetting(env, 'interval', interval);
  if (sale) {
    await saveSetting(env, 'sale_plan_id', salePlanId);
    await saveSetting(env, 'sale_price', sale.price);
    await saveSetting(env, 'sale_ends', sale.ends);
  } else {
    await clearSetting(env, 'sale_plan_id');
    await clearSetting(env, 'sale_price');
    await clearSetting(env, 'sale_ends');
  }
  return loadPaypalSettings(env);
}

/** Register this site's webhook with PayPal (or reuse an existing one for the same URL). */
export async function connectWebhook(env: Env): Promise<PaypalSettings> {
  const url = `${env.API_URL}/api/paypal/webhook`;
  const existing = await api<{ webhooks?: { id: string; url: string }[] }>(env, 'GET', '/v1/notifications/webhooks');
  let id = existing.webhooks?.find((w) => w.url === url)?.id;
  if (!id) {
    const w = await api<{ id: string }>(env, 'POST', '/v1/notifications/webhooks', { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) });
    id = w.id;
  }
  await saveSetting(env, 'webhook_id', id);
  return loadPaypalSettings(env);
}

export async function verifyWebhook(env: Env, headers: Headers, rawBody: string): Promise<boolean> {
  const s = await loadPaypalSettings(env);
  if (!s.webhook_id) return false;
  const h = (k: string) => headers.get(k) ?? '';
  const result = await api<{ verification_status?: string }>(env, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
    webhook_id: s.webhook_id,
    webhook_event: JSON.parse(rawBody),
  });
  return result.verification_status === 'SUCCESS';
}

interface PaypalSubscription {
  id: string;
  status: string; // APPROVAL_PENDING | APPROVED | ACTIVE | SUSPENDED | CANCELLED | EXPIRED
  plan_id: string;
  custom_id?: string;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: { time?: string };
    cycle_executions?: { tenure_type: string; sequence: number; cycles_completed: number; total_cycles: number }[];
  };
}

interface PaypalPlan {
  product_id?: string;
  billing_cycles?: { tenure_type: string; sequence: number; total_cycles: number; pricing_scheme?: { fixed_price?: { value: string } } }[];
}

/** The amount of the next charge: the first billing cycle that still has charges left. */
export function nextChargeAmount(sub: PaypalSubscription, plan: PaypalPlan): string | null {
  const cycles = [...(plan.billing_cycles ?? [])].sort((a, b) => a.sequence - b.sequence);
  for (const c of cycles) {
    const ex = sub.billing_info?.cycle_executions?.find((e) => e.sequence === c.sequence);
    const done = ex?.cycles_completed ?? 0;
    if (c.total_cycles === 0 || done < c.total_cycles) return c.pricing_scheme?.fixed_price?.value ?? null;
  }
  return null;
}

const DAY = 86_400_000;

/**
 * Daily: keep each active subscriber's renewal date current, and email a reminder about 30 days
 * before a yearly renewal (California requires 15-45 days' notice), once per renewal.
 */
export async function renewalReminders(env: Env): Promise<number> {
  if (!paypalKeysSet(env)) return 0;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT * FROM subscribers WHERE tier = 'paid' AND paypal_sub IS NOT NULL AND paid_until IS NULL AND unsubscribed_at IS NULL
     AND (renews_at IS NULL OR renews_at <= ? ) LIMIT 50`,
  ).bind(new Date(now + 30 * DAY).toISOString()).all<Subscriber>();
  let sent = 0;
  for (const sub of results) {
    try {
      const ps = await getSubscription(env, sub.paypal_sub!);
      const next = ps.billing_info?.next_billing_time;
      if (ps.status !== 'ACTIVE' || !next) continue;
      if (next !== sub.renews_at) await env.DB.prepare('UPDATE subscribers SET renews_at = ? WHERE id = ?').bind(next, sub.id).run();
      const t = new Date(next).getTime();
      // Only yearly renewals that are 15-30 days out, and only once per renewal date.
      if (t - now > 30 * DAY || t - now < 15 * DAY || sub.renewal_notice_for === next) continue;
      if (asInterval((await loadPaypalSettings(env)).interval) !== 'year') continue;
      const plan = await api<PaypalPlan>(env, 'GET', `/v1/billing/plans/${encodeURIComponent(ps.plan_id)}`);
      const amount = nextChargeAmount(ps, plan);
      if (!amount) continue;
      if (await sendRenewalNotice(env, sub, next, amount)) {
        await env.DB.prepare('UPDATE subscribers SET renewal_notice_for = ? WHERE id = ?').bind(next, sub.id).run();
        sent++;
      }
    } catch (err) {
      console.error('renewal reminder failed', sub.id, err);
    }
  }
  return sent;
}

export function getSubscription(env: Env, id: string): Promise<PaypalSubscription> {
  return api<PaypalSubscription>(env, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

/** End of the period already paid for; the subscriber keeps instant alerts until then. */
function paidThrough(sub: PaypalSubscription): string {
  const next = sub.billing_info?.next_billing_time;
  return next && new Date(next).getTime() > Date.now() ? new Date(next).toISOString() : nowIso();
}

/** After the PayPal button: confirm with PayPal that this subscription is real, active and theirs. */
export async function confirmApproval(env: Env, me: Subscriber, subscriptionId: string): Promise<void> {
  if (!/^I-[A-Z0-9]{6,}$/.test(subscriptionId)) throw new Error('That PayPal subscription ID looks wrong.');
  const ps = await getSubscription(env, subscriptionId);
  if (ps.custom_id !== me.id) throw new Error('That PayPal subscription belongs to a different account.');
  if (ps.status !== 'ACTIVE' && ps.status !== 'APPROVED') throw new Error(`PayPal says this subscription is ${ps.status.toLowerCase()}.`);
  const s = await loadPaypalSettings(env);
  const plan = await api<PaypalPlan>(env, 'GET', `/v1/billing/plans/${encodeURIComponent(ps.plan_id)}`);
  if (!s.product_id || plan.product_id !== s.product_id) throw new Error('That subscription is not for Leftover Tag Alerts.');
  await env.DB.prepare(`UPDATE subscribers SET tier = 'paid', paypal_sub = ?, paid_until = NULL, renews_at = ? WHERE id = ?`)
    .bind(ps.id, ps.billing_info?.next_billing_time ?? null, me.id)
    .run();
}

/** Cancel at PayPal; instant alerts continue through the period already paid. */
export async function cancelSubscription(env: Env, me: Subscriber, reason = 'Canceled from Leftover Tag Alerts settings'): Promise<string> {
  if (!me.paypal_sub) throw new Error('No PayPal subscription on file.');
  const ps = await getSubscription(env, me.paypal_sub);
  if (ps.status === 'ACTIVE' || ps.status === 'SUSPENDED' || ps.status === 'APPROVED') {
    await api(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(me.paypal_sub)}/cancel`, { reason });
  }
  const until = paidThrough(ps);
  await env.DB.prepare('UPDATE subscribers SET paid_until = ? WHERE id = ?').bind(until, me.id).run();
  return until;
}

interface PaypalEvent {
  event_type: string;
  resource: { id?: string; billing_agreement_id?: string; status?: string; custom_id?: string; billing_info?: PaypalSubscription['billing_info'] };
}

/** Apply a verified PayPal webhook event. */
export async function handlePaypalEvent(env: Env, evt: PaypalEvent): Promise<void> {
  const r = evt.resource ?? {};
  switch (evt.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
      if (!r.id) return;
      // custom_id is our subscriber id, so this works even if the browser closed before confirming.
      if (r.custom_id) {
        await env.DB.prepare(`UPDATE subscribers SET tier = 'paid', paypal_sub = ?, paid_until = NULL WHERE id = ?`).bind(r.id, r.custom_id).run();
      } else {
        await env.DB.prepare(`UPDATE subscribers SET tier = 'paid', paid_until = NULL WHERE paypal_sub = ?`).bind(r.id).run();
      }
      return;
    }
    case 'PAYMENT.SALE.COMPLETED': {
      if (r.billing_agreement_id) {
        await env.DB.prepare(`UPDATE subscribers SET tier = 'paid', paid_until = NULL WHERE paypal_sub = ?`).bind(r.billing_agreement_id).run();
      }
      return;
    }
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      if (!r.id) return;
      const until = paidThrough({ id: r.id, status: r.status ?? '', plan_id: '', billing_info: r.billing_info });
      // Keep any later paid-through date already recorded (e.g. canceled from settings first).
      await env.DB.prepare(`UPDATE subscribers SET paid_until = CASE WHEN paid_until IS NOT NULL AND paid_until > ? THEN paid_until ELSE ? END WHERE paypal_sub = ?`)
        .bind(until, until, r.id)
        .run();
      return;
    }
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      // Payments failed past the retry limit: stop instant alerts now.
      if (r.id) await env.DB.prepare('UPDATE subscribers SET paid_until = ? WHERE paypal_sub = ?').bind(nowIso(), r.id).run();
      return;
    }
  }
}

/** Daily: move people whose paid period has ended back to the free daily email. */
export async function expirePaidPlans(env: Env): Promise<number> {
  const res = await env.DB.prepare(`UPDATE subscribers SET tier = 'free' WHERE tier = 'paid' AND paid_until IS NOT NULL AND paid_until <= ?`).bind(nowIso()).run();
  return res.meta.changes ?? 0;
}

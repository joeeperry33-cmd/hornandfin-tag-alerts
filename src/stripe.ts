import type { Env, Subscriber } from './types';

async function hmacHex(algo: 'SHA-256' | 'SHA-1', key: string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: algo }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body; 5-minute tolerance. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Date.now() / 1000): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > 300) return false;
  const expected = toHex(await hmacHex('SHA-256', secret, `${t}.${payload}`));
  const sigs = header
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  return sigs.some((s) => safeEqual(s, expected));
}

/** Twilio webhook signature: base64 HMAC-SHA1 of URL + sorted params concatenated. */
export async function verifyTwilioSignature(url: string, params: URLSearchParams, header: string | null, authToken: string): Promise<boolean> {
  if (!header) return false;
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => k + (params.get(k) ?? '')).join('');
  const sig = btoa(String.fromCharCode(...new Uint8Array(await hmacHex('SHA-1', authToken, data))));
  return safeEqual(sig, header);
}

export async function createCheckout(env: Env, sub: Subscriber): Promise<string> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) throw new Error('Stripe is not configured');
  const manage = `${env.API_URL}/manage?token=${encodeURIComponent(sub.manage_token)}`;
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: sub.id,
    success_url: `${manage}&upgraded=1`,
    cancel_url: manage,
    allow_promotion_codes: 'true',
    'subscription_data[metadata][subscriber_id]': sub.id,
  });
  if (sub.stripe_customer) form.set('customer', sub.stripe_customer);
  else form.set('customer_email', sub.email);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = (await res.json()) as { url?: string; error?: { message: string } };
  if (!res.ok || !data.url) throw new Error(data.error?.message ?? `Stripe error ${res.status}`);
  return data.url;
}

export async function createPortal(env: Env, sub: Subscriber): Promise<string> {
  if (!env.STRIPE_SECRET_KEY || !sub.stripe_customer) throw new Error('No billing account on file');
  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      customer: sub.stripe_customer,
      return_url: `${env.API_URL}/manage?token=${encodeURIComponent(sub.manage_token)}`,
    }),
  });
  const data = (await res.json()) as { url?: string; error?: { message: string } };
  if (!res.ok || !data.url) throw new Error(data.error?.message ?? `Stripe error ${res.status}`);
  return data.url;
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Apply a verified Stripe event to the subscriber table. */
export async function handleStripeEvent(env: Env, evt: StripeEvent): Promise<void> {
  const obj = evt.data.object;
  if (evt.type === 'checkout.session.completed') {
    const subId = obj.client_reference_id as string | undefined;
    if (!subId) return;
    await env.DB.prepare(`UPDATE subscribers SET tier = 'paid', stripe_customer = ?, stripe_sub = ? WHERE id = ?`)
      .bind(obj.customer as string, obj.subscription as string, subId)
      .run();
  } else if (evt.type === 'customer.subscription.deleted') {
    await env.DB.prepare(`UPDATE subscribers SET tier = 'free' WHERE stripe_sub = ?`).bind(obj.id as string).run();
  } else if (evt.type === 'customer.subscription.updated') {
    const status = obj.status as string;
    const tier = status === 'active' || status === 'trialing' || status === 'past_due' ? 'paid' : 'free';
    await env.DB.prepare(`UPDATE subscribers SET tier = ? WHERE stripe_sub = ?`).bind(tier, obj.id as string).run();
  }
}

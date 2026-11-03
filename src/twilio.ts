function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Twilio webhook signature: base64 HMAC-SHA1 of URL + sorted params concatenated. */
export async function verifyTwilioSignature(url: string, params: URLSearchParams, header: string | null, authToken: string): Promise<boolean> {
  if (!header) return false;
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => k + (params.get(k) ?? '')).join('');
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  const sig = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return safeEqual(sig, header);
}

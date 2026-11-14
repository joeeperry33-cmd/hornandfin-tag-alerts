export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};

export const SPECIES = ['elk', 'deer', 'pronghorn', 'moose', 'sheep', 'goat', 'bear', 'turkey', 'javelina', 'other'];
export const SPECIES_LABEL: Record<string, string> = {
  elk: 'Elk', deer: 'Deer', pronghorn: 'Pronghorn', moose: 'Moose', sheep: 'Bighorn sheep', goat: 'Mountain goat',
  bear: 'Bear', turkey: 'Turkey', javelina: 'Javelina', other: 'Other',
};

/** Launch period: everyone gets instant alerts free. */
export function isIntro(env: { INTRO_FREE?: string }): boolean {
  return env.INTRO_FREE === 'true';
}

/** Text alerts only once a Twilio number is configured. */
export function textsEnabled(env: { TWILIO_FROM_NUMBER?: string }): boolean {
  return !!env.TWILIO_FROM_NUMBER;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function sha256(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML page, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e) ? e : null;
}

/** US numbers only for now; returns E.164 or null. */
export function normalizeUsPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Parse a comma list of states/species against an allow-list; '*' means all. */
export function parseList(input: unknown, allowed: string[], upper: boolean): string {
  if (input === '*' || input == null || input === '') return '*';
  const raw = Array.isArray(input) ? input : String(input).split(',');
  const clean = [...new Set(raw.map((s) => String(s).trim()).map((s) => (upper ? s.toUpperCase() : s.toLowerCase())))]
    .filter((s) => allowed.includes(s));
  // Everything ticked means "all", so species added later are included automatically.
  return clean.length && clean.length < allowed.length ? clean.join(',') : '*';
}

export function matchesList(list: string, value: string | null): boolean {
  if (list === '*') return true;
  if (!value) return true; // unknown species: send to everyone who follows the state
  const wanted = list.split(',');
  return value.split(',').some((v) => wanted.includes(v));
}

/** Is today (UTC month-day) inside an MM-DD window that may wrap the new year? */
export function inSeason(start: string | null, end: string | null, date = new Date()): boolean {
  if (!start || !end) return true;
  const md = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

// ---- end-of-season sale wording ----

interface PriceEnv { PAID_PRICE_LABEL: string; PAID_INTERVAL?: string; SALE_PRICE?: string; SALE_ENDS?: string }

/** "$39.99/year" -> "$39.99 a year" */
export function regularPrice(env: PriceEnv): string {
  return env.PAID_PRICE_LABEL.replace('/year', ' a year').replace('/month', ' a month');
}

export function saleOn(env: PriceEnv): boolean {
  return !!env.SALE_PRICE && !!env.SALE_ENDS;
}

/** "2027-03-01" -> "March 1, 2027" */
export function saleEndsText(env: PriceEnv): string {
  if (!env.SALE_ENDS) return '';
  return new Date(`${env.SALE_ENDS}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** What a new subscriber pays, in one phrase. */
export function priceSentence(env: PriceEnv): string {
  return saleOn(env) ? `$${env.SALE_PRICE} for your first year, then ${regularPrice(env)}` : regularPrice(env);
}

/** The amount charged today. */
export function chargeToday(env: PriceEnv): number {
  if (saleOn(env)) return Number(env.SALE_PRICE);
  return Number(/\$(\d+(?:\.\d{2})?)/.exec(env.PAID_PRICE_LABEL)?.[1] ?? '0');
}

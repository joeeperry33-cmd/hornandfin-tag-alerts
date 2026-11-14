import { classify, mergeFacets, type TagFacets } from '../tagtype';
import { sha256, tidyCaps } from '../util';
import type { ParsedListing, ParseResult } from '../types';

/**
 * A state page that draws its table from a public JSON feed (Pennsylvania's WMU remaining quotas).
 * Optionally read an ID from the page first (the season ID changes every year).
 */
export interface JsonConfig {
  /** Regex run on the page at the source URL; its first group fills {1} in dataUrl. */
  discover?: string;
  /** Feed URL, absolute or relative to the source URL. */
  dataUrl: string;
  /** Dot path to the array of hunts, e.g. "RemainingWMUs". */
  items: string;
  key: string;
  quantity: string;
  /** Label template with {Field} placeholders, e.g. "WMU {Name}". */
  label?: string;
  species?: string;
  /** Field holding the species per row (e.g. "SpeciesName"); overrides species. */
  speciesField?: string;
  defaults?: TagFacets;
  skipZero?: boolean;
  /** Skip rows whose count isn't a number ("-" for no quota). */
  requireQuantity?: boolean;
  /** Turn ALL-CAPS names into normal capitalization in labels. */
  titleCase?: boolean;
  /** Load the page first and send its cookies with the data request (feeds that need a visitor session). */
  session?: boolean;
}

function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function listingsFromJson(data: unknown, cfg: JsonConfig): ParsedListing[] {
  const items = at(data, cfg.items);
  if (!Array.isArray(items)) throw new Error(`feed has no list at "${cfg.items}"`);
  const out: ParsedListing[] = [];
  const fill = (tpl: string, it: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, f) => String(it[f] ?? '').trim());
  for (const it of items as Record<string, unknown>[]) {
    // key is a field name, or a template like "{HuntCode}|{Season}" when one field isn't unique.
    const key = (cfg.key.includes('{') ? fill(cfg.key, it) : String(it[cfg.key] ?? '')).trim();
    if (!key || /^\|*$/.test(key)) continue;
    const raw = it[cfg.quantity];
    const quantity =
      typeof raw === 'number' ? raw : raw != null && /^-?[\d,]+$/.test(String(raw).trim()) ? parseInt(String(raw).replace(/,/g, ''), 10) : null;
    if ((cfg.skipZero ?? true) && quantity !== null && quantity <= 0) continue;
    if (cfg.requireQuantity && quantity === null) continue;
    let label = fill(cfg.label ?? `{${cfg.key}}`, it).replace(/\s+/g, ' ').trim();
    if (cfg.titleCase) label = tidyCaps(label);
    const facets = mergeFacets(classify(label), cfg.defaults);
    const species = cfg.speciesField ? String(it[cfg.speciesField] ?? '').toLowerCase().trim() || cfg.species : cfg.species;
    out.push({ key, label, species, quantity, weapon: facets.weapon ?? null, sex: facets.sex ?? null, residency: facets.residency ?? null });
  }
  return out;
}

export async function fetchJsonFeed(url: string, cfg: JsonConfig, headers: Record<string, string>): Promise<{ status: number; result: ParseResult }> {
  let dataUrl = cfg.dataUrl;
  if (cfg.discover) {
    const page = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
    if (!page.ok) throw new Error(`HTTP ${page.status} loading the page`);
    const m = new RegExp(cfg.discover).exec(await page.text());
    if (!m) throw new Error('Could not find the current season on the page');
    dataUrl = dataUrl.replace('{1}', encodeURIComponent(m[1]));
  }
  let cookie = '';
  const trail: string[] = [];
  if (cfg.session) {
    // Open the report page like a visitor and keep the cookies it sets (following redirects ourselves).
    const jar = new Map<string, string>();
    let next: string | null = url;
    for (let hop = 0; next && hop < 5; hop++) {
      const r: Response = await fetch(next, { headers: { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
      const list = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [r.headers.get('set-cookie') ?? ''];
      for (const c of list) {
        const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
        if (m) jar.set(m[1], m[2]);
      }
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      trail.push(`${r.status}${loc ? `→${loc.split('?')[0]}` : ''}`);
      next = loc ? new URL(loc, next).toString() : null;
      if (!loc) await r.arrayBuffer().catch(() => undefined);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const res = await fetch(new URL(dataUrl, url).toString(), {
    headers: { ...headers, accept: 'application/json', referer: url, ...(cookie ? { cookie } : {}), 'x-requested-with': 'XMLHttpRequest' },
    redirect: cfg.session ? 'manual' : 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (res.status >= 300 && res.status < 400) {
    const names = cookie ? cookie.split('; ').map((c) => c.split('=')[0]).join(', ') : 'none';
    throw new Error(`Data feed redirected to ${(res.headers.get('location') ?? 'another page').split('?')[0]} (needs a session or login; page ${trail.join(' ') || 'not loaded'}, cookies: ${names})`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from the data feed`);
  const listings = listingsFromJson(await res.json(), cfg);
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { status: res.status, result: { hash: await sha256(canonical), listings } };
}

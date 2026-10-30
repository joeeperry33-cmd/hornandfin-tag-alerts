import { classify, mergeFacets, type TagFacets } from '../tagtype';
import { sha256 } from '../util';
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
  defaults?: TagFacets;
  skipZero?: boolean;
}

function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function listingsFromJson(data: unknown, cfg: JsonConfig): ParsedListing[] {
  const items = at(data, cfg.items);
  if (!Array.isArray(items)) throw new Error(`feed has no list at "${cfg.items}"`);
  const out: ParsedListing[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const key = String(it[cfg.key] ?? '').trim();
    if (!key) continue;
    const raw = it[cfg.quantity];
    const quantity = typeof raw === 'number' ? raw : raw != null && /^-?\d+$/.test(String(raw)) ? parseInt(String(raw), 10) : null;
    if ((cfg.skipZero ?? true) && quantity !== null && quantity <= 0) continue;
    const label = (cfg.label ?? `{${cfg.key}}`).replace(/\{(\w+)\}/g, (_, f) => String(it[f] ?? ''));
    const facets = mergeFacets(classify(label), cfg.defaults);
    out.push({ key, label, species: cfg.species, quantity, weapon: facets.weapon ?? null, sex: facets.sex ?? null, residency: facets.residency ?? null });
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
  const res = await fetch(new URL(dataUrl, url).toString(), {
    headers: { ...headers, accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from the data feed`);
  const listings = listingsFromJson(await res.json(), cfg);
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { status: res.status, result: { hash: await sha256(canonical), listings } };
}

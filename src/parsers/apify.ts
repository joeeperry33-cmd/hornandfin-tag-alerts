import type { Env, ParseResult } from '../types';
import { listingsFromJson, type JsonConfig } from './json';
import { sha256 } from '../util';

/**
 * Sources whose state page blocks automated checks, read through the owner's Apify task.
 * Each check runs the task and waits for its result (these runs take seconds), then reads the
 * rows like a JSON feed.
 */
export interface ApifyConfig extends Omit<JsonConfig, 'dataUrl' | 'discover'> {
  /** Apify task ID (Apify Console → Saved tasks), e.g. 62DjK8vXUoxSb8dyj. */
  task: string;
  /** Field holding a sentence like "ZONES 1, 4S, 5, and 8 ARE SOLD OUT." */
  soldOutField?: string;
}

/** "1,234" → 1234; "Sold out" → 0; blank → null. */
export function permitCount(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/sold\s*out|none|^n\/?a$/i.test(s)) return 0;
  const m = s.replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Zone names from "ZONES 1, 4S, 5, and 8 ARE SOLD OUT." */
export function soldOutZones(notice: unknown): Set<string> {
  const out = new Set<string>();
  const s = String(notice ?? '');
  const m = /zones?\s+(.+?)\s+(?:is|are)\s+sold out/i.exec(s);
  if (!m) return out;
  for (const part of m[1].split(/,|\band\b/i)) {
    const z = part.trim().toUpperCase();
    if (z) out.add(z);
  }
  return out;
}

function zoneId(v: unknown): string {
  return String(v ?? '').replace(/^zone\s*/i, '').trim().toUpperCase();
}

export function listingsFromApify(items: unknown, cfg: ApifyConfig) {
  if (!Array.isArray(items) || !items.length) throw new Error('Apify task returned no data');
  // One item per page the task loaded; combine their rows.
  const rows: Record<string, unknown>[] = [];
  const soldOut = new Set<string>();
  for (const page of items as Record<string, unknown>[]) {
    const list = page[cfg.items];
    if (!Array.isArray(list)) throw new Error(`Apify data has no list at "${cfg.items}"`);
    rows.push(...(list as Record<string, unknown>[]));
    if (cfg.soldOutField) for (const z of soldOutZones(page[cfg.soldOutField])) soldOut.add(z);
  }
  const clean = rows.map((r) => {
    let q = permitCount(r[cfg.quantity]);
    if (soldOut.has(zoneId(r[cfg.key]))) q = 0;
    return { ...r, [cfg.quantity]: q };
  });
  return listingsFromJson({ rows: clean }, { ...cfg, dataUrl: '', items: 'rows' });
}

export async function checkApifyTask(env: Env, cfg: ApifyConfig): Promise<{ status: number; result: ParseResult }> {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is not set in Cloudflare');
  const res = await fetch(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(cfg.task)}/run-sync-get-dataset-items?timeout=120&clean=true&format=json`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.APIFY_TOKEN}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`Apify task: HTTP ${res.status}`);
  const listings = listingsFromApify(await res.json(), cfg);
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { status: res.status, result: { hash: await sha256(canonical), listings } };
}

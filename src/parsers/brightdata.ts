import type { Env, ParsedListing, ParseResult } from '../types';
import { allowedPdfUrl, fetchPdf, pdfItems } from '../pdftext';
import { arizonaListings } from './arizona';
import { sha256 } from '../util';

/**
 * Sources whose state page blocks automated checks. The owner's Bright Data scraper loads the page
 * and returns the links to the current list PDFs; the site downloads the PDFs (hosted elsewhere) and
 * reads them itself.
 *
 * Bright Data runs are asynchronous: each check collects the result of the run started by the
 * previous check, then starts the next run. The last good list of PDF links is kept, so a slow or
 * failed run never loses the list.
 */
export interface BrightDataConfig {
  /** Scraper ID from the Bright Data scraper's "Initiate by API" page, e.g. c_mwfrxouz6gamipvxx. */
  collector: string;
  /** Input sent to the scraper. */
  input: Record<string, string>;
  /** Which PDF reader to use. */
  reader: 'arizona';
  /** Error if the last good scraper result is older than this (default 3 days). */
  staleHours?: number;
}

interface PdfLink {
  title: string;
  url: string;
}

const API = 'https://api.brightdata.com/dca';

async function getSetting(env: Env, key: string): Promise<{ value: string; updated_at: string } | null> {
  return env.DB.prepare('SELECT value, updated_at FROM settings WHERE key = ?').bind(key).first<{ value: string; updated_at: string }>();
}

async function putSetting(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return;
  }
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(key, value, new Date().toISOString())
    .run();
}

function authHeaders(env: Env): Record<string, string> {
  return { authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`, 'content-type': 'application/json' };
}

/** Bright Data answers with a JSON array, one object, or one JSON object per line. */
export function parseDatasetBody(text: string): unknown {
  const t = text.trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && 'status' in v && !('url' in v)) return v;
    return [v];
  } catch {
    return t
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
}

/** The scraper's rows, or null while the run is still going. */
export function pdfLinksFromDataset(data: unknown): PdfLink[] | null {
  if (!Array.isArray(data)) {
    const status = (data as { status?: string } | null)?.status;
    if (status && /build|collect|running|pending|queued/i.test(status)) return null;
    throw new Error(`Bright Data returned an unexpected result${status ? ` (${status})` : ''}`);
  }
  const links: PdfLink[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const url = typeof row.url === 'string' ? row.url : '';
    if (!url || !allowedPdfUrl(url)) continue;
    links.push({ title: typeof row.title === 'string' ? row.title : '', url });
  }
  return links;
}

async function collectPending(env: Env, sourceId: string): Promise<void> {
  const pendingKey = `bd:${sourceId}:pending`;
  const pending = await getSetting(env, pendingKey);
  if (!pending) return;
  const res = await fetch(`${API}/dataset?id=${encodeURIComponent(pending.value)}&format=json`, { headers: authHeaders(env), signal: AbortSignal.timeout(20000) });
  if (res.status === 202) {
    // Still running; give up on a run that has been going for over 6 hours.
    if (Date.now() - new Date(pending.updated_at).getTime() > 6 * 3600_000) await putSetting(env, pendingKey, null);
    return;
  }
  if (!res.ok) {
    await putSetting(env, pendingKey, null);
    throw new Error(`Bright Data result: HTTP ${res.status}`);
  }
  const links = pdfLinksFromDataset(parseDatasetBody(await res.text()));
  if (links === null) return;
  await putSetting(env, pendingKey, null);
  // An empty result can mean the scraper failed to find the section; keep the last good list then.
  if (links.length) await putSetting(env, `bd:${sourceId}:pdfs`, JSON.stringify(links));
}

async function startRun(env: Env, sourceId: string, cfg: BrightDataConfig): Promise<void> {
  const pendingKey = `bd:${sourceId}:pending`;
  if (await getSetting(env, pendingKey)) return;
  const res = await fetch(`${API}/trigger?collector=${encodeURIComponent(cfg.collector)}&queue_next=1`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify([cfg.input]),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Bright Data start: HTTP ${res.status}`);
  const body = (await res.json()) as { collection_id?: string };
  if (body.collection_id) await putSetting(env, pendingKey, body.collection_id);
}

export async function readPdfListings(reader: BrightDataConfig['reader'], bytes: Uint8Array): Promise<ParsedListing[]> {
  const items = await pdfItems(bytes);
  if (reader === 'arizona') return arizonaListings(items);
  throw new Error(`Unknown PDF reader ${reader}`);
}

export async function checkBrightDataPdfs(env: Env, sourceId: string, cfg: BrightDataConfig): Promise<{ status: number; result: ParseResult }> {
  if (!env.BRIGHTDATA_API_KEY) throw new Error('BRIGHTDATA_API_KEY is not set in Cloudflare');
  let runError: unknown = null;
  try {
    await collectPending(env, sourceId);
    await startRun(env, sourceId, cfg);
  } catch (err) {
    runError = err; // still read the last good PDFs below
  }

  const saved = await getSetting(env, `bd:${sourceId}:pdfs`);
  if (!saved) throw runError ?? new Error('Waiting for the first Bright Data run');
  const ageHours = (Date.now() - new Date(saved.updated_at).getTime()) / 3600_000;
  if (ageHours > (cfg.staleHours ?? 72)) throw new Error(`Bright Data list of PDFs is ${Math.round(ageHours)} hours old${runError ? ` (${String(runError)})` : ''}`);

  const links = JSON.parse(saved.value) as PdfLink[];
  const listings: ParsedListing[] = [];
  for (const link of links) {
    const url = allowedPdfUrl(link.url);
    if (!url) continue;
    listings.push(...(await readPdfListings(cfg.reader, await fetchPdf(url, env.USER_AGENT))));
  }
  const byKey = new Map(listings.map((l) => [l.key, l]));
  const merged = [...byKey.values()];
  const canonical = merged
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { status: 200, result: { hash: await sha256(canonical), listings: merged } };
}

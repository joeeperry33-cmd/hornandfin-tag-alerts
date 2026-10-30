import { extractTables, listingsFromTable, pageSummary, pickTable, type TableConfig } from './table';
import { decodeEntities, sha256 } from '../util';
import type { ParsedListing, ParseResult } from '../types';

/**
 * Public report behind a simple form (ASP.NET WebForms style): load the form, then submit it once
 * per choice, exactly as a person picking each species and pressing the button would.
 * Wyoming's license availability report works this way.
 */
export interface FormConfig {
  /** Name of the <select> to set, e.g. "ddlSpecies". */
  field: string;
  /** Submit button name and value, sent like a click. */
  submit?: { name: string; value: string };
  /** One report per choice. */
  choices: { value: string; species: string; label: string; defaults?: TableConfig['defaults'] }[];
  table: TableConfig;
}

/** Hidden inputs (view state, validation tokens) the form posts back. */
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type\s*=\s*["']?hidden/i.test(tag)) continue;
    const name = /name\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = decodeEntities(/value\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return out;
}

export function listingsFromReport(html: string, cfg: FormConfig, choice: FormConfig['choices'][number]): ParsedListing[] {
  let table;
  try {
    table = pickTable(extractTables(html), cfg.table);
  } catch (err) {
    throw new Error(`${choice.label} report: ${err instanceof Error ? err.message : String(err)} (${pageSummary(html)})`);
  }
  return listingsFromTable(table, {
    ...cfg.table,
    species: choice.species,
    keyPrefix: choice.value,
    labelPrefix: choice.label,
    defaults: { ...cfg.table.defaults, ...choice.defaults },
  });
}

export async function fetchFormReports(
  url: string,
  cfg: FormConfig,
  headers: Record<string, string>,
): Promise<{ status: number; result: ParseResult }> {
  const get = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (!get.ok) throw new Error(`HTTP ${get.status} loading the report form`);
  const formHtml = await get.text();
  const hidden = hiddenFields(formHtml);
  if (!hidden.__VIEWSTATE && !Object.keys(hidden).length) throw new Error(`Report form not found (${pageSummary(formHtml)})`);
  // Keep the session cookie the form hands out, as a browser would.
  const setCookies = (get.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [get.headers.get('set-cookie') ?? ''];
  const cookie = setCookies
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

  const listings: ParsedListing[] = [];
  let status = get.status;
  for (const choice of cfg.choices) {
    const body = new URLSearchParams(hidden);
    body.set(cfg.field, choice.value);
    if (cfg.submit) body.set(cfg.submit.name, cfg.submit.value);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', referer: url, ...(cookie ? { cookie } : {}) },
      body,
      signal: AbortSignal.timeout(25000),
    });
    status = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${choice.label} report`);
    listings.push(...listingsFromReport(await res.text(), cfg, choice));
    await new Promise((r) => setTimeout(r, 400)); // be gentle with the state's server
  }
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { status, result: { hash: await sha256(canonical), listings } };
}

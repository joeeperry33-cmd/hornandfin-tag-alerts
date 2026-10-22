import { decodeEntities, sha256 } from '../util';
import type { ParsedListing, ParseResult } from '../types';

export interface TableConfig {
  /** Pick the first table whose header row contains this text (case-insensitive). */
  headerMatch?: string;
  /** Or pick by position (0-based) among all tables on the page. */
  tableIndex?: number;
  /** Header names (case-insensitive, substring match) that together identify a hunt. */
  keyColumns: string[];
  /** Header names joined for the human label; defaults to keyColumns. */
  labelColumns?: string[];
  /** Header name holding the remaining/available count, if the page has one. */
  quantityColumn?: string;
  /** Header name holding species, or a fixed species for every row. */
  speciesColumn?: string;
  species?: string;
  /** Skip rows whose quantity is 0 (sold out). Default true. */
  skipZero?: boolean;
}

export type Table = string[][];

function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every <table> on the page as rows of cell text. Handles th/td, ignores nested markup. */
export function extractTables(html: string): Table[] {
  const tables: Table[] = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.matchAll(tableRe)) {
    const rows: Table = [];
    for (const rowMatch of tableMatch[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cell of rowMatch[0].matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
        const text = cellText(cell[3]);
        const span = /colspan\s*=\s*["']?(\d+)/i.exec(cell[2]);
        const n = span ? Math.min(parseInt(span[1], 10), 20) : 1;
        for (let i = 0; i < n; i++) cells.push(text);
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function colIndex(header: string[], name: string): number {
  const n = name.toLowerCase();
  return header.findIndex((h) => h.toLowerCase().includes(n));
}

export function parseQuantity(s: string): number | null {
  const m = s.replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export function listingsFromTable(table: Table, cfg: TableConfig): ParsedListing[] {
  const [header, ...rows] = table;
  const keyIdx = cfg.keyColumns.map((c) => colIndex(header, c));
  if (keyIdx.some((i) => i < 0)) {
    throw new Error(`table parser: missing key column(s) ${cfg.keyColumns.join(', ')} in header [${header.join(' | ')}]`);
  }
  const labelIdx = (cfg.labelColumns ?? cfg.keyColumns).map((c) => colIndex(header, c)).filter((i) => i >= 0);
  const qtyIdx = cfg.quantityColumn ? colIndex(header, cfg.quantityColumn) : -1;
  const spIdx = cfg.speciesColumn ? colIndex(header, cfg.speciesColumn) : -1;
  const skipZero = cfg.skipZero ?? true;

  const out = new Map<string, ParsedListing>();
  for (const row of rows) {
    const key = keyIdx.map((i) => row[i] ?? '').join(' | ').trim();
    if (!key || key.replace(/\|/g, '').trim() === '') continue;
    const quantity = qtyIdx >= 0 ? parseQuantity(row[qtyIdx] ?? '') : null;
    if (skipZero && quantity !== null && quantity <= 0) continue;
    const label = labelIdx.map((i) => row[i]).filter(Boolean).join(' – ');
    const species = spIdx >= 0 ? (row[spIdx] ?? '').toLowerCase() : cfg.species;
    out.set(key, { key, label: label || key, species, quantity });
  }
  return [...out.values()];
}

export function pickTable(tables: Table[], cfg: TableConfig): Table {
  if (cfg.headerMatch) {
    const m = cfg.headerMatch.toLowerCase();
    const t = tables.find((tb) => tb[0]?.some((h) => h.toLowerCase().includes(m)));
    if (t) return t;
    throw new Error(`table parser: no table with header containing "${cfg.headerMatch}"`);
  }
  const t = tables[cfg.tableIndex ?? 0];
  if (!t) throw new Error(`table parser: table index ${cfg.tableIndex ?? 0} not found (page has ${tables.length})`);
  return t;
}

/** CSV with a header row; quoted fields supported. */
export function parseCsv(text: string): Table {
  const rows: Table = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export async function parseTable(body: ArrayBuffer, format: string, cfg: TableConfig): Promise<ParseResult> {
  const text = new TextDecoder().decode(body);
  const table = format === 'csv' ? parseCsv(text) : pickTable(extractTables(text), cfg);
  const listings = listingsFromTable(table, cfg);
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity ?? ''}`)
    .sort()
    .join('\n');
  return { hash: await sha256(canonical), listings };
}

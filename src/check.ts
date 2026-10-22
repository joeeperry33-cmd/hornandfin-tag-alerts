import { parseChange, type ChangeConfig } from './parsers/change';
import { parseTable, type TableConfig } from './parsers/table';
import { robotsAllows } from './robots';
import type { Env, ParsedListing, ParseResult, Source } from './types';
import { inSeason, nowIso, STATES } from './util';

const MAX_SOURCES_PER_RUN = 25;
const MAX_LISTINGS_PER_EVENT = 15;
const OFF_SEASON_MINUTES = 24 * 60;

export function isDue(src: Source, now = new Date()): boolean {
  if (!src.last_checked) return true;
  const interval = inSeason(src.season_start, src.season_end, now) ? src.check_minutes : OFF_SEASON_MINUTES;
  // Back off failing sources: double the interval per failure, up to a day.
  const backoff = Math.min(interval * 2 ** Math.min(src.fail_count, 5), OFF_SEASON_MINUTES);
  const elapsed = (now.getTime() - new Date(src.last_checked).getTime()) / 60000;
  return elapsed >= backoff - 1;
}

async function fetchSource(env: Env, src: Source): Promise<{ status: number; body: ArrayBuffer | null }> {
  if (!(await robotsAllows(src.url, env.USER_AGENT))) throw new Error('blocked by robots.txt');
  const res = await fetch(src.url, {
    headers: {
      'user-agent': env.USER_AGENT,
      accept: src.format === 'pdf' ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml,text/csv,application/json,*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    cf: { cacheTtl: 0 },
  } as RequestInit);
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.arrayBuffer() };
}

export async function parseSource(src: Source, body: ArrayBuffer): Promise<ParseResult> {
  const cfg = src.parser_config ? JSON.parse(src.parser_config) : {};
  if (src.parser === 'table') {
    try {
      return await parseTable(body, src.format, cfg as TableConfig);
    } catch (err) {
      // Layout changed or wasn't what we expected: still alert on any change.
      console.warn(`table parse failed for ${src.id}, falling back to change detection:`, err instanceof Error ? err.message : err);
      return parseChange(body, src.format, (cfg as { change?: ChangeConfig }).change ?? {});
    }
  }
  return parseChange(body, src.format, cfg as ChangeConfig);
}

interface ListingRow {
  id: string;
  hunt_key: string;
  quantity: number | null;
  gone_at: string | null;
}

export interface ListingDiff {
  added: ParsedListing[];
  increased: { listing: ParsedListing; from: number | null }[];
  goneKeys: string[];
}

export function diffListings(previous: ListingRow[], current: ParsedListing[]): ListingDiff {
  const prev = new Map(previous.map((r) => [r.hunt_key, r]));
  const added: ParsedListing[] = [];
  const increased: { listing: ParsedListing; from: number | null }[] = [];
  for (const l of current) {
    const p = prev.get(l.key);
    if (!p || p.gone_at) added.push(l);
    else if (l.quantity !== null && p.quantity !== null && l.quantity > p.quantity) increased.push({ listing: l, from: p.quantity });
  }
  const now = new Set(current.map((l) => l.key));
  const goneKeys = previous.filter((r) => !r.gone_at && !now.has(r.hunt_key)).map((r) => r.hunt_key);
  return { added, increased, goneKeys };
}

function describe(l: ParsedListing): string {
  return l.quantity !== null ? `${l.label} (${l.quantity} available)` : l.label;
}

async function insertEvent(
  env: Env,
  src: Source,
  kind: 'new_listing' | 'quantity_up' | 'page_changed',
  title: string,
  detail: string | null,
  species: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (source_id, kind, state, species, title, detail, link_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(src.id, kind, src.state, species, title, detail, src.link_url || src.url, nowIso())
    .run();
}

async function applyListings(env: Env, src: Source, current: ParsedListing[], baseline: boolean): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT id, hunt_key, quantity, gone_at FROM listings WHERE source_id = ?',
  )
    .bind(src.id)
    .all<ListingRow>();
  const diff = diffListings(results, current);
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const l of current) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO listings (id, source_id, hunt_key, label, species, quantity, first_seen, last_seen, gone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, species = excluded.species,
           quantity = excluded.quantity, last_seen = excluded.last_seen, gone_at = NULL`,
      ).bind(`${src.id}:${l.key}`, src.id, l.key, l.label, l.species ?? null, l.quantity, ts, ts),
    );
  }
  for (const key of diff.goneKeys) {
    stmts.push(env.DB.prepare('UPDATE listings SET gone_at = ? WHERE id = ?').bind(ts, `${src.id}:${key}`));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  // First time this source yields rows (new source, or table parsing just started working):
  // record them quietly instead of announcing every existing hunt as "new".
  if (baseline || results.length === 0) return 0;

  const stateName = STATES[src.state] ?? src.state;
  let events = 0;
  // One event per species, so an elk-only subscriber never gets a deer hunt in their alert.
  for (const [species, added] of groupBySpecies(diff.added, (l) => l)) {
    const shown = added.slice(0, MAX_LISTINGS_PER_EVENT).map(describe);
    const more = added.length - shown.length;
    const noun = species ? `${species} hunts` : 'hunts';
    const title =
      added.length === 1
        ? `${stateName}: ${describe(added[0])} just opened up`
        : `${stateName}: ${added.length} ${noun} just opened up on the ${src.name}`;
    await insertEvent(env, src, 'new_listing', title, shown.join('\n') + (more > 0 ? `\n…and ${more} more` : ''), species ?? src.species);
    events++;
  }
  for (const [species, increased] of groupBySpecies(diff.increased, (d) => d.listing)) {
    const lines = increased.slice(0, MAX_LISTINGS_PER_EVENT).map(({ listing, from }) => `${listing.label}: ${from ?? 0} → ${listing.quantity}`);
    const noun = species ? `${species} hunts` : 'hunts';
    const title =
      increased.length === 1
        ? `${stateName}: more tags returned for ${increased[0].listing.label}`
        : `${stateName}: tags returned in ${increased.length} ${noun} on the ${src.name}`;
    await insertEvent(env, src, 'quantity_up', title, lines.join('\n'), species ?? src.species);
    events++;
  }
  return events;
}

const KNOWN_SPECIES: Record<string, string> = {
  elk: 'elk', deer: 'deer', 'mule deer': 'deer', whitetail: 'deer', 'white-tailed deer': 'deer',
  pronghorn: 'pronghorn', antelope: 'pronghorn', moose: 'moose', 'bighorn sheep': 'sheep', sheep: 'sheep',
  'mountain goat': 'goat', goat: 'goat', bear: 'bear', 'black bear': 'bear', turkey: 'turkey',
};

/** Map a page's species text ("Mule Deer", "Antelope") onto our species keys. */
export function normalizeSpecies(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (KNOWN_SPECIES[s]) return KNOWN_SPECIES[s];
  for (const [k, v] of Object.entries(KNOWN_SPECIES)) if (s.includes(k)) return v;
  return 'other';
}

function groupBySpecies<T>(items: T[], listing: (t: T) => ParsedListing): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const it of items) {
    const key = normalizeSpecies(listing(it).species);
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return groups;
}

/** Check one source; returns how many alert events it created. */
export async function checkSource(env: Env, src: Source): Promise<number> {
  const ts = nowIso();
  let status = 0;
  try {
    const fetched = await fetchSource(env, src);
    status = fetched.status;
    if (!fetched.body) throw new Error(`HTTP ${fetched.status}`);
    const parsed = await parseSource(src, fetched.body);
    const baseline = !src.last_hash;
    const changed = !baseline && parsed.hash !== src.last_hash;
    let events = 0;

    if (parsed.listings) {
      if (baseline || changed) events = await applyListings(env, src, parsed.listings, baseline);
    } else if (changed) {
      const stateName = STATES[src.state] ?? src.state;
      await insertEvent(env, src, 'page_changed', `${stateName}: the ${src.name} was just updated`, src.notes, src.species);
      events = 1;
    }

    await env.DB.prepare(
      `UPDATE sources SET last_hash = ?, last_checked = ?, last_status = ?, fail_count = 0,
         last_changed = CASE WHEN ? THEN ? ELSE last_changed END WHERE id = ?`,
    )
      .bind(parsed.hash, ts, status, changed ? 1 : 0, ts, src.id)
      .run();
    return events;
  } catch (err) {
    console.error(`check ${src.id} failed:`, err instanceof Error ? err.message : err);
    await env.DB.prepare('UPDATE sources SET last_checked = ?, last_status = ?, fail_count = fail_count + 1 WHERE id = ?')
      .bind(ts, status, src.id)
      .run();
    return 0;
  }
}

export async function runChecks(env: Env, onlyId?: string): Promise<{ checked: number; events: number }> {
  const { results } = onlyId
    ? await env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(onlyId).all<Source>()
    : await env.DB.prepare('SELECT * FROM sources WHERE active = 1 ORDER BY last_checked IS NOT NULL, last_checked').all<Source>();
  const now = new Date();
  const due = onlyId ? results : results.filter((s) => isDue(s, now)).slice(0, MAX_SOURCES_PER_RUN);
  let events = 0;
  // Sequential on purpose: polite to agency servers and easy on subrequest limits.
  for (const src of due) events += await checkSource(env, src);
  return { checked: due.length, events };
}

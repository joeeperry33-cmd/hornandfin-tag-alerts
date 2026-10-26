import { parseChange, type ChangeConfig } from './parsers/change';
import { parseTable, type TableConfig } from './parsers/table';
import { robotsAllows } from './robots';
import { mergeFacets, type Opening, type TagFacets } from './tagtype';
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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function fetchSource(env: Env, src: Source): Promise<{ status: number; body: ArrayBuffer | null }> {
  if (!(await robotsAllows(src.url, env.USER_AGENT))) throw new Error('disallowed by robots.txt');
  let res: Response;
  try {
    res = await fetch(src.url, {
      headers: {
        'user-agent': env.USER_AGENT,
        accept: src.format === 'pdf' ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml,text/csv,application/json,*/*',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      cf: { cacheTtl: 0 },
    } as RequestInit);
  } catch (err) {
    throw new Error(`fetch failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  if (!res.ok) {
    // Keep a snippet of the error page: it shows which firewall (Akamai, Cloudflare, Imperva...) refused us.
    const server = res.headers.get('server') ?? '';
    const snippet = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new HttpError(res.status, `HTTP ${res.status}${server ? ` from ${server}` : ''}: ${snippet}`);
  }
  try {
    return { status: res.status, body: await res.arrayBuffer() };
  } catch (err) {
    throw new Error(`reading body failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
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

function sourceDefaults(src: Source): TagFacets {
  try {
    const cfg = src.parser_config ? JSON.parse(src.parser_config) : {};
    return mergeFacets({}, cfg.defaults);
  } catch {
    return {};
  }
}

function sourceOpening(src: Source): Opening {
  return src.opening === 'returned' || src.opening === 'reissue' ? src.opening : 'leftover';
}

async function insertEvent(
  env: Env,
  src: Source,
  kind: 'new_listing' | 'quantity_up' | 'page_changed',
  title: string,
  detail: string | null,
  species: string | null,
  opening: Opening,
  facets: TagFacets,
): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO events (source_id, kind, state, species, title, detail, link_url, created_at, opening, weapon, sex, residency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(src.id, kind, src.state, species, title, detail, src.link_url || src.url, nowIso(), opening, facets.weapon ?? null, facets.sex ?? null, facets.residency ?? null)
    .first<{ id: number }>();
  return row!.id;
}

async function insertItems(env: Env, eventId: number, items: { listing: ParsedListing; from: number | null }[]): Promise<void> {
  const stmts = items.map(({ listing: l, from }) =>
    env.DB.prepare(
      'INSERT INTO event_items (event_id, label, species, quantity, prev_quantity, weapon, sex, residency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(eventId, l.label, normalizeSpecies(l.species), l.quantity, from, l.weapon ?? null, l.sex ?? null, l.residency ?? null),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
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
        `INSERT INTO listings (id, source_id, hunt_key, label, species, quantity, first_seen, last_seen, gone_at, weapon, sex, residency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, species = excluded.species,
           quantity = excluded.quantity, last_seen = excluded.last_seen, gone_at = NULL,
           weapon = excluded.weapon, sex = excluded.sex, residency = excluded.residency`,
      ).bind(`${src.id}:${l.key}`, src.id, l.key, l.label, l.species ?? null, l.quantity, ts, ts, l.weapon ?? null, l.sex ?? null, l.residency ?? null),
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
  const opening = sourceOpening(src);
  const defaults = sourceDefaults(src);
  let events = 0;
  // One alert per change. Each hunt is stored as an item with its own species and tag type, and
  // every subscriber's email lists only the hunts that match their settings.
  if (diff.added.length) {
    const title =
      diff.added.length === 1
        ? `${stateName}: ${describe(diff.added[0])} just opened up`
        : `${stateName}: ${diff.added.length} hunts just opened up on the ${src.name}`;
    const shown = diff.added.slice(0, MAX_LISTINGS_PER_EVENT).map(describe);
    const more = diff.added.length - shown.length;
    const id = await insertEvent(env, src, 'new_listing', title, shown.join('\n') + (more > 0 ? `\n…and ${more} more` : ''), speciesOf(diff.added, src), opening, defaults);
    await insertItems(env, id, diff.added.map((listing) => ({ listing, from: null })));
    events++;
  }
  if (diff.increased.length) {
    const title =
      diff.increased.length === 1
        ? `${stateName}: more tags returned for ${diff.increased[0].listing.label}`
        : `${stateName}: tags returned in ${diff.increased.length} hunts on the ${src.name}`;
    const lines = diff.increased.slice(0, MAX_LISTINGS_PER_EVENT).map(({ listing, from }) => `${listing.label}: ${from ?? 0} → ${listing.quantity}`);
    // A count going back up on a leftover list means hunters returned tags.
    const id = await insertEvent(env, src, 'quantity_up', title, lines.join('\n'), speciesOf(diff.increased.map((d) => d.listing), src), 'returned', defaults);
    await insertItems(env, id, diff.increased);
    events++;
  }
  return events;
}

function speciesOf(listings: ParsedListing[], src: Source): string | null {
  const set = new Set(listings.map((l) => normalizeSpecies(l.species)).filter(Boolean) as string[]);
  return set.size ? [...set].join(',') : src.species;
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
      await insertEvent(env, src, 'page_changed', `${stateName}: the ${src.name} was just updated`, src.notes, src.species, sourceOpening(src), sourceDefaults(src));
      events = 1;
    }

    await env.DB.prepare(
      `UPDATE sources SET last_hash = ?, last_checked = ?, last_status = ?, fail_count = 0, last_error = NULL,
         last_changed = CASE WHEN ? THEN ? ELSE last_changed END WHERE id = ?`,
    )
      .bind(parsed.hash, ts, status, changed ? 1 : 0, ts, src.id)
      .run();
    return events;
  } catch (err) {
    if (err instanceof HttpError) status = err.status;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`check ${src.id} failed:`, message);
    await env.DB.prepare('UPDATE sources SET last_checked = ?, last_status = ?, last_error = ?, fail_count = fail_count + 1 WHERE id = ?')
      .bind(ts, status, message, src.id)
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

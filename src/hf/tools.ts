import type { Env } from '../types';
import { upcomingDeadlines } from '../reminders';
import { STATES } from '../util';

/**
 * The shared "brain": small, factual lookups used by the Hunt Planner, Ask Horn & Fin and the MCP server.
 * Every answer carries its source so replies can cite it. Nothing here invents a number.
 */

const DEFAULT_ODDS_REF = '0a8bccc';

export interface DrawRow {
  points: number | null;
  applicants: number;
  drawn: number;
}

interface HuntFile {
  state: string;
  year: number;
  draw: string;
  system: string;
  split: boolean;
  sources: { label: string; url: string }[];
  notes?: string[];
  hunts: {
    id: string;
    sp: string;
    name: string;
    q?: { res: number | null; nr: number | null; all: number | null };
    res?: [number | null, number, number][];
    nr?: [number | null, number, number][];
    all?: [number | null, number, number][];
  }[];
}

const oddsCache = new Map<string, { at: number; data: HuntFile }>();

export async function huntFile(env: Env, state: string): Promise<HuntFile | null> {
  const code = state.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return null;
  const ref = env.DRAW_ODDS_REF || DEFAULT_ODDS_REF;
  const key = `${ref}:${code}`;
  const hit = oddsCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
  const res = await fetch(`https://cdn.jsdelivr.net/gh/joeeperry33-cmd/hornandfin-draw-odds@${ref}/data/${code}.json`, {
    cf: { cacheTtl: 21600, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) return null;
  const data = (await res.json()) as HuntFile;
  oddsCache.set(key, { at: Date.now(), data });
  return data;
}

/** Odds at one point level: share of applicants at that level who drew. Everyone above the cutoff counts as 100%. */
export function oddsAt(rows: [number | null, number, number][] | undefined, points: number | null): { pct: number | null; applicants: number; drawn: number; basis: string } {
  if (!rows?.length) return { pct: null, applicants: 0, drawn: 0, basis: 'no results published' };
  if (rows.length === 1 && rows[0][0] === null) {
    const [, a, d] = rows[0];
    return { pct: a ? Math.round((d / a) * 1000) / 10 : null, applicants: a, drawn: d, basis: 'random draw, all applicants' };
  }
  const p = points ?? 0;
  const exact = rows.find((r) => r[0] === p);
  if (exact) {
    const [, a, d] = exact;
    return { pct: a ? Math.round((d / a) * 1000) / 10 : null, applicants: a, drawn: d, basis: `applicants with ${p} points last draw` };
  }
  const maxPts = Math.max(...rows.map((r) => r[0] ?? 0));
  const allDrewAtTop = rows.filter((r) => (r[0] ?? 0) === maxPts).every((r) => r[2] >= r[1]);
  if (p > maxPts && allDrewAtTop) return { pct: 100, applicants: 0, drawn: 0, basis: `more points than anyone who applied (${maxPts})` };
  return { pct: null, applicants: 0, drawn: 0, basis: `nobody applied with ${p} points last draw` };
}

export async function getDrawOdds(
  env: Env,
  input: { state: string; species?: string; hunt?: string; points?: number; residency?: 'res' | 'nr'; limit?: number },
): Promise<unknown> {
  const file = await huntFile(env, input.state);
  if (!file) return { error: `No draw results on Horn & Fin for ${input.state} yet.` };
  const sp = input.species?.toLowerCase();
  const q = input.hunt?.toLowerCase();
  const resKey = input.residency === 'res' ? 'res' : 'nr';
  const hunts = file.hunts
    .filter((h) => !sp || h.sp === sp || h.sp.startsWith(sp))
    .filter((h) => !q || h.id.toLowerCase().includes(q) || h.name.toLowerCase().includes(q))
    .map((h) => {
      const rows = file.split ? h[resKey] : h.all;
      return { id: h.id, species: h.sp, name: h.name, tags: h.q?.[file.split ? resKey : 'all'] ?? h.q?.all ?? null, odds: oddsAt(rows, input.points ?? null) };
    })
    .sort((a, b) => (b.odds.pct ?? -1) - (a.odds.pct ?? -1))
    .slice(0, Math.min(input.limit ?? 12, 25));
  return {
    state: file.state,
    draw: file.draw,
    system: file.system,
    residency: file.split ? resKey : 'not split',
    hunts,
    source: file.sources[0] ?? null,
    note: 'Last draw results, not a promise of next year. Confirm in the current regulations.',
    odds_page: 'https://hornandfin.com/hunting-guides/draw-odds/',
  };
}

export interface ListingRow {
  id: number;
  title: string;
  url: string;
  directory: string | null;
  category: string | null;
  state: string | null;
  city: string | null;
  county: string | null;
  species: string | null;
  summary: string | null;
  featured: number;
  claimed: number;
}

export async function findOutfitters(
  env: Env,
  input: { state: string; species?: string; directory?: string; city?: string; county?: string; limit?: number },
): Promise<{ listings: (ListingRow & { label: string })[]; note: string }> {
  const where = ['state = ?'];
  const binds: unknown[] = [input.state.toUpperCase()];
  if (input.species) { where.push("(species LIKE ? OR title LIKE ? OR category LIKE ?)"); const s = `%${input.species.toLowerCase()}%`; binds.push(s, s, s); }
  if (input.directory) { where.push('directory LIKE ?'); binds.push(`%${input.directory}%`); }
  if (input.county) { where.push('county LIKE ?'); binds.push(`%${input.county.replace(/ county$/i, '')}%`); }
  if (input.city) { where.push('city LIKE ?'); binds.push(`%${input.city}%`); }
  const limit = Math.min(input.limit ?? 6, 12);
  const { results } = await env.DB.prepare(
    `SELECT id, title, url, directory, category, state, city, county, species, summary, featured, claimed FROM hf_listings
     WHERE ${where.join(' AND ')} ORDER BY featured DESC, claimed DESC, title LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<ListingRow>();
  return {
    listings: results.map((r) => ({ ...r, summary: r.summary?.slice(0, 280) ?? null, label: r.featured ? 'Featured' : '' })),
    note: 'Featured listings pay to appear first and must be labeled "Featured" when shown.',
  };
}

export async function listDeadlines(env: Env, input: { state?: string; species?: string; days?: number }): Promise<unknown> {
  const list = await upcomingDeadlines(env, { state: input.state?.toUpperCase(), species: input.species, days: input.days ?? 180 });
  return {
    deadlines: list.map((d) => ({ state: d.state, species: d.species ?? 'all', kind: d.kind, date: d.date, time: d.time_note, title: d.title, link: d.link_url, source: d.source })),
    note: list.length
      ? 'Dates confirmed from each agency. Confirm on the official page before applying.'
      : 'No confirmed dates loaded for this yet. Do not guess a date: tell the person to check the agency page.',
    reminders_signup: 'https://hornandfin.com/hunting-guides/draw-odds/#reminders',
  };
}

/** Rulebook search with D1 full-text search. Every passage carries book, year, page and link for citing. */
export async function searchRegulations(env: Env, input: { state: string; query: string; limit?: number }): Promise<unknown> {
  const terms = input.query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 8);
  if (!terms.length) return { passages: [], note: 'Ask with a few specific words.' };
  const match = terms.map((t) => `"${t}"`).join(' OR ');
  const { results } = await env.DB.prepare(
    `SELECT p.state, p.year, p.book, p.page, p.url, p.text FROM hf_reg_fts f JOIN hf_reg_passages p ON p.id = f.rowid
     WHERE hf_reg_fts MATCH ? AND p.state = ? ORDER BY bm25(hf_reg_fts) LIMIT ?`,
  )
    .bind(match, input.state.toUpperCase(), Math.min(input.limit ?? 4, 6))
    .all<{ state: string; year: string; book: string; page: number | null; url: string; text: string }>();
  return {
    passages: results.map((r) => ({ cite: `${r.book} (${r.year})${r.page ? `, p. ${r.page}` : ''}`, url: r.url, text: r.text.slice(0, 1800) })),
    note: results.length
      ? 'Quote or closely paraphrase these and cite them. Not legal advice; the agency rulebook is the final word.'
      : `No ${STATES[input.state.toUpperCase()] ?? input.state} rulebook passages loaded for that. Say so and link the agency; do not answer from memory.`,
  };
}

const STOP = new Set(['the', 'and', 'for', 'can', 'are', 'what', 'when', 'how', 'does', 'with', 'you', 'have', 'this', 'that', 'from', 'there', 'any', 'need']);

export async function recentStocking(env: Env, input: { state: string; water?: string; county?: string; days?: number }): Promise<unknown> {
  const since = new Date(Date.now() - (input.days ?? 21) * 86_400_000).toISOString().slice(0, 10);
  const where = ['r.state = ?', '(r.stocked_on >= ? OR (r.stocked_on IS NULL AND r.first_seen >= ?))'];
  const binds: unknown[] = [input.state.toUpperCase(), since, since];
  if (input.water) { where.push('r.water_key LIKE ?'); binds.push(`%${waterKey(input.water)}%`); }
  if (input.county) { where.push('r.county LIKE ?'); binds.push(`%${input.county.replace(/ county$/i, '')}%`); }
  const { results } = await env.DB.prepare(
    `SELECT r.water, r.county, r.species, r.quantity, r.stocked_on, s.link_url FROM stocking_reports r JOIN stocking_sources s ON s.id = r.source_id
     WHERE ${where.join(' AND ')} ORDER BY COALESCE(r.stocked_on, r.first_seen) DESC LIMIT 25`,
  )
    .bind(...binds)
    .all();
  return { stockings: results, note: results.length ? 'From the state stocking report.' : 'No stockings on file for that in the last few weeks.' };
}

export function waterKey(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Tool definitions shared by the Claude API calls and the MCP server. */
export const TOOL_DEFS = [
  {
    name: 'get_draw_odds',
    description: 'Last-draw results for a state: hunts with tags and the share of applicants who drew at a point level. Use for "can I draw", "what are my odds", "best units".',
    input_schema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Two-letter state code, e.g. CO' },
        species: { type: 'string', description: 'elk, deer, pronghorn, moose, sheep, goat, bear, turkey...' },
        hunt: { type: 'string', description: 'Optional hunt code or unit text to narrow results' },
        points: { type: 'integer', description: "Hunter's current points (0 if none)" },
        residency: { type: 'string', enum: ['res', 'nr'] },
        limit: { type: 'integer' },
      },
      required: ['state'],
    },
  },
  {
    name: 'find_outfitters',
    description: 'Horn & Fin directory listings (outfitters, guides, charters, processors, lodging) in a state. Featured listings come first and must be labeled Featured.',
    input_schema: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        species: { type: 'string' },
        directory: { type: 'string', description: 'e.g. Outfitters, Fishing, Processors' },
        city: { type: 'string' },
        county: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['state'],
    },
  },
  {
    name: 'list_deadlines',
    description: 'Confirmed application open/close dates and draw-result dates. Never guess a date that is not returned here.',
    input_schema: { type: 'object', properties: { state: { type: 'string' }, species: { type: 'string' }, days: { type: 'integer' } } },
  },
  {
    name: 'search_regulations',
    description: 'Search the state rulebook text. Returns passages with book, year and page to cite. Use for any rules question.',
    input_schema: { type: 'object', properties: { state: { type: 'string' }, query: { type: 'string' } }, required: ['state', 'query'] },
  },
  {
    name: 'recent_stocking',
    description: 'Recent trout and fish stockings from the state stocking report, by water or county.',
    input_schema: { type: 'object', properties: { state: { type: 'string' }, water: { type: 'string' }, county: { type: 'string' }, days: { type: 'integer' } }, required: ['state'] },
  },
] as const;

export async function runTool(env: Env, name: string, input: Record<string, unknown>): Promise<unknown> {
  const state = String(input.state ?? '').toUpperCase();
  if (name !== 'list_deadlines' && !STATES[state]) return { error: 'Give a two-letter US state code.' };
  switch (name) {
    case 'get_draw_odds':
      return getDrawOdds(env, { ...(input as object), state } as Parameters<typeof getDrawOdds>[1]);
    case 'find_outfitters':
      return findOutfitters(env, { ...(input as object), state } as Parameters<typeof findOutfitters>[1]);
    case 'list_deadlines':
      return listDeadlines(env, input as Parameters<typeof listDeadlines>[1]);
    case 'search_regulations':
      return searchRegulations(env, { state, query: String(input.query ?? '') });
    case 'recent_stocking':
      return recentStocking(env, { ...(input as object), state } as Parameters<typeof recentStocking>[1]);
    default:
      return { error: `unknown tool ${name}` };
  }
}

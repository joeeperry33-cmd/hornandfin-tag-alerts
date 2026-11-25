import type { Env } from '../types';
import { pdfItems, type PdfItem } from '../pdftext';
import { robotsAllows } from '../robots';
import { nowIso, SPECIES, STATES } from '../util';
import { huntFile, oddsAt } from './tools';

/** Nightly copy of public listing facts from hornandfin.com. */
export interface ExportedListing {
  id: number;
  title: string;
  url: string;
  directory?: string;
  category?: string;
  state?: string;
  city?: string;
  county?: string;
  species?: string;
  summary?: string;
  featured?: boolean;
  claimed?: boolean;
  lat?: number;
  lng?: number;
}

const STATE_BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]));

export function stateCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (STATES[s.toUpperCase()]) return s.toUpperCase();
  return STATE_BY_NAME.get(s.toLowerCase()) ?? null;
}

export async function syncListings(env: Env): Promise<{ pages: number; listings: number; error?: string }> {
  const base = env.HF_LISTINGS_URL || 'https://hornandfin.com/wp-json/hf/v1/listings-public';
  let page = 1;
  let total = 0;
  const ts = nowIso();
  try {
    for (; page <= 40; page++) {
      const res = await fetch(`${base}?page=${page}&per_page=500`, { headers: { 'user-agent': env.USER_AGENT }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
      const data = (await res.json()) as { listings: ExportedListing[]; more?: boolean };
      const stmts = data.listings
        .filter((l) => l.id && l.title && /^https:\/\/(www\.)?hornandfin\.com\//.test(l.url))
        .map((l) =>
          env.DB.prepare(
            `INSERT INTO hf_listings (id, title, url, directory, category, state, city, county, species, summary, featured, claimed, lat, lng, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, directory = excluded.directory, category = excluded.category,
               state = excluded.state, city = excluded.city, county = excluded.county, species = excluded.species, summary = excluded.summary,
               featured = excluded.featured, claimed = excluded.claimed, lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at`,
          ).bind(
            l.id, l.title.slice(0, 200), l.url, l.directory ?? null, l.category ?? null, stateCode(l.state), l.city ?? null,
            l.county?.replace(/ county$/i, '') ?? null, l.species?.toLowerCase() ?? null, l.summary?.slice(0, 600) ?? null,
            l.featured ? 1 : 0, l.claimed ? 1 : 0, l.lat ?? null, l.lng ?? null, ts,
          ),
        );
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      total += stmts.length;
      if (!data.more || !data.listings.length) break;
    }
    // Listings gone from the export (trashed or unpublished) leave the copy too.
    if (total > 1000) await env.DB.prepare('DELETE FROM hf_listings WHERE updated_at < ?').bind(ts).run();
    return { pages: page, listings: total };
  } catch (err) {
    return { pages: page, listings: total, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Put PDF text pieces back into lines, top to bottom, so a page reads like the rulebook. */
export function pageText(items: PdfItem[]): string {
  const lines = new Map<number, PdfItem[]>();
  for (const it of items) {
    const key = Math.round(it.y / 3);
    const row = lines.get(key) ?? [];
    row.push(it);
    lines.set(key, row);
  }
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((r) => r.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Split a page into passages of about 1,400 characters on line breaks. */
export function chunkPage(text: string, size = 1400): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length > size && cur.length > 200) {
      out.push(cur.trim());
      cur = '';
    }
    cur += `${line}\n`;
  }
  if (cur.trim().length > 40) out.push(cur.trim());
  return out;
}

/** Admin: read a state rulebook PDF and store its passages (replacing that book and year). */
export async function importRulebook(env: Env, input: { state: string; year: string; book: string; url: string; pageOffset?: number }): Promise<{ pages: number; passages: number }> {
  const state = stateCode(input.state);
  if (!state) throw new Error('unknown state');
  if (!/^https:\/\//.test(input.url)) throw new Error('url must be https');
  if (!(await robotsAllows(input.url, env.USER_AGENT))) throw new Error('disallowed by robots.txt');
  const res = await fetch(input.url, { headers: { 'user-agent': env.USER_AGENT, accept: 'application/pdf' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const items = await pdfItems(bytes);
  const byPage = new Map<number, PdfItem[]>();
  for (const it of items) byPage.set(it.page, [...(byPage.get(it.page) ?? []), it]);
  await env.DB.prepare('DELETE FROM hf_reg_passages WHERE state = ? AND year = ? AND book = ?').bind(state, input.year, input.book).run();
  const stmts: D1PreparedStatement[] = [];
  for (const [page, its] of byPage) {
    const printed = page + (input.pageOffset ?? 0);
    for (const chunk of chunkPage(pageText(its))) {
      stmts.push(
        env.DB.prepare('INSERT INTO hf_reg_passages (state, year, book, page, url, text) VALUES (?, ?, ?, ?, ?, ?)').bind(
          state, input.year, input.book, printed > 0 ? printed : null, `${input.url}#page=${page}`, chunk,
        ),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { pages: byPage.size, passages: stmts.length };
}

/** Points Tracker: what a hunter holds, and last-draw odds for their best hunts at those points. */
export interface PointsRow {
  state: string;
  species: string;
  residency: 'res' | 'nr';
  points: number;
}

export function cleanPoints(raw: unknown): PointsRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      state: String(r?.state ?? '').toUpperCase(),
      species: String(r?.species ?? '').toLowerCase(),
      residency: r?.residency === 'res' ? ('res' as const) : ('nr' as const),
      points: Math.max(0, Math.min(40, parseInt(String(r?.points ?? '0'), 10) || 0)),
    }))
    .filter((r) => STATES[r.state] && (SPECIES.includes(r.species) || /^[a-z_]{3,20}$/.test(r.species)))
    .slice(0, 40);
}

export async function savePoints(env: Env, subId: string, rows: PointsRow[]): Promise<void> {
  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hf_points WHERE subscriber_id = ?').bind(subId),
    ...rows.map((r) =>
      env.DB.prepare('INSERT OR REPLACE INTO hf_points (subscriber_id, state, species, residency, points, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        subId, r.state, r.species, r.residency, r.points, ts,
      ),
    ),
  ]);
}

export async function pointsReport(env: Env, subId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare('SELECT state, species, residency, points FROM hf_points WHERE subscriber_id = ? ORDER BY state, species')
    .bind(subId)
    .all<PointsRow>();
  const out = [];
  for (const r of results) {
    const file = await huntFile(env, r.state).catch(() => null);
    let best: { id: string; name: string; pct: number | null }[] = [];
    if (file) {
      best = file.hunts
        .filter((h) => h.sp === r.species)
        .map((h) => ({ id: h.id, name: h.name, pct: oddsAt(file.split ? h[r.residency] : h.all, r.points).pct }))
        .filter((h) => h.pct !== null && h.pct > 0)
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
        .slice(0, 3);
    }
    out.push({ ...r, best, draw: file?.draw ?? null });
  }
  return out;
}

/** Import the next waiting rulebook (one per run keeps each run short). */
export async function importNextRulebook(env: Env): Promise<string | null> {
  // A book still marked 'working' from an earlier run means that run was killed mid-import (usually memory).
  // Mark it failed so the queue moves on instead of retrying the same book forever.
  await env.DB.prepare(
    "UPDATE hf_rulebook_queue SET status = 'failed', result = 'run ended during import (likely too big for memory)', updated_at = ? WHERE status = 'working'",
  )
    .bind(nowIso())
    .run();
  const next = await env.DB.prepare("SELECT * FROM hf_rulebook_queue WHERE status = 'waiting' ORDER BY id LIMIT 1").first<{
    id: number; state: string; year: string; book: string; url: string; page_offset: number;
  }>();
  if (!next) return null;
  await env.DB.prepare("UPDATE hf_rulebook_queue SET status = 'working', updated_at = ? WHERE id = ?").bind(nowIso(), next.id).run();
  try {
    const r = await importRulebook(env, { state: next.state, year: next.year, book: next.book, url: next.url, pageOffset: next.page_offset });
    await env.DB.prepare("UPDATE hf_rulebook_queue SET status = 'done', result = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(r), nowIso(), next.id).run();
    return `${next.book}: ${r.pages} pages, ${r.passages} passages`;
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    await env.DB.prepare("UPDATE hf_rulebook_queue SET status = 'failed', result = ?, updated_at = ? WHERE id = ?").bind(msg, nowIso(), next.id).run();
    return `${next.book} failed: ${msg}`;
  }
}

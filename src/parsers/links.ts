import { classify, mergeFacets, type TagFacets } from '../tagtype';
import { decodeEntities, sha256 } from '../util';
import type { ParsedListing, ParseResult } from '../types';

/**
 * States that only announce leftover sales in a news release or a short list of links
 * (Nebraska, Tennessee, New Mexico, Washington, Minnesota, Alaska). Every link on the page whose
 * text (or address) matches is one item; a new matching link means a new sale was posted.
 */
export interface LinksConfig {
  /** Regex (case-insensitive) the link text must match, e.g. "leftover|surplus". */
  match: string;
  /** Optional regex the link address must also match. */
  hrefMatch?: string;
  /** Regex (case-insensitive) that drops a link even if it matched, e.g. "fishing". */
  exclude?: string;
  /** Only read links after this text on the page (case-insensitive). */
  start?: string;
  /** Text put before each link's text in alerts, e.g. "News release:". */
  labelPrefix?: string;
  species?: string;
  defaults?: TagFacets;
}

function plain(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function linksFromHtml(html: string, baseUrl: string, cfg: LinksConfig): ParsedListing[] {
  let page = html;
  if (cfg.start) {
    const i = page.toLowerCase().indexOf(cfg.start.toLowerCase());
    if (i < 0) throw new Error(`Section "${cfg.start}" not found on the page`);
    page = page.slice(i);
  }
  const match = new RegExp(cfg.match, 'i');
  const hrefMatch = cfg.hrefMatch ? new RegExp(cfg.hrefMatch, 'i') : null;
  const exclude = cfg.exclude ? new RegExp(cfg.exclude, 'i') : null;
  const out = new Map<string, ParsedListing>();
  const re = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    const text = plain(m[3]);
    let href: string;
    try {
      href = new URL(decodeEntities(m[2]), baseUrl).toString().replace(/#.*$/, '');
    } catch {
      continue;
    }
    if (!/^https?:/.test(href) || !text) continue;
    if (!match.test(text) && !match.test(href)) continue;
    if (hrefMatch && !hrefMatch.test(href)) continue;
    if (exclude && (exclude.test(text) || exclude.test(href))) continue;
    if (out.has(href)) continue;
    const label = `${cfg.labelPrefix ? `${cfg.labelPrefix.trimEnd()} ` : ''}${text}`.slice(0, 240);
    const facets = mergeFacets(classify(text), cfg.defaults);
    out.set(href, { key: href, label, species: cfg.species, quantity: null, weapon: facets.weapon ?? null, sex: facets.sex ?? null, residency: facets.residency ?? null });
  }
  return [...out.values()];
}

export async function parseLinks(body: ArrayBuffer, baseUrl: string, cfg: LinksConfig): Promise<ParseResult> {
  const listings = linksFromHtml(new TextDecoder().decode(body), baseUrl, cfg);
  return { hash: await sha256(listings.map((l) => l.key).sort().join('\n')), listings };
}

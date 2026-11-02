import { sha256 } from '../util';
import type { ParsedListing, ParseResult } from '../types';
import type { Sex, Weapon } from '../tagtype';

/**
 * Colorado's leftover and reissue lists, as text copied from CPW's file viewer in a real browser
 * (CPW serves the PDFs only through that viewer). Each hunt reads:
 *   LIST  [DESCRIPTION]  SEASON DATES  HUNT CODE  VALID UNITS  AVAILABLE
 * Hunt codes carry the tag type: EF011O4R = Elk, Female (antlerless), unit 011, rifle season 4, Rifle.
 */

const CODE = /^[A-Z][MFE]\d{3}[A-Z]\d[A-Z]$/;
const DATE = /\d{2}\/\d{2}\/\d{4}/;
const SPECIES: Record<string, string> = { A: 'pronghorn', B: 'bear', D: 'deer', E: 'elk', M: 'moose', S: 'sheep', G: 'goat', T: 'turkey' };
const SPECIES_WORD: Record<string, string> = { pronghorn: 'Pronghorn', bear: 'Bear', deer: 'Deer', elk: 'Elk', moose: 'Moose', sheep: 'Bighorn sheep', goat: 'Mountain goat', turkey: 'Turkey' };
const SEX: Record<string, Sex> = { M: 'antlered', F: 'antlerless', E: 'either' };
const WEAPON: Record<string, Weapon> = { R: 'rifle', A: 'archery', M: 'muzzleloader' };
const NOISE = /^(run date and time|due to delays|limited licensing|reissue|colorado parks and wildlife|hunt code|list|valid units|description|season dates|available|quota|pronghorn|black bear|bear|deer|elk|moose|bighorn sheep|mountain goat|desert bighorn sheep|turkey|page \d+)/i;

export interface ColoradoHunt {
  code: string;
  list: string | null;
  description: string;
  dates: string;
  units: string;
  available: number;
}

export function parseColoradoText(text: string): ColoradoHunt[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hunts: ColoradoHunt[] = [];
  let before: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CODE.test(line)) {
      before.push(line);
      continue;
    }
    // Units can wrap across lines: "133,134,140,141," then "147".
    let j = i + 1;
    let units = lines[j] ?? '';
    while (units.endsWith(',') && j + 1 < lines.length) units += lines[++j];
    const available = parseInt(lines[j + 1] ?? '', 10);
    const pre = before.filter((l) => !NOISE.test(l));
    const list = pre.find((l) => /^[A-C]$/.test(l)) ?? null;
    const dates = pre.filter((l) => DATE.test(l)).join(' ').replace(/,\s*$/, '').replace(/\s+/g, ' ');
    const description = pre
      .filter((l) => l !== list && !DATE.test(l))
      .join(' ')
      .replace(/,\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (Number.isFinite(available)) hunts.push({ code: line, list, description, dates, units, available });
    before = [];
    i = j + 1;
  }
  return hunts;
}

export function coloradoListings(text: string): ParsedListing[] {
  return parseColoradoText(text)
    .filter((h) => h.available > 0)
    .map((h) => {
      const species = SPECIES[h.code[0]] ?? 'other';
      const parts = [`${SPECIES_WORD[species] ?? ''} ${h.code}`.trim(), `GMU ${h.units}`, h.dates, h.description, h.list ? `List ${h.list}` : ''];
      let label = parts.filter(Boolean).join(' – ');
      if (label.length > 160) label = label.slice(0, 159).trimEnd() + '…';
      return {
        key: h.code,
        label,
        species,
        quantity: h.available,
        sex: SEX[h.code[1]] ?? null,
        weapon: WEAPON[h.code[h.code.length - 1]] ?? null,
        residency: 'both' as const,
      };
    });
}

/** "Run Date and Time: Nov 02 2026 8:44:00 AM MST" as printed at the top of each page. */
export function coloradoRunDate(text: string): string | null {
  return /Run Date and Time:\s*([^\n]+)/i.exec(text)?.[1]?.trim() ?? null;
}

export async function parseColorado(text: string): Promise<ParseResult> {
  const listings = coloradoListings(text);
  if (!parseColoradoText(text).length) throw new Error('Snapshot has no Colorado hunt codes; the viewer may not have finished loading');
  const canonical = listings
    .map((l) => `${l.key}=${l.quantity}`)
    .sort()
    .join('\n');
  return { hash: await sha256(canonical), listings };
}

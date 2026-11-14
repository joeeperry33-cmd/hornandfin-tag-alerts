import { classify, mergeFacets, type TagFacets } from '../tagtype';
import type { ParsedListing } from '../types';
import type { PdfItem } from '../pdftext';

/**
 * Arizona's leftover ("first come") permit-tag PDFs: one table per hunt type, each with a centered
 * heading ("HAM (Handgun, Archery, Muzzleloader) Javelina"), a header row
 * (Hunt No. | Number of Permits | Unit | Dates) and rows whose unit text can wrap onto more lines.
 */

const DATE_RANGE = /\d{1,2}\/\d{1,2}\/\d{2,4}\s*[–-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}/;

function speciesOf(heading: string): string {
  const h = heading.toLowerCase();
  if (/\belk\b/.test(h)) return 'elk';
  if (/\bdeer\b/.test(h)) return 'deer';
  if (/pronghorn|antelope/.test(h)) return 'pronghorn';
  if (/\bbear\b/.test(h)) return 'bear';
  if (/turkey/.test(h)) return 'turkey';
  if (/bighorn|sheep/.test(h)) return 'sheep';
  if (/javelina|peccary/.test(h)) return 'javelina';
  return 'other'; // bison, sandhill crane...
}

function facetsOf(heading: string): TagFacets {
  const f: TagFacets = {};
  if (/archery only/i.test(heading)) f.weapon = 'archery';
  else if (/\bHAM\b|handgun, archery, muzzleloader/i.test(heading)) f.weapon = 'muzzleloader';
  else if (/muzzleloader/i.test(heading)) f.weapon = 'muzzleloader';
  else if (/\bgeneral\b/i.test(heading)) f.weapon = 'any';
  if (/non-?resident/i.test(heading)) f.residency = 'nonresident';
  if (/antlerless|cow|doe/i.test(heading)) f.sex = 'antlerless';
  else if (/\bbull\b|\bbuck\b|antlered/i.test(heading)) f.sex = 'antlered';
  return f;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

/** Turn the PDF's text pieces into one listing per hunt. Raptor-capture permits are skipped. */
export function arizonaListings(items: PdfItem[]): ParsedListing[] {
  const out: ParsedListing[] = [];
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  let carryHeading = ''; // a table that continues onto the next page keeps its heading

  for (const page of pages) {
    const onPage = items.filter((i) => i.page === page);
    const headers = onPage.filter((i) => /^hunt no\.?$/i.test(i.str.trim())).sort((a, b) => b.y - a.y);
    // Rows above the first header on a page belong to the table carried over from the last page.
    const blocks: { heading: string; top: number; bottom: number; header?: PdfItem }[] = [];
    if (carryHeading) blocks.push({ heading: carryHeading, top: Infinity, bottom: headers[0] ? headers[0].y + 40 : -Infinity });

    headers.forEach((h, idx) => {
      const next = headers[idx + 1];
      // The heading is the text just above the header row in a different font from the rows.
      const near = onPage.filter((i) => i.y > h.y + 1 && i.y <= h.y + 40 && i.font !== h.font);
      const rowFont = onPage.find((i) => i.y < h.y && /^\d{4,5}$/.test(i.str.trim()))?.font;
      const headingParts = near
        .filter((i) => i.font !== rowFont && !/^see hunt regulations/i.test(i.str.trim()))
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((i) => i.str.trim());
      const heading = tidy(headingParts.join(' '));
      blocks.push({ heading, top: h.y, bottom: next ? next.y + 40 : -Infinity, header: h });
      carryHeading = heading;
    });

    for (const block of blocks) {
      if (!block.heading || /raptor|falcon|goshawk|capture/i.test(block.heading)) continue;
      const body = onPage.filter((i) => i.y < block.top - 1 && i.y > block.bottom);
      // Column edges from the header row on this page (fall back to the first header seen).
      const hdr = block.header ?? headers[0];
      const cols = hdr ? onPage.filter((i) => Math.abs(i.y - hdr.y) < 2).sort((a, b) => a.x - b.x) : [];
      const centers = cols.map((c) => c.x + c.w / 2);
      const huntEdge = centers.length >= 2 ? (centers[0] + centers[1]) / 2 : 140;
      const permitEdge = centers.length >= 3 ? (centers[1] + centers[2]) / 2 : 250;

      const anchors = body.filter((i) => i.x < huntEdge && /^\d{4,5}$/.test(i.str.trim())).sort((a, b) => b.y - a.y);
      for (let a = 0; a < anchors.length; a++) {
        const anchor = anchors[a];
        const nextY = anchors[a + 1]?.y ?? -Infinity;
        const cells = body.filter((i) => i !== anchor && i.y <= anchor.y + 2 && i.y > nextY + 2);
        let permits: number | null = null;
        const unit: string[] = [];
        let dates = '';
        for (const c of cells.sort((x, y) => y.y - x.y || x.x - y.x)) {
          const s = c.str.trim();
          if (DATE_RANGE.test(s) && !dates) dates = tidy(s.match(DATE_RANGE)![0]);
          else if (c.x < permitEdge && /^\d+$/.test(s) && permits === null) permits = parseInt(s, 10);
          else if (!DATE_RANGE.test(s)) unit.push(s);
        }
        if (permits === null || permits <= 0) continue;
        const hunt = anchor.str.trim();
        const unitText = tidy(unit.join(' ')).replace(/\bEXLUDING\b/g, 'EXCLUDING');
        const label = `${block.heading}, hunt ${hunt}${unitText ? `, unit ${unitText}` : ''}${dates ? `, ${dates}` : ''}`;
        const facets = mergeFacets(facetsOf(block.heading), classify(label));
        out.push({
          key: hunt,
          label,
          species: speciesOf(block.heading),
          quantity: permits,
          weapon: facets.weapon ?? null,
          sex: facets.sex ?? null,
          residency: facets.residency ?? null,
        });
      }
    }
  }
  // The same hunt can appear in two posted PDFs; keep the latest (last) one.
  const byKey = new Map(out.map((l) => [l.key, l]));
  return [...byKey.values()];
}

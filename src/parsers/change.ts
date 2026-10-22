import { htmlToText, sha256 } from '../util';
import type { ParseResult } from '../types';

export interface ChangeConfig {
  /** Only hash the text between these two markers (case-insensitive). */
  start?: string;
  end?: string;
  /** Regex sources removed before hashing (timestamps, visitor counters, etc.). */
  ignore?: string[];
}

/** Text of an HTML page reduced to the part that matters, for change detection. */
export function meaningfulText(html: string, cfg: ChangeConfig = {}): string {
  let text = htmlToText(html);
  if (cfg.start) {
    const i = text.toLowerCase().indexOf(cfg.start.toLowerCase());
    if (i >= 0) text = text.slice(i);
  }
  if (cfg.end) {
    const j = text.toLowerCase().indexOf(cfg.end.toLowerCase(), cfg.start ? cfg.start.length : 0);
    if (j >= 0) text = text.slice(0, j);
  }
  // Common noise on agency pages.
  const noise = [
    String.raw`last (updated|modified|reviewed)[:\s][^\n]{0,40}`,
    String.raw`\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b`,
    String.raw`©\s?\d{4}[^\n]*`,
    ...(cfg.ignore ?? []),
  ];
  for (const pattern of noise) text = text.replace(new RegExp(pattern, 'gi'), ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * PDFs are regenerated with fresh timestamps and IDs on many servers, so a raw
 * byte hash would change every fetch. Strip those fields before hashing.
 */
export function stablePdfBytes(buf: ArrayBuffer): string {
  // latin1 keeps a 1:1 byte mapping so the binary survives the round trip.
  const s = new TextDecoder('latin1').decode(buf);
  return s
    .replace(/\/(CreationDate|ModDate)\s*\([^)]*\)/g, '')
    .replace(/\/ID\s*\[[^\]]*\]/g, '')
    .replace(/<xmp:(CreateDate|ModifyDate|MetadataDate)>[^<]*<\/xmp:\1>/g, '')
    .replace(/<xmpMM:(DocumentID|InstanceID)>[^<]*<\/xmpMM:\1>/g, '');
}

export async function parseChange(body: ArrayBuffer, format: string, cfg: ChangeConfig = {}): Promise<ParseResult> {
  if (format === 'pdf') return { hash: await sha256(stablePdfBytes(body)) };
  const text = new TextDecoder().decode(body);
  if (format === 'html') return { hash: await sha256(meaningfulText(text, cfg)) };
  return { hash: await sha256(text.replace(/\s+/g, ' ').trim()) };
}

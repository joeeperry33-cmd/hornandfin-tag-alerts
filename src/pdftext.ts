import { getDocumentProxy } from 'unpdf';

/** One piece of text from a PDF page with its position (PDF points; y grows upward). */
export interface PdfItem {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  str: string;
}

/** All text pieces in a PDF, page by page. */
export async function pdfItems(bytes: Uint8Array): Promise<PdfItem[]> {
  const doc = await getDocumentProxy(bytes);
  const out: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items as { str: string; transform: number[]; width: number; height: number; fontName: string }[]) {
      if (!it.str || !it.str.trim()) continue;
      out.push({
        page: p,
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round(it.transform[5] * 10) / 10,
        w: Math.round(it.width * 10) / 10,
        h: Math.round(it.height * 10) / 10,
        font: it.fontName,
        str: it.str,
      });
    }
  }
  return out;
}

/** Only fetch PDFs from hosts we expect state agencies to use. */
export function allowedPdfUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (/^azgfd-(live-)?portal-wordpress-pantheon\.s3\.us-west-2\.amazonaws\.com$/.test(u.hostname)) return u;
    if (u.hostname === 'www.azgfd.com' || u.hostname === 'azgfd.com') return u;
    return null;
  } catch {
    return null;
  }
}

export async function fetchPdf(url: URL, userAgent: string): Promise<Uint8Array> {
  const res = await fetch(url.toString(), { headers: { 'user-agent': userAgent, accept: 'application/pdf' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading the PDF`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 5 || String.fromCharCode(...buf.slice(0, 5)) !== '%PDF-') throw new Error('Not a PDF');
  return buf;
}

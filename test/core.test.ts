import { describe, expect, it } from 'vitest';
import { diffListings, isDue, normalizeSpecies } from '../src/check';
import { meaningfulText, parseChange, stablePdfBytes } from '../src/parsers/change';
import { extractTables, listingsFromTable, parseCsv, parseTable } from '../src/parsers/table';
import { isAllowed, parseRobots } from '../src/robots';
import { smsBody, wants } from '../src/notify';
import { verifyStripeSignature } from '../src/stripe';
import type { AlertEvent, Source, Subscriber } from '../src/types';
import { inSeason, matchesList, normalizeEmail, normalizeUsPhone, parseList, STATES } from '../src/util';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

const UTAH_LIKE = `<html><body><h1>Remaining permits</h1><p>Last updated July 7, 2026 5:19pm</p>
<table><thead><tr><th>Hunt #</th><th>Hunt name</th><th>Species</th><th>Weapon</th><th>Permits available</th></tr></thead>
<tbody>
<tr><td>EB1005</td><td>Hunter&#39;s choice bull elk</td><td>Elk</td><td>Archery</td><td>1,204</td></tr>
<tr><td>DB1500</td><td>Pine Valley</td><td>Deer</td><td>Any legal weapon</td><td>0</td></tr>
<tr><td>EB3010</td><td>Book Cliffs &amp; Bitter Creek</td><td>Elk</td><td>Muzzleloader</td><td>3</td></tr>
</tbody></table></body></html>`;

const cfg = { headerMatch: 'hunt', keyColumns: ['hunt #'], labelColumns: ['hunt #', 'hunt name'], quantityColumn: 'available', speciesColumn: 'species' };

describe('table parser', () => {
  it('extracts rows and decodes entities', () => {
    const [t] = extractTables(UTAH_LIKE);
    expect(t[0]).toEqual(['Hunt #', 'Hunt name', 'Species', 'Weapon', 'Permits available']);
    expect(t[1][1]).toBe("Hunter's choice bull elk");
    expect(t[3][1]).toBe('Book Cliffs & Bitter Creek');
  });

  it('builds listings, parses quantities, skips sold out', () => {
    const listings = listingsFromTable(extractTables(UTAH_LIKE)[0], cfg);
    expect(listings).toEqual([
      { key: 'EB1005', label: "EB1005 – Hunter's choice bull elk", species: 'elk', quantity: 1204 },
      { key: 'EB3010', label: 'EB3010 – Book Cliffs & Bitter Creek', species: 'elk', quantity: 3 },
    ]);
  });

  it('hash ignores the "last updated" timestamp but changes with counts', async () => {
    const a = await parseTable(enc(UTAH_LIKE), 'html', cfg);
    const b = await parseTable(enc(UTAH_LIKE.replace('5:19pm', '9:02am')), 'html', cfg);
    const c = await parseTable(enc(UTAH_LIKE.replace('<td>3</td>', '<td>4</td>')), 'html', cfg);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('throws a clear error when the expected column is missing', () => {
    expect(() => listingsFromTable([['Unit', 'Count']], { keyColumns: ['hunt'] })).toThrow(/missing key column/);
  });

  it('expands colspans so columns stay aligned', () => {
    const [t] = extractTables('<table><tr><th colspan="2">Unit</th><th>Left</th></tr><tr><td>A</td><td>1</td><td>5</td></tr></table>');
    expect(t[0]).toEqual(['Unit', 'Unit', 'Left']);
  });

  it('parses CSV with quotes', () => {
    expect(parseCsv('Zone,Remaining\n"Zone 1, North",12\r\nZone 2,"0"\n')).toEqual([
      ['Zone', 'Remaining'],
      ['Zone 1, North', '12'],
      ['Zone 2', '0'],
    ]);
  });
});

describe('change parser', () => {
  it('ignores scripts, timestamps and footers', async () => {
    const page = (t: string, js: string) => `<html><script>${js}</script><body><main>Leftover list: Unit 12 has 4 tags.</main><p>Last updated: ${t}</p><footer>© 2026 State</footer></body></html>`;
    const a = await parseChange(enc(page('Oct 1 10:15 am', 'x=1')), 'html');
    const b = await parseChange(enc(page('Oct 2 3:40 pm', 'x=2')), 'html');
    expect(a.hash).toBe(b.hash);
    const c = await parseChange(enc(page('Oct 2', '').replace('4 tags', '5 tags')), 'html');
    expect(c.hash).not.toBe(a.hash);
  });

  it('can scope to a section between markers', () => {
    const html = '<p>News: rain today</p><h2>Leftover tags</h2><p>Unit 5: 2</p><h2>Contact us</h2><p>Phone</p>';
    expect(meaningfulText(html, { start: 'leftover', end: 'contact us' })).toBe('Leftover tags Unit 5: 2');
  });

  it('PDF hash survives regenerated dates and IDs', async () => {
    const pdf = (d: string, id: string) => `%PDF-1.7\n/CreationDate (D:${d}) /ModDate (D:${d})\nstream HUNT E-E-001 3\nendstream\n/ID [<${id}><${id}>]\n%%EOF`;
    const a = await parseChange(enc(pdf('20261001', 'AAA')), 'pdf');
    const b = await parseChange(enc(pdf('20261002', 'BBB')), 'pdf');
    expect(a.hash).toBe(b.hash);
    expect(stablePdfBytes(enc(pdf('1', 'X')))).not.toContain('CreationDate');
  });
});

describe('listing diff', () => {
  const prev = [
    { id: 's:A', hunt_key: 'A', quantity: 2, gone_at: null },
    { id: 's:B', hunt_key: 'B', quantity: 1, gone_at: null },
    { id: 's:C', hunt_key: 'C', quantity: 5, gone_at: '2026-08-01' },
  ];
  it('finds new, returned (quantity up), reappeared and gone hunts', () => {
    const d = diffListings(prev, [
      { key: 'A', label: 'A', quantity: 6 },
      { key: 'C', label: 'C', quantity: 1 },
      { key: 'D', label: 'D', quantity: null },
    ]);
    expect(d.added.map((l) => l.key)).toEqual(['C', 'D']);
    expect(d.increased.map((x) => [x.listing.key, x.from])).toEqual([['A', 2]]);
    expect(d.goneKeys).toEqual(['B']);
  });
  it('a quantity drop is not an alert', () => {
    const d = diffListings(prev, [{ key: 'A', label: 'A', quantity: 1 }, { key: 'B', label: 'B', quantity: 1 }]);
    expect(d.added).toEqual([]);
    expect(d.increased).toEqual([]);
  });
});

describe('species names from state pages', () => {
  it('maps agency wording onto our species keys', () => {
    expect(normalizeSpecies('Mule Deer')).toBe('deer');
    expect(normalizeSpecies('Antelope')).toBe('pronghorn');
    expect(normalizeSpecies('Rocky Mountain Bighorn Sheep')).toBe('sheep');
    expect(normalizeSpecies('Elk')).toBe('elk');
    expect(normalizeSpecies('Wild hog')).toBe('other');
    expect(normalizeSpecies(undefined)).toBeNull();
  });
});

describe('scheduling', () => {
  const base = { check_minutes: 15, season_start: '07-01', season_end: '01-15', fail_count: 0 } as Source;
  it('checks every interval in season, daily off season, and wraps the new year', () => {
    const now = new Date('2026-12-20T12:00:00Z');
    expect(isDue({ ...base, last_checked: '2026-12-20T11:44:00Z' }, now)).toBe(true);
    expect(isDue({ ...base, last_checked: '2026-12-20T11:50:00Z' }, now)).toBe(false);
    const march = new Date('2026-03-10T12:00:00Z');
    expect(isDue({ ...base, last_checked: '2026-03-10T06:00:00Z' }, march)).toBe(false);
    expect(isDue({ ...base, last_checked: '2026-03-09T11:00:00Z' }, march)).toBe(true);
    expect(inSeason('07-01', '01-15', new Date('2027-01-10T00:00:00Z'))).toBe(true);
  });
  it('backs off failing sources', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    expect(isDue({ ...base, fail_count: 3, last_checked: '2026-08-01T11:00:00Z' }, now)).toBe(false); // 15*8 = 120 min
    expect(isDue({ ...base, fail_count: 3, last_checked: '2026-08-01T09:59:00Z' }, now)).toBe(true);
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(`User-agent: *\nDisallow: /admin\nDisallow: /Documents/\nAllow: /Documents/Leftover.pdf\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n`);
  const ua = 'LeftoverTagAlerts/0.2 (+https://leftovertagalerts.com/bot)';
  it('applies the * group to our bot, longest match wins', () => {
    expect(isAllowed(robots, ua, '/Documents/Leftover.pdf')).toBe(true);
    expect(isAllowed(robots, ua, '/Documents/Other.pdf')).toBe(false);
    expect(isAllowed(robots, ua, '/hunting')).toBe(true);
  });
  it('named AI crawler groups do not apply to our bot but do apply to them', () => {
    expect(isAllowed(robots, 'ClaudeBot/1.0', '/hunting')).toBe(false);
  });
  it('wildcards and $ anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowed(r, ua, '/a/b.pdf')).toBe(false);
    expect(isAllowed(r, ua, '/a/b.pdf?x=1')).toBe(true);
  });
});

describe('subscriber matching and messages', () => {
  const sub = { states: 'CO,UT', species: 'elk' } as Subscriber;
  const ev = (state: string, species: string | null) => ({ state, species }) as AlertEvent;
  it('matches by state and species; unknown species goes to state followers', () => {
    expect(wants(sub, ev('CO', 'elk,deer'))).toBe(true);
    expect(wants(sub, ev('CO', 'deer'))).toBe(false);
    expect(wants(sub, ev('ID', 'elk'))).toBe(false);
    expect(wants(sub, ev('UT', null))).toBe(true);
    expect(matchesList('*', 'anything')).toBe(true);
  });
  it('keeps texts short and always includes STOP', () => {
    const body = smsBody({ title: 'x'.repeat(500), link_url: 'https://cpw.state.co.us/x' } as AlertEvent);
    expect(body.length).toBeLessThanOrEqual(300);
    expect(body).toMatch(/Reply STOP to end\.$/);
  });
  it('cleans input lists, emails and phones', () => {
    expect(parseList(['co', 'ut', 'XX', 'co'], Object.keys(STATES), true)).toBe('CO,UT');
    expect(parseList([], Object.keys(STATES), true)).toBe('*');
    expect(normalizeEmail(' JP@Example.COM ')).toBe('jp@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeUsPhone('(530) 555-0123')).toBe('+15305550123');
    expect(normalizeUsPhone('555-0123')).toBeNull();
  });
});

describe('stripe webhook signature', () => {
  async function sign(secret: string, t: number, payload: string) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  it('accepts a valid signature and rejects tampering or old timestamps', async () => {
    const t = 1_800_000_000;
    const payload = '{"type":"checkout.session.completed"}';
    const v1 = await sign('whsec_test', t, payload);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_test', t + 10)).toBe(true);
    expect(await verifyStripeSignature(payload + ' ', `t=${t},v1=${v1}`, 'whsec_test', t + 10)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_test', t + 1000)).toBe(false);
    expect(await verifyStripeSignature(payload, null, 'whsec_test', t)).toBe(false);
  });
});

describe('site', () => {
  const env = { SITE_URL: 'https://leftovertagalerts.com', EMBED_ORIGINS: 'hornandfin.com, landownertagauctions.com' } as never;
  it('allows our own site and listed embed sites only', async () => {
    const { allowedOrigin } = await import('../src/index');
    expect(allowedOrigin(env, 'https://leftovertagalerts.com')).toBe(true);
    expect(allowedOrigin(env, 'https://www.hornandfin.com')).toBe(true);
    expect(allowedOrigin(env, 'https://landownertagauctions.com')).toBe(true);
    expect(allowedOrigin(env, 'https://evil.example')).toBe(false);
    expect(allowedOrigin(env, 'https://hornandfin.com.evil.example')).toBe(false);
    expect(allowedOrigin(env, null)).toBe(false);
  });
  it('formats relative times', async () => {
    const { timeAgo } = await import('../src/site');
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(timeAgo('2026-10-25T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-25T11:54:00Z', now)).toBe('6 minutes ago');
    expect(timeAgo('2026-10-25T11:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-10-21T12:00:00Z', now)).toBe('4 days ago');
  });
});

describe('sign-in cookie', () => {
  it('reads the session cookie among others', async () => {
    const { readCookie } = await import('../src/index');
    const req = new Request('https://leftovertagalerts.com/manage', { headers: { cookie: 'a=1; lta_session=abc%3D%3D; b=2' } });
    expect(readCookie(req, 'lta_session')).toBe('abc==');
    expect(readCookie(req, 'missing')).toBeNull();
  });
});

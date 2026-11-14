import { currentSale, nextChargeAmount } from '../src/paypal';
import { arizonaListings } from '../src/parsers/arizona';
import { pdfLinksFromDataset } from '../src/parsers/brightdata';
import { chargeToday, priceSentence, saleEndsText } from '../src/util';
import { describe, expect, it } from 'vitest';
import { hiddenFields, listingsFromReport, type FormConfig } from '../src/parsers/form';
import { analyticsTag } from '../src/site';
import { coloradoListings, coloradoRunDate, parseColoradoText } from '../src/parsers/colorado';
import { listingsFromJson } from '../src/parsers/json';
import { checkInterval, diffListings, isDue, normalizeSpecies } from '../src/check';
import { meaningfulText, parseChange, stablePdfBytes } from '../src/parsers/change';
import { extractTables, listingsFromTable, parseCsv, parseTable } from '../src/parsers/table';
import { isAllowed, parseRobots } from '../src/robots';
import { personalize, smsBody } from '../src/notify';
import type { EventItem } from '../src/types';
import { handlePaypalEvent, paymentsReady, priceLabel } from '../src/paypal';
import { verifyTwilioSignature } from '../src/twilio';
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
      { key: 'EB1005', label: "EB1005 – Hunter's choice bull elk", species: 'elk', quantity: 1204, weapon: 'archery', sex: 'antlered', residency: null },
      { key: 'EB3010', label: 'EB3010 – Book Cliffs & Bitter Creek', species: 'elk', quantity: 3, weapon: 'muzzleloader', sex: 'antlered', residency: null },
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
  const ev = (state: string, species: string | null) => ({ state, species, title: 't', detail: null, kind: 'page_changed' }) as AlertEvent;
  const wants = (s: Subscriber, e: AlertEvent) => personalize({ ...s, page_alerts: 1 } as Subscriber, e, []) !== null;
  it('sends page-change alerts only to people who opted in', () => {
    expect(personalize(sub, ev('CO', 'elk'), [])).toBeNull();
    expect(personalize({ ...sub, page_alerts: 1 } as Subscriber, ev('CO', 'elk'), [])).not.toBeNull();
  });
  it('matches by state and species; unknown species goes to state followers', () => {
    expect(wants(sub, ev('CO', 'elk,deer'))).toBe(true);
    expect(wants(sub, ev('CO', 'deer'))).toBe(false);
    expect(wants(sub, ev('ID', 'elk'))).toBe(false);
    expect(wants(sub, ev('UT', null))).toBe(true);
    expect(matchesList('*', 'anything')).toBe(true);
  });
  it('lists only the hunts that match, with their tag type', () => {
    const e = { state: 'UT', species: 'elk,deer', kind: 'new_listing', title: 'Utah: 3 hunts just opened up on the list', opening: 'leftover' } as AlertEvent;
    const it_ = (label: string, species: string, weapon: string | null, sex: string | null, residency: string | null = null) =>
      ({ event_id: 1, label, species, quantity: 4, prev_quantity: null, weapon, sex, residency }) as EventItem;
    const items = [it_('EB1001 Bull elk ML', 'elk', 'muzzleloader', 'antlered'), it_('EA2002 Cow elk archery', 'elk', 'archery', 'antlerless'), it_('DB3003 Buck deer', 'deer', 'rifle', 'antlered', 'resident')];
    const s2 = { states: '*', species: 'elk', openings: '*', weapons: 'muzzleloader,rifle', sexes: '*', home_state: null } as Subscriber;
    const p = personalize(s2, e, items)!;
    expect(p.lines.map((l) => l.text)).toEqual(['EB1001 Bull elk ML (4 available)']);
    expect(p.lines[0].tags).toEqual(['Leftover', 'Muzzleloader', 'Antlered']);
    expect(p.title).toBe('Utah: EB1001 Bull elk ML (4 available) just opened up');
    // resident-only deer tag is hidden from a Colorado resident, shown to a Utah resident
    const deer = { ...s2, species: 'deer', weapons: '*' } as Subscriber;
    expect(personalize({ ...deer, home_state: 'CO' } as Subscriber, e, items)).toBeNull();
    expect(personalize({ ...deer, home_state: 'UT' } as Subscriber, e, items)!.lines).toHaveLength(1);
    // opening filter
    expect(personalize({ ...s2, openings: 'returned' } as Subscriber, e, items)).toBeNull();
  });
  it('keeps texts short and always includes STOP', () => {
    const body = smsBody({ link_url: 'https://cpw.state.co.us/x' } as AlertEvent, { title: 'x'.repeat(500), lines: [], tags: ['Leftover'] });
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

describe('PayPal plans', () => {
  it('shows the saved plan price, falling back to the configured label', () => {
    expect(priceLabel('19.99', 'year', '$4.99/month')).toBe('$19.99/year');
    expect(priceLabel('3.99', 'month', '$19.99/year')).toBe('$3.99/month');
    expect(priceLabel(undefined, undefined, '$19.99/year')).toBe('$19.99/year');
  });
  it('opens paid plans only when keys, plan and webhook are all set', () => {
    const env = { PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 'secret' } as never;
    expect(paymentsReady(env, { plan_id: 'P-1', webhook_id: 'W-1' })).toBe(true);
    expect(paymentsReady(env, { plan_id: 'P-1' })).toBe(false);
    expect(paymentsReady({} as never, { plan_id: 'P-1', webhook_id: 'W-1' })).toBe(false);
  });
  it('keeps instant alerts through the paid month when PayPal reports a cancellation', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ run: async () => { calls.push({ sql, args }); return { meta: { changes: 1 } }; } }) }) };
    const next = new Date(Date.now() + 10 * 86400_000).toISOString();
    await handlePaypalEvent({ DB } as never, { event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-ABC123', billing_info: { next_billing_time: next } } });
    expect(calls[0].sql).toContain('paid_until');
    expect(calls[0].args).toEqual([next, next, 'I-ABC123']);
    await handlePaypalEvent({ DB } as never, { event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-ABC123', custom_id: 'sub1' } });
    expect(calls[1].sql).toContain("tier = 'paid'");
    expect(calls[1].args).toEqual(['I-ABC123', 'sub1']);
  });
});

describe('twilio signature', () => {
  it('accepts its own signature and rejects tampering', async () => {
    const url = 'https://leftovertagalerts.com/api/sms/inbound';
    const params = new URLSearchParams({ From: '+15305550123', Body: 'STOP' });
    const data = url + 'BodySTOPFrom+15305550123';
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('tok'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))));
    expect(await verifyTwilioSignature(url, params, sig, 'tok')).toBe(true);
    expect(await verifyTwilioSignature(url, new URLSearchParams({ From: '+15305550123', Body: 'START' }), sig, 'tok')).toBe(false);
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

describe('tag types', () => {
  it('reads weapon, sex and residency from hunt text', async () => {
    const { classify } = await import('../src/tagtype');
    expect(classify('Antlerless deer - archery')).toEqual({ weapon: 'archery', sex: 'antlerless' });
    expect(classify('Bull elk, muzzleloader')).toEqual({ weapon: 'muzzleloader', sex: 'antlered' });
    expect(classify('Any legal weapon either-sex elk')).toEqual({ weapon: 'any', sex: 'either' });
    expect(classify('Nonresident whitetail rifle buck')).toEqual({ weapon: 'rifle', sex: 'antlered', residency: 'nonresident' });
    expect(classify('DA1234 Cache')).toEqual({ sex: 'antlerless' });
    expect(classify('Unit 12 general')).toEqual({});
  });
  it('row values beat list defaults; defaults fill gaps', async () => {
    const { mergeFacets } = await import('../src/tagtype');
    expect(mergeFacets({ sex: 'antlered' }, { sex: 'antlerless', residency: 'nonresident' })).toEqual({ weapon: null, sex: 'antlered', residency: 'nonresident' });
  });
  it('filters by opening, weapon, sex and home state; unknowns always pass', async () => {
    const { tagWanted } = await import('../src/tagtype');
    const f = { openings: 'leftover,returned', weapons: 'archery', sexes: 'antlered', home_state: 'CA' };
    expect(tagWanted(f, 'CO', 'leftover', { weapon: 'archery', sex: 'antlered' })).toBe(true);
    expect(tagWanted(f, 'CO', 'reissue', { weapon: 'archery' })).toBe(false); // opening not picked
    expect(tagWanted(f, 'CO', 'leftover', { weapon: 'rifle' })).toBe(false);
    expect(tagWanted(f, 'CO', 'leftover', { weapon: 'any' })).toBe(true); // any-weapon tags fit every weapon
    expect(tagWanted(f, 'CO', 'leftover', { sex: 'antlerless' })).toBe(false);
    expect(tagWanted(f, 'CO', 'leftover', { sex: 'either' })).toBe(true);
    expect(tagWanted(f, 'CO', 'leftover', { residency: 'resident' })).toBe(false); // CO resident-only, lives in CA
    expect(tagWanted(f, 'CA', 'leftover', { residency: 'resident' })).toBe(true);
    expect(tagWanted(f, 'CA', 'leftover', { residency: 'nonresident' })).toBe(false); // NR tag in home state
    expect(tagWanted(f, 'CO', 'leftover', {})).toBe(true);
    expect(tagWanted({ openings: '*', weapons: '*', sexes: '*', home_state: null }, 'UT', 'reissue', { weapon: 'rifle', sex: 'antlerless', residency: 'resident' })).toBe(true);
  });
  it('labels an alert line', async () => {
    const { facetLabels } = await import('../src/tagtype');
    expect(facetLabels('leftover', { weapon: 'muzzleloader', sex: 'antlered', residency: 'both' })).toEqual(['Leftover', 'Muzzleloader', 'Antlered', 'Residents and nonresidents']);
    expect(facetLabels(null, {})).toEqual([]);
  });
});

describe('Wyoming license availability report', () => {
  const row = (area: string, elig: string, desc: string, avail: string) =>
    `<tr class="GridDetails"><td class="GridDetails"><span>2026</span></td><td class="GridDetails" align="center"><span>${area}</span>
     <span class="wgfd-section-label-important"></span></td><td class="GridDetails"><span>${elig}</span></td>
     <td class="GridDetails"><span>${desc}</span></td><td class="GridDetails" align="right"><span>${avail}</span></td></tr>`;
  const html = `<html><body><form><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc&amp;123" /></form><table>
    <tr class="GridHeader"><td>Season</td><td>Hunt Area/Type</td><td>Eligible</td><td>Description</td><td>Available</td></tr>
    ${row('H', 'NON-RESIDENT', 'REGION H GENERAL; REGION H GENERAL', 'Season Closed')}
    ${row('GEN', 'RESIDENT', 'GENERAL; GENERAL', 'Unlimited')}
    ${row('008-3', 'EITHER', '8-3; LIMITED QUOTA; Oct. 1 - Nov. 30 Any white-tailed deer', 'Sold Out')}
    ${row('033-4 *', 'EITHER', '33-4; LIMITED QUOTA; Oct. 9 - Oct. 31 Antlerless elk', '15')}
    ${row('122-2', 'NON-RESIDENT', '122-2; LIMITED QUOTA; Oct. 10 - Nov. 30 Antlered elk five (5) points or less', '9')}
  </table></body></html>`;
  const cfg: FormConfig = {
    field: 'ddlSpecies',
    choices: [{ value: '53', species: 'elk', label: 'Elk' }],
    table: { headerMatch: 'hunt area', keyColumns: ['hunt area', 'eligible'], labelColumns: ['hunt area', 'description'], quantityColumn: 'available', residencyColumn: 'eligible', requireQuantity: true, labelStrip: ['\\s*\\*$', '^[\\w-]+; (LIMITED QUOTA|GENERAL); ?'] },
  };
  it('keeps only hunts with a number available, with clean labels and tag types', () => {
    const l = listingsFromReport(html, cfg, cfg.choices[0]);
    expect(l.map((x) => x.key)).toEqual(['53:033-4 * | EITHER', '53:122-2 | NON-RESIDENT']);
    expect(l[0].label).toBe('Elk 033-4 – Oct. 9 - Oct. 31 Antlerless elk');
    expect(l[0]).toMatchObject({ quantity: 15, species: 'elk', sex: 'antlerless', residency: 'both' });
    expect(l[1]).toMatchObject({ quantity: 9, sex: 'antlered', residency: 'nonresident' });
  });
  it('reads the hidden form fields to post back', () => {
    expect(hiddenFields(html)).toEqual({ __VIEWSTATE: 'abc&123' });
  });
});

describe('busy first-come windows', () => {
  const src = { check_minutes: 60, season_start: '07-01', season_end: '01-31', rush: '[{"start":"07-16","end":"07-31","minutes":30}]' } as Source;
  it('checks every 30 minutes during the rush and hourly otherwise', () => {
    expect(checkInterval(src, new Date('2026-07-20T12:00:00Z'))).toBe(30);
    expect(checkInterval(src, new Date('2026-08-20T12:00:00Z'))).toBe(60);
    expect(checkInterval(src, new Date('2026-03-01T12:00:00Z'))).toBe(24 * 60);
  });
});

describe('Iowa quota categories', () => {
  it('uses the per-category key columns and skips sold-out rows', () => {
    const html = `<table><tr><th>County ID</th><th>County Name</th><th>Limit</th><th>Remaining</th></tr>
      <tr><td>01</td><td>Adair</td><td>30</td><td>0</td></tr><tr><td>02</td><td>Adams</td><td>30</td><td>12</td></tr></table>`;
    const cfg: FormConfig = {
      field: 'cat', postback: true,
      choices: [{ value: '10', species: 'deer', label: 'Nonresident antlerless deer,', defaults: { residency: 'nonresident', sex: 'antlerless' }, table: { keyColumns: ['county name'] } }],
      table: { headerMatch: 'remaining', keyColumns: ['zone'], quantityColumn: 'remaining' },
    };
    const l = listingsFromReport(html, cfg, cfg.choices[0]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: '10:Adams', label: 'Nonresident antlerless deer, Adams', quantity: 12, residency: 'nonresident', sex: 'antlerless' });
  });
});

describe('Pennsylvania WMU feed', () => {
  it('lists WMUs with licenses remaining', () => {
    const data = { RemainingWMUs: [{ Name: '1A', MaxQuota: 52000, Remaining: 0 }, { Name: '2B', MaxQuota: 60000, Remaining: 9859 }] };
    const l = listingsFromJson(data, { dataUrl: 'x', items: 'RemainingWMUs', key: 'Name', quantity: 'Remaining', label: 'Antlerless deer, WMU {Name}', species: 'deer', defaults: { sex: 'antlerless', residency: 'both' } });
    expect(l).toEqual([{ key: '2B', label: 'Antlerless deer, WMU 2B', species: 'deer', quantity: 9859, weapon: null, sex: 'antlerless', residency: 'both' }]);
  });
  it('finds the current season id on the page', () => {
    const page = `<div id="app" seasonList='[{"Label":"2026 Antlerless Deer License","Value":"86669b4d-e808-471c-8667-d14f70308a91"},{"Label":"2025","Value":"c03eeed5-a140-4ce4-b9ab-55d491e070fc"}]'>`;
    expect(/seasonList='\[\{[^}]*?"Value":"([0-9a-f-]{36})"/.exec(page)?.[1]).toBe('86669b4d-e808-471c-8667-d14f70308a91');
  });
});

describe('Colorado leftover list (browser snapshot)', () => {
  const text = `Run Date and Time: Nov 02 2026 8:44:00 AM MST\nDue to delays in processing, this data may be up to one hour old.\n\n\nLimited Licensing Leftover\n\n\nCOLORADO PARKS AND WILDLIFE\n\n\nHUNT CODE\n \nLIST\nVALID UNITS (GMU)\n \nDESCRIPTION\nSEASON DATES\n\n\nAVAILABLE\n\n\nQUOTA\n\n\nPRONGHORN\n\n\nB\n \nPRIVATE LAND ONLY\n12/05/2026 - 12/13/2026\nAF133P5R\n \n133,134,140,141,\n\n\n147\n\n\n49\n\n\nDEER\n\n\nA\n \nWHITETAIL ONLY\n10/01/2026 - 10/23/2026,\n\n\n11/04/2026 - 11/30/2026,\n\n\n12/15/2026 - 12/31/2026\n\n\nDE104O3A\n \n104,105,106\n \n29\n\n\nC\n \nSPECIAL RESTRICTIONS SEE\n\n\nBROCHURE,\n\n\nPRIVATE LAND ONLY EAST OF HWY 71\n\n\n10/01/2026 - 01/31/2027\nDF096P6X\n \n096\n \n152\nRun Date and Time: Nov 02 2026 8:44:00 AM MST\nDue to delays in processing, this data may be up to one hour old.\n\n\nELK\n\n\nA\n \n11/18/2026 - 11/22/2026\nEF011O4R\n \n011,012,013,023,\n\n\n024,211\n\n\n1468\n\n\nA\n \n11/18/2026 - 11/22/2026\nEM231O4R\n \n231\n \n24`;
  it('reads every hunt with units, dates, restrictions and count', () => {
    const h = parseColoradoText(text);
    expect(h.map((x) => x.code)).toEqual(['AF133P5R', 'DE104O3A', 'DF096P6X', 'EF011O4R', 'EM231O4R']);
    expect(h[0]).toMatchObject({ list: 'B', description: 'PRIVATE LAND ONLY', dates: '12/05/2026 - 12/13/2026', units: '133,134,140,141,147', available: 49 });
    expect(h[1]).toMatchObject({ description: 'WHITETAIL ONLY', dates: '10/01/2026 - 10/23/2026, 11/04/2026 - 11/30/2026, 12/15/2026 - 12/31/2026', available: 29 });
    expect(h[2]).toMatchObject({ list: 'C', description: 'SPECIAL RESTRICTIONS SEE BROCHURE, PRIVATE LAND ONLY EAST OF HWY 71', available: 152 });
    expect(h[3]).toMatchObject({ units: '011,012,013,023,024,211', available: 1468 });
  });
  it('decodes tag type from the hunt code', () => {
    const l = coloradoListings(text);
    expect(l.find((x) => x.key === 'DE104O3A')).toMatchObject({ species: 'deer', sex: 'either', weapon: 'archery' });
    expect(l.find((x) => x.key === 'EF011O4R')).toMatchObject({ species: 'elk', sex: 'antlerless', weapon: 'rifle', quantity: 1468 });
    expect(l.find((x) => x.key === 'EM231O4R')!.label).toBe('Elk EM231O4R – GMU 231 – 11/18/2026 - 11/22/2026 – List A');
    expect(coloradoRunDate(text)).toBe('Nov 02 2026 8:44:00 AM MST');
  });
});

describe('Google Analytics', () => {
  it('loads only on public pages with a valid ID', () => {
    expect(analyticsTag({ GA_MEASUREMENT_ID: 'G-ABC123XYZ' } as never, {})).toContain('gtag/js?id=G-ABC123XYZ');
    expect(analyticsTag({ GA_MEASUREMENT_ID: 'G-ABC123XYZ' } as never, { noindex: true })).toBe('');
    expect(analyticsTag({} as never, {})).toBe('');
    expect(analyticsTag({ GA_MEASUREMENT_ID: 'UA-1234-1' } as never, {})).toBe('');
  });
});

describe('TikTok pixel', () => {
  it('loads with a valid pixel ID, respects Global Privacy Control, and stays off private pages', () => {
    const env = { TIKTOK_PIXEL_ID: 'C1A2B3C4D5E6F7G8H9I0' } as never;
    expect(analyticsTag(env, {})).toContain("ttq.load('C1A2B3C4D5E6F7G8H9I0')");
    expect(analyticsTag(env, {})).toContain('navigator.globalPrivacyControl');
    expect(analyticsTag(env, { noindex: true })).toBe('');
    expect(analyticsTag({ TIKTOK_PIXEL_ID: 'bad id<script>' } as never, {})).toBe('');
  });
});

describe('end-of-season sale', () => {
  it('is on until midnight Pacific on the end date', () => {
    const s = { sale_plan_id: 'P-SALE', sale_price: '19.99', sale_ends: '2027-03-01' };
    expect(currentSale(s, new Date('2027-02-28T23:00:00-08:00'))?.planId).toBe('P-SALE');
    expect(currentSale(s, new Date('2027-03-01T00:00:00-08:00'))).toBeNull();
    expect(currentSale({ sale_price: '19.99', sale_ends: '2027-03-01' }, new Date('2026-12-01'))).toBeNull();
  });
  it('describes the price', () => {
    const env = { PAID_PRICE_LABEL: '$39.99/year', SALE_PRICE: '19.99', SALE_ENDS: '2027-03-01' };
    expect(priceSentence(env)).toBe('$19.99 for your first year, then $39.99 a year');
    expect(saleEndsText(env)).toBe('March 1, 2027');
    expect(chargeToday(env)).toBe(19.99);
    expect(priceSentence({ PAID_PRICE_LABEL: '$39.99/year' })).toBe('$39.99 a year');
    expect(chargeToday({ PAID_PRICE_LABEL: '$39.99/year' })).toBe(39.99);
  });
  it('knows the next charge after the sale year', () => {
    const plan = {
      billing_cycles: [
        { tenure_type: 'TRIAL', sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: '19.99' } } },
        { tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: '39.99' } } },
      ],
    };
    const sub = (done: number) => ({ id: 'I-1', status: 'ACTIVE', plan_id: 'P', billing_info: { cycle_executions: [{ tenure_type: 'TRIAL', sequence: 1, cycles_completed: done, total_cycles: 1 }] } });
    expect(nextChargeAmount(sub(0), plan)).toBe('19.99');
    expect(nextChargeAmount(sub(1), plan)).toBe('39.99');
  });
});

describe('Arizona leftover PDF', () => {
  const it_ = (page: number, x: number, y: number, w: number, font: string, str: string) => ({ page, x, y, w, h: 10, font, str });
  const items = [
    it_(1, 151, 688, 300, 'f2', '2027 Spring Draw Left-over Permits – November 9, 2026'),
    it_(2, 237, 684, 150, 'f3', 'Youth Only General Javelina'),
    it_(2, 67, 670, 44, 'f4', 'Hunt No.'), it_(2, 152, 670, 92, 'f4', 'Number of Permits'), it_(2, 302, 670, 20, 'f4', 'Unit'), it_(2, 463, 670, 29, 'f4', 'Dates'),
    it_(2, 78, 657, 22, 'f1', '5034'), it_(2, 195, 657, 6, 'f1', '4'), it_(2, 270, 658, 80, 'f1', '6A,6B (EXLUDING'), it_(2, 259, 647, 100, 'f1', 'CAMP NAVAJO) AND 8'), it_(2, 438, 657, 78, 'f1', '1/22/27 – 1/31/27'),
    it_(2, 78, 634, 22, 'f1', '5036'), it_(2, 193, 634, 11, 'f1', '32'), it_(2, 271, 635, 80, 'f1', '16A (EXCLUDING'), it_(2, 268, 623, 80, 'f1', 'MOHAVE COUNTY'), it_(2, 279, 612, 60, 'f1', 'PARK LANDS)'), it_(2, 438, 634, 78, 'f1', '1/22/27 – 1/31/27'),
    it_(2, 187, 426, 237, 'f3', 'HAM (Handgun, Archery, Muzzleloader) Javelina'),
    it_(2, 67, 412, 44, 'f4', 'Hunt No.'), it_(2, 152, 412, 92, 'f4', 'Number of Permits'), it_(2, 302, 412, 20, 'f4', 'Unit'), it_(2, 463, 412, 29, 'f4', 'Dates'),
    it_(2, 78, 399, 22, 'f1', '5051'), it_(2, 193, 399, 11, 'f1', '18'), it_(2, 282, 399, 59, 'f1', '10 AND 18A'), it_(2, 441, 399, 73, 'f1', '2/5/27 – 2/15/27'),
    it_(2, 78, 386, 22, 'f1', '5052'), it_(2, 193, 386, 11, 'f1', '13'), it_(2, 278, 386, 67, 'f1', '15A AND 15B'), it_(2, 441, 386, 73, 'f1', '2/5/27 – 2/15/27'),
    it_(2, 150, 200, 300, 'f3', 'Non-Resident Raptor Capture-Falconry License Required Eyas Peregrine Falcon'),
    it_(2, 67, 180, 44, 'f4', 'Hunt No.'), it_(2, 152, 180, 92, 'f4', 'Number of Permits'), it_(2, 302, 180, 20, 'f4', 'Unit'), it_(2, 463, 180, 29, 'f4', 'Dates'),
    it_(2, 78, 167, 22, 'f1', '21002'), it_(2, 195, 167, 6, 'f1', '2'), it_(2, 280, 167, 50, 'f1', 'STATEWIDE'), it_(2, 438, 167, 78, 'f1', '4/1/27 – 8/31/27'),
  ];
  it('reads hunts, permits, wrapped units and dates by table', () => {
    const l = arizonaListings(items);
    expect(l.map((x) => [x.key, x.quantity])).toEqual([['5034', 4], ['5036', 32], ['5051', 18], ['5052', 13]]);
    expect(l[0].label).toBe('Youth Only General Javelina, hunt 5034, unit 6A,6B (EXCLUDING CAMP NAVAJO) AND 8, 1/22/27 – 1/31/27');
    expect(l[1].label).toContain('unit 16A (EXCLUDING MOHAVE COUNTY PARK LANDS)');
    expect(l[0].weapon).toBe('any');
    expect(l[2].weapon).toBe('muzzleloader');
    expect(l[2].species).toBe('javelina');
  });
  it('reads Bright Data rows and waits while a run is going', () => {
    expect(pdfLinksFromDataset({ status: 'building' })).toBeNull();
    expect(pdfLinksFromDataset([
      { title: 'Leftover permit-tags', url: 'https://azgfd-live-portal-wordpress-pantheon.s3.us-west-2.amazonaws.com/wp-content/uploads/2026/11/09054518/2027-S-FCFS-11_9_26.pdf' },
      { title: 'bad', url: 'https://evil.example.com/x.pdf' },
    ])).toHaveLength(1);
  });
});

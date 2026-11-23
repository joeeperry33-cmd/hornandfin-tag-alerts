import { describe, expect, it } from 'vitest';
import { splitWater, followMatches, parseStockDate, stockingsFromJson, stockingsFromTable } from '../src/hf/stocking';
import { oddsAt, waterKey } from '../src/hf/tools';
import { chunkPage, cleanPoints, stateCode } from '../src/hf/data';
import { cleanHistory, planPrompt, VOICE } from '../src/hf/claude';
import { handleRpc } from '../src/hf/mcp';
import type { Env } from '../src/types';

describe('stocking reports', () => {
  it('reads dates in the formats states use', () => {
    expect(parseStockDate('2026-11-20')).toBe('2026-11-20');
    expect(parseStockDate('11/20/2026')).toBe('2026-11-20');
    expect(parseStockDate('11/20/26')).toBe('2026-11-20');
    expect(parseStockDate('Nov. 20, 2026')).toBe('2026-11-20');
    expect(parseStockDate('Dec 3', new Date('2027-01-10'))).toBe('2026-12-03');
    expect(parseStockDate('soon')).toBeNull();
  });
  it('reads a stocking table', () => {
    const rows = stockingsFromTable(
      [
        ['Water Name', 'County', 'Species', 'Quantity', 'Stock Date'],
        ['Deer Creek Reservoir', 'Wasatch County', 'Rainbow Trout', '5,000', '11/18/2026'],
        ['', '', '', '', ''],
      ],
      { water: 'water', county: 'county', species: 'species', quantity: 'quantity', date: 'date' },
    );
    expect(rows).toEqual([{ water: 'Deer Creek Reservoir', county: 'Wasatch', species: 'Rainbow Trout', quantity: 5000, stocked_on: '2026-11-18' }]);
  });
  it('splits Washington-style packed water cells', () => {
    const cfg = { water: 'lake', waterRegex: '^(?<water>.+?)\\s*\\((?<code>[A-Z]{4})\\)\\s*(?<county>[A-Za-z .]+?)\\s+Region', countyCodes: {} };
    expect(splitWater('BATTLE GROUND LK (CLAR) Clark Region 5', cfg)).toEqual({ water: 'BATTLE GROUND LK', county: 'Clark' });
    expect(splitWater('Odd cell', cfg)).toEqual({ water: 'Odd cell', county: null });
  });
  it('reads json rows', () => {
    const rows = stockingsFromJson({ data: [{ w: 'Lake A', c: 'Placer', n: '200', d: '2026-11-01' }] }, { items: 'data', water: 'w', county: 'c', quantity: 'n', date: 'd', fixedSpecies: 'trout' });
    expect(rows[0]).toMatchObject({ water: 'Lake A', county: 'Placer', quantity: 200, species: 'trout' });
  });
  it('matches follows by water or county', () => {
    const s = { id: 1, state: 'UT', water: 'Deer Creek Reservoir', water_key: waterKey('Deer Creek Reservoir'), county: 'Wasatch', species: null, quantity: null, stocked_on: null, link_url: '' };
    expect(followMatches({ subscriber_id: 'a', state: 'UT', water_key: 'deer creek reservoir', county: '' }, s)).toBe(true);
    expect(followMatches({ subscriber_id: 'a', state: 'UT', water_key: 'deer creek', county: '' }, s)).toBe(true);
    expect(followMatches({ subscriber_id: 'a', state: 'UT', water_key: 'deer', county: '' }, s)).toBe(true);
    expect(followMatches({ subscriber_id: 'a', state: 'UT', water_key: 'strawberry', county: '' }, s)).toBe(false);
    expect(followMatches({ subscriber_id: 'a', state: 'UT', water_key: '*', county: 'wasatch' }, s)).toBe(true);
    expect(followMatches({ subscriber_id: 'a', state: 'ID', water_key: '*', county: 'Wasatch' }, s)).toBe(false);
  });
});

describe('draw odds', () => {
  const rows: [number | null, number, number][] = [[0, 100, 0], [3, 20, 5], [5, 4, 4]];
  it('gives odds at a point level from last draw', () => {
    expect(oddsAt(rows, 3).pct).toBe(25);
    expect(oddsAt(rows, 0).pct).toBe(0);
    expect(oddsAt(rows, 7).pct).toBe(100);
    expect(oddsAt(rows, 4).pct).toBeNull();
    expect(oddsAt([[null, 50, 5]], null).pct).toBe(10);
    expect(oddsAt(undefined, 2).pct).toBeNull();
  });
});

describe('data helpers', () => {
  it('normalizes states and points', () => {
    expect(stateCode('Colorado')).toBe('CO');
    expect(stateCode('wy')).toBe('WY');
    expect(stateCode('Narnia')).toBeNull();
    expect(cleanPoints([{ state: 'co', species: 'Elk', points: '4', residency: 'nr' }, { state: 'xx', species: 'elk', points: 1 }])).toEqual([
      { state: 'CO', species: 'elk', residency: 'nr', points: 4 },
    ]);
  });
  it('chunks rulebook pages', () => {
    const page = Array.from({ length: 60 }, (_, i) => `Line ${i} about legal shooting hours and blaze orange requirements.`).join('\n');
    const chunks = chunkPage(page);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1500)).toBe(true);
  });
});

describe('desk', () => {
  it('never brands itself as AI', () => {
    expect(VOICE).toContain('Never call yourself an AI');
  });
  it('cleans chat history', () => {
    expect(cleanHistory([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'elk odds?' }])).toEqual([{ role: 'user', content: 'elk odds?' }]);
    expect(cleanHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toBeNull();
    expect(cleanHistory('nope')).toBeNull();
  });
  it('builds the planner prompt', () => {
    expect(planPrompt({ state: 'CO', species: 'elk', points: 3, residency: 'nr' })).toContain('Points: 3');
  });
});

describe('mcp server', () => {
  const env = {} as Env;
  it('initializes and lists read-only tools', async () => {
    const init = (await handleRpc(env, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe('horn-and-fin');
    const list = (await handleRpc(env, { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain('get_draw_odds');
    expect(await handleRpc(env, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
  it('rejects unknown tools and bad states', async () => {
    const bad = (await handleRpc(env, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'buy_tag' } })) as { error: { code: number } };
    expect(bad.error.code).toBe(-32602);
    const st = (await handleRpc(env, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_draw_odds', arguments: { state: 'ZZ' } } })) as { result: { isError: boolean } };
    expect(st.result.isError).toBe(true);
  });
});

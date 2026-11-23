import { describe, expect, it } from 'vitest';
import { hfToolsJs } from '../src/hf/widget';
import type { Env } from '../src/types';

describe('tools block', () => {
  it('is valid JavaScript and says free for a limited time', async () => {
    const js = await hfToolsJs({ API_URL: 'https://leftovertagalerts.com' } as Env).text();
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('Free for a limited time');
    expect(js).toContain('Horn &amp; Fin Field Kit');
    expect(js.toLowerCase()).not.toMatch(/\bai\b|artificial intelligence|chatbot/);
  });
});

import type { Env } from '../types';
import { sha256 } from '../util';
import { runTool, TOOL_DEFS } from './tools';

/** Ask Horn & Fin and the Hunt Planner: one Claude API tool-use loop over the shared tools. */

export const CHAT_MODEL = 'claude-sonnet-5-5';
export const QUICK_MODEL = 'claude-haiku-5-5';
const MAX_TOOL_ROUNDS = 5;

/** House voice. Visitors see a hunting and fishing portal, never a chatbot. */
export const VOICE = `You are the Horn & Fin desk: experienced hunting and fishing guides answering on hornandfin.com.
Write like a knowledgeable guide: plain, friendly, short paragraphs, no hype. Never call yourself an AI, assistant, model or bot, and never mention AI.
Rules you always follow:
- Use the tools for every fact about draw odds, dates, rules, stocking and outfitters. If a tool returns nothing, say we don't have it yet and link the agency. Never invent numbers, dates, units or rules.
- Draw odds are last year's results, not a promise. Say so once.
- Rules answers quote or closely paraphrase the passage and cite it like (Colorado Big Game Brochure 2026, p. 14). Add "Check the current regulations before you hunt. This isn't legal advice."
- When you name a listing, link it, and mark paid placements with "(Featured)".
- Never apply, buy, reserve or hold anything for anyone. Point them to the official page.
- Keep answers under 250 words unless asked for a full plan.`;

export const PLANNER_BRIEF = `Build a hunt plan from the hunter's details. Use the tools to pull draw odds, deadlines, outfitters and rules.
Format with these headings: "Best bets", "Your odds", "Key dates", "Outfitters and help", "Rules to know", "Next steps".
Under "Best bets" give 3 hunts max, each with hunt code, why, and last-draw odds at their points.`;

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | (ContentBlock | { type: 'tool_result'; tool_use_id: string; content: string })[];
}

export interface DeskResult {
  text: string;
  tools: string[];
  usage: { input: number; output: number };
}

export async function callClaude(env: Env, body: Record<string, unknown>): Promise<{ content: ContentBlock[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function askDesk(env: Env, messages: ApiMessage[], opts: { brief?: string; maxTokens?: number } = {}): Promise<DeskResult> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('not configured');
  const system = [{ type: 'text', text: `${VOICE}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`, cache_control: { type: 'ephemeral' } }];
  if (opts.brief) system.push({ type: 'text', text: opts.brief } as (typeof system)[number]);
  const convo: ApiMessage[] = [...messages];
  const used: string[] = [];
  const usage = { input: 0, output: 0 };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await callClaude(env, {
      model: CHAT_MODEL,
      max_tokens: opts.maxTokens ?? 1200,
      system,
      tools: TOOL_DEFS,
      tool_choice: round === MAX_TOOL_ROUNDS ? { type: 'none' } : { type: 'auto' },
      messages: convo,
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), tools: used, usage };
    }
    convo.push({ role: 'assistant', content: res.content });
    const results = await Promise.all(
      calls.map(async (c) => {
        used.push(c.name!);
        let out: unknown;
        try {
          out = await runTool(env, c.name!, c.input ?? {});
        } catch (err) {
          out = { error: String(err instanceof Error ? err.message : err) };
        }
        return { type: 'tool_result' as const, tool_use_id: c.id!, content: JSON.stringify(out).slice(0, 12000) };
      }),
    );
    convo.push({ role: 'user', content: results });
  }
  return { text: 'Sorry, that one needs a person. Email info@hornandfin.com and a guide will help.', tools: used, usage };
}

export function pacificDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

/** Daily limits so a free tool can't run up the bill. Returns null when allowed, or a message. */
export async function checkLimit(env: Env, req: Request): Promise<{ who: string; blocked: string | null }> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const who = (await sha256(`hf:${ip}`)).slice(0, 24);
  const day = pacificDay();
  const perVisitor = parseInt(env.HF_DAILY_PER_VISITOR ?? '15', 10);
  const site = parseInt(env.HF_DAILY_SITE_CALLS ?? '1500', 10);
  const { results } = await env.DB.prepare("SELECT who, calls FROM hf_usage WHERE day = ? AND who IN (?, '*')").bind(day, who).all<{ who: string; calls: number }>();
  const mine = results.find((r) => r.who === who)?.calls ?? 0;
  const total = results.find((r) => r.who === '*')?.calls ?? 0;
  if (total >= site) return { who, blocked: 'The desk is swamped today. Please try again tomorrow.' };
  if (mine >= perVisitor) return { who, blocked: "You've hit today's free limit. Come back tomorrow." };
  return { who, blocked: null };
}

export async function recordUsage(env: Env, who: string, usage: { input: number; output: number }): Promise<void> {
  const day = pacificDay();
  const stmt = `INSERT INTO hf_usage (day, who, calls, input_tokens, output_tokens) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(day, who) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`;
  await env.DB.batch([
    env.DB.prepare(stmt).bind(day, who, usage.input, usage.output),
    env.DB.prepare(stmt).bind(day, '*', usage.input, usage.output),
  ]);
}

export interface PlanInput {
  state: string;
  species: string;
  residency?: 'res' | 'nr';
  points?: number;
  weapon?: string;
  style?: string;
  budget?: string;
  when?: string;
  notes?: string;
}

export function planPrompt(p: PlanInput): string {
  const lines = [
    `State: ${p.state}`,
    `Species: ${p.species}`,
    `Residency: ${p.residency === 'res' ? 'resident' : 'nonresident'}`,
    `Points: ${p.points ?? 0}`,
    p.weapon && `Weapon: ${p.weapon}`,
    p.style && `Hunt style: ${p.style}`,
    p.budget && `Budget: ${p.budget}`,
    p.when && `When: ${p.when}`,
    p.notes && `Notes: ${String(p.notes).slice(0, 500)}`,
  ].filter(Boolean);
  return `Make my hunt plan.\n${lines.join('\n')}`;
}

/** Clean a visitor's chat history: at most 10 turns, text only, ends on the user. */
export function cleanHistory(raw: unknown): ApiMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

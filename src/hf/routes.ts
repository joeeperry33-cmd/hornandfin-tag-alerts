import type { Env, Subscriber } from '../types';
import { sendEmails } from '../notify';
import { escapeHtml, json, normalizeEmail, nowIso, randomToken, STATES } from '../util';
import { askDesk, callClaude, checkLimit, cleanHistory, PLANNER_BRIEF, planPrompt, QUICK_MODEL, recordUsage, type PlanInput } from './claude';
import { cleanPoints, importRulebook, pointsReport, savePoints, syncListings } from './data';
import { mcpEndpoint } from './mcp';
import { checkStocking, sendStockingAlerts, stockedWaters } from './stocking';
import { findOutfitters, getDrawOdds, waterKey } from './tools';

/** Horn & Fin tools routes. Returns null when the path isn't one of ours. */
export async function hfRoute(env: Env, req: Request, url: URL, path: string, cors: Record<string, string>): Promise<Response | null> {
  if (path === '/mcp') return mcpEndpoint(env, req);
  if (!path.startsWith('/api/hf/')) return null;
  const sub = path.slice('/api/hf/'.length);
  const b = req.method === 'POST' ? await req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>) : {};

  if (sub === 'ask' && req.method === 'POST') {
    const messages = cleanHistory(b.messages);
    if (!messages) return json({ error: 'Type a question.' }, 400, cors);
    return desk(env, req, cors, messages, {});
  }
  if (sub === 'plan' && req.method === 'POST') {
    const p = b as unknown as PlanInput;
    const state = String(p.state ?? '').toUpperCase();
    if (!STATES[state] || !p.species) return json({ error: 'Pick a state and species.' }, 400, cors);
    return desk(env, req, cors, [{ role: 'user', content: planPrompt({ ...p, state }) }], { brief: PLANNER_BRIEF, maxTokens: 1800 });
  }
  if (sub === 'odds') {
    const state = (url.searchParams.get('state') ?? '').toUpperCase();
    if (!STATES[state]) return json({ error: 'state required' }, 400, cors);
    const pts = url.searchParams.get('points');
    const out = await getDrawOdds(env, {
      state,
      species: url.searchParams.get('species') ?? undefined,
      hunt: url.searchParams.get('hunt') ?? undefined,
      points: pts ? parseInt(pts, 10) : undefined,
      residency: url.searchParams.get('residency') === 'res' ? 'res' : 'nr',
      limit: 25,
    });
    return json(out, 200, { ...cors, 'cache-control': 'public, max-age=3600' });
  }
  if (sub === 'outfitters') {
    const state = (url.searchParams.get('state') ?? '').toUpperCase();
    if (!STATES[state]) return json({ error: 'state required' }, 400, cors);
    const out = await findOutfitters(env, { state, species: url.searchParams.get('species') ?? undefined, county: url.searchParams.get('county') ?? undefined, limit: 12 });
    return json(out, 200, { ...cors, 'cache-control': 'public, max-age=3600' });
  }
  if (sub === 'stocking/waters') {
    const state = (url.searchParams.get('state') ?? '').toUpperCase();
    if (!STATES[state]) return json({ waters: [] }, 200, cors);
    return json({ waters: await stockedWaters(env, state, url.searchParams.get('q') ?? '') }, 200, cors);
  }
  if (sub === 'stocking/follow' && req.method === 'POST') return stockingFollow(env, b, cors);
  if (sub === 'stocking/confirm') {
    const token = url.searchParams.get('token') ?? '';
    if (token.length < 20) return new Response('Link expired', { status: 400 });
    await env.DB.prepare('UPDATE stocking_follows SET confirm_token = NULL WHERE confirm_token = ?').bind(token).run();
    return Response.redirect('https://hornandfin.com/ultimate-hunting-fishing-resource/?stocking=confirmed', 302);
  }
  if (sub === 'points') {
    const token = String(req.method === 'POST' ? b.token ?? '' : url.searchParams.get('token') ?? '');
    const who = token.length >= 20 ? await env.DB.prepare('SELECT * FROM subscribers WHERE manage_token = ?').bind(token).first<Subscriber>() : null;
    if (!who) return json({ error: 'Sign in again from your latest Horn & Fin email.' }, 401, cors);
    if (req.method === 'POST') await savePoints(env, who.id, cleanPoints(b.rows));
    return json({ points: await pointsReport(env, who.id) }, 200, cors);
  }
  if (sub === 'inquiry-reply' && req.method === 'POST') return inquiryReply(env, req, b);
  return json({ error: 'not found' }, 404, cors);
}

async function desk(env: Env, req: Request, cors: Record<string, string>, messages: Parameters<typeof askDesk>[1], opts: Parameters<typeof askDesk>[2]): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Coming soon.' }, 503, cors);
  const { who, blocked } = await checkLimit(env, req);
  if (blocked) return json({ error: blocked }, 429, cors);
  try {
    const out = await askDesk(env, messages, opts);
    await recordUsage(env, who, out.usage);
    return json({ answer: out.text, used: out.tools }, 200, cors);
  } catch (err) {
    console.error('desk failed', err);
    return json({ error: 'Something went wrong on our end. Try again in a minute.' }, 502, cors);
  }
}

/** Public "follow this water" form. New emails confirm through the usual sign-up email; known emails confirm the follow by link. */
async function stockingFollow(env: Env, b: Record<string, unknown>, cors: Record<string, string>): Promise<Response> {
  if (b.website) return json({ ok: true }, 200, cors);
  const email = normalizeEmail(String(b.email ?? ''));
  const state = String(b.state ?? '').toUpperCase();
  const water = String(b.water ?? '').trim().slice(0, 140);
  const county = String(b.county ?? '').trim().replace(/ county$/i, '').slice(0, 60);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400, cors);
  if (!STATES[state]) return json({ error: 'Pick a state.' }, 400, cors);
  if (!water && !county) return json({ error: 'Pick a lake or stream, or a county.' }, 400, cors);
  const key = water ? waterKey(water) : '*';
  let sub = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first<Subscriber>();
  const recent = sub
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM stocking_follows WHERE subscriber_id = ? AND created_at >= ?').bind(sub.id, new Date(Date.now() - 86_400_000).toISOString()).first<{ n: number }>()
    : null;
  if ((recent?.n ?? 0) >= 20) return json({ error: 'That is a lot of waters for one day. Try again tomorrow.' }, 429, cors);
  let confirm: string | null = null;
  if (!sub) {
    const id = crypto.randomUUID();
    // Stocking-only sign-ups don't get big-game deadline reminders unless they turn them on.
    await env.DB.prepare(
      `INSERT INTO subscribers (id, email, tier, states, species, verify_token, manage_token, created_at, deadline_reminders) VALUES (?, ?, 'free', ?, 'other', ?, ?, ?, 0)`,
    )
      .bind(id, email, state, randomToken(), randomToken(), nowIso())
      .run();
    sub = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first<Subscriber>();
  } else {
    confirm = randomToken();
  }
  await env.DB.prepare(
    'INSERT OR REPLACE INTO stocking_follows (subscriber_id, state, water_key, water, county, confirm_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(sub!.id, state, key, water || `All of ${county} County`, key === '*' ? county : '', confirm, nowIso())
    .run();
  const what = water || `every stocked water in ${county} County`;
  const link = confirm
    ? `${env.API_URL}/api/hf/stocking/confirm?token=${encodeURIComponent(confirm)}`
    : `${env.API_URL}/api/verify?token=${encodeURIComponent(sub!.verify_token)}`;
  await sendEmails(env, [
    {
      to: email,
      subject: `Confirm stocking alerts for ${what}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#15211c">Confirm and we'll email you when ${escapeHtml(STATES[state])} stocks ${escapeHtml(what)}.<p><a href="${link}" style="display:inline-block;background:#ff6a13;color:#15211c;text-decoration:none;padding:10px 16px;border-radius:3px;font-weight:bold">Confirm my stocking alerts</a></p><div style="font-size:13px;color:#5b6b5e">Didn't ask for this? Ignore this email.<br>Horn & Fin, ${escapeHtml(env.BUSINESS_ADDRESS)}</div></div>`,
      text: `Confirm stocking alerts for ${what}: ${link}`,
    },
  ]);
  return json({ ok: true }, 200, cors);
}

/**
 * Contact Outfitter instant replies. The Horn & Fin plugin posts each new inquiry here and gets back a short,
 * friendly acknowledgement for the hunter (sent by the plugin, only when the owner has turned it on).
 */
async function inquiryReply(env: Env, req: Request, b: Record<string, unknown>): Promise<Response> {
  if (!env.HF_PLUGIN_KEY || req.headers.get('x-hf-key') !== env.HF_PLUGIN_KEY) return json({ error: 'not found' }, 404);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not configured' }, 503);
  const facts = {
    business: String(b.listing_title ?? '').slice(0, 140),
    listing_url: String(b.listing_url ?? ''),
    about: String(b.listing_summary ?? '').slice(0, 1200),
    hunter_first_name: String(b.hunter_name ?? '').split(' ')[0].slice(0, 40),
    hunter_message: String(b.message ?? '').slice(0, 2000),
  };
  const res = await callClaude(env, {
    model: QUICK_MODEL,
    max_tokens: 400,
    system:
      'Write a short, warm acknowledgement email body (under 120 words) on behalf of the business named in the facts, replying to a hunter or angler who just sent an inquiry through Horn & Fin. ' +
      'Thank them by first name, restate what they asked in one line, say the business will reply personally soon. Answer nothing that is not in the "about" text; never quote prices, dates or availability unless they are in it. ' +
      'No AI mentions, no sign-off name beyond the business name. Plain text only.',
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  });
  await recordUsage(env, 'inquiry', { input: res.usage.input_tokens, output: res.usage.output_tokens });
  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  return json({ reply: text });
}

/** Admin-only tools routes (already behind isAdmin). */
export async function hfAdmin(env: Env, req: Request, url: URL, path: string): Promise<Response | null> {
  if (path === '/admin/hf/sync-listings' && req.method === 'POST') return json(await syncListings(env));
  if (path === '/admin/hf/rulebook' && req.method === 'POST') {
    try {
      return json(await importRulebook(env, await req.json()));
    } catch (err) {
      return json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  }
  if (path === '/admin/hf/stocking/sources' && req.method === 'POST') {
    const { sources } = (await req.json()) as { sources: Record<string, unknown>[] };
    const stmts = sources.map((s) =>
      env.DB.prepare(
        `INSERT INTO stocking_sources (id, state, name, url, link_url, format, config, check_minutes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, name = excluded.name, url = excluded.url, link_url = excluded.link_url,
           format = excluded.format, config = excluded.config, check_minutes = excluded.check_minutes, active = excluded.active`,
      ).bind(s.id, s.state, s.name, s.url, s.link_url, s.format, typeof s.config === 'string' ? s.config : JSON.stringify(s.config), s.check_minutes ?? 720, s.active ?? 0),
    );
    if (stmts.length) await env.DB.batch(stmts);
    return json({ loaded: stmts.length });
  }
  if (path === '/admin/hf/stocking/check' && req.method === 'POST') return json(await checkStocking(env, url.searchParams.get('id') ?? undefined));
  if (path === '/admin/hf/stocking/preview') return json(await sendStockingAlerts({ ...env, STOCKING_LIVE: 'false' }));
  if (path === '/admin/hf/usage') {
    const { results } = await env.DB.prepare("SELECT day, calls, input_tokens, output_tokens FROM hf_usage WHERE who = '*' ORDER BY day DESC LIMIT 60").all();
    return json({ days: results });
  }
  return null;
}

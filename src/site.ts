import type { Env } from './types';
import { escapeHtml, isIntro, SPECIES, STATES, textsEnabled } from './util';

/*
 * Leftover Tag Alerts site design
 *   spruce  #1F3D35  header, hero ground
 *   ink     #15211C  text; also the text color on blaze buttons (white on blaze fails contrast)
 *   blaze   #FF6A13  hunter orange: actions and the "just opened" stamp only
 *   manila  #E8D49A  the paper tag
 *   lichen  #E4E9E1  page ground
 *   moss    #4F5C55  secondary text (4.9:1 on lichen)
 * Type: Big Shoulders (display, the tag), Public Sans (body, the language of agency forms).
 */

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&display=swap">`;

export const BASE_CSS = `
:root{--spruce:#1f3d35;--spruce-2:#173029;--ink:#15211c;--blaze:#ff6a13;--manila:#e8d49a;--manila-edge:#c9b16c;--lichen:#e4e9e1;--paper:#f7f9f5;--moss:#4f5c55;--line:#c4cdc6;
--display:'Big Shoulders Display','Big Shoulders','Oswald','Arial Narrow',Impact,sans-serif;--body:'Public Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--lichen);color:var(--ink);font:17px/1.6 var(--body);min-height:100vh;display:flex;flex-direction:column}
main{flex:1}
a{color:var(--spruce);text-underline-offset:2px}a:hover{color:var(--ink)}
:focus-visible{outline:3px solid var(--blaze);outline-offset:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.topbar{background:var(--spruce);color:#fff}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:60px}
.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font:800 22px/1 var(--display);letter-spacing:.5px}
.brand:hover{color:#fff}.brand svg{flex:none}
.topbar nav a{color:#dfe8e2;font-size:15px;text-decoration:none}.topbar nav a:hover{color:#fff;text-decoration:underline}
h1,h2,h3{font-family:var(--display);line-height:1.05;margin:0}
h2{font-size:clamp(30px,4vw,40px);font-weight:800;margin-bottom:14px}
h3{font-size:22px;font-weight:800}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--blaze);color:var(--ink);border:0;border-radius:3px;padding:13px 20px;font:700 16px/1.1 var(--body);cursor:pointer;text-decoration:none}
.btn:hover{background:#ff7d33;color:var(--ink)}.btn[disabled]{opacity:.6;cursor:progress}
.btn.quiet{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line)}
section{padding:64px 0}
.muted{color:var(--moss)}
footer.site{background:var(--spruce-2);color:#c9d6ce;font-size:14px;padding:32px 0}
footer.site a{color:#fff}footer.site .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;justify-content:space-between}
footer.site nav{display:flex;flex-wrap:wrap;gap:8px 20px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:560px){.topbar nav a:not(.signin){display:none}.topbar nav{font-size:15px}}
.topbar nav a.signin{font-weight:700;color:#fff}
`;

export const MARK_SVG = `<svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true"><path d="M5 1h16l4 4v24H1V5z" fill="#e8d49a"/><circle cx="13" cy="7" r="2.6" fill="#1f3d35"/><circle cx="13" cy="7" r="4.2" fill="none" stroke="#c9b16c" stroke-width="1.4"/><rect x="5" y="15" width="16" height="2.4" fill="#1f3d35"/><rect x="5" y="20" width="10" height="2.4" fill="#ff6a13"/></svg>`;

export function faviconSvg(): Response {
  return new Response(MARK_SVG.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"'), {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
  });
}

interface ShellOpts {
  title: string;
  description?: string;
  path?: string;
  css?: string;
  noindex?: boolean;
  nav?: boolean;
}

export function shell(env: Env, opts: ShellOpts, body: string): Response {
  const canonical = env.SITE_URL + (opts.path ?? '/');
  const desc = opts.description ?? 'Alerts when states post leftover, returned and reissued big game hunting tags.';
  const year = new Date().getUTCFullYear();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title><meta name="description" content="${escapeHtml(desc)}">
${opts.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:title" content="${escapeHtml(opts.title)}"><meta property="og:description" content="${escapeHtml(desc)}"><meta property="og:url" content="${canonical}"><meta property="og:type" content="website">
<meta name="theme-color" content="#1f3d35"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONTS}<style>${BASE_CSS}${opts.css ?? ''}</style></head><body>
<header class="topbar"><div class="wrap"><a class="brand" href="/">${MARK_SVG}<span>Leftover Tag Alerts</span></a>
${opts.nav === false ? '' : `<nav aria-label="Main">${isIntro(env) ? '<a href="/#how">How it works</a>' : '<a href="/#plans">Plans</a>'}&nbsp;&nbsp;&nbsp;<a href="/#states">States</a>&nbsp;&nbsp;&nbsp;<a href="/#questions">Questions</a>&nbsp;&nbsp;&nbsp;<a href="/login" class="signin">Sign in</a></nav>`}</div></header>
<main>${body}</main>
<footer class="site"><div class="wrap"><div>© ${year} ${escapeHtml(env.BUSINESS_NAME)}. Not affiliated with any state wildlife agency.</div>
<nav aria-label="Footer">${env.PARTNER_URL ? `<a href="${escapeHtml(env.PARTNER_URL)}">Horn &amp; Fin outfitters and guides</a>` : ''}<a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/bot">How we check state sites</a><a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">Contact</a></nav></div></footer>
</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': opts.noindex ? 'no-store' : 'public, max-age=300' } },
  );
}

/* ----------------------------------------------------------------- homepage */

const REGIONS: { name: string; states: string[] }[] = [
  { name: 'West', states: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NM', 'NV', 'OR', 'UT', 'WA', 'WY'] },
  { name: 'Plains and Midwest', states: ['AR', 'IA', 'IL', 'IN', 'KS', 'MI', 'MN', 'MO', 'ND', 'NE', 'OH', 'OK', 'SD', 'TX', 'WI'] },
  { name: 'East and South', states: ['AL', 'CT', 'DE', 'FL', 'GA', 'KY', 'LA', 'MA', 'MD', 'ME', 'MS', 'NC', 'NH', 'NJ', 'NY', 'PA', 'RI', 'SC', 'TN', 'VA', 'VT', 'WV'] },
];

export interface HomeData {
  watched: { state: string; name: string }[];
  unwatchedStates: string[];
  lastChecked: string | null;
  recent: { state: string; title: string; link_url: string; created_at: string }[];
}

export async function loadHomeData(env: Env): Promise<HomeData> {
  const delay = new Date(Date.now() - 12 * 3600_000).toISOString();
  const [watched, inactive, last, recent] = await Promise.all([
    env.DB.prepare('SELECT state, name FROM sources WHERE active = 1 ORDER BY state, name').all<{ state: string; name: string }>(),
    env.DB.prepare('SELECT DISTINCT state FROM sources WHERE active = 0 AND state NOT IN (SELECT state FROM sources WHERE active = 1)').all<{ state: string }>(),
    env.DB.prepare('SELECT MAX(last_checked) AS t FROM sources WHERE active = 1').first<{ t: string | null }>(),
    env.DB.prepare('SELECT state, title, link_url, created_at FROM events WHERE created_at <= ? ORDER BY created_at DESC LIMIT 6').bind(delay).all<HomeData['recent'][number]>(),
  ]);
  return { watched: watched.results, unwatchedStates: inactive.results.map((r) => r.state), lastChecked: last?.t ?? null, recent: recent.results };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** The short list name without the state in front: "Colorado leftover license list" → "leftover license list". */
function listName(state: string, name: string): string {
  const st = STATES[state] ?? state;
  return name.startsWith(st) ? name.slice(st.length).trim() : name;
}

const HOME_CSS = `
.hero{background:var(--spruce);color:#eef3ef;padding:56px 0 72px;overflow:hidden}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:48px;align-items:center}
.hero h1{font-size:clamp(44px,6.4vw,78px);font-weight:900;letter-spacing:-.5px;color:#fff;max-width:11ch}
.hero .lede{font-size:19px;max-width:34em;margin:22px 0 28px;color:#d6e2da}
.signup{max-width:520px}
.signup .row{display:flex;gap:8px}
.signup input[type=email]{flex:1;min-width:0;padding:13px 14px;border:0;border-radius:3px;font:16px var(--body);color:var(--ink);background:#fff}
.signup .fine{font-size:14px;color:#b9cbbf;margin:10px 0 0}
.signup .already{margin-top:14px}.signup .already a{color:#fff;font-weight:600}
.signup details{margin-top:14px;color:#e6eee9}
.signup summary{cursor:pointer;font-weight:600;font-size:15px}
.signup fieldset{border:0;padding:0;margin:12px 0 0}
.signup legend{font-weight:600;font-size:14px;margin-bottom:6px;color:#fff}
.pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 12px;font-size:14px}
.pick label{display:flex;gap:7px;align-items:center;padding:2px 0}
.pick input{accent-color:var(--blaze)}
.picktools{display:flex;gap:14px;font-size:13px;margin:4px 0 8px}
.picktools button{background:none;border:0;color:#fff;text-decoration:underline;cursor:pointer;padding:0;font:inherit}
.hp{position:absolute;left:-9999px}
.form-msg{margin-top:12px;font-size:15px}.form-msg.err{color:#ffc2a3}
.done{background:#fff;color:var(--ink);border-radius:3px;padding:16px 18px;max-width:520px}

/* the tag */
.tag-stage{position:relative;display:flex;flex-direction:column;align-items:center;padding:30px 0 10px}
.tag-hang{position:relative;width:min(100%,340px)}
.string{position:absolute;bottom:calc(100% - 34px);left:50%;width:2px;height:220px;background:linear-gradient(rgba(184,167,119,0),#b8a777 40%,#8f8158);transform:translateX(-1px) rotate(9deg);transform-origin:bottom center}
.tag{position:relative;width:100%;background:var(--manila);color:var(--ink);padding:62px 26px 92px;transform:rotate(-4deg);
clip-path:polygon(18% 0,82% 0,100% 12%,100% 100%,0 100%,0 12%);box-shadow:0 18px 30px rgba(0,0,0,.28);
background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.018) 0 2px,transparent 2px 5px)}
.tag::before{content:"";position:absolute;top:18px;left:50%;width:30px;height:30px;margin-left:-15px;border-radius:50%;background:var(--spruce);box-shadow:0 0 0 6px var(--manila-edge),inset 0 2px 3px rgba(0,0,0,.4)}
.tag .issuer{font:800 15px/1 var(--display);letter-spacing:1.5px;text-align:center;border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:12px}
.tag dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:15px}
.tag dt{font:700 13px/1.5 var(--display);letter-spacing:1px;color:#5d5233;padding-top:2px}
.tag dd{margin:0;font-weight:600;border-bottom:1px dotted #a8955c;padding-bottom:4px}
.tag .big{font:900 46px/1 var(--display);color:var(--ink)}
.stamp{position:absolute;right:18px;bottom:24px;transform:rotate(-8deg);color:var(--blaze);border:4px solid var(--blaze);border-radius:4px;padding:6px 12px 4px;
font:900 28px/1 var(--display);letter-spacing:1px;background:rgba(232,212,154,.55);mix-blend-mode:multiply;
animation:stampIn .5s cubic-bezier(.2,1.6,.4,1) .6s both}
@keyframes stampIn{from{opacity:0;transform:rotate(-8deg) scale(1.9)}to{opacity:1;transform:rotate(-8deg) scale(1)}}
.tag-note{font-size:13px;color:#b9cbbf;text-align:center;margin:22px 0 0;max-width:30ch}

.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;list-style:none;margin:26px 0 0;padding:0;counter-reset:s}
.steps li{counter-increment:s;border-top:3px solid var(--ink);padding-top:14px}
.steps li::before{content:counter(s);display:block;font:900 44px/1 var(--display);color:var(--spruce);margin-bottom:8px}
.steps p{margin:6px 0 0;color:var(--moss)}

.plans table{width:100%;border-collapse:collapse;background:var(--paper);font-size:16px;margin-top:22px}
.plans th,.plans td{padding:14px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.plans thead th{font:800 24px/1.1 var(--display);background:transparent;border-bottom:3px solid var(--ink)}
.plans thead th small{display:block;font:600 15px var(--body);color:var(--moss);margin-top:4px}
.plans tbody th{font-weight:600;color:var(--moss);width:28%}
.plans .instant{background:#fff3ea}
.plans .note{font-size:14px;color:var(--moss);margin-top:12px;max-width:62em}

.states{background:var(--paper)}
.checked{display:flex;align-items:center;gap:8px;color:var(--moss);font-size:15px;margin:-4px 0 26px}
.checked i{width:9px;height:9px;border-radius:50%;background:#2f9e5b;box-shadow:0 0 0 4px rgba(47,158,91,.18)}
.regions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:36px}
.regions h3{border-bottom:3px solid var(--ink);padding-bottom:8px;margin-bottom:10px}
.regions ul{list-style:none;margin:0;padding:0}
.regions li{padding:8px 0;border-bottom:1px solid var(--line)}
.regions li strong{display:block}
.regions li span{font-size:14px;color:var(--moss)}
.unwatched{margin-top:28px;font-size:15px;color:var(--moss);max-width:62em}

.recent ul{list-style:none;padding:0;margin:18px 0 0}
.recent li{padding:12px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.recent time{color:var(--moss);font-size:14px}

.launch .launch-lead{font-size:20px;max-width:38em;margin:0 0 12px}
.launch .note{font-size:15px;color:var(--moss);max-width:62em}
.partner{background:var(--spruce);color:#e6eee9;padding:44px 0}
.partner h2{color:#fff;font-size:clamp(26px,3.4vw,34px)}
.partner p{margin:0;max-width:40em}.partner a{color:#fff;font-weight:700}
.faq details{border-bottom:1px solid var(--line);padding:16px 0;max-width:760px}
.faq summary{cursor:pointer;font-weight:700;font-size:18px;list-style-position:outside}
.faq details p{margin:10px 0 0;color:#2c3a33}

@media (max-width:860px){
 .hero .wrap{grid-template-columns:1fr;gap:28px}.hero{padding:40px 0 48px}
 .tag-stage{padding-top:70px}.tag-hang{width:min(82%,290px)}.string{height:96px}.stamp{font-size:24px}
 .steps,.regions{grid-template-columns:1fr;gap:22px}
 .signup .row{flex-direction:column}.signup .btn{width:100%}
 .plans th,.plans td{padding:12px 10px}.plans tbody th{width:auto}
 section{padding:48px 0}
}
`;

function heroTag(data: HomeData): string {
  const real = data.recent[0];
  if (real) {
    return `<div class="tag-hang"><div class="string" aria-hidden="true"></div><div class="tag" role="img" aria-label="Most recent opening: ${escapeHtml(real.title)}">
<div class="issuer">${escapeHtml((STATES[real.state] ?? real.state).toUpperCase())} BIG GAME</div>
<dl><dt>OPENING</dt><dd>${escapeHtml(real.title.replace(/^[^:]+:\s*/, ''))}</dd><dt>POSTED</dt><dd>${escapeHtml(timeAgo(real.created_at))}</dd></dl>
<div class="stamp">JUST OPENED</div></div></div><p class="tag-note">Our most recent public alert. Subscribers got it 12 hours earlier.</p>`;
  }
  return `<div class="tag-hang"><div class="string" aria-hidden="true"></div><div class="tag" role="img" aria-label="Example alert: 3 elk tags open in Utah hunt EB3010">
<div class="issuer">UTAH BIG GAME</div>
<dl><dt>HUNT</dt><dd>EB3010 Book Cliffs</dd><dt>SPECIES</dt><dd>Bull elk, muzzleloader</dd><dt>LEFT</dt><dd><span class="big">3</span></dd></dl>
<div class="stamp">JUST OPENED</div></div></div><p class="tag-note">An example of what an alert tells you.</p>`;
}

function paidPlans(env: Env): string {
  return `<section id="plans" class="plans"><div class="wrap"><h2>Plans</h2>
<table><thead><tr><th scope="col"><span class="sr">Feature</span></th><th scope="col">Free<small>$0</small></th><th scope="col" class="instant">Instant<small>${escapeHtml(env.PAID_PRICE_LABEL)}</small></th></tr></thead>
<tbody>
<tr><th scope="row">How you hear</th><td>One email each morning</td><td class="instant">Email and text message</td></tr>
<tr><th scope="row">How fast</th><td>Up to a day later</td><td class="instant">Within about 15 minutes of a change</td></tr>
<tr><th scope="row">States and species</th><td>You choose</td><td class="instant">You choose</td></tr>
<tr><th scope="row">Best for</th><td>Keeping an eye on the season</td><td class="instant">Leftover days and returned tags that sell out fast</td></tr>
</tbody></table>
<p class="note">Start free with the form above. Every alert email has a link to upgrade or cancel. Instant subscribers who add a cell number and agree to texts get recurring automated alerts; message frequency varies, message and data rates may apply, and replying STOP ends them.</p>
</div></section>`;
}

function launchSection(env: Env): string {
  const texts = textsEnabled(env);
  return `<section id="plans" class="launch"><div class="wrap"><h2>Free while we launch</h2>
<p class="launch-lead">Every alert is free during launch. You get an email within about 15 minutes of a state list changing, for whatever states and species you pick.${texts ? ' Add a cell number in your settings to get texts too.' : ' Text alerts are coming soon.'}</p>
<p class="note">No card needed. If we add paid plans later, current subscribers hear about it first, and nothing changes for you unless you choose to.${texts ? ' Texts are recurring automated alerts; message frequency varies, message and data rates may apply, and replying STOP ends them.' : ''}</p>
</div></section>`;
}

export function homePage(env: Env, data: HomeData): Response {
  const watchedStates = [...new Set(data.watched.map((w) => w.state))];
  const listCount = data.watched.length;
  const byState = new Map<string, string[]>();
  for (const w of data.watched) byState.set(w.state, [...(byState.get(w.state) ?? []), listName(w.state, w.name)]);

  const regions = REGIONS.map((r) => {
    const items = r.states.filter((s) => byState.has(s)).sort((a, b) => (STATES[a] ?? a).localeCompare(STATES[b] ?? b));
    if (!items.length) return '';
    return `<div><h3>${r.name}</h3><ul>${items
      .map((s) => `<li><strong>${escapeHtml(STATES[s] ?? s)}</strong><span>${escapeHtml(byState.get(s)!.join('; '))}</span></li>`)
      .join('')}</ul></div>`;
  }).join('');

  const unwatched = data.unwatchedStates.map((s) => STATES[s] ?? s).sort();
  const stateBoxes = Object.entries(STATES)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => `<label><input type="checkbox" name="states" value="${code}" checked> ${escapeHtml(name)}</label>`)
    .join('');
  const speciesBoxes = SPECIES.map((s) => `<label><input type="checkbox" name="species" value="${s}" checked> ${s[0].toUpperCase() + s.slice(1)}</label>`).join('');

  const recent = data.recent.length
    ? `<section class="recent"><div class="wrap"><h2>Recent openings</h2><p class="muted">Shown here 12 hours after subscribers get them.</p><ul>${data.recent
        .map((e) => `<li><a href="${escapeHtml(e.link_url)}" rel="nofollow noopener">${escapeHtml(e.title)}</a><time datetime="${e.created_at}">${timeAgo(e.created_at)}</time></li>`)
        .join('')}</ul></div></section>`
    : '';

  const body = `
<section class="hero"><div class="wrap">
<div>
<h1>Leftover and returned tags, the minute states post them</h1>
<p class="lede">States put unsold and returned big game tags back on sale all season, often with no points needed. The good ones are gone within hours. We watch ${listCount} state list${listCount === 1 ? '' : 's'}, as often as every 15 minutes, and tell you when something opens up.</p>
<form class="signup" id="signup" novalidate>
<div class="row"><label for="email" class="sr">Email address</label><input id="email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
<button class="btn" type="submit">Send me alerts</button></div>
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<p class="fine">${isIntro(env) ? 'Free during launch: instant email alerts for every state and species you pick.' : 'Free daily email. Upgrade to instant email and text alerts any time.'}</p>
<details><summary>Choose states and species (all selected)</summary>
<fieldset><legend>Species</legend><div class="pick">${speciesBoxes}</div></fieldset>
<fieldset><legend>States</legend><div class="picktools"><button type="button" data-all="1">Select all</button><button type="button" data-all="0">Clear</button></div><div class="pick">${stateBoxes}</div></fieldset>
</details>
<div class="form-msg" role="status" aria-live="polite"></div>
<p class="fine already">Already signed up? <a href="/login">Sign in to change your alerts</a>.</p>
</form>
</div>
<div class="tag-stage">${heroTag(data)}</div>
</div></section>

<section id="how"><div class="wrap"><h2>How it works</h2>
<ol class="steps">
<li><h3>Pick your states and species</h3><p>Elk in Colorado, antlerless deer in Pennsylvania, anything in Utah. Change it whenever you like.</p></li>
<li><h3>We watch the state lists</h3><p>Leftover lists, returned-tag sales and weekly reissues, checked as often as every 15 minutes during the season.</p></li>
<li><h3>You buy from the state</h3><p>Each alert names the hunt and links straight to that state's license site. We never sell or hold tags.</p></li>
</ol></div></section>

${isIntro(env) ? launchSection(env) : paidPlans(env)}


<section id="states" class="states"><div class="wrap"><h2>States we watch</h2>
${data.lastChecked ? `<p class="checked"><i aria-hidden="true"></i>Last state check ${timeAgo(data.lastChecked)}</p>` : '<p class="checked">Checks start as soon as the service goes live.</p>'}
<div class="regions">${regions}</div>
<p class="unwatched">${unwatched.length ? `No public list we can watch yet: ${escapeHtml(unwatched.join(', '))}. ` : ''}Most other Southern, Eastern and Midwestern states sell deer tags over the counter, so there's nothing to wait for. Sign up for any state and you'll hear from us as soon as we add it.</p>
</div></section>

${recent}

<section id="questions" class="faq"><div class="wrap"><h2>Questions</h2>
<details><summary>Do leftover tags cost me points?</summary><p>It depends on the state. Colorado leftovers need no preference points, but Colorado reissues of hunts that took 5 or more points do use them. In Utah, buying a limited-entry deer or elk permit forfeits your bonus points. Every alert links to the state's page; check its rules before you buy.</p></details>
<details><summary>Can nonresidents buy them?</summary><p>Usually. Some states hold leftovers for residents first, such as New Mexico for the first 24 hours. The state's own page has the final word.</p></details>
<details><summary>Do you sell tags?</summary><p>No. Tags are sold only by each state's wildlife agency. We tell you when they open up and link you to the state's license site.</p></details>
<details><summary>How fast are instant alerts?</summary><p>We check each state list as often as every 15 minutes during its season and send instant alerts right after a change is found. Some states only update their lists once a day or once a week, so an alert can't come sooner than the state posts.</p></details>
<details><summary>How do I change or stop alerts?</summary><p>Every email has links to change your states and species or unsubscribe. Reply STOP to any text to end texts.</p></details>
${isIntro(env) ? '<details><summary>Is it really free?</summary><p>Yes. During launch every alert is free, with no card required. If we add paid plans later, current subscribers hear about it first, and nothing changes for you unless you choose to.</p></details>' : ''}
</div></section>

${env.PARTNER_URL ? `<section class="partner"><div class="wrap"><h2>Drew a tag? Plan the hunt on Horn &amp; Fin</h2>
<p>Find outfitters, guides and game processors in the state you're hunting on <a href="${escapeHtml(env.PARTNER_URL)}">Horn &amp; Fin</a>, our sister site for hunters and anglers.</p></div></section>` : ''}

<script>
(function(){
var f=document.getElementById('signup');if(!f)return;var msg=f.querySelector('.form-msg');
f.querySelectorAll('[data-all]').forEach(function(b){b.onclick=function(){f.querySelectorAll('input[name=states]').forEach(function(c){c.checked=b.dataset.all==='1';});};});
f.onsubmit=function(e){e.preventDefault();msg.className='form-msg';msg.textContent='';
var email=f.email.value.trim();if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){msg.className='form-msg err';msg.textContent='Enter a valid email address.';f.email.focus();return;}
var vals=function(n){return Array.prototype.map.call(f.querySelectorAll('input[name='+n+']:checked'),function(c){return c.value;});};
var st=vals('states'),sp=vals('species');if(!st.length||!sp.length){msg.className='form-msg err';msg.textContent='Pick at least one state and one species.';return;}
var btn=f.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Sending…';
fetch('/api/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,states:st,species:sp,website:f.website.value})})
.then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Sign-up failed. Try again in a minute.');});})
.then(function(){var d=document.createElement('div');d.className='done';d.setAttribute('role','status');d.innerHTML='<strong>Check your inbox.</strong> We sent a confirmation link to <span></span>. Click it to turn on your alerts.';d.querySelector('span').textContent=email;f.replaceWith(d);})
.catch(function(x){msg.className='form-msg err';msg.textContent=x.message;btn.disabled=false;btn.textContent='Send me alerts';});};
})();
</script>`;
  return shell(
    env,
    {
      title: 'Leftover Tag Alerts: leftover and returned hunting tags, the minute states post them',
      description: `Get an email or text when states post leftover, returned and reissued elk, deer, pronghorn and other big game tags. We watch ${listCount} state lists across ${watchedStates.length} states.`,
      path: '/',
      css: HOME_CSS + '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    },
    body,
  );
}

/* ----------------------------------------------------------- simple pages */

const PROSE_CSS = `.prose{max-width:760px;padding:48px 20px 72px;margin:0 auto}.prose h1{font-size:clamp(38px,5vw,54px);font-weight:900;margin-bottom:8px}
.prose h2{font-size:28px;margin:34px 0 8px}.prose p,.prose li{color:#24312b}.prose .updated{color:var(--moss);font-size:15px;margin-bottom:26px}`;

export function privacyPage(env: Env): Response {
  return shell(env, { title: 'Privacy policy | Leftover Tag Alerts', path: '/privacy', css: PROSE_CSS }, `<article class="prose">
<h1>Privacy policy</h1><p class="updated">Last updated October 25, 2026</p>
<p>${escapeHtml(env.SITE_NAME)} is operated by ${escapeHtml(env.BUSINESS_NAME)} ("we"). This policy explains what we collect when you sign up for tag alerts and what we do with it.</p>
<h2>What we collect</h2>
<ul><li>Your email address, and the states and species you choose.</li>
<li>If you subscribe to instant alerts: your mobile number (if you add one), the date you agreed to receive texts, and a customer ID from our payment processor. We never see or store your card number.</li>
<li>Basic technical data needed to run the service, such as the IP address used to sign up (to stop spam sign-ups) and records of which alerts we sent you.</li></ul>
<h2>How we use it</h2>
<p>Only to send the alerts you asked for, to confirm your sign-up, to manage your subscription, and to answer you if you contact us. We do not sell, rent or share your information for anyone else's marketing.</p>
<h2>Text messages</h2>
<p>We send text messages only to instant subscribers who enter a mobile number and check the consent box. Messages are recurring automated tag alerts; frequency varies with how often states post tags. Message and data rates may apply. Reply STOP to stop texts and HELP for help. <strong>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.</strong> Text messaging opt-in data and consent are not shared with any third parties.</p>
<h2>Services we use</h2>
<p>We use these companies to run the service, and they handle your data only for that purpose: Cloudflare (hosting and database), Resend (email delivery), Twilio (text messages) and Stripe (payments).</p>
<h2>How long we keep it</h2>
<p>We keep your information while you're subscribed. If you unsubscribe, we stop all messages right away and delete your account data on request.</p>
<h2>Your choices</h2>
<p>Every email has links to change your settings or unsubscribe. To delete your data or ask a question, email <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a>.</p>
<h2>Contact</h2>
<p>${escapeHtml(env.BUSINESS_NAME)}, ${escapeHtml(env.BUSINESS_ADDRESS)}</p>
</article>`);
}

export function termsPage(env: Env): Response {
  return shell(env, { title: 'Terms of service | Leftover Tag Alerts', path: '/terms', css: PROSE_CSS }, `<article class="prose">
<h1>Terms of service</h1><p class="updated">Last updated October 25, 2026</p>
<p>These terms cover your use of ${escapeHtml(env.SITE_NAME)}, a service of ${escapeHtml(env.BUSINESS_NAME)}. By signing up you agree to them.</p>
<h2>What the service does</h2>
<p>We watch public state wildlife agency web pages and send you an alert when a list of leftover, returned or reissued hunting tags changes. We are not a state agency, we do not sell or reserve tags, and we are not affiliated with any agency.</p>
<h2>No guarantee of availability</h2>
<p>States change their pages, post late, or sell out before an alert reaches you. Alerts may be delayed, incomplete or wrong. Always confirm availability, eligibility, point rules and season dates on the state's site before you buy a tag or make travel plans. We are not responsible for tags you could not get or costs you incur.</p>
<h2>Price</h2>
${isIntro(env) ? `<p>All alerts are free during our launch period. If we add paid plans later, we'll email current subscribers before anything changes, and you won't be charged unless you choose a paid plan.</p>` : `<p>Instant alerts cost ${escapeHtml(env.PAID_PRICE_LABEL)}, billed monthly through Stripe until you cancel. Cancel any time from the billing link in your settings page; you keep instant alerts until the end of the period you paid for. We don't give partial-month refunds.</p>`}
<h2>Text messages</h2>
<p>If you add a mobile number and agree to texts, you'll receive recurring automated tag alerts. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP for help. Carriers are not liable for delayed or undelivered messages.</p>
<h2>Fair use</h2>
<p>Don't sign up with someone else's email or phone number, and don't try to overload or copy the service.</p>
<h2>Changes</h2>
<p>We may update these terms. If we make a material change, we'll email active subscribers before it takes effect.</p>
<h2>Contact</h2>
<p><a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a><br>${escapeHtml(env.BUSINESS_NAME)}, ${escapeHtml(env.BUSINESS_ADDRESS)}</p>
</article>`);
}

export function botPage(env: Env): Response {
  return shell(env, { title: 'How we check state sites | Leftover Tag Alerts', path: '/bot', css: PROSE_CSS }, `<article class="prose">
<h1>How we check state sites</h1><p class="updated">For state wildlife agency web teams</p>
<p>Our checker identifies itself as <code>${escapeHtml(env.USER_AGENT)}</code>. It reads only public pages that list leftover, remaining, returned or reissued hunting licenses, so hunters can be told when they change.</p>
<ul><li>It follows your robots.txt and skips any page it disallows for our user agent or for all agents.</li>
<li>It requests each page at most once every 15 minutes during that list's sales season and once a day the rest of the year, one request at a time.</li>
<li>It backs off automatically when a page returns errors.</li>
<li>It never logs in, submits forms, buys licenses or touches the license sales system. Every alert sends hunters to your own site to buy.</li></ul>
<p>If you'd like us to check less often, use a different page, or stop, email <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a> and we'll change it the same day.</p>
</article>`);
}

export function robotsTxt(env: Env): Response {
  return new Response(`User-agent: *\nDisallow: /api/\nDisallow: /manage\nDisallow: /admin\n\nSitemap: ${env.SITE_URL}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export function sitemapXml(env: Env): Response {
  const urls = ['/', '/privacy', '/terms', '/bot'].map((p) => `<url><loc>${env.SITE_URL}${p}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

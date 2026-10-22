import type { Env, Subscriber } from './types';
import { escapeHtml, SPECIES, STATES } from './util';

const STYLE = `
:root{--green:#1f3a2a;--orange:#f07c1b;--bg:#f4f1ea;--ink:#1d2a1f;--muted:#5b6b5e;--line:#d9d3c5;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121a15;--ink:#e8ede9;--muted:#9fb0a4;--line:#2c3a31;--card:#1a241e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:var(--green);color:#fff;padding:14px 16px;font-weight:700;font-size:18px}header span{color:var(--orange)}
main{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin:0 0 16px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:0 0 10px}p{margin:0 0 10px}.muted{color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px}
label.chk{display:flex;gap:8px;align-items:center;font-size:15px}
input[type=tel],input[type=email]{width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;font-size:16px;background:var(--card);color:var(--ink)}
button,.btn{display:inline-block;background:var(--orange);color:#fff;border:0;border-radius:6px;padding:10px 16px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.notice{background:#e7f3ea;color:#1f3a2a;border-radius:6px;padding:10px 12px;margin-bottom:16px}
.tier{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--orange);color:#fff;vertical-align:middle}
`;

export function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="robots" content="noindex"><style>${STYLE}</style></head>
<body><header>Horn &amp; Fin <span>Tag Alerts</span></header><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export function messagePage(env: Env, title: string, message: string): Response {
  return page(title, `<div class="card"><h1>${escapeHtml(title)}</h1><p>${message}</p><p><a href="${env.SITE_URL}">Back to Horn &amp; Fin</a></p></div>`);
}

function checkboxes(name: string, options: [string, string][], selected: string): string {
  const all = selected === '*';
  const set = new Set(selected.split(','));
  return options
    .map(([value, label]) => `<label class="chk"><input type="checkbox" name="${name}" value="${value}"${all || set.has(value) ? ' checked' : ''}> ${escapeHtml(label)}</label>`)
    .join('');
}

export function managePage(env: Env, sub: Subscriber, flags: { welcome?: boolean; upgraded?: boolean; saved?: boolean }): Response {
  const paid = sub.tier === 'paid';
  const notice = flags.upgraded
    ? '<div class="notice">You\'re on instant alerts. Add your cell number below to get texts.</div>'
    : flags.welcome
      ? '<div class="notice">Your email is confirmed. Pick the states and species you care about.</div>'
      : flags.saved
        ? '<div class="notice">Saved.</div>'
        : '';
  const states = Object.entries(STATES);
  const species = SPECIES.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as [string, string]);

  const plan = paid
    ? `<div class="card"><h2>Instant alerts <span class="tier">ACTIVE</span></h2>
<p class="muted">You get an email, and a text if you add a number, within about 15 minutes of a tag opening up.</p>
<label for="phone">Cell number for texts</label>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(sub.phone ?? '')}" placeholder="(530) 555-0123">
<label class="chk" style="margin-top:10px;align-items:flex-start"><input type="checkbox" name="sms_consent" value="1"${sub.sms_consent_at && !sub.sms_stopped ? ' checked' : ''}>
<span class="muted">I agree to receive recurring automated tag alert texts from Horn &amp; Fin at this number. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase.</span></label>
<p style="margin-top:12px"><button type="button" class="secondary" id="billing">Manage billing</button></p></div>`
    : `<div class="card"><h2>Free daily digest</h2>
<p class="muted">You get one email each morning with everything that opened up in the last day. Leftover and returned tags often sell out within hours.</p>
<button type="button" id="upgrade">Get instant email + text alerts · ${escapeHtml(env.PAID_PRICE_LABEL)}</button></div>`;

  const body = `${notice}
<div class="card"><h1>Your tag alerts</h1><p class="muted">${escapeHtml(sub.email)}</p></div>
<form id="prefs">
${plan}
<div class="card"><h2>Species</h2><div class="grid">${checkboxes('species', species, sub.species)}</div></div>
<div class="card"><h2>States</h2>
<div class="row" style="margin-bottom:10px"><button type="button" class="secondary" data-all="1">Select all</button><button type="button" class="secondary" data-all="0">Clear</button></div>
<div class="grid">${checkboxes('states', states, sub.states)}</div></div>
<div class="row"><button type="submit">Save</button><a href="${env.API_URL}/api/unsubscribe?token=${encodeURIComponent(sub.manage_token)}" class="muted">Unsubscribe from everything</a></div>
</form>
<script>
const token=${JSON.stringify(sub.manage_token)};
const api=${JSON.stringify(env.API_URL)};
const form=document.getElementById('prefs');
document.querySelectorAll('[data-all]').forEach(b=>b.onclick=()=>form.querySelectorAll('input[name=states]').forEach(c=>c.checked=b.dataset.all==='1'));
async function post(path,body){const r=await fetch(api+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,...body})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong');return d;}
form.onsubmit=async e=>{e.preventDefault();
 const vals=n=>[...form.querySelectorAll('input[name='+n+']:checked')].map(c=>c.value);
 const phone=form.querySelector('[name=phone]');const consent=form.querySelector('[name=sms_consent]');
 try{await post('/api/manage',{states:vals('states'),species:vals('species'),phone:phone?phone.value:undefined,sms_consent:consent?consent.checked:undefined});location.search='?token='+encodeURIComponent(token)+'&saved=1';}catch(err){alert(err.message);}};
const up=document.getElementById('upgrade');if(up)up.onclick=async()=>{try{const d=await post('/api/checkout',{});location.href=d.url;}catch(err){alert(err.message);}};
const bill=document.getElementById('billing');if(bill)bill.onclick=async()=>{try{const d=await post('/api/billing',{});location.href=d.url;}catch(err){alert(err.message);}};
</script>`;
  return page('Your tag alerts', body);
}

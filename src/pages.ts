import { shell } from './site';
import type { Env, Subscriber } from './types';
import { escapeHtml, isIntro, SPECIES, STATES, textsEnabled } from './util';

const APP_CSS = `
.app{max-width:760px;margin:0 auto;padding:36px 20px 64px}
.app h1{font-size:clamp(34px,5vw,46px);font-weight:900;margin-bottom:6px}
.panel{background:var(--paper);border-top:3px solid var(--ink);padding:20px 20px 22px;margin:0 0 22px}
.panel h2{font-size:26px;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 14px}
label.chk{display:flex;gap:8px;align-items:center;font-size:16px;padding:2px 0}
label.chk input{accent-color:var(--blaze);width:17px;height:17px}
input[type=tel]{width:100%;max-width:320px;padding:12px;border:1.5px solid var(--line);border-radius:3px;font:17px var(--body);background:#fff;color:var(--ink)}
.consent{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px;color:var(--moss)}
.consent input{margin-top:3px;accent-color:var(--blaze);width:17px;height:17px;flex:none}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.notice{background:#dcefe2;border-left:4px solid #2f9e5b;padding:12px 14px;margin-bottom:20px}
.err{color:#a3270f;font-weight:600;margin-top:10px}
.pill{display:inline-block;font:700 13px/1 var(--body);background:var(--blaze);color:var(--ink);padding:5px 9px;border-radius:2px;vertical-align:4px;margin-left:6px}
.linkbtn{background:none;border:0;padding:0;color:var(--spruce);text-decoration:underline;cursor:pointer;font:inherit}
`;

export function messagePage(env: Env, title: string, message: string): Response {
  return shell(env, { title: `${title} | Leftover Tag Alerts`, noindex: true, nav: false, css: APP_CSS },
    `<div class="app"><h1>${escapeHtml(title)}</h1><p>${message}</p><p><a href="/">Go to Leftover Tag Alerts</a></p></div>`);
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
    ? '<div class="notice" role="status">Instant alerts are on. Add your cell number below to get texts.</div>'
    : flags.welcome
      ? '<div class="notice" role="status">Your email is confirmed. Pick the states and species you care about.</div>'
      : flags.saved
        ? '<div class="notice" role="status">Saved.</div>'
        : '';
  const states = Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1]));
  const species = SPECIES.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as [string, string]);

  const intro = isIntro(env);
  const phoneFields = textsEnabled(env)
    ? `<label for="phone"><strong>Cell number for texts</strong></label><br>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(sub.phone ?? '')}" placeholder="(530) 555-0123">
<label class="consent"><input type="checkbox" name="sms_consent" value="1"${sub.sms_consent_at && !sub.sms_stopped ? ' checked' : ''}>
<span>I agree to receive recurring automated tag alert text messages from Leftover Tag Alerts at this number. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See our <a href="/privacy">privacy policy</a> and <a href="/terms">terms</a>.</span></label>`
    : '<p class="muted">Text alerts are coming soon. We\'ll email you when you can add your cell number.</p>';

  const plan = intro
    ? `<div class="panel"><h2>Instant alerts<span class="pill">Free during launch</span></h2>
<p class="muted">You get an email within about 15 minutes of a tag list changing in the states you pick.</p>
${phoneFields}</div>`
    : paid
    ? `<div class="panel"><h2>Instant alerts<span class="pill">On</span></h2>
<p class="muted">You get an email${textsEnabled(env) ? ', and a text if you add a number,' : ''} within about 15 minutes of a tag list changing.</p>
${phoneFields}
<p style="margin-top:16px"><button type="button" class="btn quiet" id="billing">Manage billing or cancel</button></p></div>`
    : `<div class="panel"><h2>Free daily email</h2>
<p class="muted">One email each morning with everything that opened up in the last day. Leftover and returned tags often sell out within hours.</p>
<button type="button" class="btn" id="upgrade">Get instant email and text alerts for ${escapeHtml(env.PAID_PRICE_LABEL)}</button></div>`;

  const body = `<div class="app">${notice}
<h1>Your alerts</h1><p class="muted">${escapeHtml(sub.email)} &nbsp;|&nbsp; <a href="/logout">Sign out</a></p>
<form id="prefs" novalidate>
${plan}
<div class="panel"><h2>Species</h2><div class="grid">${checkboxes('species', species, sub.species)}</div></div>
<div class="panel"><h2>States</h2>
<div class="row" style="margin-bottom:10px"><button type="button" class="linkbtn" data-all="1">Select all</button><button type="button" class="linkbtn" data-all="0">Clear</button></div>
<div class="grid">${checkboxes('states', states, sub.states)}</div></div>
<div class="row"><button type="submit" class="btn">Save changes</button><a href="/api/unsubscribe?token=${encodeURIComponent(sub.manage_token)}">Unsubscribe from everything</a></div>
<div class="err" role="alert"></div>
</form></div>
<script>
const token=${JSON.stringify(sub.manage_token)};
const form=document.getElementById('prefs');const errBox=form.querySelector('.err');
document.querySelectorAll('[data-all]').forEach(b=>b.onclick=()=>form.querySelectorAll('input[name=states]').forEach(c=>c.checked=b.dataset.all==='1'));
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,...body})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong. Try again.');return d;}
form.onsubmit=async e=>{e.preventDefault();errBox.textContent='';
 const vals=n=>[...form.querySelectorAll('input[name='+n+']:checked')].map(c=>c.value);
 if(!vals('states').length||!vals('species').length){errBox.textContent='Pick at least one state and one species.';return;}
 const phone=form.querySelector('[name=phone]');const consent=form.querySelector('[name=sms_consent]');
 try{await post('/api/manage',{states:vals('states'),species:vals('species'),phone:phone?phone.value:undefined,sms_consent:consent?consent.checked:undefined});location.href='/manage?saved=1';}catch(err){errBox.textContent=err.message;}};
const up=document.getElementById('upgrade');if(up)up.onclick=async()=>{try{const d=await post('/api/checkout',{});location.href=d.url;}catch(err){errBox.textContent=err.message;}};
const bill=document.getElementById('billing');if(bill)bill.onclick=async()=>{try{const d=await post('/api/billing',{});location.href=d.url;}catch(err){errBox.textContent=err.message;}};
</script>`;
  return shell(env, { title: 'Your alerts | Leftover Tag Alerts', noindex: true, nav: false, css: APP_CSS }, body);
}

export function loginPage(env: Env): Response {
  const body = `<div class="app"><h1>Sign in</h1>
<p class="muted">Enter the email you signed up with and we'll send you a link to change your alerts. No password needed.</p>
<form id="login" class="panel" novalidate>
<label for="email"><strong>Email</strong></label><br>
<input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" style="width:100%;max-width:420px;padding:12px;border:1.5px solid var(--line);border-radius:3px;font:17px var(--body);margin:6px 0 14px">
<br><button type="submit" class="btn">Email me a sign-in link</button>
<div class="err" role="alert"></div></form>
<p class="muted">Not signed up yet? <a href="/">Get alerts on the home page</a>.</p></div>
<script>
const f=document.getElementById('login');const err=f.querySelector('.err');
f.onsubmit=async e=>{e.preventDefault();err.textContent='';const email=f.email.value.trim();
 if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){err.textContent='Enter a valid email address.';return;}
 const btn=f.querySelector('button');btn.disabled=true;btn.textContent='Sending…';
 try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong. Try again.');
  f.outerHTML='<div class="notice" role="status"><strong>Check your inbox.</strong> If that email is signed up, a sign-in link is on its way. It can take a minute, and it may land in spam.</div>';}
 catch(x){err.textContent=x.message;btn.disabled=false;btn.textContent='Email me a sign-in link';}};
</script>`;
  return shell(env, { title: 'Sign in | Leftover Tag Alerts', noindex: true, nav: false, css: APP_CSS }, body);
}

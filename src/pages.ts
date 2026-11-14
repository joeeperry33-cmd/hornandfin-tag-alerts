import { shell, tiktokTag } from './site';
import type { Env, Subscriber } from './types';
import { chargeToday, escapeHtml, isIntro, priceSentence, saleEndsText, saleOn, SPECIES, SPECIES_LABEL, STATES, textsEnabled } from './util';

const APP_CSS = `
.sale-tag{display:inline-block;background:var(--blaze);color:#fff;font:800 12px/1 var(--display);letter-spacing:.08em;text-transform:uppercase;padding:6px 9px;margin:0 0 6px}
.app{max-width:760px;margin:0 auto;padding:36px 20px 64px}
.app h1{font-size:clamp(34px,5vw,46px);font-weight:900;margin-bottom:6px}
.panel{background:var(--paper);border-top:3px solid var(--ink);padding:20px 20px 22px;margin:0 0 22px}
.panel h2{font-size:26px;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 14px}
label.chk{display:flex;gap:8px;align-items:center;font-size:16px;padding:2px 0}
label.chk input{accent-color:var(--blaze);width:17px;height:17px}
select{padding:11px;border:1.5px solid var(--line);border-radius:3px;font:17px var(--body);background:#fff;color:var(--ink);max-width:100%}
.sub{font-size:15px;font-weight:700;margin:16px 0 6px}
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

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
}

export function managePage(
  env: Env,
  sub: Subscriber,
  flags: { welcome?: boolean; upgraded?: boolean; saved?: boolean; owner?: boolean; paypal?: { clientId: string; planId: string } },
): Response {
  const paid = sub.tier === 'paid';
  const notice = flags.upgraded
    ? '<div class="notice" role="status">Instant alerts are on. Add your cell number below to get texts.</div>'
    : flags.welcome
      ? (isIntro(env) || paid ? '<div class="notice" role="status">Your email is confirmed. Pick the states and species you care about.</div>' : '<div class="notice" role="status">Your email is confirmed. Pick your states and species, then subscribe below to start alerts.</div>')
      : flags.saved
        ? '<div class="notice" role="status">Saved.</div>'
        : '';
  const states = Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1]));
  const species = SPECIES.map((s) => [s, SPECIES_LABEL[s] ?? s] as [string, string]);

  const intro = isIntro(env);
  const phoneFields = textsEnabled(env)
    ? `<label for="phone"><strong>Cell number for texts</strong></label><br>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(sub.phone ?? '')}" placeholder="(530) 555-0123">
<label class="consent"><input type="checkbox" name="sms_consent" value="1"${sub.sms_consent_at && !sub.sms_stopped ? ' checked' : ''}>
<span>I agree to receive recurring automated tag alert text messages from Leftover Tag Alerts at this number. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See our <a href="/privacy">privacy policy</a> and <a href="/terms">terms</a>.</span></label>`
    : '<p class="muted">Text alerts are coming soon. We\'ll email you when you can add your cell number.</p>';

  const plan = intro && !(flags.paypal && !paid) && !sub.paypal_sub
    ? `<div class="panel"><h2>Instant alerts<span class="pill">Free during launch</span></h2>
<p class="muted">You get an email within about 15 minutes of a tag list changing in the states you pick.</p>
${phoneFields}</div>`
    : paid
    ? `<div class="panel"><h2>Instant alerts<span class="pill">${sub.paid_until ? 'Canceled' : 'On'}</span></h2>
<p class="muted">You get an email${textsEnabled(env) ? ', and a text if you add a number,' : ''} within about 15 minutes of a tag list changing.</p>
${phoneFields}
${
  sub.paid_until
    ? `<p style="margin-top:16px">Your PayPal subscription is canceled. Instant alerts continue through <strong>${escapeHtml(longDate(sub.paid_until))}</strong>, then alerts stop unless you subscribe again.</p>`
    : sub.paypal_sub
      ? `<p style="margin-top:16px" class="muted">Billed ${env.PAID_INTERVAL === 'month' ? 'monthly' : 'yearly'} through PayPal. You can also cancel in your PayPal account.</p>
<p><button type="button" class="btn quiet" id="cancelPlan">Cancel instant alerts</button></p>`
      : ''
}</div>`
    : flags.paypal
    ? `<div class="panel"><h2>Subscribe to start alerts</h2>
<p class="muted">Your settings are saved. Alerts start as soon as you subscribe. Leftover and returned tags often sell out within hours.</p>
${saleOn(env) ? `<p class="sale-tag">End-of-season sale</p>` : ''}<p><strong>Instant email${textsEnabled(env) ? ' and text' : ''} alerts for ${escapeHtml(priceSentence(env))}.</strong> Billed ${env.PAID_INTERVAL === 'month' ? 'monthly' : 'once a year'} through PayPal and renews automatically until you cancel. Cancel any time.${saleOn(env) ? ` The price goes to ${escapeHtml(env.PAID_PRICE_LABEL.replace('/year', ' a year'))} for new sign-ups on ${escapeHtml(saleEndsText(env))}.` : ''}</p>
<div id="paypal-button" style="max-width:340px;margin-top:10px"></div></div>`
    : `<div class="panel"><h2>Subscriptions open soon</h2>
<p class="muted">Your settings are saved. We'll email you as soon as you can subscribe.</p></div>`;

  const body = `<div class="app">${notice}
<h1>Your alerts</h1><p class="muted">${escapeHtml(sub.email)} ${flags.owner ? '&nbsp;|&nbsp; <a href="/admin/subscribers">Subscribers</a>' : ''} &nbsp;|&nbsp; <a href="/logout">Sign out</a></p>
<form id="prefs" novalidate>
${plan}
<div class="panel"><h2>Species</h2><div class="grid">${checkboxes('species', species, sub.species)}</div></div>
<div class="panel"><h2>Tag types</h2>
<p class="muted">Every alert shows each hunt's tag type. Narrow what you get here. When a state doesn't say, you still get the alert.</p>
<div class="sub">How it opened up</div><div class="grid">${checkboxes('openings', [['leftover', 'Leftover'], ['returned', 'Returned'], ['reissue', 'Reissued']], sub.openings || '*')}</div>
<div class="sub">Weapon</div><div class="grid">${checkboxes('weapons', [['archery', 'Archery'], ['muzzleloader', 'Muzzleloader'], ['rifle', 'Rifle']], sub.weapons || '*')}</div>
<p class="muted" style="font-size:14px;margin-top:4px">Any-weapon tags are always included.</p>
<div class="sub">Antlered or antlerless</div><div class="grid">${checkboxes('sexes', [['antlered', 'Antlered'], ['antlerless', 'Antlerless']], sub.sexes || '*')}</div>
<div class="sub"><label for="home_state">Your home state</label></div>
<select id="home_state" name="home_state"><option value="">Don't filter by residency</option>${states
    .map(([code, name]) => `<option value="${code}"${sub.home_state === code ? ' selected' : ''}>${escapeHtml(name)}</option>`)
    .join('')}</select>
<p class="muted" style="font-size:14px;margin-top:6px">Set this to skip resident-only tags in other states and nonresident-only tags in yours.</p>
<div class="sub">Page-change alerts</div>
<label class="chk"><input type="checkbox" name="page_alerts" value="1"${sub.page_alerts ? ' checked' : ''}> Also email me when a state's page changes</label>
<p class="muted" style="font-size:14px;margin-top:4px">Some states don't post hunt-by-hunt counts, so all we can see is that their page changed. Often it's not a new tag. Leave this off to get alerts only when a hunt opens up or more tags come back.</p></div>
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
 if(!vals('openings').length||!vals('weapons').length||!vals('sexes').length){errBox.textContent='Pick at least one option under each tag type.';return;}
 const phone=form.querySelector('[name=phone]');const consent=form.querySelector('[name=sms_consent]');
 try{await post('/api/manage',{states:vals('states'),species:vals('species'),openings:vals('openings'),weapons:vals('weapons'),sexes:vals('sexes'),home_state:form.querySelector('[name=home_state]').value,page_alerts:form.querySelector('[name=page_alerts]').checked,phone:phone?phone.value:undefined,sms_consent:consent?consent.checked:undefined});location.href='/manage?saved=1';}catch(err){errBox.textContent=err.message;}};
const cancelBtn=document.getElementById('cancelPlan');if(cancelBtn){let armed=false;cancelBtn.onclick=async()=>{
 if(!armed){armed=true;cancelBtn.textContent='Tap again to cancel your PayPal subscription';return;}
 cancelBtn.disabled=true;try{await post('/api/paypal/cancel',{});location.href='/manage?saved=1';}catch(err){errBox.textContent=err.message;cancelBtn.disabled=false;}};}
${
  flags.paypal && !paid
    ? `(function(){const s=document.createElement('script');
s.src='https://www.paypal.com/sdk/js?client-id='+encodeURIComponent(${JSON.stringify(flags.paypal.clientId)})+'&vault=true&intent=subscription&currency=USD';
s.onload=()=>paypal.Buttons({style:{label:'subscribe',shape:'rect',color:'gold'},
 createSubscription:(data,actions)=>actions.subscription.create({plan_id:${JSON.stringify(flags.paypal.planId)},custom_id:${JSON.stringify(sub.id)}}),
 onApprove:async(data)=>{try{await post('/api/paypal/approved',{subscriptionID:data.subscriptionID});location.href='/manage?upgraded=1';}catch(err){errBox.textContent=err.message+' If PayPal shows the subscription as active, refresh in a minute.';}},
 onError:()=>{errBox.textContent='PayPal could not start the subscription. Try again.';}}).render('#paypal-button');
s.onerror=()=>{errBox.textContent='PayPal did not load. Check your connection and refresh.';};
document.head.appendChild(s);})();`
    : ''
}
</script>`;
  // Right after PayPal approval (clean URL, no sign-in token): tell TikTok an ad led to a subscription.
  const price = chargeToday(env);
  const conversion =
    flags.upgraded && paid
      ? tiktokTag(env, `ttq.track('CompletePayment',{value:${price},currency:'USD',content_id:'instant-alerts',content_type:'product'});`)
      : '';
  return shell(env, { title: 'Your alerts | Leftover Tag Alerts', noindex: true, nav: false, css: APP_CSS }, body + conversion);
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


export interface SubscriberRow {
  email: string;
  states: string;
  species: string;
  openings: string | null;
  weapons: string | null;
  sexes: string | null;
  home_state: string | null;
  phone: string | null;
  sms_consent_at: string | null;
  verified_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

function statusOf(r: SubscriberRow): 'Active' | 'Unconfirmed' | 'Unsubscribed' {
  return r.unsubscribed_at ? 'Unsubscribed' : r.verified_at ? 'Active' : 'Unconfirmed';
}

function listText(v: string | null | undefined, all = 'All'): string {
  return !v || v === '*' ? all : v.split(',').join(', ');
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '';
}

/** Owner-only list of everyone who signed up. */
export function subscribersPage(env: Env, rows: SubscriberRow[]): Response {
  const count = (s: string) => rows.filter((r) => statusOf(r) === s).length;
  const tr = rows
    .map((r) => {
      const st = statusOf(r);
      const types = [r.openings, r.weapons, r.sexes].some((v) => v && v !== '*')
        ? [listText(r.openings, ''), listText(r.weapons, ''), listText(r.sexes, '')].filter(Boolean).join(' · ')
        : 'All';
      return `<tr><td>${escapeHtml(r.email)}</td><td><span class="st st-${st.toLowerCase()}">${st}</span></td><td>${escapeHtml(listText(r.states))}</td><td>${escapeHtml(listText(r.species))}</td><td>${escapeHtml(types)}${r.home_state ? `<br><span class="muted">Home: ${escapeHtml(r.home_state)}</span>` : ''}</td><td>${r.phone && r.sms_consent_at ? 'Yes' : ''}</td><td>${day(r.created_at)}</td></tr>`;
    })
    .join('');
  const css = `${APP_CSS}
.app{max-width:1100px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 22px}
.stat{background:var(--paper);border-top:3px solid var(--ink);padding:12px 16px;min-width:130px}
.stat b{display:block;font:900 30px/1 var(--display)}
.tbl{overflow-x:auto;background:var(--paper)}
table.subs{border-collapse:collapse;width:100%;font-size:15px}
table.subs th,table.subs td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.subs th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--moss)}
.st{font-size:13px;font-weight:700;padding:2px 7px;border-radius:2px}
.st-active{background:#dcefe2;color:#1d5c37}.st-unconfirmed{background:#f3ead2;color:#6b5312}.st-unsubscribed{background:#eee;color:#555}`;
  const body = `<div class="app">
<h1>Subscribers</h1><p class="muted"><a href="/manage">Your alerts</a> &nbsp;|&nbsp; <a href="/admin/subscribers.csv">Download CSV</a> &nbsp;|&nbsp; <a href="/admin/paypal">PayPal</a> &nbsp;|&nbsp; <a href="/admin/costs">Costs</a> &nbsp;|&nbsp; <a href="/logout">Sign out</a></p>
<div class="stats"><div class="stat"><b>${count('Active')}</b>Active</div><div class="stat"><b>${count('Unconfirmed')}</b>Haven't confirmed</div><div class="stat"><b>${count('Unsubscribed')}</b>Unsubscribed</div><div class="stat"><b>${rows.filter((r) => r.phone && r.sms_consent_at && !r.unsubscribed_at).length}</b>Want texts</div></div>
<div class="tbl"><table class="subs"><thead><tr><th>Email</th><th>Status</th><th>States</th><th>Species</th><th>Tag types</th><th>Texts</th><th>Signed up</th></tr></thead>
<tbody>${tr || '<tr><td colspan="7">No sign-ups yet.</td></tr>'}</tbody></table></div>
<p class="muted" style="margin-top:14px;font-size:14px">Only you can see this page. Subscriber emails are private: don't share or sell them.</p></div>`;
  return shell(env, { title: 'Subscribers | Leftover Tag Alerts', noindex: true, nav: false, css }, body);
}

export function costsPage(env: Env, body: string): Response {
  const css = `${APP_CSS}
.app{max-width:1100px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 22px}
.stat{background:var(--paper);border-top:3px solid var(--ink);padding:12px 16px;min-width:150px;flex:1}
.stat b{display:block;font:900 30px/1 var(--display)}
.tbl{overflow-x:auto;background:var(--paper);margin-bottom:10px}
table.subs{border-collapse:collapse;width:100%;font-size:15px}
table.subs th,table.subs td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.subs th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--moss)}
table.subs .n{text-align:right;white-space:nowrap}
h2{margin-top:28px}`;
  return shell(env, { title: 'Costs | Leftover Tag Alerts', noindex: true, nav: false, css }, body);
}

export function subscribersCsv(rows: SubscriberRow[]): Response {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['email', 'status', 'states', 'species', 'openings', 'weapons', 'antlered_antlerless', 'home_state', 'texts', 'signed_up', 'confirmed'].join(',')];
  for (const r of rows) {
    lines.push(
      [r.email, statusOf(r), listText(r.states), listText(r.species), listText(r.openings), listText(r.weapons), listText(r.sexes), r.home_state ?? '', r.phone && r.sms_consent_at ? 'yes' : '', r.created_at, r.verified_at ?? '']
        .map((v) => q(String(v)))
        .join(','),
    );
  }
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="subscribers.csv"', 'cache-control': 'no-store' },
  });
}


/** Owner-only PayPal setup: which account mode, keys present, plan/price, webhook, and paid counts. */
export function paypalAdminPage(
  env: Env,
  v: {
    mode: 'sandbox' | 'live';
    keys: boolean;
    settings: { product_id?: string; plan_id?: string; price?: string; interval?: string; webhook_id?: string; sale_plan_id?: string; sale_price?: string; sale_ends?: string };
    intro: boolean;
    ready: boolean;
    paid: number;
    canceling: number;
    notice: string;
    error: string;
  },
): Response {
  const step = (done: boolean, text: string) => `<li class="${done ? 'done' : ''}">${done ? '✓' : '○'} ${text}</li>`;
  const live = v.mode === 'live';
  const css = `${APP_CSS}
.steps{list-style:none;padding:0;margin:8px 0 0}.steps li{padding:6px 0;font-size:16px;color:var(--moss)}.steps li.done{color:#1d5c37;font-weight:600}
.mode{display:inline-block;font:700 13px/1 var(--body);padding:5px 9px;border-radius:2px;background:${live ? '#dcefe2' : '#f3ead2'};color:${live ? '#1d5c37' : '#6b5312'}}
input[type=text]{padding:11px;border:1.5px solid var(--line);border-radius:3px;font:17px var(--body);width:120px}
code{font-size:14px;background:#eef1ec;padding:1px 5px;border-radius:2px}`;
  const body = `<div class="app">
<h1>PayPal</h1><p class="muted"><a href="/admin/subscribers">Subscribers</a> &nbsp;|&nbsp; <a href="/manage">Your alerts</a></p>
${v.notice ? `<div class="notice" role="status">${escapeHtml(v.notice)}</div>` : ''}${v.error ? `<div class="err" role="alert" style="margin-bottom:16px">${escapeHtml(v.error)}</div>` : ''}
<div class="panel"><h2>Status</h2>
<p>Account mode: <span class="mode">${live ? 'Live (real payments)' : 'Sandbox (test payments)'}</span></p>
<ul class="steps">
${step(v.keys, `PayPal keys added in Cloudflare (<code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_SECRET</code>)`)}
${step(!!v.settings.plan_id, v.settings.plan_id ? `Plan: <strong>$${escapeHtml(v.settings.price ?? '')}/${escapeHtml(v.settings.interval ?? 'month')}</strong> <code>${escapeHtml(v.settings.plan_id)}</code>` : 'Plan created')}
${step(!!v.settings.webhook_id, 'PayPal connected to this site (payment and cancel notices)')}
${step(!v.intro, v.intro ? 'Free launch period is still on, so no one is offered a paid plan yet' : 'Free launch period is over')}
</ul>
<p style="margin-top:10px"><strong>${v.ready && !v.intro ? 'Paid plans are open to subscribers.' : 'Paid plans are switched off.'}</strong> ${v.paid} paying subscriber${v.paid === 1 ? '' : 's'}${v.canceling ? `, ${v.canceling} canceled and finishing their paid month` : ''}.</p></div>

<div class="panel"><h2>${v.settings.plan_id ? 'Change the price' : 'Create the plan'}</h2>
<p class="muted">${v.settings.plan_id ? 'This makes a new plan for new sign-ups. People already subscribed keep the price they signed up at.' : 'Creates the Leftover Tag Alerts product and the plan in the Horn &amp; Fin PayPal account.'}</p>
<form method="post" action="/admin/paypal/plan" class="row"><label>$ <input type="text" name="price" inputmode="decimal" value="${escapeHtml(v.settings.price ?? '19.99')}" pattern="\\d{1,3}\\.\\d{2}" required></label>
<select name="interval" aria-label="Billing period"><option value="year"${(v.settings.interval ?? 'year') === 'year' ? ' selected' : ''}>per year</option><option value="month"${v.settings.interval === 'month' ? ' selected' : ''}>per month</option></select>
<p class="muted" style="width:100%;margin:10px 0 4px">Optional sale: a lower price for the first year, for people who sign up before the end date. Leave blank for no sale.</p>
<label>Sale $ <input type="text" name="sale_price" inputmode="decimal" value="${escapeHtml(v.settings.sale_price ?? '')}" pattern="\\d{1,3}\\.\\d{2}" placeholder="19.99"></label>
<label>until <input type="date" name="sale_ends" value="${escapeHtml(v.settings.sale_ends ?? '')}"></label>
<button class="btn" ${v.keys ? '' : 'disabled'}>${v.settings.plan_id ? 'Create new price' : 'Create plan'}</button></form>
${v.settings.sale_plan_id ? `<p class="muted">Sale plan: <strong>$${escapeHtml(v.settings.sale_price ?? '')} first ${escapeHtml(v.settings.interval ?? 'year')}, then $${escapeHtml(v.settings.price ?? '')}</strong> until ${escapeHtml(v.settings.sale_ends ?? '')} <code>${escapeHtml(v.settings.sale_plan_id)}</code></p>` : ''}</div>

<div class="panel"><h2>Connect PayPal to this site</h2>
<p class="muted">Registers <code>${escapeHtml(env.API_URL)}/api/paypal/webhook</code> with PayPal so the site hears about payments, renewals and cancellations. Safe to run again.</p>
<form method="post" action="/admin/paypal/webhook"><button class="btn quiet" ${v.keys ? '' : 'disabled'}>${v.settings.webhook_id ? 'Reconnect' : 'Connect'}</button></form></div>

<p class="muted" style="font-size:14px">Going live: add the Live keys in Cloudflare, set <code>PAYPAL_ENV = "live"</code>, then create the plan and connect again here (sandbox and live keep separate plans). Paid plans open when <code>INTRO_FREE</code> is turned off.</p>
</div>`;
  return shell(env, { title: 'PayPal | Leftover Tag Alerts', noindex: true, nav: false, css }, body);
}

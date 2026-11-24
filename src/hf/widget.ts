import type { Env } from '../types';
import { SPECIES, SPECIES_LABEL, STATES } from '../util';

/**
 * Horn & Fin Field Kit (the ultimate hunting and fishing resource): every Horn & Fin tool in one embeddable block.
 *   <div id="hf-tools"></div><script src="https://leftovertagalerts.com/hf-tools.js" async></script>
 * Optional data-tab="plan|ask|odds|dates|stocking|returned" opens a tab; data-state="CO" preselects a state.
 * Plain JS (no template literals) so it can live inside this TypeScript string.
 */
export function hfToolsJs(env: Env): Response {
  const js = String.raw`(function(){
var API=__API__;var STATES=__STATES__;var SPECIES=__SPECIES__;var SPL=__SPL__;
function el(t,a,h){var e=document.createElement(t);for(var k in a||{})e.setAttribute(k,a[k]);if(h!=null)e.innerHTML=h;return e;}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function md(s){var h=esc(s);h=h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
h=h.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');h=h.replace(/^#{1,4} (.+)$/gm,'<h4>$1</h4>');h=h.replace(/^[-*] (.+)$/gm,'<li>$1</li>');
h=h.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g,'<ul>$1</ul>');return h.split(/\n{2,}/).map(function(p){return /^<(h4|ul)/.test(p)?p:'<p>'+p.replace(/\n/g,'<br>')+'</p>';}).join('');}
function stateOpts(sel){return '<option value="">State</option>'+STATES.map(function(s){return '<option value="'+s[0]+'"'+(s[0]===sel?' selected':'')+'>'+s[1]+'</option>';}).join('');}
function spOpts(){return SPECIES.filter(function(s){return s!=='other';}).map(function(s){return '<option value="'+s+'">'+(SPL[s]||s)+'</option>';}).join('');}
function post(path,body){return fetch(API+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Something went wrong.');return j;});});}
function get(path){return fetch(API+path).then(function(r){return r.json();});}
var CSS='.hft{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15211c;max-width:960px;margin:0 auto}'+
'.hft *{box-sizing:border-box}.hft .hero{background:#1f3d35;color:#fff;border-radius:6px 6px 0 0;padding:22px 22px 16px}'+
'.hft .hero h2{margin:0 0 4px;font-size:26px;color:#fff}.hft .hero p{margin:0;color:#d6e2da}.hft .hero p.sub{margin:0 0 8px;color:#f0a35e;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:13px}'+
'.hft .free{display:inline-block;background:#ff6a13;color:#15211c;font-weight:700;font-size:13px;letter-spacing:.3px;padding:3px 10px;border-radius:3px;margin-bottom:10px;text-transform:uppercase}'+
'.hft .tabs{display:flex;flex-wrap:wrap;gap:4px;background:#173029;padding:8px 10px}'+
'.hft .tabs button{background:transparent;border:0;color:#d6e2da;padding:8px 12px;font-weight:600;font-size:14px;border-radius:3px;cursor:pointer}'+
'.hft .tabs button[aria-selected=true]{background:#e4e9e1;color:#1f3d35}'+
'.hft .pane{background:#fff;border:1px solid #c4cdc6;border-top:0;border-radius:0 0 6px 6px;padding:20px}'+
'.hft h3{margin:0 0 6px;font-size:20px;color:#1f3d35}.hft .lead{margin:0 0 14px;color:#4f5c55}'+
'.hft .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}'+
'.hft label{font-size:13px;font-weight:600;color:#4f5c55;display:block}.hft select,.hft input,.hft textarea{width:100%;padding:9px;border:1px solid #c4cdc6;border-radius:5px;font-size:15px;margin-top:3px;background:#fff;color:#15211c}'+
'.hft .go{background:#ff6a13;color:#15211c;border:0;border-radius:3px;padding:11px 20px;font-weight:700;font-size:15px;cursor:pointer}.hft .go:disabled{opacity:.6}'+
'.hft .out{margin-top:16px;border-left:4px solid #2f7d5b;padding:4px 14px;background:#f5f8f4;border-radius:0 5px 5px 0}.hft .out:empty{display:none}'+
'.hft .out h4{margin:14px 0 4px;color:#1f3d35}.hft .err{color:#b3261e;font-size:14px;margin-top:8px}.hft .ok{background:#dcefe2;border-radius:6px;padding:12px;color:#1f3d35;margin-top:10px}'+
'.hft table{width:100%;border-collapse:collapse;font-size:14px}.hft th,.hft td{text-align:left;padding:6px;border-bottom:1px solid #e4e9e1}.hft th{color:#4f5c55}'+
'.hft .fine{font-size:12px;color:#5b6b5e;margin-top:12px}.hft .chat{margin-bottom:10px}.hft .me{background:#e4e9e1;border-radius:6px;padding:8px 12px;margin:8px 0 8px 15%}'+
'.hft .hp{position:absolute;left:-9999px}.hft .pts td input{width:70px}.hft select,.hft input,.hft textarea{max-width:100%}.hft .out table{display:block;overflow-x:auto}'+
'@media(max-width:640px){.hft .pts thead{display:none}.hft .pts tr{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;padding:10px 0;border-bottom:1px solid #e4e9e1}.hft .pts td{display:block;border:0;padding:0;min-width:0}.hft .pts td[data-l]:before{content:attr(data-l);display:block;font-size:12px;font-weight:700;color:#4f5c55;text-transform:uppercase;margin-bottom:3px}.hft .pts td select,.hft .pts td input{width:100%}.hft .pts td:last-child{grid-column:1/-1;text-align:right}}';
var TABS=[['plan','Plan a Hunt'],['ask','Ask Horn & Fin'],['odds','Draw Odds & Points'],['dates','Deadlines & Reminders'],['stocking','Stocking Alerts'],['returned','Returned Tags']];
function mount(root){if(root.dataset.mounted)return;root.dataset.mounted='1';var pre=(root.dataset.state||'').toUpperCase();
root.appendChild(el('style',{},CSS));var w=el('div',{class:'hft'});root.appendChild(w);
w.innerHTML='<div class="hero"><p class="sub">Horn &amp; Fin Field Kit</p><p>Plan hunts, check draw odds, never miss a deadline and know when your water gets stocked.</p></div>'+
'<div class="tabs" role="tablist">'+TABS.map(function(t){return '<button role="tab" data-t="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</div><div class="pane"></div>';
var pane=w.querySelector('.pane');var btns=w.querySelectorAll('.tabs button');
function show(t){for(var i=0;i<btns.length;i++)btns[i].setAttribute('aria-selected',btns[i].dataset.t===t?'true':'false');pane.innerHTML='';VIEWS[t](pane,pre);try{history.replaceState(null,'','#'+t);}catch(e){}}
for(var i=0;i<btns.length;i++)btns[i].onclick=function(){show(this.dataset.t);};
var start=(location.hash||'').slice(1);show(VIEWS[start]?start:(root.dataset.tab&&VIEWS[root.dataset.tab]?root.dataset.tab:'plan'));}
var VIEWS={
plan:function(p,pre){p.innerHTML='<h3>Plan a Hunt</h3><p class="lead">Tell us what you want to hunt. We pull last year\'s draw results, the key dates, outfitters and the rules into one plan.</p>'+
'<form><div class="row"><div><label>State<select name="state" required>'+stateOpts(pre)+'</select></label></div><div><label>Species<select name="species">'+spOpts()+'</select></label></div>'+
'<div><label>Residency<select name="residency"><option value="nr">Nonresident</option><option value="res">Resident</option></select></label></div><div><label>Your points<input name="points" type="number" min="0" max="40" value="0"></label></div></div>'+
'<div class="row"><div><label>Weapon<select name="weapon"><option>Any</option><option>Rifle</option><option>Archery</option><option>Muzzleloader</option></select></label></div><div><label>Style<select name="style"><option>DIY public land</option><option>Guided</option><option>Drop camp</option><option>Private land</option></select></label></div>'+
'<div><label>Budget<input name="budget" placeholder="$3,000"></label></div><div><label>When<input name="when" placeholder="Fall 2027"></label></div></div>'+
'<label>Anything else?<textarea name="notes" rows="2" placeholder="Bringing my son, first elk hunt, want a good chance at a bull"></textarea></label><br><button class="go">Build my plan</button><div class="err"></div></form><div class="out"></div>'+
'<p class="fine">Draw odds are last year\'s results, not a promise. Always confirm in the current state regulations. We never apply or buy tags for you.</p>';
var f=p.querySelector('form'),out=p.querySelector('.out');f.onsubmit=function(e){e.preventDefault();var d={};new FormData(f).forEach(function(v,k){d[k]=v;});d.points=parseInt(d.points||'0',10);
if(!d.state){f.querySelector('.err').textContent='Pick a state.';return;}var b=f.querySelector('.go');b.disabled=true;b.textContent='Building your plan...';f.querySelector('.err').textContent='';out.innerHTML='';
post('/api/hf/plan',d).then(function(j){out.innerHTML=md(j.answer);}).catch(function(x){f.querySelector('.err').textContent=x.message;}).then(function(){b.disabled=false;b.textContent='Build my plan';});};},
ask:function(p){p.innerHTML='<h3>Ask Horn & Fin</h3><p class="lead">Rules, seasons, draw odds, where to fish, who to call. Answers cite the state rulebook page.</p><div class="chat"></div>'+
'<form><textarea name="q" rows="2" placeholder="Do I need blaze orange for archery elk in Colorado?"></textarea><br><button class="go">Ask</button><div class="err"></div></form><p class="fine">Rules answers aren\'t legal advice. Check the current regulations before you hunt or fish.</p>';
var hist=[];var chat=p.querySelector('.chat'),f=p.querySelector('form');f.onsubmit=function(e){e.preventDefault();var q=f.q.value.trim();if(!q)return;f.q.value='';hist.push({role:'user',content:q});
chat.appendChild(el('div',{class:'me'},esc(q)));var a=el('div',{class:'out'},'<p>Looking that up...</p>');chat.appendChild(a);var b=f.querySelector('.go');b.disabled=true;
post('/api/hf/ask',{messages:hist}).then(function(j){a.innerHTML=md(j.answer);hist.push({role:'assistant',content:j.answer});}).catch(function(x){a.innerHTML='<p class="err">'+esc(x.message)+'</p>';hist.pop();}).then(function(){b.disabled=false;var m=a.previousSibling||a;if(m.scrollIntoView)m.scrollIntoView({behavior:'smooth',block:'start'});});};},
odds:function(p,pre){var saved=[];try{saved=JSON.parse(localStorage.getItem('hf_points')||'[]');}catch(e){}
p.innerHTML='<h3>Draw Odds & Points Tracker</h3><p class="lead">Enter the points you hold. We show your best odds from last year\'s draw. Your points stay on this device.</p>'+
'<table class="pts"><thead><tr><th>State</th><th>Species</th><th>Residency</th><th>Points</th><th></th></tr></thead><tbody></tbody></table><button type="button" class="go add" style="margin-top:10px;background:#e4e9e1">+ Add a state</button> <button type="button" class="go run" style="margin-top:10px">Show my best odds</button><div class="out"></div>'+
'<p class="fine">Odds = share of last draw\'s applicants at your point level who drew. Not a promise of next year. Full tables: <a href="https://hornandfin.com/hunting-guides/draw-odds/">Draw odds</a>.</p>';
var tb=p.querySelector('tbody'),out=p.querySelector('.out');
function addRow(r){r=r||{state:pre,species:'elk',residency:'nr',points:0};var tr=el('tr',{},'<td data-l="State"><select name="state">'+stateOpts(r.state)+'</select></td><td data-l="Species"><select name="species">'+spOpts()+'</select></td><td data-l="Residency"><select name="residency"><option value="nr">Nonresident</option><option value="res">Resident</option></select></td><td data-l="Points"><input name="points" type="number" min="0" max="40" value="'+(r.points||0)+'"></td><td><a href="#" class="rm">Remove</a></td>');
tr.querySelector('[name=species]').value=r.species;tr.querySelector('[name=residency]').value=r.residency;tr.querySelector('.rm').onclick=function(e){e.preventDefault();tr.remove();};tb.appendChild(tr);}
(saved.length?saved:[null]).forEach(addRow);p.querySelector('.add').onclick=function(){addRow();};
p.querySelector('.run').onclick=function(){var rows=Array.prototype.map.call(tb.querySelectorAll('tr'),function(tr){return{state:tr.querySelector('[name=state]').value,species:tr.querySelector('[name=species]').value,residency:tr.querySelector('[name=residency]').value,points:parseInt(tr.querySelector('[name=points]').value||'0',10)};}).filter(function(r){return r.state;});
try{localStorage.setItem('hf_points',JSON.stringify(rows));}catch(e){}out.innerHTML='<p>Checking last year\'s draws...</p>';
Promise.all(rows.map(function(r){return get('/api/hf/odds?state='+r.state+'&species='+r.species+'&points='+r.points+'&residency='+r.residency).then(function(j){return{r:r,j:j};});})).then(function(all){
out.innerHTML=all.map(function(x){var j=x.j,r=x.r;if(j.error)return '<h4>'+esc(r.state)+' '+esc(SPL[r.species]||r.species)+'</h4><p>'+esc(j.error)+'</p>';var top=(j.hunts||[]).filter(function(h){return h.odds.pct>0;}).slice(0,5);
return '<h4>'+esc(j.state)+' '+esc(SPL[r.species]||r.species)+', '+r.points+' points</h4>'+(top.length?'<table><tr><th>Hunt</th><th>Last-draw odds</th><th>Tags</th></tr>'+top.map(function(h){return '<tr><td>'+esc(h.id)+'<br><span style="color:#5b6b5e">'+esc(h.name)+'</span></td><td><strong>'+h.odds.pct+'%</strong></td><td>'+(h.tags==null?'':h.tags)+'</td></tr>';}).join('')+'</table>':'<p>No hunts drew at your point level last year. Keep building points, or look at leftover and returned tags.</p>')+'<p class="fine">'+esc(j.draw||'')+'</p>';}).join('');});};},
dates:function(p,pre){p.innerHTML='<h3>Deadlines & Reminders</h3><p class="lead">Reminders 7 days and 1 day before draws close, and the day results post.</p>'+
'<form><div class="row"><div><label>Email<input name="email" type="email" required placeholder="you@example.com"></label></div><div><label>State<select name="state">'+stateOpts(pre)+'</select></label></div><div><label>Species<select name="species"><option value="">All species</option>'+spOpts()+'</select></label></div></div>'+
'<input class="hp" name="website" tabindex="-1" autocomplete="off"><button class="go">Remind me</button><div class="err"></div></form><div class="list" style="margin-top:16px"></div>';
var f=p.querySelector('form'),list=p.querySelector('.list');function load(){var st=f.state.value;get('/api/deadlines'+(st?'?state='+st:'')).then(function(j){var d=j.deadlines||[];
list.innerHTML=d.length?'<table><tr><th>Date</th><th>State</th><th>What</th></tr>'+d.slice(0,40).map(function(x){return '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.state)+'</td><td><a href="'+esc(x.link_url)+'" target="_blank" rel="noopener">'+esc(x.title)+'</a></td></tr>';}).join('')+'</table>':'<p class="fine">We add dates as each state confirms them. Sign up and we\'ll remind you as soon as they\'re set.</p>';});}
f.state.onchange=load;load();f.onsubmit=function(e){e.preventDefault();var b=f.querySelector('.go');b.disabled=true;
post('/api/subscribe',{email:f.email.value,states:f.state.value?[f.state.value]:STATES.map(function(s){return s[0];}),species:f.species.value?[f.species.value]:SPECIES,website:f.website.value}).then(function(){f.outerHTML='<div class="ok">Check your email and click the link to turn on your free reminders.</div>';}).catch(function(x){f.querySelector('.err').textContent=x.message;b.disabled=false;});};},
stocking:function(p,pre){p.innerHTML='<h3>Stocking Alerts</h3><p class="lead">Pick a lake, stream or whole county. We email you when the state stocks it, with guides and shops nearby.</p>'+
'<form><div class="row"><div><label>State<select name="state" required>'+stateOpts(pre)+'</select></label></div><div><label>Lake or stream<input name="water" list="hf-waters" placeholder="Start typing a water"></label><datalist id="hf-waters"></datalist></div><div><label>Or whole county<input name="county" placeholder="Placer"></label></div></div>'+
'<div class="row"><div><label>Email<input name="email" type="email" required placeholder="you@example.com"></label></div></div><input class="hp" name="website" tabindex="-1" autocomplete="off"><button class="go">Alert me</button><div class="err"></div></form><div class="out"></div>';
var f=p.querySelector('form'),dl=p.querySelector('datalist'),out=p.querySelector('.out'),t;f.water.oninput=function(){clearTimeout(t);t=setTimeout(function(){if(!f.state.value||f.water.value.length<2)return;get('/api/hf/stocking/waters?state='+f.state.value+'&q='+encodeURIComponent(f.water.value)).then(function(j){dl.innerHTML=(j.waters||[]).map(function(w){return '<option value="'+esc(w.water)+'">'+esc(w.county?w.county+' County':'')+'</option>';}).join('');});},250);};
if(/stocking=confirmed/.test(location.search))out.innerHTML='<p><strong>You\'re set.</strong> We\'ll email you when it\'s stocked.</p>';
f.onsubmit=function(e){e.preventDefault();var b=f.querySelector('.go');b.disabled=true;f.querySelector('.err').textContent='';
post('/api/hf/stocking/follow',{email:f.email.value,state:f.state.value,water:f.water.value,county:f.county.value,website:f.website.value}).then(function(){f.outerHTML='<div class="ok">Check your email and click the link to confirm. Then we\'ll let you know every time it\'s stocked.</div>';}).catch(function(x){f.querySelector('.err').textContent=x.message;b.disabled=false;});};},
returned:function(p,pre){p.innerHTML='<h3>Returned & Leftover Tags</h3><p class="lead">States put returned and leftover tags back on sale all year, and they go fast. Get an alert the moment they post.</p><div id="lta-signup" data-states="'+esc(pre)+'"></div>';
var s=document.createElement('script');s.src=API+'/widget.js';s.async=true;p.appendChild(s);if(window.LTA_MOUNT)window.LTA_MOUNT();}
};
function init(){var n=document.querySelectorAll('#hf-tools,.hf-tools');for(var i=0;i<n.length;i++)mount(n[i]);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();`
    .replace('__API__', JSON.stringify(env.API_URL))
    .replace('__STATES__', JSON.stringify(Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1]))))
    .replace('__SPECIES__', JSON.stringify(SPECIES))
    .replace('__SPL__', JSON.stringify(SPECIES_LABEL));
  return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } });
}

import type { Env } from './types';
import { SPECIES, STATES } from './util';

/**
 * Embeddable sign-up form for other sites (e.g. Horn & Fin). Paste into a WordPress Custom HTML block:
 *   <div id="lta-signup"></div>
 *   <script src="https://leftovertagalerts.com/widget.js" async></script>
 * The site's hostname must be listed in EMBED_ORIGINS.
 * Optional: data-states="CO,UT" on the div pre-selects states (e.g. on a state guide page).
 */
export function widgetJs(env: Env): Response {
  const states = Object.entries(STATES);
  const js = `(function(){
var API=${JSON.stringify(env.API_URL)};var STATES=${JSON.stringify(states)};var SPECIES=${JSON.stringify(SPECIES)};
function el(t,a,h){var e=document.createElement(t);for(var k in a||{})e.setAttribute(k,a[k]);if(h!=null)e.innerHTML=h;return e;}
function mount(root){if(root.dataset.mounted)return;root.dataset.mounted='1';
var pre=(root.dataset.states||'').toUpperCase().split(',').filter(Boolean);
var css='.ltaw{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15211c;background:#fff;border:2px solid #1f3d35;border-radius:4px;padding:18px;max-width:640px}'+
'.ltaw h3{margin:0 0 4px;font-size:20px;color:#1f3d35}.ltaw p{margin:0 0 12px;color:#4f5c55;font-size:14px}'+
'.ltaw input[type=email]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c4cdc6;border-radius:6px;font-size:16px;margin-bottom:10px}'+
'.ltaw details{margin:0 0 10px}.ltaw summary{cursor:pointer;font-weight:600;color:#1f3d35}'+
'.ltaw .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 10px;margin-top:8px;font-size:14px}'+
'.ltaw button{background:#ff6a13;color:#15211c;border:0;border-radius:3px;padding:11px 18px;font-weight:700;font-size:15px;cursor:pointer}'+
'.ltaw .ok{background:#dcefe2;border-radius:6px;padding:12px;color:#1f3d35}.ltaw .err{color:#b3261e;font-size:14px;margin-top:8px}'+
'.ltaw .hp{position:absolute;left:-9999px}';
root.appendChild(el('style',{},css));
var box=el('form',{class:'ltaw',novalidate:''});
var sp=SPECIES.map(function(s){return '<label><input type=checkbox name=species value="'+s+'" checked> '+s[0].toUpperCase()+s.slice(1)+'</label>';}).join('');
var st=STATES.map(function(s){return '<label><input type=checkbox name=states value="'+s[0]+'"'+(pre.length&&pre.indexOf(s[0])<0?'':' checked')+'> '+s[1]+'</label>';}).join('');
box.innerHTML='<h3>Leftover and returned tag alerts</h3><p>Get an email when states post leftover, returned or reissued big game tags. Free daily email, or instant email and text alerts for ${env.PAID_PRICE_LABEL}. From <a href="${env.SITE_URL}" target="_blank" rel="noopener">Leftover Tag Alerts</a>.</p>'+
'<input type=email name=email placeholder="you@example.com" autocomplete=email required aria-label="Email">'+
'<input class=hp type=text name=website tabindex=-1 autocomplete=off aria-hidden=true>'+
'<details><summary>Species</summary><div class=g>'+sp+'</div></details>'+
'<details'+(pre.length?' open':'')+'><summary>States'+(pre.length?' ('+pre.join(', ')+')':' (all)')+'</summary><div class=g>'+st+'</div></details>'+
'<button type=submit>Send me alerts</button><div class=err role=alert></div>';
box.onsubmit=function(e){e.preventDefault();var err=box.querySelector('.err');err.textContent='';
var v=function(n){return Array.prototype.map.call(box.querySelectorAll('input[name='+n+']:checked'),function(c){return c.value;});};
var email=box.querySelector('[name=email]').value;if(!/.+@.+\\..+/.test(email)){err.textContent='Enter a valid email.';return;}
var btn=box.querySelector('button');btn.disabled=true;btn.textContent='Sending…';
fetch(API+'/api/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,states:v('states'),species:v('species'),website:box.querySelector('[name=website]').value})})
.then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Something went wrong');return d;});})
.then(function(){box.innerHTML='<div class=ok><strong>Check your inbox.</strong> Click the link we just sent to '+email.replace(/[<>&"]/g,'')+' to turn on your alerts.</div>';})
.catch(function(x){err.textContent=x.message;btn.disabled=false;btn.textContent='Send me alerts';});};
root.appendChild(box);}
function init(){var n=document.querySelectorAll('#lta-signup,.lta-signup,#hf-tag-alerts');for(var i=0;i<n.length;i++)mount(n[i]);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();`;
  return new Response(js, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' },
  });
}

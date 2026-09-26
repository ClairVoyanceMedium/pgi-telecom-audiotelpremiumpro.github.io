(()=>{
"use strict";
const PORTAL_ID="149417663",REGION="eu1";
const KEY="pgi_tracking_consent_v1",VERSION="2026-09-26",MAX_AGE=180*24*60*60*1000;
const SCRIPT_ID="hs-script-loader",COOKIES=["hubspotutk","__hstc","__hssc","__hssrc","messagesUtk"];
function read(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY)||"null"),age=x?Date.now()-Number(x.at||0):Infinity;
    if(!x||x.version!==VERSION||!["accepted","rejected"].includes(x.choice)||age<0||age>MAX_AGE){localStorage.removeItem(KEY);return null}
    return x.choice;
  }catch(_e){return null}
}
function write(choice){try{localStorage.setItem(KEY,JSON.stringify({choice,at:Date.now(),version:VERSION}))}catch(_e){}}
function expire(name,domain){document.cookie=name+"=; Max-Age=0; Path=/; SameSite=Lax"+(domain?"; Domain="+domain:"")}
function clearCookies(){
  const host=location.hostname.replace(/^www\./,"");
  COOKIES.forEach(name=>{expire(name,"");if(host)expire(name,host);if(host&&host.includes("."))expire(name,"."+host)});
}
function reject(){
  window._hsq=window._hsq||[];
  window._hsq.push(["doNotTrack"]);
  clearCookies();
}
function load(){
  if(document.getElementById(SCRIPT_ID))return;
  window._hsq=window._hsq||[];
  const s=document.createElement("script");
  s.id=SCRIPT_ID;s.async=true;s.defer=true;s.src="https://js-"+REGION+".hs-scripts.com/"+PORTAL_ID+".js";
  document.head.appendChild(s);
}
function ensureStyle(){
  if(document.getElementById("pgi-tracking-consent-style"))return;
  const s=document.createElement("style");s.id="pgi-tracking-consent-style";
  s.textContent="#pgi-tracking-consent{position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:760px;margin:0 auto;padding:18px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:#17100df2;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.45);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;backdrop-filter:blur(14px)}#pgi-tracking-consent[hidden]{display:none!important}#pgi-tracking-consent strong{display:block;font-size:16px;margin:0 0 6px}#pgi-tracking-consent p{margin:0;color:#e8ded9}#pgi-tracking-consent a{color:#fff;text-decoration:underline;text-underline-offset:3px}#pgi-tracking-consent .pgi-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}#pgi-tracking-consent button{min-height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.22);padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}#pgi-tracking-consent [data-consent-accept]{background:#fff;color:#17100d}#pgi-tracking-consent [data-consent-reject]{background:transparent;color:#fff}@media(max-width:560px){#pgi-tracking-consent{left:10px;right:10px;bottom:10px;padding:15px}#pgi-tracking-consent .pgi-consent-actions{grid-template-columns:1fr}}";
  document.head.appendChild(s);
}
function banner(){
  let b=document.getElementById("pgi-tracking-consent");if(b)return b;
  ensureStyle();b=document.createElement("section");b.id="pgi-tracking-consent";b.hidden=true;
  b.setAttribute("role","dialog");b.setAttribute("aria-labelledby","pgi-consent-title");
  b.innerHTML='<strong id="pgi-consent-title">Mesure d’audience</strong><p>Avec votre accord, HubSpot nous aide à mesurer les visites et le parcours commercial afin d’améliorer Audiotel Premium Pro. Le refus n’empêche pas l’accès au site. <a href="/cookies-traceurs/">En savoir plus</a>.</p><div class="pgi-consent-actions"><button type="button" data-consent-reject>Refuser</button><button type="button" data-consent-accept>Accepter</button></div>';
  document.body.appendChild(b);
  b.querySelector("[data-consent-accept]").addEventListener("click",()=>{write("accepted");b.hidden=true;load()});
  b.querySelector("[data-consent-reject]").addEventListener("click",()=>{write("rejected");b.hidden=true;reject()});
  return b;
}
function show(){banner().hidden=false}
function boot(){
  document.addEventListener("click",e=>{const t=e.target.closest("[data-tracking-preferences]");if(t){e.preventDefault();show()}});
  const choice=read();
  if(navigator.globalPrivacyControl===true&&choice!=="accepted"){write("rejected");reject();return}
  if(choice==="accepted")load();else if(choice==="rejected")reject();else show();
}
window.PGITrackingPreferences={status:()=>read()||"unset",accept:()=>{write("accepted");const b=document.getElementById("pgi-tracking-consent");if(b)b.hidden=true;load()},reject:()=>{write("rejected");const b=document.getElementById("pgi-tracking-consent");if(b)b.hidden=true;reject()},open:show};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
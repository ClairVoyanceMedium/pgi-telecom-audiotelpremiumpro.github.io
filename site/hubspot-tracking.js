(()=>{
"use strict";
const PORTAL_ID="149417663",REGION="eu1",GTM_ID="GTM-5L6NW5JZ",MEASUREMENT_ID="G-SZY50J75N7";
const KEY="pgi_tracking_consent_v1",VERSION="2026-09-27-analytics-v1",MAX_AGE=180*24*60*60*1000;
const HS_SCRIPT_ID="hs-script-loader",GTM_SCRIPT_ID="pgi-gtm-loader",LEAD_KEY="pgi_public_order_intent_v1";
const PRIVATE_RE=/^\/(?:cockpit(?:\.html)?|admin(?:\.html)?)(?:\/|$)/i,CLIENT_RE=/^\/client(?:\.html)?(?:\/|$)/i;
const HS_COOKIES=["hubspotutk","__hstc","__hssc","__hssrc","messagesUtk"];
const PARAMS=Object.freeze({
  generate_lead:["account_type","service_intent","lead_source"],
  sign_up:["method","account_type","service_intent","lead_source"],
  login:["method"],
  begin_checkout:["currency","value"],
  qualify_lead:["account_type","service_intent","lead_source"],
  working_lead:["account_type","service_intent","lead_source"],
  close_convert_lead:["currency","value","account_type","service_intent","lead_source"],
  purchase:["transaction_id","currency","value"],
  refund:["transaction_id","currency","value"]
});
const path=location.pathname||"/",privatePage=PRIVATE_RE.test(path),publicPage=!privatePage&&!CLIENT_RE.test(path);
const pending=[],denied={analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"};
let pendingUser=null;
window.dataLayer=window.dataLayer||[];
function gtag(){window.dataLayer.push(arguments)}
window.gtag=window.gtag||gtag;
window.gtag("consent","default",{...denied,wait_for_update:500});
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
  const host=location.hostname.replace(/^www\./,""),names=document.cookie.split(";").map(x=>x.split("=")[0].trim()).filter(Boolean);
  [...new Set([...HS_COOKIES,...names.filter(x=>x==="_ga"||x.startsWith("_ga_")||x==="_gid"||x==="_gat"||x==="_gcl_au")])].forEach(name=>{
    expire(name,"");if(host)expire(name,host);if(host&&host.includes("."))expire(name,"."+host);
  });
}
function updateConsent(granted){window.gtag("consent","update",{...denied,analytics_storage:granted?"granted":"denied"})}
function loadGtm(){
  if(privatePage||document.getElementById(GTM_SCRIPT_ID))return;
  window.dataLayer.push({"gtm.start":Date.now(),event:"gtm.js"});
  const j=document.createElement("script");j.id=GTM_SCRIPT_ID;j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+encodeURIComponent(GTM_ID);
  (document.head||document.documentElement).appendChild(j);
}
function loadHubSpot(){
  if(!publicPage||document.getElementById(HS_SCRIPT_ID))return;
  window._hsq=window._hsq||[];
  const s=document.createElement("script");s.id=HS_SCRIPT_ID;s.async=true;s.defer=true;s.src="https://js-"+REGION+".hs-scripts.com/"+PORTAL_ID+".js";
  document.head.appendChild(s);
}
function validUserId(value){const x=String(value||"").trim();return x.length>=8&&x.length<=128&&!x.includes("@")&&/^[A-Za-z0-9_-]+$/.test(x)?x:""}
function leadContext(){try{const x=JSON.parse(sessionStorage.getItem(LEAD_KEY)||"null")||{};return {account_type:x.account_type,service_intent:x.service_intent,lead_source:x.source||"client_portal"}}catch(_e){return {lead_source:"client_portal"}}}
function identify(value){
  const id=validUserId(value);if(!id||privatePage)return false;
  const choice=read();
  if(choice==="accepted"){window.gtag("config",MEASUREMENT_ID,{user_id:id,send_page_view:false});return true}
  if(choice===null)pendingUser=id;
  return false;
}
function identifyUser(user){const raw=user&&(user.public_id||user.customer_id||user.user_id||user.id);if(raw==null||String(raw).includes("@"))return false;return identify("pgi_"+String(raw).replace(/[^A-Za-z0-9_-]/g,"_").slice(0,120))}
function clearUser(){pendingUser=null;if(read()==="accepted"&&!privatePage)window.gtag("config",MEASUREMENT_ID,{user_id:null,send_page_view:false})}
function authEvent(name,method,result,accountType){const user=result&&result.user;if(!user||result.pending_contract)return result;identifyUser(user);track(name,{method,account_type:accountType});return result}
function wrapCustomerApi(){
  const api=window.PGICustomerApi;if(!api||api.__analyticsWrapped)return;
  const wrapped={...api};
  wrapped.login=async(...args)=>authEvent("login","email",await api.login(...args));
  wrapped.register=async(...args)=>{const result=await api.register(...args);return result.email_verification_required?result:authEvent("sign_up","email",result,args[0]&&args[0].account_type)};
  wrapped.google=async(...args)=>authEvent(args[2]?"sign_up":"login","google",await api.google(...args));
  wrapped.activate=async(...args)=>authEvent("sign_up","email",await api.activate(...args));
  wrapped.me=async(...args)=>{const result=await api.me(...args);identifyUser(result&&result.user);return result};
  wrapped.logout=async(...args)=>{try{return await api.logout(...args)}finally{clearUser()}};
  wrapped.changePassword=async(...args)=>{const result=await api.changePassword(...args);clearUser();return result};
  Object.defineProperty(wrapped,"__analyticsWrapped",{value:true});window.PGICustomerApi=Object.freeze(wrapped);
}
function beginCheckout(offer){return track("begin_checkout",{currency:String(offer&&offer.currency||"EUR").toUpperCase(),value:Number(offer&&offer.amount_minor)/100})}
function clean(name,params){
  const allowed=PARAMS[name];if(!allowed)return null;
  const out={};
  for(const key of allowed){
    const value=params&&params[key];if(value==null||value==="")continue;
    if(key==="value"){const n=Number(value);if(Number.isFinite(n)&&n>=0)out[key]=Math.round(n*100)/100;continue}
    const text=String(value).trim().slice(0,key==="transaction_id"?128:80);if(text&&!/[\r\n]/.test(text))out[key]=text;
  }
  return out;
}
function send(name,params){window.gtag("event",name,params)}
function track(name,params={}){
  if(privatePage)return false;
  const withContext=["generate_lead","sign_up","qualify_lead","working_lead","close_convert_lead"].includes(name)?{...leadContext(),...params}:params;
  const safe=clean(name,withContext);if(!safe)return false;
  const choice=read();
  if(choice==="accepted"){send(name,safe);return true}
  if(choice===null&&pending.length<20)pending.push([name,safe]);
  return false;
}
function flush(){if(pendingUser){identify(pendingUser);pendingUser=null}while(pending.length){const x=pending.shift();send(x[0],x[1])}}
function reject(){updateConsent(false);pending.length=0;pendingUser=null;window._hsq=window._hsq||[];window._hsq.push(["doNotTrack"]);clearCookies()}
function accept(){
  if(navigator.globalPrivacyControl===true){write("rejected");reject();return false}
  write("accepted");updateConsent(true);loadGtm();loadHubSpot();flush();return true;
}
function ensureStyle(){
  if(document.getElementById("pgi-tracking-consent-style"))return;
  const s=document.createElement("style");s.id="pgi-tracking-consent-style";
  s.textContent="#pgi-tracking-consent{position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:760px;margin:0 auto;padding:18px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:#17100df2;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.45);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;backdrop-filter:blur(14px)}#pgi-tracking-consent[hidden]{display:none!important}#pgi-tracking-consent strong{display:block;font-size:16px;margin:0 0 6px}#pgi-tracking-consent p{margin:0;color:#e8ded9}#pgi-tracking-consent a{color:#fff;text-decoration:underline;text-underline-offset:3px}#pgi-tracking-consent .pgi-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}#pgi-tracking-consent button{min-height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.35);padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;background:#fff;color:#17100d}@media(max-width:560px){#pgi-tracking-consent{left:10px;right:10px;bottom:10px;padding:15px}#pgi-tracking-consent .pgi-consent-actions{grid-template-columns:1fr}}";
  document.head.appendChild(s);
}
function banner(){
  let b=document.getElementById("pgi-tracking-consent");if(b)return b;
  ensureStyle();b=document.createElement("section");b.id="pgi-tracking-consent";b.hidden=true;b.setAttribute("role","dialog");b.setAttribute("aria-labelledby","pgi-consent-title");
  b.innerHTML='<strong id="pgi-consent-title">Mesure d’audience facultative</strong><p>Avec votre accord, Google Analytics et HubSpot mesurent les visites et le parcours commercial pour améliorer Audiotel Premium Pro. Aucune donnée saisie dans les formulaires n’est envoyée à Google Analytics. Refuser n’empêche pas d’utiliser le site. <a href="/cookies-traceurs/">En savoir plus</a>.</p><div class="pgi-consent-actions"><button type="button" data-consent-reject>Refuser</button><button type="button" data-consent-accept>Accepter</button></div>';
  document.body.appendChild(b);
  b.querySelector("[data-consent-accept]").addEventListener("click",()=>{accept();b.hidden=true});
  b.querySelector("[data-consent-reject]").addEventListener("click",()=>{write("rejected");b.hidden=true;reject()});
  return b;
}
function show(){banner().hidden=false}
function boot(){
  wrapCustomerApi();
  document.addEventListener("click",e=>{const t=e.target.closest("[data-tracking-preferences]");if(t){e.preventDefault();show()}});
  if(privatePage){reject();return}
  const choice=read();
  if(navigator.globalPrivacyControl===true){write("rejected");reject();return}
  if(choice==="accepted")accept();else if(choice==="rejected")reject();else show();
}
window.PGIAnalytics=Object.freeze({track,identify,identifyUser,clearUser,beginCheckout,measurementId:MEASUREMENT_ID,containerId:GTM_ID});
window.PGITrackingPreferences={status:()=>read()||"unset",accept:()=>{const ok=accept(),b=document.getElementById("pgi-tracking-consent");if(b)b.hidden=true;return ok},reject:()=>{write("rejected");const b=document.getElementById("pgi-tracking-consent");if(b)b.hidden=true;reject()},open:show};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();

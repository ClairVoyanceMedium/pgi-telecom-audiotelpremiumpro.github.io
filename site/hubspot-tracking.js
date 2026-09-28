(()=>{
"use strict";
const PORTAL_ID="149417663",REGION="eu1",GTM_ID="GTM-5L6NW5JZ",MEASUREMENT_ID="G-SZY50J75N7";
const KEY="pgi_tracking_consent_v1",VERSION="2026-09-27-analytics-v1",MAX_AGE=180*24*60*60*1000;
const HS_SCRIPT_ID="hs-script-loader",GTM_SCRIPT_ID="pgi-gtm-loader",GA_SCRIPT_ID="pgi-ga4-loader",LEAD_KEY="pgi_public_order_intent_v1";
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
  refund:["transaction_id","currency","value"],
  contact_widget_open:["contact_context","contact_source"],
  contact_form_start:["contact_context","contact_source"],
  contact_message_submit:["contact_context","contact_source"],
  contact_message_success:["contact_context","contact_source","crm_sync"],
  contact_message_error:["contact_context","contact_source","error_type"],
  select_content:["content_type","content_id"],
  order_form_start:["form_context"],
  order_form_submit:["form_context"],
  order_form_error:["form_context","error_field"],
  order_form_abandon:["form_context"],
  registration_view:["registration_source"],
  email_verification_required:["account_type","service_intent","lead_source"],
  page_performance:["metric_name","metric_rating","metric_value"]
});
const VALUES=Object.freeze({
  account_type:new Set(["business","individual"]),
  service_intent:new Set(["new_number","portability","commercial_information","technical_support","other"]),
  lead_source:new Set(["public_marketing_site","client_portal"]),
  method:new Set(["email","google"]),
  currency:new Set(["EUR"]),
  contact_context:new Set(["home","pricing","portability","payouts","education","industry","opening","legal","other"]),
  contact_source:new Set(["floating_email_widget"]),
  crm_sync:new Set(["synced","not_synced"]),
  error_type:new Set(["network_or_server","validation"]),
  content_type:new Set(["cta","navigation","resource","internal_link","faq","tool"]),
  form_context:new Set(["home","opening"]),
  error_field:new Set(["account_type","identity","email","service_intent","consent","other"]),
  registration_source:new Set(["public_order"]),
  metric_name:new Set(["lcp_ms","cls_milli","ttfb_ms","interaction_latency_p98_ms"]),
  metric_rating:new Set(["good","needs_improvement","poor"])
});
const ALIASES=Object.freeze({service_intent:Object.freeze({advice:"commercial_information"})});
const path=location.pathname||"/",privatePage=PRIVATE_RE.test(path),publicPage=!privatePage&&!CLIENT_RE.test(path);
function contentGroup(pathname=location.pathname){
  const p=String(pathname||"/").toLowerCase();
  if(p==="/")return "Accueil";
  if(/tarif-numero-sva|comparateur-audiotel/.test(p))return "Tarifs et comparaison";
  if(/portabilite-numero-sva/.test(p))return "Portabilité";
  if(/reversement-audiotel/.test(p))return "Reversements";
  if(/guide-audiotel-sva|numero-sva|numero-surtaxe-08/.test(p))return "Guide et information SVA";
  if(/audiotel-(voyance|coaching|professionnels|independants)/.test(p))return "Pages métiers";
  if(/demande-ouverture/.test(p))return "Demande d’ouverture";
  if(CLIENT_RE.test(p))return "Espace client";
  if(/conditions|confidentialite|mentions-legales|retractation|resilier|cookies/.test(p))return "Juridique et confidentialité";
  return "Autres pages publiques";
}
function trafficOrigin(){
  let host="";
  try{host=new URL(document.referrer||"").hostname.toLowerCase().replace(/^www\./,"")}catch(_e){}
  if(!host)return "direct_or_unknown";
  const ai=[
    ["chatgpt.com","ai_chatgpt"],["chat.openai.com","ai_chatgpt"],["perplexity.ai","ai_perplexity"],
    ["copilot.microsoft.com","ai_copilot"],["gemini.google.com","ai_gemini"],["claude.ai","ai_claude"],
    ["poe.com","ai_poe"],["you.com","ai_you"],["phind.com","ai_phind"],["chat.mistral.ai","ai_mistral"]
  ].find(([domain])=>host===domain||host.endsWith("."+domain));
  if(ai)return ai[1];
  if(/(^|\.)(google|bing|yahoo|duckduckgo|ecosia|qwant|baidu|yandex)\./.test(host)||host==="search.brave.com")return "search";
  if(/(^|\.)(facebook|instagram|linkedin|tiktok|x|twitter|youtube|reddit)\./.test(host))return "social";
  if(host===location.hostname.toLowerCase().replace(/^www\./,""))return "internal";
  return "referral";
}
function paymentReferrer(){
  try{const h=new URL(document.referrer||"").hostname.toLowerCase();return h==="stripe.com"||h.endsWith(".stripe.com")}catch(_e){return false}
}
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
function loadGa4(){
  if(privatePage||window.__pgiGa4Configured)return;
  window.__pgiGa4Configured=true;
  const s=document.createElement("script");s.id=GA_SCRIPT_ID;s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(MEASUREMENT_ID);
  (document.head||document.documentElement).appendChild(s);
  window.gtag("js",new Date());
  const context={content_group:contentGroup(),traffic_origin:trafficOrigin()};
  window.gtag("set",context);
  window.gtag("config",MEASUREMENT_ID,{
    send_page_view:true,
    content_group:context.content_group,
    allow_google_signals:false,
    allow_ad_personalization_signals:false,
    ...(paymentReferrer()?{ignore_referrer:true}:{})
  });
}
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
  wrapped.register=async(...args)=>{const result=await api.register(...args);if(result.email_verification_required){track("email_verification_required",{account_type:args[0]&&args[0].account_type});return result}return authEvent("sign_up","email",result,args[0]&&args[0].account_type)};
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
    if(key==="metric_value"){const n=Number(value);if(Number.isFinite(n)&&n>=0)out[key]=Math.round(n*1000)/1000;continue}
    let text=String(value).trim().slice(0,key==="transaction_id"?128:80);
    if(key==="currency")text=text.toUpperCase();
    if(ALIASES[key]&&ALIASES[key][text])text=ALIASES[key][text];
    if(key==="transaction_id"){if(/^[A-Za-z0-9_-]{1,128}$/.test(text))out[key]=text;continue}
    if(VALUES[key]&&!VALUES[key].has(text))continue;
    if(text&&!/[\r\n]/.test(text))out[key]=text;
  }
  return out;
}
function send(name,params){window.gtag("event",name,params)}
function track(name,params={}){
  if(privatePage)return false;
  const withContext=["generate_lead","sign_up","qualify_lead","working_lead","close_convert_lead","email_verification_required"].includes(name)?{...leadContext(),...params}:params;
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
  write("accepted");updateConsent(true);
  window._hsq=window._hsq||[];window._hsq.push(["doNotTrack",{track:true}]);
  loadGa4();loadGtm();loadHubSpot();flush();return true;
}
function contentIdForLink(link){
  const raw=String(link?.getAttribute("href")||"").trim();
  if(!raw||raw.startsWith("#")||raw.startsWith("mailto:")||raw.startsWith("tel:")||raw.startsWith("javascript:"))return "";
  let url;try{url=new URL(raw,location.href)}catch(_e){return ""}
  if(url.origin!==location.origin)return "";
  const p=url.pathname.replace(/\/+$/,"")||"/";
  const known={
    "/demande-ouverture":"opening_request","/client.html":"client_portal","/comparateur-audiotel":"comparator",
    "/guide-audiotel-sva":"guide_sva","/portabilite-numero-sva":"portability","/reversement-audiotel":"payouts",
    "/numero-sva":"numero_sva","/numero-surtaxe-08":"numero_surtaxe","/tarif-numero-sva":"pricing",
    "/audiotel-voyance":"industry_voyance","/audiotel-coaching":"industry_coaching",
    "/audiotel-professionnels":"industry_professionals","/audiotel-independants":"industry_independents","/":"home"
  };
  return known[p]||"";
}
function contentTypeForLink(link){
  if(link.matches(".btn,.header-login,[data-order-type],.resource-link"))return link.matches(".resource-link")?"resource":"cta";
  if(link.closest("nav"))return "navigation";
  return "internal_link";
}
function bindContentMeasurement(){
  document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");if(!link)return;
    const id=contentIdForLink(link);if(!id)return;
    track("select_content",{content_type:contentTypeForLink(link),content_id:id});
  });
  document.querySelectorAll("details").forEach((details,index)=>details.addEventListener("toggle",()=>{
    if(details.open)track("select_content",{content_type:"faq",content_id:(contentGroup().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50)||"page")+"_faq_"+String(index+1)});
  }));
  const calculator=document.querySelector("[data-calculator]");
  if(calculator){
    let used=false;
    calculator.addEventListener("input",()=>{if(!used){used=true;track("select_content",{content_type:"tool",content_id:"homepage_calculator"})}});
  }
  const comparatorInputs=[...document.querySelectorAll("#gap,#cmp-hours,#cmp-week,#cmp-month")];
  if(comparatorInputs.length){
    let used=false;
    comparatorInputs.forEach(input=>input.addEventListener("input",()=>{if(!used){used=true;track("select_content",{content_type:"tool",content_id:"audiotel_comparator"})}}));
  }
}
function bindOrderFunnel(){
  const form=document.getElementById("order-form");if(!form)return;
  const formContext=location.pathname.includes("demande-ouverture")?"opening":"home";
  let started=false,submitted=false,lastErrorAt=0;
  form.addEventListener("focusin",()=>{if(!started){started=true;track("order_form_start",{form_context:formContext})}},{once:true});
  form.addEventListener("submit",()=>{submitted=true;track("order_form_submit",{form_context:formContext})});
  form.addEventListener("invalid",event=>{
    const now=Date.now();if(now-lastErrorAt<700)return;lastErrorAt=now;
    const name=String(event.target?.name||event.target?.id||"");
    const field=/account_type/.test(name)?"account_type":/first_name|last_name|company_name/.test(name)?"identity":/email/.test(name)?"email":/service_intent/.test(name)?"service_intent":/processing_consent/.test(name)?"consent":"other";
    track("order_form_error",{form_context:formContext,error_field:field});
  },true);
  window.addEventListener("pagehide",()=>{if(started&&!submitted)track("order_form_abandon",{form_context:formContext})},{once:true});
}
function performanceRating(name,value){
  if(name==="lcp_ms")return value<=2500?"good":value<=4000?"needs_improvement":"poor";
  if(name==="cls_milli")return value<=100?"good":value<=250?"needs_improvement":"poor";
  if(name==="ttfb_ms")return value<=800?"good":value<=1800?"needs_improvement":"poor";
  return value<=200?"good":value<=500?"needs_improvement":"poor";
}
function bindPerformanceMeasurement(){
  if(privatePage||typeof PerformanceObserver!=="function")return;
  let lcp=0,cls=0,reported=false;
  const interactions=[];
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())lcp=Math.max(lcp,Number(e.startTime||0))}).observe({type:"largest-contentful-paint",buffered:true})}catch(_e){}
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)cls+=Number(e.value||0)}).observe({type:"layout-shift",buffered:true})}catch(_e){}
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(Number(e.interactionId||0)>0&&Number(e.duration||0)>0)interactions.push(Number(e.duration))}).observe({type:"event",buffered:true,durationThreshold:40})}catch(_e){}
  const report=()=>{
    if(reported)return;reported=true;
    const nav=performance.getEntriesByType("navigation")[0];
    const metrics=[];
    if(lcp>0)metrics.push(["lcp_ms",Math.round(lcp)]);
    if(cls>=0)metrics.push(["cls_milli",Math.round(cls*1000)]);
    const ttfb=Number(nav?.responseStart||0);if(ttfb>0)metrics.push(["ttfb_ms",Math.round(ttfb)]);
    if(interactions.length){
      const sorted=interactions.slice().sort((a,b)=>a-b),idx=Math.max(0,Math.ceil(sorted.length*.98)-1);
      metrics.push(["interaction_latency_p98_ms",Math.round(sorted[idx])]);
    }
    for(const [metric_name,metric_value] of metrics)track("page_performance",{metric_name,metric_rating:performanceRating(metric_name,metric_value),metric_value});
  };
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")report()});
  window.addEventListener("pagehide",report,{once:true});
}
function bindRegistrationMeasurement(){
  if(CLIENT_RE.test(location.pathname)&&new URLSearchParams(location.search).get("register")==="1")track("registration_view",{registration_source:"public_order"});
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
  bindContentMeasurement();
  bindOrderFunnel();
  bindPerformanceMeasurement();
  bindRegistrationMeasurement();
  if(document.readyState!=="complete")document.addEventListener("DOMContentLoaded",wrapCustomerApi,{once:true});
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

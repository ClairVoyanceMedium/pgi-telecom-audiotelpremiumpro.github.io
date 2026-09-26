(()=>{
"use strict";
const CONSENT_KEY="pgi_consent_v2",ATTR_KEY="pgi_acquisition_v2",SESSION_KEY="pgi_analytics_session_v1";
const allowedUtms=["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","msclkid"];
let config=null,consent=readConsent(),booted=false,volatileAttribution=null;

function safe(value,max=180){return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max)}
function readConsent(){try{const x=JSON.parse(localStorage.getItem(CONSENT_KEY)||"null");return x&&x.version===2?x:null}catch{return null}}
function saveConsent(next){
  consent={version:2,necessary:true,analytics:next.analytics===true,marketing:next.marketing===true,updated_at:new Date().toISOString()};
  try{localStorage.setItem(CONSENT_KEY,JSON.stringify(consent))}catch{}
  if(!consent.analytics&&!consent.marketing){
    try{sessionStorage.removeItem(ATTR_KEY);sessionStorage.removeItem(SESSION_KEY)}catch{}
  }
  applyConsent();
}
function storedAttribution(){
  try{return JSON.parse(sessionStorage.getItem(ATTR_KEY)||"{}")||{}}catch{return{}}
}
function initialAttribution(){
  if(volatileAttribution)return volatileAttribution;
  const q=new URLSearchParams(location.search),next={};
  allowedUtms.forEach(k=>{const v=safe(q.get(k),180);if(v)next[k]=v});
  next.landing_path=safe(location.pathname,300);
  try{const h=document.referrer?new URL(document.referrer).hostname:"";if(h&&h!==location.hostname)next.referrer_host=safe(h,180)}catch{}
  next.first_seen_at=new Date().toISOString();
  volatileAttribution=next;
  return next;
}
function captureAttribution(persist=false){
  const allowed=Boolean(consent?.analytics||consent?.marketing);
  const next={...(allowed?storedAttribution():{}),...initialAttribution()};
  const q=new URLSearchParams(location.search);
  allowedUtms.forEach(k=>{const v=safe(q.get(k),180);if(v)next[k]=v});
  if(allowed&&persist){try{sessionStorage.setItem(ATTR_KEY,JSON.stringify(next))}catch{}}
  return next;
}
function sessionId(){
  if(!consent?.analytics)return "";
  try{
    let id=sessionStorage.getItem(SESSION_KEY);
    if(!id){id=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+"-"+Math.random().toString(36).slice(2));sessionStorage.setItem(SESSION_KEY,id)}
    return id;
  }catch{return""}
}
function setGoogleConsent(a,m){
  window.dataLayer=window.dataLayer||[];
  window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
  window.gtag("consent","update",{
    analytics_storage:a?"granted":"denied",
    ad_storage:m?"granted":"denied",
    ad_user_data:m?"granted":"denied",
    ad_personalization:m?"granted":"denied"
  });
}
function initGoogleDefaults(){
  window.dataLayer=window.dataLayer||[];
  window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
  window.gtag("consent","default",{
    analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",
    wait_for_update:500
  });
}
function loadScript(src,id){
  if(id&&document.getElementById(id))return;
  const s=document.createElement("script");if(id)s.id=id;s.async=true;s.src=src;document.head.appendChild(s);
}
function loadGa4(){
  const id=safe(config?.ga4_measurement_id,32);
  if(!/^G-[A-Z0-9]+$/i.test(id)||document.getElementById("pgi-ga4"))return;
  loadScript("https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(id),"pgi-ga4");
  window.gtag("js",new Date());
  window.gtag("config",id,{anonymize_ip:true,allow_google_signals:false,send_page_view:false});
  window.gtag("event","page_view",{page_location:location.href,page_path:location.pathname,page_title:document.title});
}
function loadHubSpot(){
  const portal=safe(config?.hubspot_portal_id,24),region=safe(config?.hubspot_region||"eu1",10).toLowerCase();
  if(!/^\d{4,20}$/.test(portal)||!/^(eu1|na1)$/.test(region)||document.getElementById("hs-script-loader"))return;
  window._hsq=window._hsq||[];
  loadScript("https://js-"+region+".hs-scripts.com/"+portal+".js","hs-script-loader");
}
function loadClarity(){
  const id=safe(config?.clarity_project_id,40);
  if(!/^[a-z0-9]{6,40}$/i.test(id)||window.clarity)return;
  (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script",id);
}
async function fetchConfig(){
  if(config)return config;
  try{
    const r=await fetch("/api/v1/public/integrations",{credentials:"same-origin",headers:{accept:"application/json"}});
    if(r.ok)config=await r.json();
  }catch{}
  config=config||{};
  return config;
}
async function applyConsent(){
  if(!consent)return;
  setGoogleConsent(consent.analytics,consent.marketing);
  await fetchConfig();
  if(consent.analytics||consent.marketing)captureAttribution(true);
  if(consent.analytics){
    if(config.ga4_enabled!==false)loadGa4();
    if(config.clarity_enabled===true)loadClarity();
  }
  if(consent.marketing&&config.hubspot_tracking_enabled!==false)loadHubSpot();
  if(!consent.marketing&&window._hsq)window._hsq.push(["doNotTrack"]);
  if(consent.analytics&&!booted){booted=true;track("page_view",{path:location.pathname});}
  updateBanner();
}
function track(name,meta={}){
  const event=safe(name,80).toLowerCase().replace(/[^a-z0-9_.-]/g,"_");
  if(!event)return;
  if(consent?.analytics&&window.gtag)window.gtag("event",event,cleanMeta(meta));
  if(!consent?.analytics)return;
  const a=captureAttribution(true);
  fetch("/api/v1/public/acquisition/event",{
    method:"POST",credentials:"same-origin",keepalive:true,
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      event_name:event,session_id:sessionId(),path:location.pathname,
      referrer_host:a.referrer_host||null,
      source:a.utm_source||null,medium:a.utm_medium||null,campaign:a.utm_campaign||null,term:a.utm_term||null,content:a.utm_content||null,
      consent_analytics:true,consent_marketing:consent?.marketing===true,
      metadata:cleanMeta(meta)
    })
  }).catch(()=>{});
}
function cleanMeta(meta){
  const out={};
  Object.entries(meta&&typeof meta==="object"?meta:{}).slice(0,12).forEach(([k,v])=>{
    const key=safe(k,40).replace(/[^A-Za-z0-9_.-]/g,"_");
    if(!key||/(email|phone|name|siret|registration|address|password)/i.test(key))return;
    if(typeof v==="number"&&Number.isFinite(v))out[key]=v;
    else if(typeof v==="boolean")out[key]=v;
    else out[key]=safe(v,120);
  });
  return out;
}
function banner(){
  if(document.getElementById("pgi-consent"))return;
  const style=document.createElement("style");style.id="pgi-consent-style";style.textContent=
    "#pgi-consent{position:fixed;z-index:10000;left:12px;right:12px;bottom:12px;max-width:760px;margin:auto;padding:18px;border-radius:18px;background:#211713;color:#fff7f0;border:1px solid rgba(232,179,110,.35);box-shadow:0 24px 70px rgba(0,0,0,.48);font:13px/1.45 system-ui,sans-serif}#pgi-consent strong{font-size:15px}#pgi-consent p{margin:7px 0 12px;color:#cdb8a8}#pgi-consent .pgi-c-actions{display:flex;flex-wrap:wrap;gap:8px}#pgi-consent button{border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:10px 13px;background:transparent;color:#fff7f0;font-weight:700;cursor:pointer}#pgi-consent button[data-accept]{background:#e8b36e;color:#231812;border-color:#e8b36e}#pgi-consent .pgi-c-custom{display:none;margin:10px 0}.pgi-c-open #pgi-consent .pgi-c-custom{display:grid;gap:7px}#pgi-consent label{display:flex;gap:9px;align-items:center}#pgi-consent-manage{position:fixed;z-index:9999;left:12px;bottom:12px;border:1px solid rgba(232,179,110,.3);background:#211713;color:#f4cf95;border-radius:999px;padding:8px 11px;font:11px system-ui;cursor:pointer}";
  document.head.appendChild(style);
  const el=document.createElement("section");el.id="pgi-consent";el.setAttribute("role","dialog");el.setAttribute("aria-label","Préférences de confidentialité");
  el.innerHTML='<strong>Vos préférences de confidentialité</strong><p>Les traceurs de mesure et CRM ne sont chargés qu’après votre choix. Les fonctions indispensables du site restent actives.</p><div class="pgi-c-custom"><label><input type="checkbox" data-analytics> Mesure d’audience (Google Analytics / Clarity)</label><label><input type="checkbox" data-marketing> CRM et parcours commercial (HubSpot)</label></div><div class="pgi-c-actions"><button type="button" data-reject>Tout refuser</button><button type="button" data-custom>Personnaliser</button><button type="button" data-save hidden>Enregistrer</button><button type="button" data-accept>Tout accepter</button></div>';
  document.body.appendChild(el);
  el.querySelector("[data-reject]").onclick=()=>saveConsent({analytics:false,marketing:false});
  el.querySelector("[data-accept]").onclick=()=>saveConsent({analytics:true,marketing:true});
  el.querySelector("[data-custom]").onclick=()=>{document.documentElement.classList.add("pgi-c-open");el.querySelector("[data-save]").hidden=false};
  el.querySelector("[data-save]").onclick=()=>saveConsent({analytics:el.querySelector("[data-analytics]").checked,marketing:el.querySelector("[data-marketing]").checked});
}
function manageButton(){
  if(document.getElementById("pgi-consent-manage"))return;
  const b=document.createElement("button");b.id="pgi-consent-manage";b.type="button";b.textContent="Confidentialité";
  b.onclick=()=>{consent=null;banner();const el=document.getElementById("pgi-consent");if(el)el.hidden=false};
  document.body.appendChild(b);
}
function updateBanner(){
  const el=document.getElementById("pgi-consent");if(el)el.hidden=Boolean(consent);
  manageButton();
}
function bind(){
  document.addEventListener("click",e=>{
    const a=e.target.closest("a,button");if(!a)return;
    const href=a.getAttribute("href")||"";
    if(/demande-ouverture|register=1/.test(href)||a.matches("[data-order-type]"))track("cta_open_application",{placement:a.dataset.orderType||"link"});
    if(/comparateur-audiotel/.test(href))track("cta_open_comparator",{placement:"link"});
  },true);
  document.addEventListener("submit",e=>{
    if(e.target?.id==="order-form")track("application_intent",{account_type:e.target.querySelector('[name="order_account_type"]:checked')?.value||"unknown"});
    if(e.target?.id==="customer-register-form")track("registration_submit",{account_type:document.getElementById("register-account-type")?.value||"unknown"});
  },true);
  const savings=document.getElementById("current-platform-fee");
  if(savings)savings.addEventListener("change",()=>track("savings_calculated",{current_monthly_cost:Number(savings.value)||0}));
}
async function init(){
  initGoogleDefaults();initialAttribution();bind();
  await fetchConfig();
  if(consent)applyConsent();else banner();
  manageButton();
}
window.PGITracking=Object.freeze({track,getAttribution:()=>{if(!consent?.analytics&&!consent?.marketing)return{};const a=captureAttribution(true);return typeof structuredClone==="function"?structuredClone(a):JSON.parse(JSON.stringify(a))},getSessionId:()=>sessionId(),getConsent:()=>consent?{...consent}:null});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

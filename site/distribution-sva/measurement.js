import {createDirectSvaTracker} from "/site/direct-sva-tracking.js";

// Separate consent, stream and business-unit measurement for future Distribution pages.
// Never infer consent from Audiotel Premium Pro or use its existing GA4 ID.
const runtime=window.__PGI_DIRECT_SVA_MEASUREMENT__||{};
const MEASUREMENT_ID=String(runtime.measurementId||"").trim();
const STORAGE_KEY="pgi_dsva_analytics_consent_v1";
const MAX_AGE=180*24*60*60*1000;
const lang=["en","es","pt","de","it"].find(l=>location.pathname.startsWith("/distribution-sva/"+l+"/"))||"fr";
const TRANSLATIONS={
 fr:{heading:"Mesure du Pôle Télécom & Réseau",body:"Autorisez-vous des statistiques de navigation pour améliorer ce service ? Aucun numéro de téléphone, identifiant de dossier ou contenu de formulaire n'est transmis.",accept:"Autoriser",refuse:"Refuser",settings:"Préférences de statistiques"},
 en:{heading:"Telecom & Network Division analytics",body:"Allow anonymous navigation statistics to improve this service? No telephone numbers, account references or form content will be transmitted.",accept:"Allow",refuse:"Decline",settings:"Analytics preferences"},
 es:{heading:"Estadísticas del área de telecomunicaciones",body:"¿Autoriza estadísticas de navegación para mejorar el servicio? No se transmitirán números de teléfono, referencias de expedientes ni datos de formularios.",accept:"Autorizar",refuse:"Rechazar",settings:"Preferencias de estadísticas"},
 pt:{heading:"Estatísticas da área de telecomunicações",body:"Autoriza estatísticas de navegação para melhorar o serviço? Não serão enviados números de telefone, referências de processos nem conteúdos de formulários.",accept:"Autorizar",refuse:"Recusar",settings:"Preferências de estatísticas"},
 de:{heading:"Statistik für Telekommunikation & Netze",body:"Dürfen wir anonyme Nutzungsstatistiken erheben? Telefonnummern, Kundenakten und Formularinhalte werden nicht übertragen.",accept:"Erlauben",refuse:"Ablehnen",settings:"Statistik-Einstellungen"},
 it:{heading:"Statistiche della divisione telecomunicazioni",body:"Consente statistiche anonime di navigazione? Numeri di telefono, riferimenti dei fascicoli e contenuti dei moduli non vengono trasmessi.",accept:"Consenti",refuse:"Rifiuta",settings:"Preferenze statistiche"}
};
const words=TRANSLATIONS[lang];
const privatePage=/^\/distribution-sva\/(?:espace-client|conditions|confidentialite|mentions-legales)(?:\/|$)/.test(location.pathname);
const enabled=runtime.enabled===true&&runtime.dedicatedPropertyConfirmed===true&&
 runtime.customDimensionRegistered===true&&runtime.legalApproved===true&&runtime.directReleaseApproved===true&&
 /^G-[A-Z0-9]{8,}$/.test(MEASUREMENT_ID)&&MEASUREMENT_ID!=="G-SZY50J75N7"&&
 location.hostname==="audiotel-premium-pro.com"&&privatePage===false&&navigator.globalPrivacyControl!==true;
let tracker=null,denied=false,eventsBound=false,consentUI=null;
function preference(){
 try{
  const record=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
  if(!record||record.version!==1||!["accepted","refused"].includes(record.choice)||
     !Number.isFinite(record.timestamp)||Date.now()-record.timestamp<0||
     Date.now()-record.timestamp>MAX_AGE)return null;
  return record.choice;
 }catch{return null;}
}
function save(choice){
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,choice,timestamp:Date.now()}));}catch{}
}
function createLoader(url){
 const script=document.createElement("script");
 script.async=true;script.src=url;script.dataset.pgiUnit="direct_sva";
 document.head.appendChild(script);
}
function initTracking(){
 if(!enabled||denied)return false;
 if(tracker)return true;
 window.dataLayer=window.dataLayer||[];
 window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
 const candidate=createDirectSvaTracker({
  ga4:{enabled:true,consentGranted:true,legalApproved:true,customDimensionRegistered:true,
   dedicatedPropertyConfirmed:true,measurementId:MEASUREMENT_ID,gtag:window.gtag},
  locationRef:location,navigatorRef:navigator,documentRef:document,scriptLoader:createLoader
 });
 if(candidate.start().enabled!==true)return false;
 tracker=candidate;
 tracker.pageView(); // Exactly once, no sensitive query string or fragment.
 bindEvents();
 return true;
}
function track(name,type="distribution"){if(!enabled||denied||!tracker)return;tracker.event(name,type);}
function makeButton(text,className,action){
 const btn=document.createElement("button");btn.type="button";btn.className=className;btn.textContent=text;
 btn.addEventListener("click",action);return btn;
}
function closePanel(){consentUI?.remove();consentUI=null;}
function decline(){
 denied=true;save("refused");closePanel();
 // A user withdrawing consent must stop subsequent GA4 collection without
 // altering the independent Audiotel consent or clearing its GA4 cookies.
 if(tracker){
  window["ga-disable-"+MEASUREMENT_ID]=true;
  window.gtag?.("consent","update",{analytics_storage:"denied",ad_storage:"denied",
   ad_user_data:"denied",ad_personalization:"denied"});
 }
}
function accept(){
 denied=false;save("accepted");closePanel();
 window["ga-disable-"+MEASUREMENT_ID]=false;
 initTracking();
}
function promptPreference(){
 if(!enabled||consentUI)return;
 const region=document.createElement("aside");
 region.className="notice";region.setAttribute("role","region");
 region.setAttribute("aria-label",words.heading);
 region.style.cssText="position:fixed;z-index:40;bottom:16px;left:16px;right:16px;max-width:540px;padding:14px;box-shadow:0 8px 30px #0008";
 const title=document.createElement("strong");title.textContent=words.heading;
 const paragraph=document.createElement("p");paragraph.className="mini";paragraph.textContent=words.body;
 const actions=document.createElement("div");actions.className="actions";
 actions.append(makeButton(words.accept,"button",accept),makeButton(words.refuse,"button secondary",decline));
 region.append(title,paragraph,actions);document.body.appendChild(region);
 consentUI=region;
}
function createPreferenceControl(){
 const footer=document.querySelector("footer");if(!footer||footer.querySelector("[data-ds-analytics-preferences]"))return;
 const button=makeButton(words.settings,"ds-analytics-preferences",()=>{
  denied=true;
  if(tracker)window["ga-disable-"+MEASUREMENT_ID]=true;
  promptPreference();
 });
 button.dataset.dsAnalyticsPreferences="";
 footer.appendChild(button);
}
function bindEvents(){
 if(eventsBound)return;eventsBound=true;
 if("IntersectionObserver" in window){
  const observed=new Set();
  const observer=new IntersectionObserver(entries=>{
   for(const e of entries)if(e.isIntersecting&&!observed.has(e.target)){
    observed.add(e.target);track("dsva_section_view");observer.unobserve(e.target);
   }
  },{threshold:0.5});
  document.querySelectorAll("main section[id]").forEach(section=>observer.observe(section));
 }
 document.addEventListener("click",event=>{
  const link=event.target?.closest?.("a[href]");
  if(!link)return;
  const href=link.getAttribute("href")||"";
  if(link.hasAttribute("hreflang")&&href.startsWith("/distribution-sva/"))track("dsva_language_switch");
  else if(/\/(?:partenaires|partners)\//.test(href))track("dsva_partner_interest");
  else if(href.startsWith("/distribution-sva/espace-client/"))track("dsva_portal_access_attempt");
  else if(link.closest("nav"))track("dsva_navigation_click");
  else if(link.closest(".hero"))track("dsva_operator_interest");
 });
 document.addEventListener("toggle",event=>{
  if(event.target instanceof HTMLDetailsElement&&event.target.open)track("dsva_faq_open");
 },true);
 document.querySelectorAll("form[data-ds-prelaunch-form]").forEach(form=>{
  form.addEventListener("invalid",()=>track("dsva_form_error"),true);
 });
}
if(enabled){
 createPreferenceControl();
 const existing=preference();
 if(existing==="accepted")initTracking();
 else if(existing==="refused")denied=true;
 else promptPreference();
}

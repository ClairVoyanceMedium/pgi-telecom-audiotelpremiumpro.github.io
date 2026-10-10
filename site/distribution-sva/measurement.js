import {createDirectSvaTracker} from "/site/direct-sva-tracking.js";

// Future service only. This file is absent from today's production bundle.
// Private individuals, CRM identifiers, phone numbers and form contents are never transmitted.
const runtime=window.__PGI_DIRECT_SVA_MEASUREMENT__||{};
const enabled=runtime.enabled===true&&runtime.dedicatedPropertyConfirmed===true&&
 runtime.customDimensionRegistered===true&&runtime.legalApproved===true&&runtime.directReleaseApproved===true&&
 /^G-[A-Z0-9]{8,}$/.test(String(runtime.measurementId||""))&&
 runtime.measurementId!=="G-SZY50J75N7"&&navigator.globalPrivacyControl!==true;
let tracker=null,denied=false;
function createLoader(url){
 const script=document.createElement("script");
 script.async=true;script.src=url;script.dataset.pgiUnit="direct_sva";
 document.head.appendChild(script);
}
function initTracking(){
 window.dataLayer=window.dataLayer||[];
 window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
 tracker=createDirectSvaTracker({
  ga4:{enabled:true,consentGranted:true,legalApproved:true,
   customDimensionRegistered:true,dedicatedPropertyConfirmed:true,
   measurementId:runtime.measurementId,gtag:window.gtag},
  locationRef:location,navigatorRef:navigator,documentRef:document,
  scriptLoader:createLoader
 });
 return tracker.start().enabled===true;
}
function track(name,type="distribution"){if(denied||!tracker)return;tracker.event(name,type);}
function privacyChoice(){
 if(!enabled)return;
 const choice=document.createElement("aside");
 choice.className="notice";choice.setAttribute("role","region");
 choice.setAttribute("aria-label","Préférences de mesure du service de distribution");
 choice.style.cssText="position:fixed;z-index:40;bottom:16px;left:16px;right:16px;max-width:540px;box-shadow:0 8px 30px #0008";
 choice.innerHTML='<p><strong>Mesure de PGI Telecom Distribution</strong></p>'+
 '<p class="mini">Autoriser des statistiques anonymisées de navigation pour améliorer ce service ? Aucun contenu de formulaire ou numéro de téléphone ne sera envoyé.</p>'+
 '<div class="actions"><button type="button" class="button" data-ds-consent-accept>Autoriser</button>'+
 '<button type="button" class="button secondary" data-ds-consent-refuse>Refuser</button></div>';
 document.body.appendChild(choice);
 choice.querySelector("[data-ds-consent-refuse]").addEventListener("click",()=>{
  denied=true;choice.remove();
 });
 choice.querySelector("[data-ds-consent-accept]").addEventListener("click",()=>{
  choice.remove();
  if(initTracking())bindEvents();
 });
}
function bindEvents(){
 const observed=new Set();
 document.querySelectorAll("main section[id]").forEach(section=>{
  if(!("IntersectionObserver" in window))return;
  const observer=new IntersectionObserver(entries=>{
   for(const e of entries){
    if(e.isIntersecting&&!observed.has(e.target.id)){
     observed.add(e.target.id);track("dsva_section_view");
     observer.unobserve(e.target);
    }
   }
  },{threshold:0.5});
  observer.observe(section);
 });
 document.addEventListener("click",event=>{
  const link=event.target.closest("a[href]");
  if(link){
   if(link.closest("nav"))track("dsva_navigation_click");
   else if(link.getAttribute("href")?.includes("/espace-client/"))track("dsva_portal_access_attempt");
   else if(link.closest(".hero"))track("dsva_operator_interest");
  }
 });
 document.addEventListener("toggle",event=>{
  if(event.target instanceof HTMLDetailsElement&&event.target.open)track("dsva_faq_open");
 },true);
 document.querySelectorAll("form[data-ds-prelaunch-form]").forEach(form=>{
  form.addEventListener("invalid",()=>track("dsva_form_error"),true);
 });
}
privacyChoice();

// Future direct-distribution pages only. Not referenced by any existing HTML entrypoint.
// Does not load Google Analytics, set cookies or send network requests on import.
const RESERVED_PLATFORM_MEASUREMENT_ID="G-SZY50J75N7";
const EVENT_SPEC=Object.freeze({
 dsva_language_switch:"interest",
 dsva_partner_interest:"interest",
 dsva_operator_interest:"interest",
 dsva_navigation_click:"interest",
 dsva_section_view:"interest",
 dsva_faq_open:"interest",
 dsva_portal_access_attempt:"interest",
 dsva_form_error:"request_started",
 dsva_number_request_started:"request_started",
 dsva_number_request_submitted:"request_submitted",
 dsva_portability_request_submitted:"request_submitted",
 dsva_contract_accepted:"contract_accepted",
 dsva_number_activated:"number_activated"
});
const SERVICES=new Set(["numero_sva","portabilite","interconnexion","distribution"]);
const PUBLIC_FR_PATHS=new Set([
 "/distribution-sva/","/distribution-sva/solutions/","/distribution-sva/business-live/",
 "/distribution-sva/transition/","/distribution-sva/conformite/",
 "/distribution-sva/reclamations/","/distribution-sva/architecture-reseau/",
 "/distribution-sva/numerotation/","/distribution-sva/interconnexion-routage/",
 "/distribution-sva/releves-reversements/","/distribution-sva/partenaires/",
 "/distribution-sva/questions-frequentes/"
]);
function publicDirectPath(path){
 if(PUBLIC_FR_PATHS.has(path))return true;
 return /^\/distribution-sva\/(?:en|es|pt|de|it)\/(?:solutions\/|faq\/|partners\/)?$/.test(path);
}


export function createDirectSvaTracker({ga4,documentRef,locationRef,navigatorRef,scriptLoader}={}){
 const measurement=String(ga4?.measurementId||"").trim();
 const path=String(locationRef?.pathname||"").split(/[?#]/,1)[0];
 const privatePath=/^\/distribution-sva\/(?:espace-client|conditions|confidentialite|mentions-legales)(?:\/|$)/i.test(path);
 const trustedHost=locationRef?.hostname==null||locationRef.hostname==="audiotel-premium-pro.com";
 const permitted=ga4?.enabled===true&&ga4?.consentGranted===true&&ga4?.legalApproved===true&&
  ga4?.customDimensionRegistered===true&&ga4?.dedicatedPropertyConfirmed===true&&
  /^G-[A-Z0-9]{8,}$/.test(measurement)&&measurement!==RESERVED_PLATFORM_MEASUREMENT_ID&&
  publicDirectPath(path)&&!privatePath&&trustedHost&&
  navigatorRef?.globalPrivacyControl!==true;
 const reason=!permitted?"DIRECT_SVA_GA4_INACTIVE_OR_UNVERIFIED":"EXPLICITLY_APPROVED";
 let started=false,pageviewSent=false;
 function event(name,service){
  const stage=EVENT_SPEC[name];
  if(!stage||!SERVICES.has(service))return {accepted:false,reason:"INVALID_DIRECT_SVA_EVENT"};
  if(!permitted||!started)return {accepted:false,reason:"DIRECT_SVA_GA4_DISABLED"};
  const gtag=ga4?.gtag;
  if(typeof gtag!=="function")return {accepted:false,reason:"DIRECT_SVA_GTAG_UNAVAILABLE"};
  // Restrict every event to Distribution property even if shared gtag exists.
  // All identifiers are static enums. No CRM identifier or user-provided strings.
  gtag("event",name,{send_to:measurement,pgi_business_unit:"direct_sva",
   pgi_funnel_stage:stage,pgi_service_type:service});
  return {accepted:true};
 }
 function pageView(){
  if(!permitted||!started)return {accepted:false,reason:"DIRECT_SVA_GA4_DISABLED"};
  if(pageviewSent)return {accepted:false,reason:"DIRECT_SVA_GA4_PAGEVIEW_DUPLICATE"};
  if(typeof ga4?.gtag!=="function")return {accepted:false,reason:"DIRECT_SVA_GTAG_UNAVAILABLE"};
  // No query string or fragment, which can contain sensitive identifiers.
  // This explicit event compensates for send_page_view:false in the config.
  ga4.gtag("event","page_view",{
   send_to:measurement,page_location:"https://audiotel-premium-pro.com"+path,
   pgi_business_unit:"direct_sva",pgi_funnel_stage:"interest",pgi_service_type:"distribution"
  });
  pageviewSent=true;
  return {accepted:true};
 }
 function start(){
  if(!permitted)return {enabled:false,reason};
  if(started)return {enabled:true,reused:true};
  if(!documentRef||typeof scriptLoader!=="function"||typeof ga4?.gtag!=="function"){
   return {enabled:false,reason:"DIRECT_SVA_GA4_RUNTIME_MISSING"};
  }
  ga4.gtag("consent","default",{analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
  scriptLoader("https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(measurement),documentRef);
  ga4.gtag("js",new Date());
  ga4.gtag("consent","update",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
  ga4.gtag("config",measurement,{send_page_view:false,cookie_prefix:"pgi_dsva",allow_google_signals:false,allow_ad_personalization_signals:false});
  started=true;
  return {enabled:true,property:"dedicated_direct_sva",pageview_suppressed:true};
 }
 return Object.freeze({enabled:permitted,reason,start,event,pageView});
}

export const DIRECT_SVA_EVENT_SPEC=EVENT_SPEC;

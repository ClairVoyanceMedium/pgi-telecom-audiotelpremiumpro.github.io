// Future direct-distribution pages only. Not referenced by any existing HTML entrypoint.
// Does not load Google Analytics, set cookies or send network requests on import.
const RESERVED_PLATFORM_MEASUREMENT_ID="G-SZY50J75N7";
const EVENT_SPEC=Object.freeze({
 dsva_operator_interest:"interest",
 dsva_number_request_started:"request_started",
 dsva_number_request_submitted:"request_submitted",
 dsva_portability_request_submitted:"request_submitted",
 dsva_contract_accepted:"contract_accepted",
 dsva_number_activated:"number_activated"
});
const SERVICES=new Set(["numero_sva","portabilite","interconnexion","distribution"]);

export function createDirectSvaTracker({ga4,documentRef,locationRef,navigatorRef,scriptLoader}={}){
 const measurement=String(ga4?.measurementId||"").trim();
 const path=String(locationRef?.pathname||"");
 const permitted=ga4?.enabled===true&&ga4?.consentGranted===true&&ga4?.legalApproved===true&&
  ga4?.customDimensionRegistered===true&&ga4?.dedicatedPropertyConfirmed===true&&
  /^G-[A-Z0-9]{8,}$/.test(measurement)&&measurement!==RESERVED_PLATFORM_MEASUREMENT_ID&&
  /^\/distribution-sva(?:\/|$)/.test(path)&&navigatorRef?.globalPrivacyControl!==true;
 const reason=!permitted?"DIRECT_SVA_GA4_INACTIVE_OR_UNVERIFIED":"EXPLICITLY_APPROVED";
 let started=false;
 function event(name,service){
  const stage=EVENT_SPEC[name];
  if(!stage||!SERVICES.has(service))return {accepted:false,reason:"INVALID_DIRECT_SVA_EVENT"};
  if(!permitted||!started)return {accepted:false,reason:"DIRECT_SVA_GA4_DISABLED"};
  const gtag=ga4?.gtag;
  if(typeof gtag!=="function")return {accepted:false,reason:"DIRECT_SVA_GTAG_UNAVAILABLE"};
  // All parameters are generated from strict enums. No caller, email, phone or dossier data.
  gtag("event",name,{pgi_business_unit:"direct_sva",pgi_funnel_stage:stage,pgi_service_type:service});
  return {accepted:true};
 }
 function start(){
  if(!permitted)return {enabled:false,reason};
  if(started)return {enabled:true,reused:true};
  if(!documentRef||typeof scriptLoader!=="function"||typeof ga4?.gtag!=="function"){
   return {enabled:false,reason:"DIRECT_SVA_GA4_RUNTIME_MISSING"};
  }
  // A dedicated property only. Existing Audiotel tracking is excluded from this path.
  ga4.gtag("consent","default",{analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
  scriptLoader("https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(measurement),documentRef);
  ga4.gtag("js",new Date());
  ga4.gtag("consent","update",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
  ga4.gtag("config",measurement,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
  started=true;
  return {enabled:true,property:"dedicated_direct_sva",pageview_suppressed:true};
 }
 return Object.freeze({enabled:permitted,reason,start,event});
}

export const DIRECT_SVA_EVENT_SPEC=EVENT_SPEC;

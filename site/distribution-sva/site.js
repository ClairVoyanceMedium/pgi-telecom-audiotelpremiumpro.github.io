// Dedicated distribution direct public UI. This file is not packaged before explicit release.
(() => {
 "use strict";
 const badge=document.querySelector("[data-ds-service-state]");
 if(badge)badge.textContent="PGI Telecom Distribution en préparation";
 const currentYear=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric"}).format(new Date());
 document.querySelectorAll("[data-ds-year]").forEach(n=>n.textContent=currentYear);
 const activePath=location.pathname;
 document.querySelectorAll('.menu a[href]').forEach(a=>{
  const href=a.getAttribute("href");if(href===activePath)a.setAttribute("aria-current","page");
 });
 // One consent-gated measurement adapter for all future public language pages.
 // The existing Audiotel measurement property must never be reused by this unit.
 const analytics=window.__PGI_DIRECT_SVA_MEASUREMENT__;
 const privatelyScoped=new RegExp("^/distribution-sva/(?:espace-client|conditions|confidentialite|mentions-legales)(?:/|$)","i").test(location.pathname);
 if(!privatelyScoped&&analytics?.enabled===true&&analytics?.directReleaseApproved===true&&
    analytics?.dedicatedPropertyConfirmed===true&&analytics?.customDimensionRegistered===true&&
    analytics?.legalApproved===true&&/^G-[A-Z0-9]{8,}$/.test(String(analytics?.measurementId||""))&&
    analytics.measurementId!=="G-SZY50J75N7"&&navigator.globalPrivacyControl!==true&&
    !document.querySelector('script[src*="/site/distribution-sva/measurement.js"]')){
   const script=document.createElement("script");
   script.type="module";
   script.src="/site/distribution-sva/measurement.js";
   document.head.appendChild(script);
 }
 // Marketing forms are not activated until API, consent, CRM and legal gates are verified.
 document.querySelectorAll("form[data-ds-prelaunch-form]").forEach(form=>{
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const status=form.querySelector("[role=status]");
    if(status)status.textContent="Aucune demande envoyée. La souscription directe sera ouverte après les validations nécessaires.";
  });
 });
})();

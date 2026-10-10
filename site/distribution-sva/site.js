// Dedicated distribution direct public UI. This file is not packaged before explicit release.
(() => {
 "use strict";
 const badge=document.querySelector("[data-ds-service-state]");
 if(badge)badge.textContent="Projet de distribution directe en préparation";
 const currentYear=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric"}).format(new Date());
 document.querySelectorAll("[data-ds-year]").forEach(n=>n.textContent=currentYear);
 const activePath=location.pathname;
 document.querySelectorAll('.menu a[href]').forEach(a=>{
  const href=a.getAttribute("href");if(href===activePath)a.setAttribute("aria-current","page");
 });
 // Marketing forms are not activated until API, consent, CRM and legal gates are verified.
 document.querySelectorAll("form[data-ds-prelaunch-form]").forEach(form=>{
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const status=form.querySelector("[role=status]");
    if(status)status.textContent="Aucune demande envoyée. La souscription directe sera ouverte après les validations nécessaires.";
  });
 });
})();

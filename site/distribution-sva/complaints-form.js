// Future direct SVA complaint intake. The form remains disabled unless the
// server explicitly proves all release/notification/legal gates are satisfied.
// Never send personal complaint text to GA4 or a third-party browser endpoint.
(async()=>{
 "use strict";
 const form=document.querySelector("[data-ds-complaint-form]");
 if(!form)return;
 const fieldset=form.querySelector("fieldset"),status=form.querySelector("[role=status]");
 const submit=form.querySelector('[type="submit"]');
 const request=async(url,options={})=>{
  const response=await fetch(url,{...options,credentials:"same-origin",cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body?.error?.code||"RECLAMATION_INDISPONIBLE");
  return body;
 };
 let released=false;
 try{
  const capability=await request("/api/v1/public/direct-sva/complaints/capabilities");
  released=capability.intake_enabled===true&&
   capability.legal_review_approved===true&&
   capability.notification_channel_verified===true&&
   capability.customer_receipt_enabled===true;
 }catch{released=false;}
 if(!released){
  fieldset.disabled=true;
  status.textContent="Le dépôt de réclamations pour la future distribution directe n'est pas encore ouvert. Aucun message n'est envoyé depuis ce formulaire de préparation.";
  return;
 }
 fieldset.disabled=false;
 status.textContent="Formulaire sécurisé de réclamation disponible.";
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!released||fieldset.disabled)return;
  const data=new FormData(form);
  const payload={
   email:String(data.get("email")||"").trim(),
   category:String(data.get("category")||""),
   subject:String(data.get("subject")||"").trim(),
   message:String(data.get("message")||"").trim(),
   processing_notice_acknowledged:data.get("processing_notice_acknowledged")==="yes",
   website:String(data.get("website")||"")
  };
  fieldset.disabled=true;submit.setAttribute("aria-busy","true");
  status.textContent="Enregistrement de votre réclamation...";
  try{
   const result=await request("/api/v1/public/direct-sva/complaints",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
    body:JSON.stringify(payload)
   });
   if(result.accepted!==true||!/^DSVA-RCL-[0-9A-F-]{36}$/.test(String(result.reference||"")))
    throw Error("RECEPTION_NON_CONFIRMEE");
   form.reset();
   status.textContent="Réclamation enregistrée sous la référence "+result.reference+
    ". Un accusé de réception sera envoyé à votre adresse selon les conditions applicables.";
  }catch{
   status.textContent="Votre réclamation n'a pas été confirmée. Aucun accusé de réception ne doit être présumé. Merci de réessayer ou de contacter le service clients par un canal vérifié.";
  }finally{
   fieldset.disabled=false;submit.removeAttribute("aria-busy");
  }
 });
})();

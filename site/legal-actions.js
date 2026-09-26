(()=>{
  "use strict";
  const form=document.getElementById("consumer-withdrawal-form");
  if(!form)return;
  const summary=document.getElementById("consumer-withdrawal-summary");
  const result=document.getElementById("consumer-withdrawal-result");
  const status=document.getElementById("consumer-withdrawal-status");
  const confirmButton=document.getElementById("consumer-withdrawal-confirm");
  const backButton=document.getElementById("consumer-withdrawal-back");
  let pending=null,idempotencyKey=null;

  const value=id=>String(document.getElementById(id)?.value||"").trim();
  const setText=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
  const uuid=()=>crypto?.randomUUID?crypto.randomUUID():"00000000-0000-4000-8000-"+Date.now().toString(16).padStart(12,"0").slice(-12);

  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    pending={
      first_name:value("withdrawal-first-name"),
      last_name:value("withdrawal-last-name"),
      acknowledgement_email:value("withdrawal-email"),
      contract_reference:value("withdrawal-contract-reference"),
      website:value("withdrawal-website"),
      confirmed:true
    };
    idempotencyKey=uuid();
    setText("withdrawal-summary-name",pending.first_name+" "+pending.last_name);
    setText("withdrawal-summary-email",pending.acknowledgement_email);
    setText("withdrawal-summary-contract",pending.contract_reference);
    form.hidden=true;result.hidden=true;summary.hidden=false;
    confirmButton?.focus();
  });

  backButton?.addEventListener("click",()=>{
    summary.hidden=true;result.hidden=true;form.hidden=false;pending=null;idempotencyKey=null;
    document.getElementById("withdrawal-first-name")?.focus();
  });

  confirmButton?.addEventListener("click",async()=>{
    if(!pending||!idempotencyKey)return;
    confirmButton.disabled=true;
    const original=confirmButton.textContent;
    confirmButton.textContent="Enregistrement…";
    if(status){status.textContent="";status.classList.remove("error");}
    try{
      const response=await fetch("/api/v1/public/consumer-withdrawal",{
        method:"POST",
        credentials:"same-origin",
        headers:{"content-type":"application/json","idempotency-key":idempotencyKey},
        body:JSON.stringify(pending)
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error("WITHDRAWAL_FAILED"),{code:body?.error?.code||"WITHDRAWAL_FAILED"});
      setText("withdrawal-result-reference",body.reference||"—");
      setText("withdrawal-result-time",body.received_at?new Date(body.received_at).toLocaleString("fr-FR"):"—");
      setText("withdrawal-result-email",pending.acknowledgement_email);
      summary.hidden=true;result.hidden=false;
      if(status)status.textContent=body?.acknowledgement?.state==="accepted"
        ?"Votre déclaration est enregistrée et l’accusé de réception électronique a été remis au prestataire d’envoi."
        :"Votre déclaration est enregistrée. L’accusé de réception électronique est en cours d’acheminement.";
      pending=null;
    }catch(error){
      if(status){
        status.classList.add("error");
        status.textContent=error?.code==="LEGAL_ACTION_RATE_LIMITED"
          ?"Trop de demandes ont été envoyées depuis cette connexion. Utilisez le canal email indiqué ci-dessous si nécessaire."
          :"La demande n’a pas pu être enregistrée. Réessayez ou utilisez immédiatement le canal email de secours indiqué sur cette page.";
      }
    }finally{
      confirmButton.disabled=false;
      confirmButton.textContent=original;
    }
  });
})();

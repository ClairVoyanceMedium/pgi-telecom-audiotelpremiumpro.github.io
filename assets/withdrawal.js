(function(){
"use strict";

const form=document.getElementById("withdrawal-form");
const review=document.getElementById("withdrawal-review");
const status=document.getElementById("withdrawal-status");
const continueButton=document.getElementById("withdrawal-review-button");
const confirmButton=document.getElementById("withdrawal-confirm-button");
const backButton=document.getElementById("withdrawal-back-button");
if(!form||!review||!status||!continueButton||!confirmButton||!backButton)return;

let busy=false;
const fields=["first_name","last_name","contract_email","acknowledgement_email","contract_reference","contract_date","contract_details"];

function value(name){
  const el=form.elements.namedItem(name);
  return el?String(el.value||"").trim():"";
}
function apiBase(){
  const configured=window.PGI_CONFIG&&window.PGI_CONFIG.apiBaseUrl?String(window.PGI_CONFIG.apiBaseUrl):"/api/v1";
  return configured.replace(/\/$/,"");
}
function idempotencyKey(){
  if(window.crypto&&typeof window.crypto.randomUUID==="function")return window.crypto.randomUUID();
  throw new Error("SECURE_BROWSER_REQUIRED");
}
function setStatus(message,kind){
  status.textContent=message||"";
  status.dataset.state=kind||"";
  status.hidden=!message;
}
function summaryLine(label,text){
  const row=document.createElement("div");
  row.className="withdrawal-summary-row";
  const strong=document.createElement("strong");
  strong.textContent=label;
  const span=document.createElement("span");
  span.textContent=text||"Non renseigné";
  row.append(strong,span);
  return row;
}
function payload(){
  return {
    first_name:value("first_name"),
    last_name:value("last_name"),
    contract_email:value("contract_email"),
    acknowledgement_email:value("acknowledgement_email"),
    contract_reference:value("contract_reference"),
    contract_date:value("contract_date"),
    contract_details:value("contract_details"),
    website:value("website"),
    confirmed:true,
    legal_version:"2026-09-26-b2b-b2c-v3"
  };
}
function showReview(){
  if(!form.reportValidity())return;
  if(value("website"))return;
  const box=review.querySelector("[data-withdrawal-summary]");
  box.replaceChildren(
    summaryLine("Nom",value("first_name")+" "+value("last_name")),
    summaryLine("E-mail du contrat",value("contract_email")),
    summaryLine("Accusé de réception",value("acknowledgement_email")),
    summaryLine("Référence",value("contract_reference")||"Non renseignée"),
    summaryLine("Date du contrat",value("contract_date")||"Non renseignée"),
    summaryLine("Contrat / service",value("contract_details"))
  );
  form.hidden=true;
  review.hidden=false;
  setStatus("");
  review.focus();
}
function back(){
  if(busy)return;
  review.hidden=true;
  form.hidden=false;
  setStatus("");
  continueButton.focus();
}
async function submit(){
  if(busy)return;
  busy=true;
  confirmButton.disabled=true;
  backButton.disabled=true;
  confirmButton.textContent="Transmission en cours…";
  setStatus("Transmission sécurisée de votre déclaration…","pending");
  try{
    const response=await fetch(apiBase()+"/public/withdrawal",{
      method:"POST",
      credentials:"same-origin",
      cache:"no-store",
      headers:{
        "Accept":"application/json",
        "Content-Type":"application/json",
        "Idempotency-Key":idempotencyKey()
      },
      body:JSON.stringify(payload())
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error("WITHDRAWAL_SUBMISSION_FAILED"),{status:response.status,code:data&&data.error&&data.error.code});
    const submitted=data.submitted_at?new Date(data.submitted_at):null;
    const when=submitted&&!Number.isNaN(submitted.getTime())?submitted.toLocaleString("fr-FR",{dateStyle:"long",timeStyle:"medium"}):"à l’instant";
    review.hidden=true;
    form.hidden=true;
    setStatus("Votre rétractation est enregistrée sous la référence "+String(data.reference||"")+" le "+when+". Un accusé de réception reprenant votre déclaration est envoyé à l’adresse indiquée.","success");
    const heading=document.getElementById("renoncer-contrat");
    if(heading)heading.scrollIntoView({block:"start",behavior:"smooth"});
  }catch(error){
    const unavailable=error&&error.code==="ONLINE_WITHDRAWAL_UNAVAILABLE";
    setStatus(unavailable?"La fonctionnalité de rétractation est temporairement indisponible. Utilisez également l’adresse support@audiotel-premium-pro.com afin de conserver une trace datée de votre demande.":"La transmission n’a pas abouti. Vérifiez votre connexion puis recommencez. Si le problème persiste, écrivez à support@audiotel-premium-pro.com.","error");
    confirmButton.disabled=false;
    backButton.disabled=false;
    confirmButton.textContent="Confirmer la rétractation";
    busy=false;
  }
}

continueButton.addEventListener("click",showReview);
backButton.addEventListener("click",back);
confirmButton.addEventListener("click",submit);
form.addEventListener("submit",function(event){event.preventDefault();showReview();});
const contractEmail=form.elements.namedItem("contract_email");
const acknowledgement=form.elements.namedItem("acknowledgement_email");
if(contractEmail&&acknowledgement){
  contractEmail.addEventListener("blur",function(){
    if(!String(acknowledgement.value||"").trim())acknowledgement.value=String(contractEmail.value||"").trim();
  });
}
})();

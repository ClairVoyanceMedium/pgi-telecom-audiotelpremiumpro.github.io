let o={getDemo:()=>false,getData:()=>({}),reload:async()=>{},toast:()=>{},locale:"fr-FR"},busy=false,ready=false;
const $=id=>document.getElementById(id);
const eligible=s=>["submitted","awaiting_documents","eligibility_check","operator_pending","scheduled"].includes(String(s||"").toLowerCase());
function mount(){
  if($("portability-priority"))return;
  const before=$("portability-source-contract")?.closest("label");if(!before)return;
  const row=document.createElement("div");row.className="cp-row";row.style.alignItems="flex-start";
  row.innerHTML='<div><strong>Portabilité prioritaire PGI Telecom</strong><span>9,90 € TTC, paiement unique. Priorité sur notre traitement administratif uniquement, sans garantie ni réduction du délai opérateur.</span></div><label class="cp-check" style="margin:0"><input id="portability-priority" type="checkbox"><span>Ajouter</span></label>';
  before.parentNode.insertBefore(row,before);
}
function decorate(data){
  const rows=data?.portability_requests||[],cards=[...document.querySelectorAll("#portability-list .cp-portability-row")];
  rows.forEach((x,i)=>{const card=cards[i],actions=card?.querySelector(".cp-portability-actions");if(!actions)return;
    const p=String(x.priority_status||"none").toLowerCase();
    if(p==="paid"){const b=document.createElement("span");b.className="cp-chip ok";b.textContent="PRIORITAIRE PGI";actions.prepend(b);return}
    if(!eligible(x.status))return;
    const b=document.createElement("button");b.type="button";b.className="cp-portability-priority";b.dataset.portabilityPriority=String(x.id);b.textContent=p==="checkout_open"?"Reprendre le paiement 9,90 €":"Passer en prioritaire 9,90 €";actions.appendChild(b);
  });
}
function message(c){return ({PORTABILITY_PRIORITY_ALREADY_PAID:"Le traitement prioritaire est déjà activé.",PORTABILITY_PRIORITY_PAYMENT_PROCESSING:"Le paiement est déjà en cours de traitement.",PORTABILITY_PRIORITY_NOT_AVAILABLE:"Le traitement prioritaire n’est plus disponible pour ce dossier.",PAYMENT_PROVIDER_UNAVAILABLE:"Le paiement prioritaire est momentanément indisponible.",PAYMENT_ACCOUNT_NOT_READY:"Le paiement prioritaire est momentanément indisponible.",STRIPE_CHECKOUT_URL_INVALID:"Le paiement prioritaire n’a pas pu être ouvert."})[c]||"Le paiement prioritaire n’a pas pu être ouvert."}
async function checkout(id,button){
  if(busy)return false;if(o.getDemo()){o.toast("Le paiement prioritaire à 9,90 € TTC est disponible uniquement en production.");return false}busy=true;
  const old=button?.textContent;if(button)button.disabled=true;
  try{const r=await window.PGICustomerApi.createPortabilityPriorityCheckout(id,window.PGICustomerApi.newIdempotencyKey()),url=r?.checkout?.url;if(!url||!/^https:\/\/checkout\.stripe\.com\//i.test(url))throw Object.assign(new Error("STRIPE_CHECKOUT_URL_INVALID"),{code:"STRIPE_CHECKOUT_URL_INVALID"});location.assign(url);return true}
  catch(e){o.toast(message(e?.code));return false}finally{busy=false;if(button){button.disabled=false;if(old!=null)button.textContent=old}}
}
function payload(){
  const rate=String($("portability-rate")?.value||"").trim();
  return {country_code:$("portability-country").value,number:$("portability-number").value.trim(),rio:$("portability-rio").value.trim(),current_operator_name:$("portability-operator").value.trim(),current_operator_reference:$("portability-reference").value.trim(),account_holder_name:$("portability-holder").value.trim(),desired_port_date:$("portability-date").value||null,service_rate_ttc_per_min:rate===""?null:Number(rate.replace(",",".")),tariff_code:$("portability-tariff-code").value.trim(),service_family:$("portability-service-family").value,number_owner_confirmed:true,authorization_confirmed:true,source_contract_liability_acknowledged:true};
}
async function submit(e){
  if(!$("portability-priority")?.checked)return;
  e.preventDefault();e.stopImmediatePropagation();if(busy)return;
  const msg=$("portability-message"),btn=$("portability-submit");msg.textContent="";msg.classList.remove("bad");
  if(!$("portability-owner-confirmed").checked||!$("portability-authority-confirmed").checked||!$("portability-source-contract").checked){msg.classList.add("bad");msg.textContent="Les trois confirmations sont nécessaires pour ouvrir le dossier.";return}
  if(o.getDemo()){msg.textContent="La portabilité gratuite et l’option prioritaire à 9,90 € TTC sont prêtes.";return}
  busy=true;btn.disabled=true;const old=btn.textContent;btn.textContent="Envoi en cours…";
  try{const created=await window.PGICustomerApi.createPortability(payload(),window.PGICustomerApi.newIdempotencyKey());btn.textContent="Ouverture du paiement…";busy=false;if(await checkout(created.id,btn))return;await o.reload();o.toast("Demande gratuite enregistrée. L’option prioritaire n’a pas été activée.")}
  catch(err){msg.classList.add("bad");msg.textContent="La demande de portabilité n’a pas pu être enregistrée."}
  finally{busy=false;btn.disabled=false;btn.textContent=old}
}
function rerender(data){mount();decorate(data||o.getData())}
export function init(next={}){
  if(ready)return;ready=true;o={...o,...next};mount();
  $("client-portability-form")?.addEventListener("submit",submit,true);
  $("portability-list")?.addEventListener("click",e=>{const b=e.target.closest("[data-portability-priority]");if(!b)return;e.preventDefault();e.stopImmediatePropagation();checkout(b.dataset.portabilityPriority,b)},true);
  document.addEventListener("pgi:portal-loaded",e=>rerender(e.detail?.data));rerender(o.getData());
}

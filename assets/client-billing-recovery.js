(function(root){
"use strict";
const $=id=>document.getElementById(id);
const tr=s=>root.PGIClientI18n?.t?root.PGIClientI18n.t(s):s;
const fmt=(v,withTime=false)=>{if(!v)return "";const d=new Date(v);if(!Number.isFinite(d.getTime()))return "";try{return new Intl.DateTimeFormat(root.PGIClientI18n?.locale||"fr-FR",withTime?{dateStyle:"short",timeStyle:"short"}:{dateStyle:"medium"}).format(d);}catch{return d.toLocaleString();}};
let busy=false;
async function openPortal(){
  if(busy)return;
  const b=$("client-billing-recovery-action"),old=b?.textContent||"";
  busy=true;if(b){b.disabled=true;b.textContent=tr("Ouverture de la facturation…");}
  try{
    const r=await root.PGICustomerApi.createBillingPortal(),u=new URL(r.url,location.href);
    if(u.protocol!=="https:")throw new Error("INVALID_BILLING_URL");
    location.href=u.href;
  }catch{
    const txt=$("client-billing-recovery-text");if(txt)txt.textContent=tr("Impossible d’ouvrir la facturation. Réessayez depuis « Gérer la facturation ».");
    if(b){b.disabled=false;b.textContent=old;}
    busy=false;
  }
}
function render(data={},provider={}){
  const box=$("client-billing-recovery");if(!box)return;
  const r=data.billing_summary?.recovery||null,s=String(r?.state||"").toLowerCase(),attention=r&&!["healthy","recovered"].includes(s);
  box.hidden=!attention;box.classList.toggle("is-critical",Boolean(attention&&(r.service_suspended||s==="suspended")));
  if(!attention)return;
  let title=tr("Paiement à régulariser"),parts=[];
  if(s==="action_required"){title=tr("Validation bancaire requise");parts.push(tr("Votre banque demande une action pour finaliser le renouvellement."));}
  else if(r.service_suspended||s==="suspended"){title=tr("Accès SVA suspendu temporairement");parts.push(tr("La période de grâce est terminée. Votre espace, vos factures et vos reversements acquis restent accessibles."));}
  else parts.push(tr("Votre service reste actif pendant la période de grâce."));
  if(r.grace_until&&!r.service_suspended)parts.push(tr("Grâce jusqu’au")+" "+fmt(r.grace_until)+".");
  if(r.next_retry_at)parts.push(tr("Prochaine tentative automatique")+" "+fmt(r.next_retry_at,true)+".");
  if(Number(r.attempt_count)>0)parts.push(tr("Tentative")+" "+new Intl.NumberFormat(root.PGIClientI18n?.locale||"fr-FR").format(Number(r.attempt_count))+".");
  if(r.recovery_deadline)parts.push(tr("Récupération automatique suivie jusqu’au")+" "+fmt(r.recovery_deadline)+".");
  $("client-billing-recovery-title").textContent=title;
  $("client-billing-recovery-text").textContent=parts.join(" ");
  const b=$("client-billing-recovery-action");if(b){b.disabled=!provider.customer_portal_available;b.setAttribute("aria-disabled",String(!provider.customer_portal_available));}
}
root.PGIBillingRecovery=Object.freeze({render});
document.addEventListener("DOMContentLoaded",()=>{$("client-billing-recovery-action")?.addEventListener("click",openPortal);},{once:true});
})(window);

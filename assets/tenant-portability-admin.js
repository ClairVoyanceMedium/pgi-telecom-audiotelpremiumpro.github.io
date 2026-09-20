export {renderPayoutTermsSection,runPayoutTermsAction,payoutTermsError} from "./tenant-payout-admin.js";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(Number(v)||0);}catch{return (Number(v)||0).toFixed(2)+" "+c;}};
const date=v=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"—";};
const datetimeLocal=v=>{if(!v)return"";const d=new Date(v);if(!Number.isFinite(d.getTime()))return"";const z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes());};
const labels={pending:"En attente",verified:"Vérifié",rejected:"Rejeté",submitted:"Demande reçue",awaiting_documents:"Justificatifs requis",eligibility_check:"Éligibilité",operator_pending:"Attente opérateur",scheduled:"Planifiée",ported:"Portée",cancelled:"Annulée"};
const lab=v=>labels[v]||v||"—";
const chip=v=>'<span class="td-chip '+esc(v||"neutral")+'">'+esc(lab(v))+"</span>";
const options=(values,current)=>values.map(v=>'<option value="'+esc(v)+'" '+(v===current?"selected":"")+'>'+esc(lab(v))+"</option>").join("");

let styled=false;
function ensureStyle(){
  if(styled||document.getElementById("tenant-portability-admin-style"))return;styled=true;
  const s=document.createElement("style");s.id="tenant-portability-admin-style";s.textContent=".td-port-list{display:grid;gap:8px}.td-port-card{padding:11px;border:1px solid rgba(53,216,255,.13);border-radius:12px;background:rgba(8,19,31,.82)}.td-port-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.td-port-head strong{display:block;font-size:10px}.td-port-head small{display:block;margin-top:4px;color:#71869a;font-size:7px}.td-port-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:9px}.td-port-grid label{display:grid;gap:4px;color:#6f8599;font-size:6.5px;font-weight:850;text-transform:uppercase}.td-port-grid input,.td-port-grid select{width:100%;min-height:38px;padding:7px;border:1px solid #253447;border-radius:9px;background:#07101b;color:#e2eef6;font-size:10px}.td-port-note{margin:8px 0 0;color:#6f8599;font-size:7.5px;line-height:1.45}.td-port-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}@media(max-width:900px){.td-port-grid{grid-template-columns:1fr 1fr}}@media(max-width:700px){.td-port-grid{grid-template-columns:1fr}.td-port-grid input,.td-port-grid select{min-height:44px;font-size:16px}}";document.head.appendChild(s);
}

export function renderPortabilitySection(rows=[],carrierAdmin={}){
  ensureStyle();
  const route=carrierAdmin.route||{},activeCarrierId=route.active_carrier_id||"",activeCarrierName=route.active_carrier||"Aucun opérateur SVA actif";
  const cards=rows.map(p=>{
    const final=["ported","cancelled"].includes(p.status),canComplete=p.status==="scheduled";
    const detail=[p.current_operator_name?"Opérateur actuel : "+p.current_operator_name:null,p.current_operator_reference?"Réf. ancien opérateur : "+p.current_operator_reference:null,p.rio_validation_status==="verified"?"RIO validé":null,p.source_contract_transfer_mode==="none"?"Ancien contrat non repris":null,p.desired_port_date?"Date souhaitée : "+date(p.desired_port_date):null,p.target_carrier?"Cible : "+p.target_carrier:null].filter(Boolean).join(" • ");
    if(final)return '<div class="td-port-card"><div class="td-port-head"><div><strong>'+esc(p.display_number||p.requested_e164)+'</strong><small>'+esc(detail||p.country_code||"")+'</small></div>'+chip(p.status)+'</div><p class="td-port-note">Tarif conservé : '+esc(money(p.service_rate_ttc_per_min,p.currency))+'/min • '+esc(p.tariff_code||"code tarifaire —")+' • '+esc(lab(p.tariff_verification_status))+(p.completed_at?" • Finalisée "+esc(date(p.completed_at)):"")+"</p></div>";
    return '<div class="td-port-card" data-portability-card="'+esc(p.id)+'" data-active-carrier-id="'+esc(activeCarrierId)+'"><div class="td-port-head"><div><strong>'+esc(p.display_number||p.requested_e164)+'</strong><small>'+esc(detail||p.country_code||"")+'</small></div>'+chip(p.status)+'</div>'+
      '<div class="td-port-grid"><label>État<select data-port-status>'+options(["submitted","awaiting_documents","eligibility_check","operator_pending","scheduled","rejected","cancelled"],p.status)+'</select></label>'+
      '<label>Titularité<select data-port-owner>'+options(["pending","verified","rejected"],p.ownership_status)+'</select></label>'+
      '<label>Contrôle tarif<select data-port-tariff-status>'+options(["pending","verified","rejected"],p.tariff_verification_status||"pending")+'</select></label>'+
      '<label>Tarif TTC/min<input data-port-rate type="number" min="0" max="10000" step="0.000001" value="'+esc(p.service_rate_ttc_per_min??"")+'"></label>'+
      '<label>Code tarifaire<input data-port-code maxlength="80" value="'+esc(p.tariff_code||"")+'"></label>'+
      '<label>Réf. opérateur<input data-port-ref maxlength="200" value="'+esc(p.operator_portability_reference||"")+'"></label>'+
      '<label>Date de bascule<input data-port-schedule type="datetime-local" value="'+esc(datetimeLocal(p.scheduled_at))+'"></label>'+
      '<label>Opérateur cible<input value="'+esc(activeCarrierName)+'" readonly></label></div>'+
      '<p class="td-port-note">Le numéro E.164 reste '+esc(p.requested_e164)+'. La bascule finale est bloquée tant que titularité, RIO France, séparation de l’ancien contrat, tarif, KYC, abonnement et route opérateur ne sont pas validés.</p>'+
      '<div class="td-port-actions"><button class="td-btn success" data-portability-save="'+esc(p.id)+'">Enregistrer le dossier</button>'+(canComplete?'<button class="td-btn success" data-portability-complete="'+esc(p.id)+'">Confirmer la bascule opérateur</button>':"")+"</div></div>";
  }).join("");
  return '<section class="td-section"><div class="td-section-head"><h3>Portabilité des numéros existants</h3><span>'+rows.length+'</span></div><p class="td-empty">Route SVA active : '+esc(activeCarrierName)+(route.active_connection_state?" • "+esc(route.active_connection_state):"")+'</p><div class="td-port-list">'+(cards||'<p class="td-empty">Aucune demande de portabilité.</p>')+"</div></section>";
}

export function portabilityError(e){
  return {PORTABILITY_SCHEDULE_REQUIRED:"Renseignez la date de bascule.",PORTABILITY_TARGET_CARRIER_REQUIRED:"Aucun opérateur SVA cible n’est défini.",PORTABILITY_TARGET_CARRIER_UNAVAILABLE:"L’opérateur cible n’est pas disponible.",PORTABILITY_OPERATOR_REFERENCE_REQUIRED:"La référence de portabilité opérateur est obligatoire.",PORTABILITY_OWNERSHIP_VERIFICATION_REQUIRED:"La titularité du numéro doit être vérifiée.",PORTABILITY_RIO_VERIFICATION_REQUIRED:"Le RIO doit être vérifié avant l’envoi à l’opérateur.",PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED:"Le client doit confirmer que PGI ne reprend pas les obligations de son ancien contrat.",PORTABILITY_TARIFF_VERIFICATION_REQUIRED:"Le tarif actuel doit être vérifié.",PORTABILITY_TARIFF_DETAILS_REQUIRED:"Le tarif actuel est incomplet.",PORTABILITY_TARIFF_CODE_REQUIRED:"Le code tarifaire vérifié est obligatoire.",PORTABILITY_NOT_SCHEDULED:"La portabilité doit être planifiée avant sa finalisation.",PORTABILITY_KYC_REQUIRED:"Le KYC du client doit être vérifié avant la bascule.",PORTABILITY_CARRIER_CONTRACT_REQUIRED:"Configurez d’abord les conditions réelles de reversement de l’opérateur cible.",PORTABILITY_PAYOUT_TERMS_REQUIRED:"Configurez d’abord la marge PGI et les règles de reversement du client.",PORTABILITY_TENANT_NOT_ACTIVE:"Le client doit être actif avant la bascule.",SVA_SUBSCRIPTION_REQUIRED:"L’accès SVA du client doit être actif avant la bascule.",PORTABILITY_TARGET_ROUTE_NOT_ACTIVE:"L’opérateur cible n’est pas l’opérateur actif de la route SVA.",PORTABILITY_TARGET_ROUTE_NOT_READY:"La liaison SIP de l’opérateur cible n’est pas prête."}[e&&e.code]||(e&&e.code)||"Action impossible";
}

export async function runPortabilityAction(e,api){
  const save=e.target.closest("[data-portability-save]");
  if(save){
    const card=save.closest("[data-portability-card]"),rawSchedule=card.querySelector("[data-port-schedule]")?.value||"",rateRaw=card.querySelector("[data-port-rate]")?.value??"";
    const payload={status:card.querySelector("[data-port-status]").value,ownership_status:card.querySelector("[data-port-owner]").value,tariff_verification_status:card.querySelector("[data-port-tariff-status]").value,service_rate_ttc_per_min:rateRaw===""?null:Number(rateRaw),tariff_code:card.querySelector("[data-port-code]").value.trim(),operator_portability_reference:card.querySelector("[data-port-ref]").value.trim(),scheduled_at:rawSchedule?new Date(rawSchedule).toISOString():null,target_carrier_id:card.dataset.activeCarrierId||null,rejection_reason:null};
    await api.setPortabilityStatus(save.dataset.portabilitySave,payload,api.newIdempotencyKey());
    return {handled:true,message:"Dossier de portabilité enregistré."};
  }
  const complete=e.target.closest("[data-portability-complete]");
  if(complete){
    const card=complete.closest("[data-portability-card]"),ref=card.querySelector("[data-port-ref]")?.value.trim()||"";
    if(!confirm("Confirmer uniquement si l’opérateur a effectivement réalisé la bascule du numéro. Le même numéro et le tarif vérifié seront activés dans PGI."))return {handled:true,cancelled:true};
    await api.completePortability(complete.dataset.portabilityComplete,{operator_portability_reference:ref},api.newIdempotencyKey());
    return {handled:true,message:"Portabilité finalisée : numéro et tarif conservés.",refreshShell:true};
  }
  return {handled:false};
}

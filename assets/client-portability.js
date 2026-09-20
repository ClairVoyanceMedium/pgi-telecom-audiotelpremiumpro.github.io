const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const dateOnly=(v,locale)=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale||"fr-FR",{dateStyle:"medium"}).format(d):"—";};
const dt=(v,locale)=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale||"fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";};
const money=(v,c,locale)=>{if(v==null||!Number.isFinite(Number(v)))return"—";try{return new Intl.NumberFormat(locale||"fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v));}catch{return Number(v).toFixed(2)+" "+(c||"");}};
const labels={submitted:"Demande reçue",awaiting_documents:"Justificatifs requis",eligibility_check:"Éligibilité en cours",operator_pending:"En attente opérateur",scheduled:"Portabilité planifiée",ported:"Numéro porté",rejected:"Demande refusée",cancelled:"Annulé"};
const label=v=>labels[String(v||"").toLowerCase()]||String(v||"—");
const chip=v=>{const s=String(v||"").toLowerCase(),tone=s==="ported"?"ok":["submitted","awaiting_documents","eligibility_check","operator_pending","scheduled"].includes(s)?"warn":["rejected"].includes(s)?"bad":"neutral";return '<span class="cp-chip '+tone+'">'+esc(label(v))+"</span>";};

export function createController({getData,getDemo,reload,toast,countryCodes,locale}){
  let busy=false,countriesReady=false,bound=false;
  function populateCountries(){
    const select=$("portability-country");if(!select||countriesReady)return;
    const data=getData()||{},tenantCountry=data.tenant&&data.tenant.country_code,current=String(tenantCountry||"FR").toUpperCase();
    let dn=null;try{dn=new Intl.DisplayNames([locale||"fr-FR"],{type:"region"});}catch{}
    const rows=(countryCodes||["FR"]).map(code=>({code,label:dn?dn.of(code):code})).filter(x=>x.label).sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:"base"}));
    select.innerHTML=rows.map(x=>'<option value="'+x.code+'">'+esc(x.label)+'</option>').join("");
    select.value=(countryCodes||[]).includes(current)?current:"FR";countriesReady=true;syncRioRequirement();
  }
  function syncRioRequirement(){
    const country=$("portability-country"),rio=$("portability-rio"),hint=$("portability-rio-required");if(!rio)return;
    const fr=String(country?.value||"FR").toUpperCase()==="FR";rio.required=fr;
    rio.placeholder=fr?"12 caractères":"Selon les règles du pays";
    if(hint)hint.textContent=fr?"(obligatoire en France)":"(si requis par l’opérateur)";
  }
  function render(data){
    const rows=data.portability_requests||[],el=$("portability-list"),count=$("portability-count");
    if(count)count.textContent=String(rows.length);if(!el)return;
    el.innerHTML=rows.length?rows.map(x=>{
      const status=String(x.status||"submitted").toLowerCase(),meta=[x.country_code||"",label(status)];
      if(x.desired_port_date)meta.push("Souhaitée : "+dateOnly(x.desired_port_date,locale));
      if(x.scheduled_at)meta.push("Prévue : "+dt(x.scheduled_at,locale));
      if(x.service_rate_ttc_per_min!=null)meta.push("Tarif déclaré : "+money(x.service_rate_ttc_per_min,x.currency,locale)+"/min");
      if(x.tariff_verification_status==="verified")meta.push("Tarif vérifié");
      if(x.rio_validation_status==="verified")meta.push("RIO vérifié");
      if(x.source_contract_transfer_mode==="none")meta.push("Ancien contrat non repris");
      if(x.operator_portability_reference)meta.push("Réf. opérateur : "+x.operator_portability_reference);
      if(x.rejection_reason)meta.push("Motif : "+x.rejection_reason);
      const cancellable=["submitted","awaiting_documents","eligibility_check","operator_pending"].includes(status);
      const action=cancellable?'<button class="cp-portability-cancel" type="button" data-portability-cancel="'+esc(x.id)+'">Annuler</button>':"";
      return '<div class="cp-row cp-portability-row"><div><strong>'+esc(x.display_number||x.requested_e164||"Numéro")+'</strong><span>'+esc(meta.filter(Boolean).join(" · "))+'</span></div><div class="cp-portability-actions">'+chip(status)+action+'</div></div>';
    }).join(""):'<p class="cp-empty">Aucune demande de portabilité en cours.</p>';
  }
  function open(){
    populateCountries();const d=$("client-portability-dialog"),msg=$("portability-message");
    if(msg){msg.textContent="";msg.classList.remove("bad");}
    if(d&&typeof d.showModal==="function")d.showModal();else if(d)d.setAttribute("open","");
  }
  function close(){const d=$("client-portability-dialog");if(!d)return;if(typeof d.close==="function"&&d.open)d.close();else d.removeAttribute("open");}
  async function submit(e){
    e.preventDefault();if(busy)return;const msg=$("portability-message"),submit=$("portability-submit");
    msg.textContent="";msg.classList.remove("bad");
    if(!$("portability-owner-confirmed").checked||!$("portability-authority-confirmed").checked||!$("portability-source-contract").checked){msg.classList.add("bad");msg.textContent="Les trois confirmations sont nécessaires pour ouvrir le dossier.";return;}
    const rateRaw=String($("portability-rate").value||"").trim();
    const payload={country_code:$("portability-country").value,number:$("portability-number").value.trim(),rio:$("portability-rio").value.trim(),current_operator_name:$("portability-operator").value.trim(),current_operator_reference:$("portability-reference").value.trim(),account_holder_name:$("portability-holder").value.trim(),desired_port_date:$("portability-date").value||null,service_rate_ttc_per_min:rateRaw===""?null:Number(rateRaw.replace(",",".")),tariff_code:$("portability-tariff-code").value.trim(),service_family:$("portability-service-family").value,number_owner_confirmed:true,authorization_confirmed:true,source_contract_liability_acknowledged:true};
    if(getDemo()){msg.textContent="Le parcours est prêt. La demande réelle sera envoyée lorsque le backend privé sera connecté.";return;}
    busy=true;submit.disabled=true;const previous=submit.textContent;submit.textContent="Envoi en cours…";
    try{await window.PGICustomerApi.createPortability(payload,window.PGICustomerApi.newIdempotencyKey());$("client-portability-form").reset();countriesReady=false;close();await reload();toast("Demande de portabilité enregistrée.");}
    catch(err){const m={INVALID_PORTABILITY_NUMBER:"Le numéro saisi n’est pas valide.",INVALID_PORTABILITY_RIO:"Le RIO saisi ne correspond pas à ce numéro.",PORTABILITY_RIO_REQUIRED:"Le RIO est obligatoire pour porter ce numéro en France.",PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED:"Confirmez que les obligations de votre ancien contrat restent à votre charge.",INVALID_PORTABILITY_TARIFF:"Le tarif saisi n’est pas valide.",PORTABILITY_ALREADY_REQUESTED:"Une demande est déjà ouverte pour ce numéro.",NUMBER_ALREADY_MANAGED:"Ce numéro est déjà géré dans votre espace.",PORTABILITY_NUMBER_UNAVAILABLE:"Ce numéro est déjà rattaché à un autre dossier.",PORTABILITY_AUTHORIZATION_REQUIRED:"Les autorisations doivent être confirmées.",TENANT_CLOSED:"Ce compte ne peut plus ouvrir de portabilité."};msg.classList.add("bad");msg.textContent=m[err&&err.code]||"La demande de portabilité n’a pas pu être enregistrée.";}
    finally{busy=false;submit.disabled=false;submit.textContent=previous;}
  }
  async function cancel(id){
    if(busy)return;if(getDemo()){toast("Aucune portabilité réelle n’est active en démonstration.");return;}busy=true;
    try{await window.PGICustomerApi.cancelPortability(id,window.PGICustomerApi.newIdempotencyKey());await reload();toast("Demande de portabilité annulée.");}
    catch{toast("Cette demande ne peut plus être annulée.");}finally{busy=false;}
  }
  function bind(){
    if(bound)return;bound=true;
    $("portability-close")?.addEventListener("click",close);
    $("portability-country")?.addEventListener("change",syncRioRequirement);
    $("client-portability-form")?.addEventListener("submit",submit);
    $("portability-list")?.addEventListener("click",e=>{const b=e.target.closest("[data-portability-cancel]");if(b)cancel(b.dataset.portabilityCancel);});
  }
  bind();
  return {render,open};
}

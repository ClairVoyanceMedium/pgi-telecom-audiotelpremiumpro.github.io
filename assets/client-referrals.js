(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(minor,currency="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+currency}};
let state=null,busy=false;
function ensure(){
  if($("client-referrals"))return $("client-referrals");
  const anchor=$("client-growth-suite")||$("client-card-payments")||$("client-live-money");
  if(!anchor)return null;
  const section=document.createElement("section");
  section.id="client-referrals";section.className="crf";section.hidden=true;
  anchor.insertAdjacentElement("afterend",section);
  section.addEventListener("click",handle);
  return section;
}
function historyHtml(rows){
  if(!rows.length)return '<div class="crf-history"><p>Aucun parrainage dans votre historique.</p></div>';
  return '<div class="crf-history"><h3>Suivi de mes parrainages</h3>'+rows.slice(0,12).map(x=>'<div><span>'+esc(new Date(x.claimed_at).toLocaleDateString("fr-FR"))+'</span><strong>'+esc(({claimed:"En attente d’activation",qualified:"Qualifié",rewarded:"Prime acquise",rejected:"Non éligible"})[x.status]||x.status)+'</strong><b>'+esc(money(x.reward_minor||0,x.reward_currency||"EUR"))+'</b></div>').join("")+'</div>';
}
function render(){
  const root=ensure();if(!root||!state)return;
  const p=state.program||{},summary=state.summary||{},history=state.referrals||[],hasHistory=history.length>0||state.incoming;
  if(!p.enabled&&!hasHistory){root.hidden=true;root.innerHTML="";return}
  root.hidden=false;
  if(!p.enabled){
    root.innerHTML='<div class="crf-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Historique de parrainage</h2><p>Le programme est actuellement désactivé. Aucun nouveau code ni ancien lien ne peut créer de parrainage. Votre historique déjà acquis reste conservé.</p></div><span class="crf-badge off">DÉSACTIVÉ</span></div>'+historyHtml(history);
    return;
  }
  const reward=money(p.reward_minor||0,p.currency||"EUR"),share=state.share_url||"",code=state.code||"";
  root.innerHTML='<div class="crf-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Recommandez Audiotel Premium Pro</h2><p>Partagez votre lien personnel. La prime de <strong>'+esc(reward)+'</strong> est acquise uniquement lorsque le filleul devient réellement actif avec un abonnement payé.</p></div><span class="crf-badge">ACTIF</span></div>'+
    '<div class="crf-grid"><article><span>Votre code</span><strong>'+esc(code)+'</strong><button type="button" data-copy-referral>Copier mon lien</button><input id="crf-share" value="'+esc(share)+'" readonly aria-label="Lien de parrainage"></article><article><span>Parrainages enregistrés</span><strong>'+esc(summary.claims||0)+'</strong><small>'+esc(summary.pending||0)+' en attente · '+esc(summary.rewarded||0)+' primé(s)</small></article><article><span>Primes acquises</span><strong>'+esc(money(summary.earned_minor||0,p.currency||"EUR"))+'</strong><small>Les règlements restent tracés individuellement.</small></article></div>'+
    '<div class="crf-claim"><div><strong>Vous avez reçu un code de parrainage ?</strong><span>Ajoutez-le avant votre première activation payante.</span></div><input id="crf-code" maxlength="24" autocomplete="off" autocapitalize="characters" placeholder="CODE PARRAIN"><button type="button" data-claim-referral>Enregistrer le code</button><small id="crf-feedback" role="status"></small></div>'+historyHtml(history);
}
async function load(){
  const root=ensure();if(!root||!window.PGICustomerApi?.referrals)return;
  try{state=await window.PGICustomerApi.referrals();render()}catch(_e){root.hidden=true}
}
async function handle(e){
  const copy=e.target.closest("[data-copy-referral]");
  if(copy){const value=state?.share_url||"";if(!value)return;try{await navigator.clipboard.writeText(value);copy.textContent="Lien copié"}catch{const input=$("crf-share");input?.select();document.execCommand?.("copy")}return}
  if(e.target.closest("[data-claim-referral]")){
    if(busy)return;
    const code=String($("crf-code")?.value||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,""),feedback=$("crf-feedback");
    if(!/^[A-Z0-9]{8,24}$/.test(code)){if(feedback)feedback.textContent="Code invalide.";return}
    busy=true;if(feedback)feedback.textContent="Enregistrement…";
    try{
      await window.PGICustomerApi.claimReferral(code,window.PGICustomerApi.newIdempotencyKey());
      if(feedback)feedback.textContent="Code enregistré. La prime du parrain ne sera acquise qu’après votre activation payante.";
      await load();
    }catch(err){
      if(feedback)feedback.textContent=({REFERRAL_PROGRAM_DISABLED:"Le programme est actuellement désactivé.",REFERRAL_CLAIM_TOO_LATE:"Un code ne peut plus être ajouté après l’activation payante.",SELF_REFERRAL_FORBIDDEN:"Vous ne pouvez pas utiliser votre propre code.",REFERRAL_ALREADY_CLAIMED:"Un parrainage est déjà rattaché à ce dossier.",REFERRAL_CODE_NOT_FOUND:"Ce code n’est pas reconnu."})[err?.code]||"Impossible d’enregistrer ce code.";
    }finally{busy=false}
  }
}
document.addEventListener("pgi:portal-loaded",load);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){ensure();if(window.PGIClientPortalData)load()},{once:true});else{ensure();if(window.PGIClientPortalData)load()}
})();
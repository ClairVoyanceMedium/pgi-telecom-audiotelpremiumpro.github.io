(function(root){
"use strict";
const mount=document.getElementById("client-referral-mount");
if(!mount)return;
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR")}};
let loading=false;
function storedCode(){try{const c=String(localStorage.getItem("pgi_referral_code")||"").trim().toUpperCase();return /^[A-Z0-9]{8,24}$/.test(c)?c:""}catch(_e){return""}}
function statusText(v){return({claimed:"En attente de l’activation payée",qualified:"Qualifié",rewarded:"Récompensé",rejected:"Refusé",earned:"Acquise",paid:"Versée",cancelled:"Annulée"})[v]||String(v||"—")}
function shareUrl(code){return location.origin+"/?ref="+encodeURIComponent(code)}
async function copy(value,button){try{await navigator.clipboard.writeText(value);if(button){const old=button.textContent;button.textContent="Copié";setTimeout(()=>button.textContent=old,1400)}}catch(_e){}}
function render(data){
  const cfg=data.configuration||{},code=data.code&&data.code.status==="active"?data.code:null,inbound=data.inbound||null,reward=money(cfg.reward_minor||0,cfg.currency||"EUR");
  const rewards=(data.rewards||[]).map(x=>'<div class="cp-row"><div><strong>'+esc(statusText(x.status))+'</strong><span>'+esc(x.count)+' récompense(s)</span></div><span class="cp-chip '+(x.status==="paid"?"ok":"neutral")+'">'+esc(money(x.amount_minor,x.currency))+'</span></div>').join("");
  const captured=!inbound?storedCode():"",share=code?shareUrl(code.code):"";
  mount.innerHTML='<article class="cp-panel"><div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Inviter un nouveau client</h2></div><span class="cp-chip '+(data.enabled?"ok":"neutral")+'">'+(data.enabled?"ACTIF":"DÉSACTIVÉ")+'</span></div>'+
    '<p class="cp-muted">'+(data.enabled?'Récompense actuelle : <strong>'+esc(reward)+'</strong> après activation réellement payée du filleul. Aucun droit n’est créé sur une simple inscription.':'Le programme est actuellement fermé aux nouvelles invitations. Votre historique reste conservé.')+'</p>'+
    (code?'<div class="cp-stack"><div class="cp-row"><div><strong>Mon code</strong><span>'+esc(code.code)+'</span></div><button id="referral-copy-code" class="cp-ghost" type="button">Copier</button></div><div class="cp-row"><div><strong>Lien de parrainage</strong><span>'+esc(share)+'</span></div><button id="referral-copy-link" class="cp-ghost" type="button">Copier le lien</button></div></div>':
      (data.enabled&&data.can_share?'<button id="referral-create-code" class="cp-primary" type="button">Créer mon code de parrainage</button>':
      (data.enabled?'<p class="cp-muted">Votre code devient disponible lorsque votre abonnement Audiotel Premium Pro est actif et payé.</p>':'')))+
    (!inbound&&data.enabled&&data.can_claim?'<div class="cp-stack"><div class="cp-row"><div><strong>J’ai reçu un code</strong><span>À enregistrer avant votre première activation payée.</span></div></div><label class="cp-form"><span>Code du parrain</span><input id="referral-claim-code" type="text" maxlength="24" autocomplete="off" value="'+esc(captured)+'" placeholder="Code de parrainage"></label><button id="referral-claim" class="cp-ghost" type="button">Enregistrer le code</button></div>':'')+
    (inbound?'<div class="cp-row"><div><strong>Mon parrainage reçu</strong><span>'+esc(statusText(inbound.status))+'</span></div><span class="cp-chip neutral">'+esc(money(inbound.reward_minor,inbound.reward_currency))+'</span></div>':'')+
    '<div class="cp-stack">'+(rewards||'<p class="cp-empty">Aucune récompense acquise pour le moment.</p>')+'</div><p id="referral-feedback" class="cp-muted" role="status"></p></article>';
  document.getElementById("referral-copy-code")?.addEventListener("click",e=>copy(code.code,e.currentTarget));
  document.getElementById("referral-copy-link")?.addEventListener("click",e=>copy(share,e.currentTarget));
  document.getElementById("referral-create-code")?.addEventListener("click",createCode);
  document.getElementById("referral-claim")?.addEventListener("click",claimCode);
}
function feedback(value){const e=document.getElementById("referral-feedback");if(e)e.textContent=value||""}
async function refresh(){
  if(loading||!root.PGICustomerApi)return;
  loading=true;
  try{render(await root.PGICustomerApi.referrals())}
  catch(error){if(error?.status!==401)mount.innerHTML='<article class="cp-panel"><p class="cp-muted">Parrainage momentanément indisponible.</p></article>'}
  finally{loading=false}
}
async function createCode(){
  if(loading)return;
  loading=true;feedback("Création du code…");
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());loading=false;await refresh()}
  catch(error){loading=false;feedback(error?.code||"Création impossible")}
}
async function claimCode(){
  if(loading)return;
  const input=document.getElementById("referral-claim-code"),code=String(input?.value||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{8,24}$/.test(code))return feedback("Code invalide.");
  loading=true;feedback("Enregistrement du parrainage…");
  try{await root.PGICustomerApi.claimReferral(code,root.PGICustomerApi.newIdempotencyKey());try{localStorage.removeItem("pgi_referral_code")}catch(_e){}loading=false;await refresh()}
  catch(error){loading=false;feedback(error?.code||"Enregistrement impossible")}
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",()=>{mount.innerHTML=""});
})(window);

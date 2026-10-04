(function(){
"use strict";
var api=window.PGICustomerApi,state=null,busy=false;
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format((Number(v)||0)/100)}catch(_e){return ((Number(v)||0)/100).toFixed(2)+" "+(c||"EUR")}}
function ensure(){
 if($("client-referrals"))return $("client-referrals");
 var anchor=$("client-card-payments")||$("client-growth-suite")||$("client-live-money");if(!anchor)return null;
 if(!$("client-referrals-style")){var style=document.createElement("style");style.id="client-referrals-style";style.textContent=".crf{margin:18px 0;padding:18px;border:1px solid rgba(181,142,94,.24);border-radius:18px;background:linear-gradient(145deg,rgba(45,28,19,.96),rgba(25,17,13,.97));color:#f4ede8}.crf[hidden]{display:none}.crf-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.crf-head h2{margin:3px 0 5px;font-size:20px}.crf-badge{padding:6px 9px;border:1px solid rgba(211,169,109,.35);border-radius:999px;font-size:10px;font-weight:850}.crf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:14px 0}.crf-grid div{padding:11px;border:1px solid rgba(255,255,255,.08);border-radius:12px}.crf-grid span,.crf-grid small{display:block;color:#bdaea5;font-size:11px}.crf-grid strong{display:block;margin:4px 0;font-size:17px}.crf-link{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}.crf-link input{min-width:0;padding:11px;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:#160f0c;color:#fff}.crf-note{margin:12px 0 0;color:#bdaea5;font-size:12px;line-height:1.55}.crf-feedback{min-height:18px;margin:8px 0 0;font-size:12px;color:#d7bd94}@media(max-width:700px){.crf-grid{grid-template-columns:1fr}.crf-link{grid-template-columns:1fr}.crf-head{display:block}.crf-badge{display:inline-flex;margin-top:8px}}";document.head.appendChild(style)}
 var s=document.createElement("section");s.id="client-referrals";s.className="crf";s.hidden=true;anchor.insertAdjacentElement("afterend",s);return s;
}
function render(){
 var root=ensure();if(!root||!state)return;
 if(!state.program_active&&!state.has_existing_activity){root.hidden=true;return}
 root.hidden=false;
 var c=state.counts||{},r=state.rewards||{},currency=state.currency||"EUR";
 var header='<div class="crf-head"><div><p class="cp-kicker">PARRAINAGE CLIENT</p><h2>Recommandez Audiotel Premium Pro</h2><p>'+(state.program_active?"Votre lien attribue un parrainage au dépôt de la demande.":"Les nouveaux parrainages sont actuellement désactivés. Votre historique reste conservé.")+'</p></div><span class="crf-badge">'+(state.program_active?"ACTIF":"HISTORIQUE")+'</span></div>';
 var stats='<div class="crf-grid"><div><span>Filleuls enregistrés</span><strong>'+Number(c.total||0)+'</strong><small>'+Number(c.claimed||0)+' en attente de qualification</small></div><div><span>Primes acquises</span><strong>'+money(r.earned_minor||0,currency)+'</strong><small>'+Number(r.earned_count||0)+' à régler</small></div><div><span>Primes réglées</span><strong>'+money(r.paid_minor||0,currency)+'</strong><small>'+Number(r.paid_count||0)+' règlement(s)</small></div></div>';
 var action="";
 if(state.program_active&&state.code){
   var link=location.origin+String(state.referral_path||"");
   action='<div class="crf-link"><input id="crf-link" readonly value="'+esc(link)+'"><button id="crf-copy" class="cp-primary" type="button">Copier mon lien</button></div>';
 }else if(state.program_active&&state.can_create_code){
   action='<button id="crf-create" class="cp-primary" type="button">Créer mon lien de parrainage</button>';
 }else if(state.program_active&&!state.eligible_referrer){
   action='<p class="crf-note"><strong>Accès après premier paiement confirmé.</strong> Le lien devient disponible lorsque votre propre abonnement est actif et qu’une facture a réellement été payée.</p>';
 }
 var reward=state.current_reward_minor!=null?money(state.current_reward_minor,currency):"le montant figé lors de la demande";
 root.innerHTML=header+stats+action+'<p class="crf-note">Règle de sécurité : aucun auto-parrainage. Le montant applicable est figé lors de la demande du filleul. Une prime de '+esc(reward)+' devient acquise uniquement après confirmation serveur d’un abonnement actif et d’une facture payée. Le règlement de la prime reste séparé et traçable.</p><p id="crf-feedback" class="crf-feedback" role="status"></p>';
 if($("crf-create"))$("crf-create").onclick=createCode;if($("crf-copy"))$("crf-copy").onclick=copy;
}
async function load(){
 var root=ensure();if(!root||!api?.referrals)return;
 try{state=await api.referrals();render()}catch(_e){if(root)root.hidden=true}
}
async function createCode(){
 if(busy||!api?.createReferralCode)return;busy=true;var b=$("crf-create"),f=$("crf-feedback");if(b)b.disabled=true;if(f)f.textContent="Création du lien sécurisé…";
 try{await api.createReferralCode(api.newIdempotencyKey());await load()}catch(e){if(f)f.textContent=e?.code==="REFERRAL_REFERRER_NOT_ELIGIBLE"?"Votre premier paiement doit être confirmé avant de créer le lien.":"Création momentanément indisponible."}finally{busy=false;if(b)b.disabled=false}
}
async function copy(){
 var value=$("crf-link")?.value,f=$("crf-feedback");if(!value)return;
 try{await navigator.clipboard.writeText(value);if(f)f.textContent="Lien de parrainage copié."}catch(_e){if(f)f.textContent="Copiez le lien affiché manuellement."}
}
document.addEventListener("pgi:portal-loaded",load);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){ensure();load()},{once:true});else{ensure();load()}
})();
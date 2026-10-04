(function(){
"use strict";
var api=window.PGICustomerApi,state=null,busy=false;
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function moneyMinor(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format((Number(v)||0)/100)}catch(_e){return ((Number(v)||0)/100).toFixed(2)+" "+(c||"EUR")}}
function date(v){if(!v)return"";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):""}
function statusLabel(v){return({claimed:"En attente du paiement",qualified:"Qualifié",rewarded:"Récompense acquise",rejected:"Non éligible"})[String(v||"")]||String(v||"")}
function ensure(){
 if($("client-referrals"))return $("client-referrals");
 var anchor=$("client-card-payments")||$("client-growth-suite")||$("client-live-money");if(!anchor)return null;
 var s=document.createElement("section");s.id="client-referrals";s.className="crf";s.hidden=true;
 s.innerHTML='<div class="crf-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Recommandez Audiotel Premium Pro</h2><p>Partagez votre lien personnel lorsque le programme est actif. La qualification intervient uniquement après un abonnement réellement payé par le filleul.</p></div><span id="crf-status" class="crf-badge">CHARGEMENT</span></div><div id="crf-body"></div>';
 anchor.insertAdjacentElement("afterend",s);return s;
}
function historyHtml(rows){
 if(!rows.length)return '<p class="cp-empty">Aucun parrainage enregistré pour le moment.</p>';
 return '<div class="crf-list">'+rows.slice(0,20).map(function(x){return '<div class="crf-row"><span><strong>'+esc(statusLabel(x.status))+'</strong><small>'+esc(date(x.claimed_at))+'</small></span><b>'+moneyMinor(x.reward_minor,x.reward_currency)+'</b></div>'}).join("")+'</div>';
}
function render(){
 var section=ensure(),body=$("crf-body"),badge=$("crf-status");if(!section||!body||!state)return;
 var rows=Array.isArray(state.referrals)?state.referrals:[],rewards=Array.isArray(state.rewards)?state.rewards:[],cfg=state.configuration||{};
 if(state.enabled!==true&&rows.length===0&&rewards.length===0){section.hidden=true;return}
 section.hidden=false;
 if(state.enabled!==true){
  badge.textContent="DÉSACTIVÉ";
  body.innerHTML='<div class="crf-disabled"><strong>Programme actuellement désactivé</strong><p>Votre historique reste conservé. Aucun nouveau lien ni nouveau parrainage n’est créé pendant la désactivation.</p></div><h3>Historique</h3>'+historyHtml(rows);
  return;
 }
 badge.textContent="ACTIF";
 var reward=moneyMinor(cfg.reward_minor||0,cfg.currency||"EUR"),link=String(state.share_url||"");
 var linkBlock=state.code
  ?'<div class="crf-link"><label>Votre code<input id="crf-code" readonly value="'+esc(state.code)+'"></label><label>Votre lien de parrainage<input id="crf-link" readonly value="'+esc(link)+'"></label><div class="crf-actions"><button id="crf-copy" class="cp-primary" type="button">Copier mon lien</button></div><p id="crf-feedback" class="crf-feedback"></p></div>'
  :state.can_create?'<div class="crf-create"><p>Votre lien personnel n’a pas encore été créé.</p><button id="crf-create" class="cp-primary" type="button">Créer mon lien de parrainage</button><p id="crf-feedback" class="crf-feedback"></p></div>':'<p class="cp-empty">Le propriétaire ou un administrateur du compte peut créer le lien.</p>';
 body.innerHTML='<div class="crf-kpis"><div><span>Récompense configurée</span><strong>'+reward+'</strong></div><div><span>Parrainages</span><strong>'+rows.length+'</strong></div><div><span>Récompenses acquises</span><strong>'+rewards.filter(function(x){return x.status==="earned"||x.status==="paid"}).length+'</strong></div></div>'+
 '<p class="crf-rule">Un filleul est qualifié après son premier abonnement effectivement payé. Le mois en cours offert ne déclenche pas de récompense. Le montant applicable est figé lors de l’attribution du parrainage.</p>'+linkBlock+'<h3>Historique</h3>'+historyHtml(rows);
 $("crf-create")?.addEventListener("click",createCode);$("crf-copy")?.addEventListener("click",copyLink);
}
async function load(){
 ensure();if(!api?.referrals)return;
 try{state=await api.referrals();render()}catch(_e){var section=$("client-referrals");if(section)section.hidden=true}
}
async function createCode(){
 if(busy||!api?.createReferralCode)return;busy=true;var b=$("crf-create"),f=$("crf-feedback");if(b)b.disabled=true;if(f)f.textContent="Création du lien en cours...";
 try{var created=await api.createReferralCode(api.newIdempotencyKey());state=await api.referrals();if(created?.share_url)state.share_url=created.share_url;render()}
 catch(e){if(f)f.textContent=e?.code==="REFERRAL_PROGRAM_DISABLED"?"Le programme vient d’être désactivé.":"Impossible de créer le lien de parrainage."}
 finally{busy=false;if(b)b.disabled=false}
}
async function copyLink(){
 var value=$("crf-link")?.value||"";if(!value)return;var f=$("crf-feedback");
 try{await navigator.clipboard.writeText(value);if(f)f.textContent="Lien copié."}catch(_e){if(f)f.textContent="Sélectionnez le lien puis copiez-le manuellement."}
}
document.addEventListener("pgi:portal-loaded",load);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){ensure();load()},{once:true});else{ensure();load()}
})();
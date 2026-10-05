(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function tierLabel(t,currency){
  if(!t)return"";
  return (t.to==null?"À partir du "+t.from+"e":t.from+" à "+t.to)+" : "+money(t.reward_minor,currency)+" par filleul";
}
function renderRecent(rows,currency,required){
  if(!rows.length)return '<p class="cp-muted">Aucun filleul enregistré pour le moment.</p>';
  return '<div class="cp-stack">'+rows.map(function(x){
    var paid=Math.max(0,Math.min(required,Number(x.paid_invoice_count)||0)),qualified=x.status==="rewarded";
    var label=qualified?"QUALIFIÉ":x.status==="rejected"?"REFUSÉ":paid+"/"+required+" PAIEMENTS";
    var reward=qualified&&Number(x.reward_minor)>0?" · "+money(x.reward_minor,currency)+" acquis":"";
    return '<div class="cp-row"><div><strong>Filleul '+esc(String(x.public_id||"").slice(0,8).toUpperCase())+'</strong><span>'+(qualified?"Les "+required+" factures mensuelles payées ont été validées.":"Progression : "+paid+" facture(s) mensuelle(s) payée(s) sur "+required+".")+esc(reward)+'</span></div><span class="cp-chip '+(qualified?"ok":"")+'">'+esc(label)+'</span></div>';
  }).join("")+'</div>';
}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;
  var summary=state.summary||{},code=String(state.code||""),currency=state.currency||"EUR",required=Number(state.qualification_paid_invoices)||3;
  var tiers=Array.isArray(state.tiers)?state.tiers:[],milestones=Array.isArray(state.milestones)?state.milestones:[],recent=Array.isArray(state.recent)?state.recent:[];
  var next=state.next_reward||null,enabled=state.enabled===true,payout=state.payout_account||null;
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var codeBlock="";
  if(enabled&&code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>Prochaine prime: '+esc(money(next&&next.total_minor||state.reward_minor,currency))+'.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(enabled&&state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
  }else if(enabled){
    codeBlock='<p class="cp-muted">Lien disponible après activation du compte et paiement de l’abonnement.</p>';
  }else{
    codeBlock='<div class="cp-row"><div><strong>Programme actuellement fermé</strong><span>Aucun nouveau parrainage ne peut être créé tant que le programme reste désactivé. Historique et primes acquises sont conservés.</span></div><span class="cp-chip">FERMÉ</span></div>';
  }
  var payoutBlock=payout?.transfers_enabled&&payout?.payouts_enabled?'<div class="cp-row"><strong>Primes: versement automatique actif</strong><span class="cp-chip ok">ACTIF</span></div>':'<div class="cp-row"><strong>Versement sécurisé à configurer</strong></div><p class="cp-muted">Audiotel Premium Pro ne stocke aucune donnée bancaire.</p>'+(state.can_manage?'<button id="client-referral-payout" class="cp-primary" type="button">Configurer mes versements</button>':'');
  var scale=tiers.length?'<div class="cp-stack">'+tiers.map(function(t){return '<div class="cp-row"><div><strong>'+esc(tierLabel(t,currency))+'</strong><span>'+(t.to==null?'Montant fixe dès le 25e filleul.':'Prime selon le nombre de filleuls qualifiés.')+'</span></div></div>';}).join("")+'</div>':"";
  var bonus=milestones.length?'<p class="cp-muted">Bonus fixes : '+milestones.map(function(x){return esc((x.ordinal===1?"1er":x.ordinal+"e")+" filleul +"+money(x.bonus_minor,currency));}).join(" · ")+'.</p>':"";
  box.innerHTML=
    '<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Mon espace ambassadeur</h2></div><span>'+esc(String(summary.rewarded||0))+' qualifié(s)</span></div>'+
    '<p class="cp-muted">Prime acquise après <strong>3 factures mensuelles distinctes payées</strong>. Barème fixe, sans commission SVA.</p>'+
    codeBlock+
    '<div class="cp-row"><div><strong>'+esc(String(summary.visits||0))+' visite(s) · '+esc(String(summary.prospects||0))+' demande(s)</strong><span>'+esc(String(summary.claimed||0))+' filleul(s) enregistré(s) · '+esc(String(summary.rewarded||0))+' qualifié(s) · '+esc(money(summary.reward_minor||0,currency))+' acquis.</span></div></div>'+
    payoutBlock+
    '<div class="cp-panel-head"><div><p class="cp-kicker">BARÈME FIXE</p><h3>Prime par filleul qualifié</h3></div></div>'+scale+bonus+
    '<div class="cp-panel-head"><div><p class="cp-kicker">SUIVI</p><h3>Progression de mes filleuls</h3></div></div>'+renderRecent(recent,currency,required)+
    '<p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
  bind();
}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true);}}
async function refresh(){
  if(!root.PGICustomerApi||typeof root.PGICustomerApi.referral!=="function")return;
  try{render(await root.PGICustomerApi.referral());}catch(e){if(e&&e.status===401)return;var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}}
}
async function createCode(){
  if(busy)return;busy=true;status("Création du lien sécurisé...");
  var b=$("client-referral-create");if(b)b.disabled=true;
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien de parrainage est prêt.");}
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation de votre abonnement actif et payé.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(map[e&&e.code]||"Le lien de parrainage n'a pas pu être créé.",true);}
  finally{busy=false;if(b)b.disabled=false;}
}
async function configurePayout(){if(busy)return;busy=1;try{var r=await root.PGICustomerApi.configureReferralPayout(root.PGICustomerApi.newIdempotencyKey());if(r?.onboarding?.url)location.href=r.onboarding.url;else await refresh()}catch(_e){status("Versement indisponible.",1)}finally{busy=0}}
async function copyLink(){
  var input=$("client-referral-link");if(!input)return;
  try{await navigator.clipboard.writeText(input.value);status("Lien copié.");}
  catch(_e){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.");}catch(_x){status("Copie impossible sur cet appareil.",true);}}
}
function bind(){
  $("client-referral-create")?.addEventListener("click",createCode,{once:true});
  $("client-referral-copy")?.addEventListener("click",copyLink);
  $("client-referral-payout")?.addEventListener("click",configurePayout,{once:true});
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",function(){var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}});
})(window);

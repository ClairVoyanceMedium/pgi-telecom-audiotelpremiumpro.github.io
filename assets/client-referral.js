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
  var codeBlock="",payoutBlock="";
  if(enabled&&code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>Votre prochain filleul qualifié peut vous rapporter '+esc(money(next&&next.total_minor||state.reward_minor,currency))+'.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(enabled&&state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
  }else if(enabled){
    codeBlock='<p class="cp-muted">Le lien sera disponible après activation de votre compte et confirmation de votre abonnement actif et payé.</p>';
  }else{
    codeBlock='<div class="cp-row"><div><strong>Programme actuellement fermé</strong><span>Aucun nouveau parrainage ne peut être créé tant que le programme reste désactivé. Votre historique et vos récompenses acquises sont conservés.</span></div><span class="cp-chip">FERMÉ</span></div>';
  }
  if(enabled&&code){
    if(payout&&payout.transfers_enabled===true){
      payoutBlock='<div class="cp-row"><div><strong>Versements automatiques activés</strong><span>Vos primes acquises sont envoyées automatiquement via Stripe, sans action de votre part.</span></div><span class="cp-chip ok">ACTIF</span></div>';
    }else{
      payoutBlock='<div class="cp-row"><div><strong>Coordonnées de versement à finaliser</strong><span>Une seule configuration Stripe est nécessaire pour recevoir ensuite toutes vos primes automatiquement.</span></div><button id="client-referral-payout" class="cp-primary" type="button">Configurer mes versements</button></div>';
    }
  }
  var scale=tiers.length?'<div class="cp-stack">'+tiers.map(function(t){return '<div class="cp-row"><div><strong>'+esc(tierLabel(t,currency))+'</strong><span>'+(t.to==null?'Ce montant reste fixe et non négociable à partir du 25e filleul qualifié.':'Prime automatique selon votre nombre total de filleuls qualifiés.')+'</span></div></div>';}).join("")+'</div>':"";
  var bonus=milestones.length?'<p class="cp-muted">Bonus fixes : '+milestones.map(function(x){return esc((x.ordinal===1?"1er":x.ordinal+"e")+" filleul +"+money(x.bonus_minor,currency));}).join(" · ")+'.</p>':"";
  box.innerHTML=
    '<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Mon espace ambassadeur</h2></div><span>'+esc(String(summary.rewarded||0))+' qualifié(s)</span></div>'+
    '<p class="cp-muted">Une récompense devient acquise après <strong>3 factures mensuelles distinctes réellement payées</strong> par le filleul. Le barème est fixe, automatique et ne porte jamais sur le chiffre d’affaires SVA.</p>'+
    codeBlock+payoutBlock+
    '<div class="cp-row"><div><strong>'+esc(String(summary.visits||0))+' visite(s) · '+esc(String(summary.prospects||0))+' demande(s)</strong><span>'+esc(String(summary.claimed||0))+' filleul(s) enregistré(s) · '+esc(String(summary.rewarded||0))+' qualifié(s) · '+esc(money(summary.reward_minor||0,currency))+' acquis.</span></div></div>'+
    '<div class="cp-panel-head"><div><p class="cp-kicker">BARÈME FIXE</p><h3>Prime par filleul qualifié</h3></div></div>'+scale+bonus+
    '<div class="cp-panel-head"><div><p class="cp-kicker">SUIVI</p><h3>Progression de mes filleuls</h3></div></div>'+renderRecent(recent,currency,required)+
    '<p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
  bind();
}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true);}}
async function refresh(){
  if(!root.PGICustomerApi||typeof root.PGICustomerApi.referral!=="function")return;
  try{
    var results=await Promise.all([
      root.PGICustomerApi.referral(),
      typeof root.PGICustomerApi.cardPaymentStatus==="function"?root.PGICustomerApi.cardPaymentStatus().catch(function(){return null;}):Promise.resolve(null)
    ]);
    var data=results[0]||{};data.payout_account=results[1]&&results[1].account||null;render(data);
  }catch(e){if(e&&e.status===401)return;var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}}
}
async function createCode(){
  if(busy)return;busy=true;status("Création du lien sécurisé...");
  var b=$("client-referral-create");if(b)b.disabled=true;
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien de parrainage est prêt.");}
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation de votre abonnement actif et payé.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(map[e&&e.code]||"Le lien de parrainage n'a pas pu être créé.",true);}
  finally{busy=false;if(b)b.disabled=false;}
}
async function setupPayout(){
  if(busy||!root.PGICustomerApi||typeof root.PGICustomerApi.activateCardPayments!=="function")return;
  busy=true;status("Préparation sécurisée de vos versements automatiques...");
  var b=$("client-referral-payout");if(b)b.disabled=true;
  try{
    var result=await root.PGICustomerApi.activateCardPayments(root.PGICustomerApi.newIdempotencyKey());
    var url=result&&result.onboarding&&result.onboarding.url;
    if(!url)throw Object.assign(new Error("STRIPE_ONBOARDING_URL_MISSING"),{code:"STRIPE_ONBOARDING_URL_MISSING"});
    location.href=url;
  }catch(e){
    var map={STRIPE_CONNECT_NOT_READY:"Le service de versement Stripe est momentanément indisponible.",CARD_PAYMENT_ACCOUNT_NOT_READY:"Votre compte Stripe doit être finalisé.",COMMERCIAL_READINESS_REQUIRED:"Votre dossier doit être finalisé avant l'activation des versements."};
    status(map[e&&e.code]||"La configuration des versements n'a pas pu être ouverte.",true);
  }finally{busy=false;if(b)b.disabled=false;}
}
async function copyLink(){
  var input=$("client-referral-link");if(!input)return;
  try{await navigator.clipboard.writeText(input.value);status("Lien copié.");}
  catch(_e){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.");}catch(_x){status("Copie impossible sur cet appareil.",true);}}
}
function bind(){
  $("client-referral-create")?.addEventListener("click",createCode,{once:true});
  $("client-referral-payout")?.addEventListener("click",setupPayout,{once:true});
  $("client-referral-copy")?.addEventListener("click",copyLink);
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",function(){var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}});
})(window);

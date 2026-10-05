(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function tierText(data){
  var tiers=Array.isArray(data.tiers)?data.tiers:[];
  return tiers.map(function(t){return (t.to==null?"Dès le "+t.from+"e":t.from===t.to?t.from+"e":t.from+"e au "+t.to+"e")+" : "+money(t.reward_minor,data.currency);}).join(" · ");
}
function bonusText(data){
  var b=data.bonuses||{};
  return ["1","5","10"].filter(function(k){return Number(b[k])>0;}).map(function(k){return "bonus "+k+"e : +"+money(b[k],data.currency);}).join(" · ");
}
function referralStatus(row){
  if(row.status==="rewarded")return '<span class="cp-chip ok">ACQUIS</span>';
  if(row.status==="rejected")return '<span class="cp-chip neutral">NON ÉLIGIBLE</span>';
  var paid=Math.min(Number(row.paid_invoices||0),Number(row.required_paid_invoices||3));
  return '<span class="cp-chip neutral">'+esc(paid+" / "+Number(row.required_paid_invoices||3)+" paiements")+'</span>';
}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;
  var summary=state.summary||{},code=String(state.code||""),active=state.enabled===true,next=state.next_reward||{},recent=Array.isArray(state.recent)?state.recent:[];
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var codeBlock="";
  if(code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code ambassadeur : '+esc(code)+'</strong><span>Partagez ce lien. La récompense est acquise après 3 mensualités distinctes réellement encaissées pour le filleul.</span></div><span class="cp-chip '+(active?"ok":"neutral")+'">'+(active?"ACTIF":"PROGRAMME FERMÉ")+'</span></div><label class="cp-field"><span>Lien de recommandation</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(active&&state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien ambassadeur</button></div>';
  }else{
    var eligibility=!active?"Le programme est actuellement fermé aux nouveaux parrainages. Vos récompenses déjà acquises restent historisées.":"Votre adresse e-mail doit être vérifiée pour un compte Ambassadeur, ou votre compte client doit être actif avec un abonnement payé.";
    codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p>';
  }
  var nextText=next.total_reward_minor!=null?'<div class="cp-row"><div><strong>Prochain filleul qualifié : '+money(next.total_reward_minor,state.currency)+'</strong><span>Base '+money(next.base_reward_minor,state.currency)+(Number(next.bonus_minor)>0?" + bonus "+money(next.bonus_minor,state.currency):"")+". Le montant est déterminé automatiquement par son rang.</span></div></div>":"";
  var history=recent.length?'<div class="cp-stack">'+recent.map(function(x){return '<div class="cp-row"><div><strong>Filleul enregistré le '+esc(new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(new Date(x.claimed_at)))+'</strong><span>'+(x.status==="rewarded"?"Récompense acquise : "+money(x.reward_minor,x.reward_currency||state.currency):"Progression de qualification : "+Math.min(Number(x.paid_invoices||0),Number(x.required_paid_invoices||3))+" mensualité(s) payée(s) sur "+Number(x.required_paid_invoices||3))+'</span></div>'+referralStatus(x)+'</div>';}).join("")+'</div>':'<p class="cp-muted">Aucun filleul enregistré pour le moment.</p>';
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PROGRAMME AMBASSADEUR</p><h2>Recommander Audiotel Premium Pro et cumuler mes récompenses</h2></div><span>'+esc(String(summary.rewarded||0))+' qualifié(s)</span></div>'+
    '<p class="cp-muted"><strong>Barème automatique et non négociable.</strong> '+esc(tierText(state))+'. '+esc(bonusText(state))+'. À partir du 25e filleul qualifié, la base reste fixée à '+money(2000,state.currency)+' par nouveau filleul.</p>'+
    '<p class="cp-muted">Un filleul devient qualifié uniquement après <strong>'+esc(String(state.qualification_paid_invoices||3))+' mensualités distinctes réellement payées</strong>. Une relance ou un webhook dupliqué ne compte pas comme une mensualité supplémentaire.</p>'+
    codeBlock+nextText+
    '<div class="cp-row"><div><strong>'+esc(String(summary.clicks||0))+' clic(s) · '+esc(String(summary.claimed||0))+' prospect(s) · '+esc(String(summary.pending||0))+' en qualification</strong><span>'+esc(String(summary.rewarded||0))+' filleul(s) qualifié(s) · '+esc(money(summary.reward_minor||0,state.currency))+' de récompenses acquises. Seuil indicatif de règlement : '+esc(money(state.payout_threshold_minor||2000,state.currency))+'.</span></div></div>'+
    '<div class="cp-panel-head" style="margin-top:18px"><div><p class="cp-kicker">SUIVI</p><h3>Mes filleuls</h3></div></div>'+history+
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
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien ambassadeur est prêt.");}
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme Ambassadeur est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Vérifiez votre adresse e-mail Ambassadeur ou activez votre compte client et son abonnement.",REFERRAL_CODE_UNAVAILABLE:"Le lien ambassadeur est momentanément indisponible."};status(map[e&&e.code]||"Le lien ambassadeur n'a pas pu être créé.",true);}
  finally{busy=false;if(b)b.disabled=false;}
}
async function copyLink(){
  var input=$("client-referral-link");if(!input)return;
  try{await navigator.clipboard.writeText(input.value);status("Lien copié.");}
  catch(_e){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.");}catch(_x){status("Copie impossible sur cet appareil.",true);}}
}
function bind(){
  $("client-referral-create")?.addEventListener("click",createCode,{once:true});
  $("client-referral-copy")?.addEventListener("click",copyLink);
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",function(){var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}});
})(window);

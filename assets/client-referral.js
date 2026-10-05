(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function tierText(x){var range=x.to==null?x.from+" et +":x.from+" à "+x.to;return range+" : "+money(x.reward_minor,state&&state.currency);}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;
  if(state.enabled!==true){box.hidden=true;box.innerHTML="";return;}
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var summary=state.summary||{},code=String(state.code||""),next=state.next_reward||{},schedule=Array.isArray(state.schedule)?state.schedule:[],milestones=Array.isArray(state.milestones)?state.milestones:[],need=Number(state.qualification_paid_months||3);
  var nextReward=money(next.total_minor||state.reward_minor||0,state.currency),nextOrdinal=Number(next.ordinal||Number(summary.rewarded||0)+1);
  var eligibility=state.eligible===true?"Votre parrainage est actif.":"Disponible après activation de votre compte et confirmation de votre abonnement.";
  var codeBlock="";
  if(code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>Prochaine récompense estimée : '+esc(nextReward)+' pour votre filleul qualifié n° '+esc(nextOrdinal)+'.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
  }else{
    codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p>';
  }
  var tiers=schedule.map(function(x){return '<span class="cp-chip">'+esc(tierText(x))+'</span>';}).join(" ");
  var bonuses=milestones.map(function(x){return '<span class="cp-chip">Bonus n° '+esc(x.ordinal)+' : +'+esc(money(x.bonus_minor,state.currency))+'</span>';}).join(" ");
  var recent=Array.isArray(state.recent)?state.recent:[];
  var recentRows=recent.map(function(x){
    var paid=Math.max(0,Math.min(need,Number(x.paid_months||0))),done=x.status==="rewarded";
    var title=x.referred_name||"Filleul";
    var detail=done?"Récompense acquise : "+money(x.reward_minor,x.reward_currency||state.currency):paid+"/"+need+" mensualité(s) réellement encaissée(s)";
    var chip=done?"RÉCOMPENSÉ":x.status==="rejected"?"REJETÉ":"EN VALIDATION";
    return '<div class="cp-row"><div><strong>'+esc(title)+'</strong><span>'+esc(detail)+'</span></div><span class="cp-chip '+(done?"ok":"")+'">'+esc(chip)+'</span></div>';
  }).join("");
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Recommander et cumuler mes récompenses</h2></div><span>'+esc(String(summary.rewarded||0))+' qualifié(s)</span></div>'+
    '<p class="cp-muted">Un filleul déclenche sa récompense après '+esc(need)+' mensualités d’abonnement distinctes réellement encaissées. Le barème est fixe et appliqué automatiquement selon votre nombre de filleuls qualifiés.</p>'+
    codeBlock+
    '<div class="cp-stack"><div class="cp-row"><div><strong>Barème fixe</strong><span>La prime augmente avec votre nombre de filleuls qualifiés.</span></div></div><div>'+tiers+'</div><div>'+bonuses+'</div><p class="cp-muted">À partir du 25e filleul qualifié, la prime de base reste fixée à 20 € par filleul.</p></div>'+
    '<div class="cp-row"><div><strong>'+esc(String(summary.claimed||0))+' parrainage(s) enregistré(s)</strong><span>'+esc(money(summary.reward_minor||0,state.currency))+' de récompenses acquises au total.</span></div></div>'+
    (recentRows?'<div class="cp-stack"><div class="cp-row"><div><strong>Suivi de mes filleuls</strong><span>Progression automatique vers les '+esc(need)+' mensualités requises.</span></div></div>'+recentRows+'</div>':"")+
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
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation de votre abonnement.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(map[e&&e.code]||"Le lien de parrainage n'a pas pu être créé.",true);}
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

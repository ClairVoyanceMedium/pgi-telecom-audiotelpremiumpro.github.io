(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function date(v){if(!v)return"";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"";}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function progressRows(recent){
  if(!recent.length)return '<p class="cp-muted">Aucun filleul enregistré pour le moment.</p>';
  return '<div class="cp-stack">'+recent.slice(0,8).map(function(x,i){
    var paid=Math.max(0,Math.min(3,Number(x.qualified_payments||0))),rewarded=x.status==="rewarded",label=rewarded?"QUALIFIÉ":paid+"/3 MENSUALITÉS";
    return '<div class="cp-row"><div><strong>Filleul #'+esc(String(i+1))+'</strong><span>Enregistré le '+esc(date(x.claimed_at)||"date indisponible")+' · '+(rewarded?("récompense acquise "+money(x.reward_minor,x.reward_currency||"EUR")):("progression de qualification "+paid+"/3"))+'</span></div><span class="cp-chip '+(rewarded?"ok":"")+'">'+esc(label)+'</span></div>';
  }).join("")+'</div>';
}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var summary=state.summary||{},code=String(state.code||""),next=state.next_reward||{},currency=state.currency||"EUR",recent=Array.isArray(state.recent)?state.recent:[];
  var nextTotal=money(next.total_reward_minor||next.base_reward_minor||1000,currency),nextBase=money(next.base_reward_minor||1000,currency),nextBonus=Number(next.milestone_bonus_minor||0);
  var programNotice=state.enabled===true
    ?'<span class="cp-chip ok">PROGRAMME ACTIF</span>'
    :'<span class="cp-chip">PROGRAMME SUSPENDU</span>';
  var eligibility="";
  if(state.enabled!==true)eligibility="Les nouveaux parrainages sont temporairement suspendus. Vos récompenses et votre historique restent visibles.";
  else if(state.eligible!==true)eligibility="Votre lien sera disponible après activation de votre compte et confirmation de votre premier paiement.";
  else eligibility="Votre compte est éligible au programme Ambassadeur.";
  var codeBlock="";
  if(code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>Prochaine récompense prévue au rang '+esc(next.rank||1)+' : '+esc(nextTotal)+(nextBonus?' dont '+esc(money(nextBonus,currency))+' de bonus de palier':'')+'.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien Ambassadeur</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien Ambassadeur</button></div>';
  }else codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p>';
  box.innerHTML=
    '<div class="cp-panel-head"><div><p class="cp-kicker">AMBASSADEUR</p><h2>Recommander et cumuler mes récompenses</h2></div>'+programNotice+'</div>'+
    '<p class="cp-muted">Barème fixe : 10 € du 1er au 4e filleul qualifié, 12 € du 5e au 9e, 15 € du 10e au 24e, puis 20 € à partir du 25e. Bonus automatiques : +5 € au 1er, +20 € au 5e et +50 € au 10e. Un filleul devient qualifié après 3 mensualités réellement encaissées.</p>'+
    '<div class="cp-row"><div><strong>Votre prochaine récompense : '+esc(nextTotal)+'</strong><span>Base '+esc(nextBase)+(nextBonus?' + bonus '+esc(money(nextBonus,currency)):'')+' · rang '+esc(next.rank||1)+'</span></div></div>'+
    codeBlock+
    '<div class="cp-row"><div><strong>'+esc(String(summary.claimed||0))+' parrainage(s) enregistré(s)</strong><span>'+esc(String(summary.rewarded||0))+' qualifié(s) · '+esc(money(summary.reward_minor||0,currency))+' de récompenses acquises au total.</span></div></div>'+
    '<div class="cp-panel-head" style="margin-top:14px"><div><p class="cp-kicker">SUIVI</p><h3>Progression des filleuls</h3></div></div>'+progressRows(recent)+
    '<p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
  bind();
}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true);}}
async function refresh(){
  if(!root.PGICustomerApi||typeof root.PGICustomerApi.referral!=="function")return;
  try{render(await root.PGICustomerApi.referral());}catch(e){if(e&&e.status===401)return;var box=$("client-referral-mount");if(box){box.hidden=false;box.innerHTML='<p class="cp-muted">Le suivi Ambassadeur est momentanément indisponible. Aucun montant de remplacement n’est affiché.</p>';}}
}
async function createCode(){
  if(busy)return;busy=true;status("Création du lien sécurisé...");
  var b=$("client-referral-create");if(b)b.disabled=true;
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien Ambassadeur est prêt.");}
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme Ambassadeur est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le lien sera disponible après activation du compte et confirmation du premier paiement.",REFERRAL_CODE_UNAVAILABLE:"Le lien Ambassadeur est momentanément indisponible."};status(map[e&&e.code]||"Le lien Ambassadeur n'a pas pu être créé.",true);}
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

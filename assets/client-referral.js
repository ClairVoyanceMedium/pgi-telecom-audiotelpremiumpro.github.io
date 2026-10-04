(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;
  if(state.enabled!==true){box.hidden=true;box.innerHTML="";return;}
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var reward=money(state.reward_minor,state.currency),summary=state.summary||{},code=String(state.code||"");
  var eligibility=state.eligible===true?"Votre parrainage est actif.":"Disponible après activation de votre compte et confirmation du premier paiement.";
  var codeBlock="";
  if(code){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>Prime prévue : '+esc(reward)+' par filleul qualifié.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  }else if(state.can_manage===true&&state.eligible===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
  }else{
    codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p>';
  }
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Inviter un nouveau client</h2></div><span>'+esc(String(summary.rewarded||0))+' qualifié(s)</span></div><p class="cp-muted">La récompense de '+esc(reward)+' est acquise uniquement lorsque le filleul devient réellement client avec un abonnement actif et payé. Un simple formulaire ou une inscription ne déclenche aucune prime.</p>'+codeBlock+'<div class="cp-row"><div><strong>'+esc(String(summary.claimed||0))+' parrainage(s) enregistré(s)</strong><span>'+esc(money(summary.reward_minor||0,state.currency))+' de récompenses acquises au total.</span></div></div><p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
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
  catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation du premier paiement.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(map[e&&e.code]||"Le lien de parrainage n'a pas pu être créé.",true);}
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

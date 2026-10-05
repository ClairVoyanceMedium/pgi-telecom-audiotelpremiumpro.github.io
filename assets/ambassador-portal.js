(function(){"use strict";
var api=null,state=null,busy=false;
const $=id=>document.getElementById(id);
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR")}};
const date=v=>{if(!v)return"N/D";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"N/D"};
function authMessage(msg,bad){var e=$("amb-auth-message");if(e){e.textContent=msg||"";e.classList.toggle("bad",bad===true)}}
function secMessage(msg,bad){var e=$("amb-security-message");if(e){e.textContent=msg||"";e.classList.toggle("bad",bad===true)}}
function authPanel(id){["amb-login-panel","amb-activation-panel","amb-forgot-panel","amb-reset-panel"].forEach(x=>$(x).classList.toggle("amb-hidden",x!==id));authMessage("")}
function statusChip(v){var s=String(v||"").toLowerCase(),cls=/paid|active|transferred|rewarded/.test(s)?"ok":/earned|pending|processing|waiting|retry|claimed/.test(s)?"warn":"bad";return '<span class="amb-chip '+cls+'">'+esc(s?s.toUpperCase():"N/D")+'</span>'}
function referralLink(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code)}
function renderLink(data){
  var zone=$("amb-link-zone"),program=data.program||{},ref=data.referral||{};
  if(program.enabled!==true){zone.innerHTML='<div class="amb-note"><strong>Programme actuellement fermé.</strong><br>Votre historique reste disponible. Aucun nouveau filleul ne peut être rattaché tant que le programme n’est pas réactivé.</div>';return}
  if(ref.code){
    var link=referralLink(ref.code);
    zone.innerHTML='<label class="amb-muted">Votre lien personnel</label><input id="amb-referral-link" readonly value="'+esc(link)+'"><div class="amb-actions"><button id="amb-copy-link" class="amb-btn" type="button">Copier mon lien</button><button id="amb-share-link" class="amb-ghost" type="button">Partager</button></div><small class="amb-muted">Code ambassadeur : '+esc(ref.code)+'</small>';
    $("amb-copy-link").onclick=async()=>{try{await navigator.clipboard.writeText(link);secMessage("Lien copié.")}catch(_e){secMessage("Copie impossible sur cet appareil.",true)}};
    $("amb-share-link").onclick=async()=>{var text="Je vous recommande Audiotel Premium Pro. Voici mon lien : "+link;try{if(navigator.share)await navigator.share({title:"Audiotel Premium Pro",text,url:link});else await navigator.clipboard.writeText(text)}catch(_e){}};
  }else{
    zone.innerHTML='<p class="amb-muted">Votre profil est actif. Créez votre lien personnel pour commencer à parrainer.</p><button id="amb-create-code" class="amb-btn" type="button">Créer mon lien ambassadeur</button>';
    $("amb-create-code").onclick=createCode;
  }
}
function renderPayout(data){
  var zone=$("amb-payout-zone"),p=data.payout_account;
  if(p&&p.transfers_enabled===true){
    zone.innerHTML='<div class="amb-row"><div class="amb-row-top"><strong>Versements automatiques prêts</strong>'+statusChip("active")+'</div><span>Votre compte bénéficiaire est validé. Les primes dues sont traitées automatiquement.</span></div>';
  }else{
    var detail=p?"État : "+String(p.status||"en cours")+". Finalisez les informations demandées pour recevoir les versements.":"Activez votre compte de versement pour permettre les paiements automatiques.";
    zone.innerHTML='<p class="amb-muted">'+esc(detail)+'</p><button id="amb-connect-payout" class="amb-btn" type="button">Configurer mes versements</button>';
    $("amb-connect-payout").onclick=connectPayout;
  }
}
function renderReferrals(data){
  var rows=Array.isArray(data.referral&&data.referral.recent)?data.referral.recent:[],required=Number(data.program&&data.program.qualification_paid_invoices)||3,zone=$("amb-referrals");
  if(!rows.length){zone.innerHTML='<p class="amb-empty">Aucun filleul enregistré pour le moment.</p>';return}
  zone.innerHTML=rows.map((x,i)=>{var paid=Math.max(0,Math.min(required,Number(x.paid_invoice_count)||0)),pct=Math.round(paid*100/required),qualified=x.status==="rewarded";return '<article class="amb-row"><div class="amb-row-top"><div><strong>Filleul '+esc(String(x.public_id||"").slice(0,8).toUpperCase())+'</strong><br><small>Enregistré le '+esc(date(x.claimed_at))+'</small></div>'+statusChip(qualified?"rewarded":x.status)+'</div><div class="amb-row-top" style="margin-top:10px"><span>Factures mensuelles payées</span><strong>'+paid+' / '+required+'</strong></div><div class="amb-progress"><i style="width:'+pct+'%"></i></div></article>'}).join("");
}
function renderRewards(data){
  var rows=Array.isArray(data.rewards)?data.rewards:[],body=$("amb-rewards-body"),currency=data.program&&data.program.currency||"EUR";
  if(!rows.length){body.innerHTML='<tr><td colspan="5" class="amb-empty">Aucune prime acquise pour le moment.</td></tr>';return}
  body.innerHTML=rows.map(x=>'<tr><td>'+esc(date(x.earned_at))+'</td><td><strong>'+esc(money(x.amount_minor,x.currency||currency))+'</strong></td><td>'+statusChip(x.status)+'</td><td>'+statusChip(x.payout_state||x.status)+'</td><td>'+esc(x.provider_transfer_reference||x.paid_reference||"En attente")+'</td></tr>').join("");
}
function render(data){
  state=data||{};var s=state.summary||{},conv=state.conversion||{},currency=state.program&&state.program.currency||"EUR",next=state.referral&&state.referral.next_reward||{};
  $("amb-header-name").textContent=state.profile&&state.profile.display_name||"Ambassadeur";
  $("amb-next-reward").textContent=money(next.total_minor||next.reward_minor||0,currency);
  $("amb-next-reward-detail").textContent=state.program&&state.program.enabled===true?"Montant estimé pour votre prochain filleul qualifié.":"Le programme est actuellement fermé aux nouveaux parrainages.";
  $("amb-program-note").textContent=state.program&&state.program.enabled===true?"Programme actif. Un filleul est qualifié après "+String(state.program.qualification_paid_invoices||3)+" factures mensuelles distinctes réellement payées.":"Programme actuellement fermé pour les nouveaux parrainages. Votre historique et vos primes déjà acquises restent conservés.";
  $("amb-kpi-visits").textContent=String(s.visits||0);$("amb-kpi-prospects").textContent=String(s.prospects||0);$("amb-kpi-claimed").textContent=String(s.claimed||0);$("amb-kpi-rewarded").textContent=String(s.rewarded||0);
  $("amb-kpi-earned").textContent=money(s.reward_minor||0,currency);$("amb-kpi-paid").textContent=money(s.paid_minor||0,currency);$("amb-kpi-payable").textContent=money(s.earned_unpaid_minor||0,currency);$("amb-kpi-rate").textContent=(Number(conv.claim_to_reward_percent)||0).toLocaleString("fr-FR")+" %";
  $("amb-rate-visit").textContent=(Number(conv.visit_to_prospect_percent)||0).toLocaleString("fr-FR")+" %";$("amb-rate-prospect").textContent=(Number(conv.prospect_to_claim_percent)||0).toLocaleString("fr-FR")+" %";$("amb-rate-claim").textContent=(Number(conv.claim_to_reward_percent)||0).toLocaleString("fr-FR")+" %";
  renderLink(state);renderPayout(state);renderReferrals(state);renderRewards(state);
}
async function load(){
  var data=await api.dashboard();render(data);$("amb-auth").classList.add("amb-hidden");$("amb-app").classList.remove("amb-hidden");return data
}
async function createCode(){if(busy)return;busy=true;try{await api.createCode(api.key());await load()}catch(e){secMessage(e.code==="REFERRAL_PROGRAM_DISABLED"?"Le programme est actuellement fermé.":"Création du lien impossible.",true)}finally{busy=false}}
async function connectPayout(){if(busy)return;busy=true;try{var r=await api.connectPayout(api.key()),url=r&&r.onboarding&&r.onboarding.url;if(url){location.href=url;return}await load()}catch(e){secMessage("Configuration des versements indisponible : "+String(e.code||"erreur"),true)}finally{busy=false}}
function csvEscape(v){var s=String(v==null?"":v);return /[;"\n"]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(){
  if(!state)return;var rows=[["Type","Identifiant","Date","Statut","Montant","Paiement","Référence"]],currency=state.program&&state.program.currency||"EUR";
  (state.referral&&state.referral.recent||[]).forEach(x=>rows.push(["Filleul",String(x.public_id||"").slice(0,8),date(x.claimed_at),x.status||"",x.reward_minor?money(x.reward_minor,x.reward_currency||currency):"","",""]));
  (state.rewards||[]).forEach(x=>rows.push(["Prime",x.public_id||"",date(x.earned_at),x.status||"",money(x.amount_minor,x.currency||currency),x.payout_state||"",x.provider_transfer_reference||x.paid_reference||""]));
  var blob=new Blob(["\ufeff"+rows.map(r=>r.map(csvEscape).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="parrainage-audiotel-premium-pro.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function doLogin(e){e.preventDefault();if(busy)return;busy=true;authMessage("Connexion...");try{var email=$("amb-login-email").value.trim(),pass=$("amb-login-password").value,tenant=$("amb-login-tenant").value||"",remember=$("amb-remember").checked;await api.login(email,pass,tenant,remember);await load()}catch(err){if(err.status===409&&err.payload&&Array.isArray(err.payload.tenants)){var wrap=$("amb-tenant-wrap"),sel=$("amb-login-tenant");sel.innerHTML=err.payload.tenants.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");wrap.classList.remove("amb-hidden");authMessage("Plusieurs profils sont associés à cette adresse. Choisissez le profil ambassadeur puis reconnectez-vous.")}else if(err.code==="AMBASSADOR_PROFILE_REQUIRED"||err.code==="AMBASSADOR_PROFILE_NOT_ACTIVE")authMessage("Ce profil n’a pas d’espace ambassadeur actif.",true);else authMessage("Connexion impossible. Vérifiez vos identifiants.",true)}finally{busy=false}}
async function activate(e){e.preventDefault();var p=$("amb-activation-password").value,c=$("amb-activation-confirm").value;if(p!==c){authMessage("Les deux mots de passe sont différents.",true);return}if(!$("amb-activation-legal").checked){authMessage("Acceptez les conditions avant l’activation.",true);return}try{var token=new URLSearchParams(location.search).get("invite")||"";await api.activate(token,$("amb-activation-name").value.trim(),p);history.replaceState(null,"",location.pathname);await load()}catch(err){authMessage("Activation impossible : "+String(err.code||"erreur"),true)}}
async function forgot(e){e.preventDefault();try{await api.forgot($("amb-forgot-email").value.trim());authMessage("Si cette adresse correspond à un compte, un lien sécurisé vient d’être envoyé.")}catch(_e){authMessage("Envoi momentanément indisponible.",true)}}
async function reset(e){e.preventDefault();var p=$("amb-reset-password").value,c=$("amb-reset-confirm").value;if(p!==c){authMessage("Les deux mots de passe sont différents.",true);return}var token=String(location.hash||"").replace(/^#password-reset=/,"");try{await api.reset(token,p);history.replaceState(null,"",location.pathname);authPanel("amb-login-panel");authMessage("Mot de passe modifié. Vous pouvez vous connecter.")}catch(err){authMessage("Réinitialisation impossible : "+String(err.code||"erreur"),true)}}
async function changePassword(e){e.preventDefault();try{await api.changePassword($("amb-current-password").value,$("amb-new-password").value);secMessage("Mot de passe modifié. Reconnexion nécessaire.");setTimeout(()=>location.reload(),900)}catch(err){secMessage("Modification impossible : "+String(err.code||"erreur"),true)}}
async function boot(){
  api=window.PGIAmbassadorApi;if(!api){authMessage("Configuration indisponible.",true);return}
  $("amb-login-form").addEventListener("submit",doLogin);$("amb-activation-form").addEventListener("submit",activate);$("amb-forgot-form").addEventListener("submit",forgot);$("amb-reset-form").addEventListener("submit",reset);$("amb-password-form").addEventListener("submit",changePassword);
  $("amb-forgot-open").onclick=()=>authPanel("amb-forgot-panel");$("amb-back-login").onclick=()=>authPanel("amb-login-panel");$("amb-refresh").onclick=()=>load().catch(()=>{});$("amb-export").onclick=exportCsv;$("amb-print").onclick=()=>window.print();$("amb-logout").onclick=async()=>{try{await api.logout()}catch(_e){}location.reload()};
  if(new URLSearchParams(location.search).get("invite")){authPanel("amb-activation-panel");return}
  if(String(location.hash||"").startsWith("#password-reset=")){authPanel("amb-reset-panel");return}
  try{await api.me();await load()}catch(_e){authPanel("amb-login-panel")}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
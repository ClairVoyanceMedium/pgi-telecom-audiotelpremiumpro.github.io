(function(){
"use strict";
const $=id=>document.getElementById(id);
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const TOKEN_KEY="pgi_ambassador_access";
function token(){try{return sessionStorage.getItem(TOKEN_KEY)||localStorage.getItem(TOKEN_KEY)||""}catch{return""}}
function saveToken(v){try{sessionStorage.setItem(TOKEN_KEY,v);localStorage.setItem(TOKEN_KEY,v)}catch{}}
function clearToken(){try{sessionStorage.removeItem(TOKEN_KEY);localStorage.removeItem(TOKEN_KEY)}catch{}}
async function json(path,options={}){
  const headers=Object.assign({"Accept":"application/json"},options.body?{"Content-Type":"application/json"}:{},options.headers||{});
  const r=await fetch("/api/v1"+path,{method:options.method||"GET",credentials:"same-origin",cache:"no-store",headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data?.error?.code||"HTTP_"+r.status);e.code=data?.error?.code||"HTTP_"+r.status;throw e}
  return data;
}
function status(msg,bad=false){const e=$("ambassador-status");if(e){e.textContent=msg||"";e.className="ambassador-status"+(bad?" bad":"")}}
function renderProgram(p){
  if(!p)return;
  document.querySelectorAll("[data-ambassador-min-payout]").forEach(e=>e.textContent=money(p.minimum_payout_minor,p.currency));
  document.querySelectorAll("[data-ambassador-paid-months]").forEach(e=>e.textContent=String(p.qualification_paid_invoices||3));
  const banner=$("ambassador-program-state");
  if(banner&&!p.enabled){banner.hidden=false;banner.textContent="Les nouvelles inscriptions Ambassadeur sont temporairement fermées. Les comptes et récompenses déjà acquis restent suivis."}
}
function renderDashboard(d){
  const box=$("ambassador-dashboard");if(!box)return;
  box.hidden=false;$("ambassador-register-panel").hidden=true;
  const s=d.summary||{},p=d.profile||{},prog=d.progress||{};
  $("ambassador-name").textContent=p.display_name||"Ambassadeur";
  $("ambassador-code").textContent=p.code||"";
  $("ambassador-link").value=d.referral_link||"";
  $("ambassador-kpis").innerHTML=[
    ["Recommandations",s.referrals||0],["Clients qualifiés",s.qualified||0],["En attente",s.pending||0],
    ["Solde acquis",money(s.earned_minor||0)],["Déjà versé",money(s.paid_minor||0)],["Gains cumulés",money(s.lifetime_minor||0)]
  ].map(x=>'<div><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join("");
  const n=$("ambassador-next");
  if(n)n.textContent="Prochain client qualifié : "+money(prog.next_client_reward_minor||0)+(prog.next_milestone?" | prochain bonus au palier "+prog.next_milestone+" : "+money(prog.next_milestone_bonus_minor||0):"");
  const c=$("ambassador-email-consent");if(c)c.checked=p.motivation_email_consent===true;
  const pay=$("ambassador-payout-state");
  if(pay)pay.textContent=s.payable?"Seuil atteint et conformité validée : solde payable.":(p.payout_compliance_status!=="verified"?"Versement disponible après validation administrative des informations de paiement.":"Le versement devient disponible à partir de "+money(d.schedule.minimum_payout_minor,d.schedule.currency)+".");
  const list=$("ambassador-recent");
  if(list)list.innerHTML=(d.recent||[]).map(x=>'<div class="ambassador-row"><strong>'+esc(x.status==="qualified"?"Client qualifié":"Qualification en cours")+'</strong><span>'+(x.status==="qualified"?money(Number(x.base_reward_minor||0)+Number(x.bonus_reward_minor||0)):esc((x.qualifying_paid_invoices||0)+" / "+d.schedule.qualification_paid_invoices+" mensualités payées"))+'</span></div>').join("")||'<p>Aucune recommandation enregistrée pour le moment.</p>';
}
async function loadDashboard(){
  const t=token();if(!t)return;
  try{renderDashboard(await json("/public/ambassadors/dashboard",{headers:{"X-Ambassador-Token":t}}));status("Espace Ambassadeur connecté.")}
  catch(e){clearToken();status("Votre lien d’accès a expiré. Demandez un nouveau lien.",true)}
}
async function register(e){
  e.preventDefault();
  const f=e.currentTarget,b=Object.fromEntries(new FormData(f).entries());
  b.processing_consent=!!$("amb-processing")?.checked;
  b.terms_accepted=!!$("amb-terms")?.checked;
  b.advertising_disclosure_accepted=!!$("amb-disclosure")?.checked;
  b.motivation_email_consent=!!$("amb-emails")?.checked;
  b.country_code="FR";b.website=String(b.website||"");
  status("Création de votre accès Ambassadeur...");
  try{
    const r=await json("/public/ambassadors",{method:"POST",body:b});
    status(r.email_sent?"Accès créé. Le lien sécurisé vient de vous être envoyé par email.":"Accès créé. Vous pouvez demander votre lien sécurisé ci-dessous.");
    f.reset();
  }catch(err){
    status(({AMBASSADOR_PROGRAM_DISABLED:"Le programme est actuellement fermé.",AMBASSADOR_TERMS_REQUIRED:"Vous devez accepter les conditions du programme.",AMBASSADOR_DISCLOSURE_REQUIRED:"Vous devez accepter la règle de transparence publicitaire.",INVALID_AMBASSADOR_EMAIL:"Adresse email invalide."}[err.code]||"Création impossible pour le moment."),true);
  }
}
async function resend(e){
  e.preventDefault();const address=String(new FormData(e.currentTarget).get("email")||"").trim();status("Envoi du lien sécurisé...");
  try{await json("/public/ambassadors/access-link",{method:"POST",body:{email:address}});status("Si cette adresse correspond à un compte Ambassadeur actif, un nouveau lien sécurisé a été envoyé.")}
  catch{status("Demande enregistrée. Réessayez plus tard si nécessaire.",true)}
}
async function preferences(){
  const t=token();if(!t)return;
  try{await json("/public/ambassadors/preferences",{method:"POST",headers:{"X-Ambassador-Token":t},body:{motivation_email_consent:!!$("ambassador-email-consent")?.checked}});status("Préférences email enregistrées.")}
  catch{status("Impossible d’enregistrer la préférence.",true)}
}
function copyLink(){
  const e=$("ambassador-link");if(!e)return;
  navigator.clipboard?.writeText(e.value).then(()=>status("Lien personnel copié.")).catch(()=>{e.select();document.execCommand("copy");status("Lien personnel copié.")});
}
function logout(){clearToken();location.replace("/ambassadeur-audiotel/")}
async function boot(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,"")),incoming=String(hash.get("access")||"");
  if(incoming.length>=32){saveToken(incoming);history.replaceState(null,"",location.pathname+location.search)}
  try{renderProgram(await json("/public/ambassador-program"))}catch{}
  $("ambassador-register")?.addEventListener("submit",register);
  $("ambassador-access")?.addEventListener("submit",resend);
  $("ambassador-copy")?.addEventListener("click",copyLink);
  $("ambassador-save-preferences")?.addEventListener("click",preferences);
  $("ambassador-logout")?.addEventListener("click",logout);
  await loadDashboard();
}
document.addEventListener("DOMContentLoaded",boot);
})();
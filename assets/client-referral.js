(function(root){"use strict";
let busy=false,viewPromise=null;
const $=id=>document.getElementById(id);
const view=()=>viewPromise||(viewPromise=import("./client-referral-view.js"));
function status(message,bad){const x=$("client-referral-status");if(x){x.textContent=message||"";x.classList.toggle("bad",bad===true)}}
async function refresh(){
  if(!root.PGICustomerApi?.referral)return;
  try{const [data,ui]=await Promise.all([root.PGICustomerApi.referral(),view()]),box=$("client-referral-mount");if(box){ui.renderReferral(box,data);bind()}}
  catch(error){if(error?.status===401)return;const box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML=""}}
}
async function createCode(){
  if(busy)return;busy=true;status("Création du lien sécurisé...");
  const b=$("client-referral-create");if(b)b.disabled=true;
  try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien de parrainage est prêt.")}
  catch(error){const messages={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation de votre abonnement actif et payé.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(messages[error?.code]||"Le lien de parrainage n'a pas pu être créé.",true)}
  finally{busy=false;if(b)b.disabled=false}
}
async function activatePayouts(){
  if(busy||!root.PGICustomerApi?.activateReferralPayouts)return;busy=true;status("Ouverture sécurisée de Stripe...");
  const b=$("client-referral-payout-connect");if(b)b.disabled=true;
  try{
    const result=await root.PGICustomerApi.activateReferralPayouts(root.PGICustomerApi.newIdempotencyKey()),url=result?.onboarding?.url;
    if(!/^https:\/\//i.test(String(url||"")))throw new Error("INVALID_ONBOARDING_URL");
    location.assign(url);
  }catch(error){
    const messages={STRIPE_CONNECT_NOT_READY:"Le service de versement est momentanément indisponible.",CUSTOMER_ADMIN_REQUIRED:"Le propriétaire ou un administrateur doit effectuer cette opération.",IDEMPOTENCY_KEY_REQUIRED:"La demande sécurisée doit être relancée."};
    status(messages[error?.code]||"Les coordonnées de versement n'ont pas pu être ouvertes.",true);busy=false;if(b)b.disabled=false
  }
}
async function copyLink(){
  const input=$("client-referral-link");if(!input)return;
  try{await navigator.clipboard.writeText(input.value);status("Lien copié.")}
  catch(_error){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.")}catch(_copy){status("Copie impossible sur cet appareil.",true)}}
}
function bind(){
  $("client-referral-create")?.addEventListener("click",createCode,{once:true});
  $("client-referral-copy")?.addEventListener("click",copyLink);
  $("client-referral-payout-connect")?.addEventListener("click",activatePayouts,{once:true});
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",()=>{const box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML=""}});
})(window);

(function(root){"use strict";
var busy=false;
function $(id){return document.getElementById(id)}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true)}}
async function setup(){
 if(busy||!root.PGICustomerApi?.activateReferralPayouts)return;busy=true;status("Ouverture de la vérification Stripe...");
 var b=$("client-referral-payout");if(b)b.disabled=true;
 try{
  var r=await root.PGICustomerApi.activateReferralPayouts(root.PGICustomerApi.newIdempotencyKey());
  if(r?.onboarding?.url){location.href=r.onboarding.url;return}
  status("Configuration Stripe mise à jour.");
 }catch(e){
  var map={STRIPE_CONNECT_NOT_READY:"Le service de versement Stripe est momentanément indisponible.",CUSTOMER_ADMIN_REQUIRED:"Seul le titulaire ou un administrateur peut configurer les versements."};
  status(map[e?.code]||"La configuration des versements n'a pas pu être ouverte.",true);
 }finally{busy=false;if(b)b.disabled=false}
}
function render(state){
 var mount=$("client-referral-payout-mount");if(!mount)return;
 var p=state?.payout_setup||{};
 if(state?.enabled!==true||!state?.code){mount.innerHTML="";return}
 if(p.configured===true&&p.payouts_enabled===true){
  mount.innerHTML='<div class="cp-row"><div><strong>Versements automatiques configurés</strong><span>Votre compte Stripe est prêt à recevoir les primes acquises. Aucun traitement manuel par PGI Telecom n’est nécessaire.</span></div><span class="cp-chip ok">PRÊT</span></div>';
  return;
 }
 mount.innerHTML='<div class="cp-row"><div><strong>Configurer mes versements automatiques</strong><span>Stripe vérifie votre identité et votre compte de versement une seule fois. Ce compte Stripe unifié peut aussi servir à l’option de paiement par carte, sans obligation de l’utiliser.</span></div><button id="client-referral-payout" class="cp-primary" type="button">'+(p.configured===true?"Finaliser avec Stripe":"Configurer avec Stripe")+'</button></div>';
 $("client-referral-payout").addEventListener("click",setup,{once:true});
}
document.addEventListener("pgi:referral-rendered",function(e){render(e.detail||{})});
})(window);

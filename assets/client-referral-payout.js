var busy=false;
function buttonHtml(payout){
  return '<div class="cp-row"><div><strong>Activer mes versements automatiques</strong><span>Finalisez une fois votre compte de versement sécurisé. Ensuite, chaque prime acquise sera réglée automatiquement.</span></div><button id="client-referral-payout-connect" class="cp-primary" type="button">'+(payout?"Finaliser l’activation":"Activer")+'</button></div>';
}
export function mountReferralPayout(state,api,status){
  var box=document.getElementById("client-referral-payout");if(!box)return;
  var payout=state&&state.payout_account||null;
  var body;
  if(payout&&payout.transfers_enabled===true){
    body='<div class="cp-row"><div><strong>Versements automatiques activés</strong><span>Vos primes acquises sont versées automatiquement dès qu’elles deviennent exigibles, sans demande manuelle.</span></div><span class="cp-chip ok">ACTIF</span></div>';
  }else if(state&&state.can_manage===true){
    body=buttonHtml(payout);
  }else{
    body='<p class="cp-muted">Le propriétaire ou un administrateur du compte doit finaliser l’activation des versements automatiques.</p>';
  }
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">VERSEMENTS</p><h3>Mes primes automatiques</h3></div></div>'+body;
  var b=document.getElementById("client-referral-payout-connect");if(!b)return;
  b.addEventListener("click",async function(){
    if(busy)return;busy=true;b.disabled=true;status("Préparation de votre compte de versement sécurisé...");
    try{
      var result=await api.connectReferralPayout(api.newIdempotencyKey());
      var url=result&&result.onboarding&&result.onboarding.url;
      if(url){location.href=url;return;}
      status("Votre compte de versement est prêt.");
    }catch(e){
      var map={STRIPE_CONNECT_NOT_READY:"Le service de versement est momentanément indisponible.",CUSTOMER_ADMIN_REQUIRED:"Seul le propriétaire ou un administrateur peut activer les versements."};
      status(map[e&&e.code]||"L’activation des versements n’a pas pu être finalisée.",true);
    }finally{busy=false;b.disabled=false;}
  },{once:true});
}

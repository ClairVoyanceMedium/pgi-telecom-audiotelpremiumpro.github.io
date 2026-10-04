export function createController({getDemo,reload,toast}){
  let busy=false;
  async function activate(id){
    if(busy)return;
    if(getDemo()){toast("La priorité PGI sera disponible sur un dossier réel.");return;}
    busy=true;
    try{
      const result=await window.PGICustomerApi.createPortabilityPriorityCheckout(id,window.PGICustomerApi.newIdempotencyKey());
      if(result?.already_paid){await reload();toast("La priorité PGI est déjà activée sur ce dossier.");return;}
      if(result?.payment_confirmation_pending){toast("Paiement reçu. La confirmation sécurisée est en cours, aucun nouveau paiement n’est nécessaire.");setTimeout(()=>reload().catch(()=>{}),1800);return;}
      if(result?.url&&/^https:\/\/checkout\.stripe\.com\//i.test(result.url)){location.assign(result.url);return;}
      throw new Error("CHECKOUT_URL_MISSING");
    }catch(err){
      const messages={PORTABILITY_PRIORITY_NOT_AVAILABLE:"La priorité n’est plus disponible pour ce dossier.",B2C_COMMERCIAL_NOT_READY:"Cette option n’est pas encore disponible pour ce dossier particulier.",PAYMENT_ACCOUNT_NOT_READY:"Le paiement sécurisé est momentanément indisponible.",PAYMENT_PROVIDER_UNAVAILABLE:"Le paiement sécurisé est momentanément indisponible."};
      toast(messages[err?.code]||"Impossible d’ouvrir le paiement de la priorité pour le moment.");
    }finally{busy=false;}
  }
  function handleReturn(){
    const params=new URLSearchParams(location.search),state=params.get("portability-priority");
    if(!state)return;
    toast(state==="success"?"Paiement reçu. La priorité sera affichée dès confirmation sécurisée du paiement.":"Paiement annulé. Votre portabilité reste gratuite et conserve la file standard.");
    const url=new URL(location.href);url.searchParams.delete("portability-priority");url.searchParams.delete("session_id");
    history.replaceState(null,"",url.pathname+(url.search?"?"+url.searchParams.toString():"")+url.hash);
  }
  return {activate,handleReturn};
}

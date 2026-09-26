export function createController(ctx){
  const $=ctx.$,tr=ctx.tr,money=ctx.money,n=ctx.n,dateOnly=ctx.dateOnly,esc=ctx.esc,chip=ctx.chip;

  function activeSubscription(data){
    return (data.subscriptions||[]).find(x=>["active","past_due"].includes(String(x.status||"").toLowerCase()))||null;
  }

  function ensureCancelDialog(){
    let d=$("client-billing-cancel-dialog");
    if(d)return d;
    d=document.createElement("dialog");
    d.id="client-billing-cancel-dialog";
    d.className="cp-dialog";
    d.innerHTML='<div class="cp-dialog-card"><div class="cp-dialog-head"><div><p class="cp-kicker">RÉSILIATION ÉLECTRONIQUE</p><h2>Résilier mon abonnement</h2></div><button class="cp-dialog-close" type="button" data-cancel-close aria-label="Fermer">×</button></div><p class="cp-muted">Vérifiez les informations ci-dessous avant de notifier définitivement la résiliation.</p><div class="cp-stack"><div class="cp-row"><div><strong>Titulaire / compte</strong><span id="client-cancel-holder"></span></div></div><div class="cp-row"><div><strong>Contrat</strong><span id="client-cancel-contract"></span></div></div><div class="cp-row"><div><strong>Date d’effet prévue</strong><span id="client-cancel-effective"></span></div></div><div class="cp-row"><div><strong>Numéros SVA</strong><span>Cette résiliation concerne l’abonnement plateforme. Elle ne demande ni portabilité ni libération automatique d’un numéro.</span></div></div></div><p class="cp-muted">Après notification, la demande reçoit une référence horodatée. Sauf droit impératif ou situation particulière, l’abonnement reste accessible jusqu’à la fin de la période déjà payée puis cesse de se renouveler.</p><div class="cp-search-scopes"><button id="client-cancel-confirm" class="cp-primary" type="button">Notifier la résiliation</button><button type="button" data-cancel-close>Retour</button></div></div>';
    document.body.appendChild(d);
    d.querySelectorAll("[data-cancel-close]").forEach(b=>b.addEventListener("click",()=>d.close()));
    d.addEventListener("click",e=>{if(e.target===d)d.close();});
    $("client-cancel-confirm").addEventListener("click",submitCancellation);
    return d;
  }

  function render(data){
    const rows=data.subscriptions||[],el=$("subscription-list"),provider=data.billing_provider||{},offer=data.billing_offer||null,billingSummary=data.billing_summary||{},currencyInfo=billingSummary.billing_currency||{};
    el.innerHTML=rows.length?rows.slice(0,3).map(x=>{
      const price=x.amount_minor!=null?money(n(x.amount_minor)/100,x.price_currency||x.billing_currency)+" TTC / "+(x.billing_interval==="year"?"an":"mois"):"Tarif contractuel";
      const stage=String(x.recovery_stage||"current");let detail=price+" · période payée jusqu’au "+dateOnly(x.current_period_end);if(x.cancel_at_period_end)detail+=" · résiliation enregistrée, aucun renouvellement après cette date";
      if(stage==="grace")detail+=" · paiement à régulariser, service maintenu jusqu’au "+dateOnly(x.dunning_grace_until);
      if(stage==="retrying")detail+=" · relances automatiques en cours jusqu’au "+dateOnly(x.dunning_deadline_at);
      if(stage==="suspended")detail+=" · accès SVA suspendu jusqu’au règlement";
      return '<div class="cp-row"><div><strong>'+esc(x.plan_name||"Abonnement Audiotel")+'</strong><span>'+esc(detail)+'</span></div>'+chip(stage==="current"?x.status:stage)+"</div>";
    }).join(""):'<p class="cp-empty">Aucun abonnement actif pour le moment.</p>';

    const stateEl=$("client-billing-provider-state"),chipEl=$("client-billing-provider-chip"),start=$("client-billing-start"),manage=$("client-billing-manage"),cancel=$("client-billing-cancel"),offerDetail=$("client-billing-offer-detail"),offerChip=$("client-billing-offer-chip"),consent=$("client-billing-consent");
    if(consent){
      const terms=$("client-billing-terms"),span=terms&&terms.closest("label")?.querySelector("span");
      if(span)span.innerHTML='Avant mon premier paiement, j’accepte les <a href="/conditions-abonnement/" target="_blank" rel="noopener">conditions générales de vente, d’abonnement et de services</a> et les <a href="/conditions-utilisation/" target="_blank" rel="noopener">CGU</a>, applicables selon mon profil particulier ou professionnel. L’abonnement est à durée indéterminée, facturé mensuellement d’avance : la première période est payée maintenant puis chaque mois jusqu’à résiliation. La résiliation peut être demandée à tout moment et prend normalement effet à la fin de la période déjà payée. J’ai pris connaissance de la <a href="/confidentialite/" target="_blank" rel="noopener">politique de confidentialité</a> et, lorsque j’agis comme consommateur, de la fonctionnalité <a href="/retractation/" target="_blank" rel="noopener">Renoncer au contrat ici</a>.';
      if(!$("client-billing-immediate"))consent.insertAdjacentHTML("beforeend",'<label class="cp-check"><input id="client-billing-immediate" type="checkbox"><span>Je demande expressément que l’accès payant commence immédiatement avant la fin du délai de rétractation lorsque ce droit m’est applicable. Je reconnais qu’en cas d’exécution complète du service avant la fin de ce délai, je perds mon droit de rétractation dans les conditions prévues par la loi.</span></label>');
    }
    const current=activeSubscription(data),currentSubscription=Boolean(current);
    const needsRecovery=rows.some(x=>["grace","retrying","suspended"].includes(String(x.recovery_stage||"").toLowerCase()));
    if(consent)consent.hidden=currentSubscription;
    const connected=provider.connection_state&&provider.connection_state!=="not_connected";
    if(offer&&offer.amount_minor!=null){
      const cadence=offer.billing_interval==="year"?"an":"mois",offerPrice=money(n(offer.amount_minor)/100,offer.currency)+" TTC / "+cadence;
      if(offerDetail)offerDetail.textContent=offerPrice+" · "+tr("facturé mensuellement d’avance · résiliation à tout moment, effet fin de période");
      if(offerChip){offerChip.textContent=money(n(offer.amount_minor)/100,offer.currency);offerChip.className="cp-chip ok";}
      if(start)start.textContent=tr("Souscrire avec obligation de paiement")+" — "+offerPrice;
    }else{
      const resolvedCurrency=currencyInfo.currency||((data.tenant||{}).default_currency)||"EUR";
      if(offerDetail)offerDetail.textContent=tr("Devise automatique")+" : "+resolvedCurrency+" · "+tr("tarif local à configurer");
      if(offerChip){offerChip.textContent=resolvedCurrency;offerChip.className="cp-chip warn";}
    }
    if(stateEl)stateEl.textContent=needsRecovery?tr("Paiement à régulariser. Utilisez la facturation sécurisée pour mettre à jour votre moyen de paiement."):connected?tr("Prestataire de paiement configuré."):tr("Architecture de paiement prête, prestataire non connecté.");
    if(chipEl){chipEl.textContent=needsRecovery?tr("À RÉGULARISER"):connected?tr("PRÊT"):tr("NON CONNECTÉ");chipEl.className="cp-chip "+(needsRecovery?"warn":connected?"ok":"neutral");}
    if(start){start.disabled=false;start.setAttribute("aria-disabled",String(!provider.checkout_available||!offer));start.title=!offer?tr("Tarif indisponible pour ce compte."):!provider.checkout_available?tr("Paiement en ligne pas encore activé."):"";}
    if(manage){manage.textContent=needsRecovery?tr("Régulariser mon paiement"):tr("Gérer factures et paiement");manage.disabled=false;manage.setAttribute("aria-disabled",String(!provider.customer_portal_available||!rows.length));manage.title=!rows.length?tr("Aucun abonnement actif à gérer."):!provider.customer_portal_available?tr("Portail de facturation pas encore activé."):"";}
    if(cancel){
      const already=Boolean(current&&current.cancel_at_period_end);
      cancel.textContent=already?tr("Résiliation enregistrée"):tr("Résilier mon abonnement");
      cancel.disabled=already||!currentSubscription;
      cancel.setAttribute("aria-disabled",String(already||!currentSubscription));
      cancel.title=already?tr("Le renouvellement est déjà désactivé."):!currentSubscription?tr("Aucun abonnement actif à résilier."):"";
    }
  }

  function openCancellation(){
    const state=ctx.getState(),data=state.data||{},subscription=activeSubscription(data);
    if(!subscription){ctx.toast("Aucun abonnement actif à résilier.");return;}
    if(subscription.cancel_at_period_end){ctx.toast("La résiliation est déjà enregistrée. Aucun renouvellement n’aura lieu après la période en cours.");return;}
    const d=ensureCancelDialog(),tenant=data.tenant||{};
    $("client-cancel-holder").textContent=tenant.display_name||tenant.name||"Compte client authentifié";
    $("client-cancel-contract").textContent=(subscription.plan_name||"Abonnement Audiotel Premium Pro")+" · facturation mensuelle";
    $("client-cancel-effective").textContent=subscription.current_period_end?dateOnly(subscription.current_period_end):"Fin de la période en cours";
    $("client-cancel-confirm").disabled=false;
    if(typeof d.showModal==="function")d.showModal();
  }

  async function submitCancellation(){
    const state=ctx.getState();if(state.billingBusy)return;
    const button=$("client-cancel-confirm");state.billingBusy=true;if(button){button.disabled=true;button.textContent="Enregistrement…";}
    try{
      const api=window.PGICustomerApi,result=await api.cancelBillingSubscription(api.newIdempotencyKey());
      const d=$("client-billing-cancel-dialog");if(d?.open)d.close();
      if(result&&result.state==="scheduled")ctx.toast("Résiliation enregistrée. Aucun renouvellement après la fin de la période déjà payée.");
      else ctx.toast("Résiliation reçue et horodatée. L’exécution technique est en cours.");
      if(typeof window.PGIReload==="function")await window.PGIReload();
    }catch(err){
      ctx.toast(err&&err.code==="ACTIVE_SUBSCRIPTION_REQUIRED"?"Aucun abonnement actif à résilier.":"La notification n’a pas pu être enregistrée. Réessayez ou utilisez le canal de secours indiqué sur la page de résiliation.");
    }finally{
      state.billingBusy=false;if(button){button.disabled=false;button.textContent="Notifier la résiliation";}
    }
  }

  async function open(kind){
    if(kind==="cancel"){openCancellation();return;}
    const state=ctx.getState();if(state.billingBusy)return;
    if(state.demo){ctx.toast("Prestataire de paiement non connecté.");return;}
    const data=state.data||{},provider=data.billing_provider||{},offer=data.billing_offer||null,rows=data.subscriptions||[];
    if(kind==="start"&&!offer){ctx.toast("Le tarif n’est pas encore disponible pour ce compte.");return;}
    if(kind==="start"&&!provider.checkout_available){ctx.toast("Le paiement en ligne n’est pas encore activé. Votre dossier reste enregistré.");return;}
    if(kind==="start"){
      const terms=$("client-billing-terms");
      if(!terms||!terms.checked){ctx.toast("Acceptez les conditions d’abonnement et les CGU avant le paiement.");if(terms)terms.focus();return;}
      const immediate=$("client-billing-immediate");
      if(!immediate||!immediate.checked){ctx.toast("Confirmez votre demande de commencement immédiat du service.");if(immediate)immediate.focus();return;}
    }
    if(kind==="manage"&&!rows.length){ctx.toast("Aucun abonnement actif à gérer pour le moment.");return;}
    if(kind==="manage"&&!provider.customer_portal_available){ctx.toast("Le portail de facturation n’est pas encore activé.");return;}
    const api=window.PGICustomerApi,action=kind==="manage"?api.createBillingPortal:api.createBillingCheckout;
    const button=kind==="manage"?$("client-billing-manage"):$("client-billing-start"),original=button?button.textContent:"";
    const idempotencyKey=kind==="manage"?null:api.newIdempotencyKey();
    state.billingBusy=true;if(button){button.disabled=true;button.textContent=kind==="manage"?tr("Ouverture de la facturation…"):tr("Ouverture du paiement…");}
    try{
      const result=kind==="manage"?await action():await action(idempotencyKey,{subscription_terms_accepted:true,privacy_notice_acknowledged:true,immediate_performance_requested:true,legal_version:"2026-09-26-b2b-b2c-v3"});
      const target=result&&result.url?new URL(result.url,location.origin):null;
      if(!target||target.protocol!=="https:")throw new Error("INVALID_BILLING_URL");
      location.assign(target.href);
    }catch(err){ctx.toast(err&&err.code==="PAYMENT_PROVIDER_NOT_CONNECTED"?"Prestataire de paiement non connecté.":"Gestion de l’abonnement indisponible.");}
    finally{state.billingBusy=false;if(button){button.textContent=original;render(state.data||{});}}
  }

  function handleReturn(){
    const url=new URL(location.href),result=url.searchParams.get("billing");if(!result)return;
    url.searchParams.delete("billing");url.searchParams.delete("session_id");history.replaceState(null,"",url.pathname+(url.search?"?"+url.searchParams.toString():"")+url.hash);
    if(result==="success")ctx.toast("Paiement reçu par Stripe. L’abonnement sera activé uniquement après confirmation sécurisée du webhook.");
    else if(result==="cancelled")ctx.toast("Paiement annulé. Aucun changement n’a été appliqué.");
    else if(result==="portal-return")ctx.toast("Retour de la facturation sécurisé. Les changements confirmés par Stripe seront synchronisés automatiquement.");
  }
  return {render,open,handleReturn};
}

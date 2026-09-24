let adminModule=null;
const $=id=>document.getElementById(id);
const n=v=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(Number(v)||0);
const money=(v,c)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format(Number(v)||0);}catch{return Number(v||0).toFixed(2)+" €";}};
export function render(summary={},tenantCount=0,provider={}){
  const active=Number(summary.external_subscriptions_active||0);
  const access=Number(summary.subscription_access_enabled||0);
  const blocked=Number(summary.subscription_access_blocked||0);
  const set=(id,value)=>{const e=$(id);if(e)e.textContent=value;};
  set("wh-sub-price",money(Number(summary.subscription_price_minor||300)/100,summary.subscription_price_currency||"EUR")+" TTC/mois");
  set("wh-sub-active",n(active));
  set("wh-sub-active-detail",n(tenantCount)+" client(s) externe(s)");
  set("wh-sub-access",n(access)+" / "+n(tenantCount));
  const grace=Number(summary.subscription_recovery_grace||0),actionRequired=Number(summary.subscription_recovery_action_required||0),suspended=Number(summary.subscription_recovery_suspended||0);
  set("wh-sub-blocked",n(blocked)+" bloqué(s) • "+n(grace)+" en récupération • "+n(suspended)+" suspendu(s)");
  set("wh-sub-internal",summary.internal_billing_exempt===false?"À CONFIGURER":"EXEMPTÉ");
  const connected=provider.connection_state&&provider.connection_state!=="not_connected";
  set("wh-billing-provider",connected?"PRÊT":"NON CONNECTÉ");
  set("wh-billing-provider-state",connected?"Événements de paiement activés":"Architecture prête, connexion à effectuer");
  set("wh-billing-checkout",provider.checkout_available?"ACTIF":"PRÊT À BRANCHER");
  set("wh-billing-payout","OPÉRATEUR → PGI → CLIENT");
  const unpaid=Number(summary.subscription_unpaid_alerts||0),list=$("alerts-list"),count=$("alert-count"),old=$("subscription-unpaid-alert");
  if(old)old.remove();
  if(unpaid&&list){
    const critical=suspended>0;
    const detail=[grace?n(grace)+" en grâce/retry":null,actionRequired?n(actionRequired)+" action bancaire requise":null,suspended?n(suspended)+" suspendu(s)":null].filter(Boolean).join(" • ");
    list.insertAdjacentHTML("afterbegin",'<div id="subscription-unpaid-alert" class="alert-item"><div class="alert-icon '+(critical?"bad":"warn")+'">!</div><div><strong>Recouvrement des abonnements</strong><small>'+detail+'. Les reversements SVA acquis restent inchangés.</small></div></div>');
    if(count)count.textContent=String(Number(count.textContent||0)+1);
  }
  const view=$("view-wholesale"),root=$("customer-admin-root");
  if(view&&view.classList.contains("active")&&root&&window.PGIApi){
    if(!adminModule)adminModule=import("./customer-admin.js");
    adminModule.then(m=>m.render()).then(()=>{import("./customer-profitability.js").then(m=>m.mountFleetProfitability(root)).catch(()=>{});import("./customer-relations.js").then(m=>m.mountFleetRelations(root)).catch(()=>{});}).catch(()=>{});
  }
}

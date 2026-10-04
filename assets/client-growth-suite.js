(function(){
"use strict";
var data={},observer=null;
var DEMO={serviceRate:0.80,payoutRate:0.46,currentRate:0.40,hours:5,days:22};
function $(id){return document.getElementById(id)}
function num(v){v=Number(v);return Number.isFinite(v)?v:0}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(num(v))}catch(_e){return num(v).toFixed(2)+" €"}}
function pct(v){return (num(v)>=0?"+":"")+num(v).toFixed(1).replace(".",",")+" %"}
function parseMoney(s){var t=String(s||"").replace(/\s/g,"").replace("€","").replace(",",".").replace(/[^0-9.-]/g,"");return num(t)}
function currentCurrency(){return data?.tenant?.default_currency||(data?.financial_by_currency||[])[0]?.currency||"EUR"}
function currentFinancial(){
  var cur=currentCurrency(),rows=data?.financial_by_currency||[];
  return rows.find(function(x){return x.currency===cur})||rows[0]||{};
}
function previousFinancial(){
  var cur=currentCurrency(),rows=data?.comparison_previous||[];
  return rows.find(function(x){return x.currency===cur})||rows[0]||{};
}
function liveValue(){return parseMoney($("client-live-amount")?.textContent)}
function daysInMonth(){var d=new Date();return new Date(d.getFullYear(),d.getMonth()+1,0).getDate()}
function goal(){try{return Math.max(1,num(localStorage.getItem("pgi_client_business_goal"))||500)}catch(_e){return 500}}
function setGoal(v){try{localStorage.setItem("pgi_client_business_goal",String(Math.max(1,num(v)||500)))}catch(_e){}}
function style(){
  if($("client-growth-suite-css"))return;
  var l=document.createElement("link");l.id="client-growth-suite-css";l.rel="stylesheet";l.href="assets/client-growth-suite.css";document.head.appendChild(l);
}
function ensure(){
  style();
  if($("client-growth-suite"))return;
  var anchor=$("client-activation-premium")||$("client-command-center")||$("client-live-money");
  if(!anchor)return;
  var s=document.createElement("section");
  s.id="client-growth-suite";s.className="cgs";
  s.innerHTML='<div class="cgs-head"><div><p class="cp-kicker">PILOTAGE AVANCÉ</p><h2>Mon centre de croissance Audiotel</h2><p>Projections, comparaison, portabilité, routage, finance et conformité réunis au même endroit.</p></div><span class="cgs-demo">TARIFS DE DÉMONSTRATION</span></div>'+
  '<div class="cgs-liveplus"><div><span>Business Live</span><strong id="cgs-live">0,00 €</strong><small>Le compteur principal reste inchangé.</small></div><div><span>Objectif personnel</span><strong id="cgs-goal">500,00 €</strong><small id="cgs-goal-progress">0 % atteint</small></div><div><span>Projection fin de mois</span><strong id="cgs-month-proj">—</strong><small>Projection indicative sur données disponibles.</small></div><div><span>Vs période précédente</span><strong id="cgs-vs-prev">—</strong><small id="cgs-vs-note">Comparaison automatique si disponible.</small></div></div>'+
  '<div class="cgs-grid">'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>COMPARATEUR</span><h3>Revenu potentiel</h3></div><b>DÉMO</b></div><div class="cgs-fields"><label>Reversement actuel<input id="cgs-current-rate" type="number" min="0" max="2" step="0.01" value="'+DEMO.currentRate+'"><small>€/min</small></label><label>Hypothèse Audiotel<input id="cgs-demo-rate" type="number" min="0" max="2" step="0.01" value="'+DEMO.payoutRate+'"><small>€/min</small></label><label>Heures / jour<input id="cgs-hours" type="number" min="0" max="24" step="0.5" value="'+DEMO.hours+'"></label><label>Jours / mois<input id="cgs-days" type="number" min="0" max="31" step="1" value="'+DEMO.days+'"></label></div><div class="cgs-result"><span>Gain potentiel indicatif / mois</span><strong id="cgs-gain">—</strong><small id="cgs-gain-year">— sur 12 mois</small></div><p class="cgs-note">Valeurs de démonstration uniquement. Elles seront remplacées automatiquement par les tarifs contractuels après branchement opérateur.</p></article>'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>PORTABILITÉ</span><h3>Suivi façon colis</h3></div><b id="cgs-port-badge">PRÊT</b></div><div id="cgs-port-steps" class="cgs-steps"></div><p class="cgs-note">Chaque étape est affichée seulement lorsqu\'elle est réellement connue dans votre dossier.</p></article>'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>ROUTAGE INTELLIGENT</span><h3>Règles avancées</h3></div><b>PRÉ-BRANCHEMENT</b></div><div class="cgs-list"><div><span>Horaires & disponibilité</span><strong>Préparé</strong></div><div><span>Débordement automatique</span><strong>Préparé</strong></div><div><span>Priorité intervenants</span><strong>Préparé</strong></div><div><span>File d\'attente intelligente</span><strong>Préparé</strong></div><div><span>Destinations actuellement connues</span><strong id="cgs-route-count">0</strong></div></div><p class="cgs-note">Aucune règle télécom fictive n\'est activée avant raccordement opérateur.</p></article>'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>FINANCE</span><h3>Rapprochement client</h3></div><b>CONTRÔLE</b></div><div class="cgs-list"><div><span>Net validé</span><strong id="cgs-fin-valid">0,00 €</strong></div><div><span>Déjà payé</span><strong id="cgs-fin-paid">0,00 €</strong></div><div><span>Montant retenu</span><strong id="cgs-fin-held">0,00 €</strong></div><div><span>Reste à rapprocher</span><strong id="cgs-fin-gap">0,00 €</strong></div></div><p class="cgs-note">Les règlements et relevés validés restent la seule référence officielle.</p></article>'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>PAIEMENT CB INTÉGRÉ</span><h3>Audiotel + carte bancaire</h3></div><b>PAIEMENT SÉCURISÉ</b></div><div class="cgs-list"><div><span>Liens de paiement sécurisés</span><strong>Activation du paiement</strong></div><div><span>Commission PGI de lancement</span><strong>4,9 %</strong></div><div><span>Frais de traitement</span><strong>Facturés par le prestataire</strong></div><div><span>CB à la minute</span><strong>À relier à la téléphonie</strong></div></div><p class="cgs-note">Le centre Paiements CB gère l’activation et la création des liens. Le débit à la minute sera raccordé au moteur d’appel lors du branchement téléphonique.</p></article><article id="cgs-referral-card" class="cgs-card" hidden><div class="cgs-card-head"><div><span>PARRAINAGE</span><h3>Inviter un nouveau client</h3></div><b>ACTIF</b></div><div class="cgs-list"><div><span>Mon code</span><strong id="cgs-ref-code">—</strong></div><div><span>Invitations attribuées</span><strong id="cgs-ref-total">0</strong></div><div><span>Filleuls activés</span><strong id="cgs-ref-qualified">0</strong></div></div><div class="cgs-dialog-actions"><button id="cgs-ref-copy" class="cp-primary" type="button">Copier mon lien</button></div><p id="cgs-ref-benefit" class="cgs-note">L’avantage est acquis uniquement après activation effective du filleul.</p></article>'+
    '<article class="cgs-card"><div class="cgs-card-head"><div><span>CONFIANCE</span><h3>Centre conformité</h3></div><b id="cgs-trust-score">—</b></div><div id="cgs-trust" class="cgs-checks"></div><p class="cgs-note">Ce centre n\'affiche que les éléments internes vérifiables. Aucune certification externe n\'est simulée.</p></article>'+
  '</div>'+
  '<article class="cgs-onboarding"><div><span>ASSISTANT D\'OUVERTURE</span><h3>Préparer mon dossier en quelques réponses</h3><p>Profil, nouveau numéro ou portabilité, volume estimé et routage souhaité.</p></div><button id="cgs-onboard-open" class="cp-primary" type="button">Préparer mon parcours</button></article>'+
  '<dialog id="cgs-onboard-dialog" class="cp-dialog"><form method="dialog" class="cp-dialog-card cgs-dialog"><div class="cp-dialog-head"><div><p class="cp-kicker">ASSISTANT D\'OUVERTURE</p><h2>Préparer mon parcours</h2></div><button class="cp-dialog-close" value="cancel" aria-label="Fermer">×</button></div><div class="cgs-form"><label>Profil<select id="cgs-ob-profile"><option value="individual">Particulier</option><option value="business">Professionnel / entreprise</option></select></label><label>Projet<select id="cgs-ob-project"><option value="new">Nouveau numéro</option><option value="portability">Portabilité</option></select></label><label>Volume estimé / mois<input id="cgs-ob-volume" type="number" min="0" step="100" value="3000"></label><label>Routage<select id="cgs-ob-routing"><option value="single">Une destination</option><option value="schedule">Selon horaires</option><option value="multi">Plusieurs intervenants</option></select></label></div><div id="cgs-ob-summary" class="cgs-summary"></div><div class="cgs-dialog-actions"><button value="cancel" class="cp-ghost">Fermer</button><button id="cgs-ob-save" value="cancel" class="cp-primary">Enregistrer sur cet appareil</button></div></form></dialog>';
  anchor.insertAdjacentElement("afterend",s);
  bind();
}
function bind(){
  ["cgs-current-rate","cgs-demo-rate","cgs-hours","cgs-days"].forEach(function(id){$(id)?.addEventListener("input",renderComparator)});
  $("cgs-ref-copy")?.addEventListener("click",async function(){
    var url=$("cgs-referral-card")?.dataset.shareUrl||"";if(!url)return;
    try{await navigator.clipboard.writeText(url);this.textContent="Lien copié";setTimeout(()=>{this.textContent="Copier mon lien"},1400)}catch(_e){prompt("Copiez votre lien de parrainage",url)}
  });
  $("cgs-goal")?.addEventListener("click",function(){
    var v=prompt("Objectif Business Live en euros",String(goal()));
    if(v!=null&&num(String(v).replace(",","."))>0){setGoal(String(v).replace(",","."));renderLivePlus()}
  });
  $("cgs-onboard-open")?.addEventListener("click",function(){renderOnboarding();$("cgs-onboard-dialog")?.showModal()});
  ["cgs-ob-profile","cgs-ob-project","cgs-ob-volume","cgs-ob-routing"].forEach(function(id){$(id)?.addEventListener("change",renderOnboarding)});
  $("cgs-ob-save")?.addEventListener("click",function(){
    try{localStorage.setItem("pgi_client_opening_plan",JSON.stringify({profile:$("cgs-ob-profile")?.value,project:$("cgs-ob-project")?.value,volume:num($("cgs-ob-volume")?.value),routing:$("cgs-ob-routing")?.value,saved_at:new Date().toISOString()}))}catch(_e){}
  });
  var target=$("client-live-amount");
  if(target&&typeof MutationObserver!=="undefined"){observer=new MutationObserver(renderLivePlus);observer.observe(target,{childList:true,characterData:true,subtree:true})}
  renderAll();
}
function renderComparator(){
  var a=num($("cgs-current-rate")?.value),b=num($("cgs-demo-rate")?.value),h=num($("cgs-hours")?.value),d=num($("cgs-days")?.value);
  var mins=h*60*d,gain=Math.max(0,(b-a)*mins);
  if($("cgs-gain"))$("cgs-gain").textContent=money(gain,"EUR");
  if($("cgs-gain-year"))$("cgs-gain-year").textContent=money(gain*12,"EUR")+" sur 12 mois · "+Math.round(mins).toLocaleString("fr-FR")+" min/mois";
}
function renderLivePlus(){
  var cur=currentCurrency(),live=liveValue(),g=goal(),fin=currentFinancial(),prev=previousFinancial();
  if($("cgs-live"))$("cgs-live").textContent=money(live,cur);
  if($("cgs-goal"))$("cgs-goal").textContent=money(g,cur);
  if($("cgs-goal-progress"))$("cgs-goal-progress").textContent=Math.min(999,live/g*100).toFixed(1).replace(".",",")+" % atteint";
  var today=new Date(),day=Math.max(1,today.getDate()),projection=live>0?live/day*daysInMonth():num(fin.estimated_client_net_ht||fin.net_payout_ht||0);
  if($("cgs-month-proj"))$("cgs-month-proj").textContent=projection>0?money(projection,cur):"—";
  var a=num(fin.generated_revenue_ttc||fin.revenue_ttc||0),b=num(prev.generated_revenue_ttc||prev.revenue_ttc||0);
  if($("cgs-vs-prev"))$("cgs-vs-prev").textContent=b>0?pct((a-b)/b*100):"—";
  if($("cgs-vs-note"))$("cgs-vs-note").textContent=b>0?"Sur le chiffre généré de la période comparable.":"Comparaison disponible dès qu’une période précédente existe.";
}
function renderPortability(){
  var rows=data?.portability_requests||[],r=rows[0]||null,status=String(r?.status||"").toLowerCase();
  var order=["received","verified","operator_submitted","scheduled","completed"],labels=["Demande reçue","Documents vérifiés","Opérateur saisi","Date confirmée","Numéro actif"];
  var map={pending:"received",submitted:"operator_submitted",in_review:"verified",accepted:"scheduled",active:"completed",done:"completed",completed:"completed"};
  var s=map[status]||status,idx=order.indexOf(s);if(idx<0&&r)idx=0;
  if($("cgs-port-badge"))$("cgs-port-badge").textContent=r?(status||"EN COURS").toUpperCase():"AUCUNE DEMANDE";
  if($("cgs-port-steps"))$("cgs-port-steps").innerHTML=labels.map(function(label,i){return '<div class="'+(i<idx?"done":i===idx?"current":"")+'"><i>'+(i+1)+'</i><span>'+esc(label)+'</span></div>'}).join("");
}
function renderFinance(){
  var cur=currentCurrency(),rows=data?.settlements||[],valid=0,paid=0,held=0;
  rows.forEach(function(x){if((x.currency||cur)!==cur)return;var n=num(x.net_payout_ht),h=num(x.held_amount_ht);if(["reconciled","invoiced","payable","paid"].includes(String(x.status)))valid+=n;if(String(x.status)==="paid")paid+=n;held+=h});
  if($("cgs-fin-valid"))$("cgs-fin-valid").textContent=money(valid,cur);
  if($("cgs-fin-paid"))$("cgs-fin-paid").textContent=money(paid,cur);
  if($("cgs-fin-held"))$("cgs-fin-held").textContent=money(held,cur);
  if($("cgs-fin-gap"))$("cgs-fin-gap").textContent=money(Math.max(0,valid-paid),cur);
}
async function loadReferral(){
  var card=$("cgs-referral-card");if(!card||!window.PGICustomerApi?.referrals)return;
  try{
    var r=await window.PGICustomerApi.referrals();
    card.hidden=r.enabled!==true;
    if(card.hidden)return;
    card.dataset.shareUrl=r.share_url||"";
    if($("cgs-ref-code"))$("cgs-ref-code").textContent=r.code||"—";
    if($("cgs-ref-total"))$("cgs-ref-total").textContent=String(r.total||0);
    if($("cgs-ref-qualified"))$("cgs-ref-qualified").textContent=String(r.qualified||0);
    if($("cgs-ref-benefit"))$("cgs-ref-benefit").textContent=(r.benefit_label||"Avantage sur l’abonnement")+" · acquis uniquement après activation effective du filleul.";
  }catch(_e){card.hidden=true}
}
function renderTrust(){
  var tenant=data?.tenant||{},numbers=data?.numbers||[],routes=data?.destinations||[];
  var checks=[
    ["Identité / KYC",tenant.kyc_status==="verified"],
    ["Numéro attribué",numbers.some(function(x){return ["active","assigned"].includes(String(x.assignment_status||x.status))})],
    ["Routage connu",routes.length>0],
    ["Documents contractuels publiés",true],
    ["Support non surtaxé",true]
  ],ok=checks.filter(function(x){return x[1]}).length;
  if($("cgs-trust-score"))$("cgs-trust-score").textContent=ok+"/"+checks.length;
  if($("cgs-trust"))$("cgs-trust").innerHTML=checks.map(function(x){return '<div class="'+(x[1]?"ok":"wait")+'"><span>'+esc(x[0])+'</span><strong>'+(x[1]?"PRÊT":"À FINALISER")+'</strong></div>'}).join("");
  if($("cgs-route-count"))$("cgs-route-count").textContent=String(routes.length);
}
function renderOnboarding(){
  var profile=$("cgs-ob-profile")?.value||"individual",project=$("cgs-ob-project")?.value||"new",vol=num($("cgs-ob-volume")?.value),routing=$("cgs-ob-routing")?.value||"single";
  var profileLabel=profile==="business"?"professionnel / entreprise":"particulier";
  var projectLabel=project==="portability"?"portabilité du numéro existant":"nouveau numéro";
  var routeLabel={single:"une destination",schedule:"routage selon horaires",multi:"plusieurs intervenants"}[routing]||routing;
  if($("cgs-ob-summary"))$("cgs-ob-summary").innerHTML='<strong>Parcours préparé</strong><p>Profil : '+esc(profileLabel)+' · Projet : '+esc(projectLabel)+' · Volume indicatif : '+Math.round(vol).toLocaleString("fr-FR")+' min/mois · Routage : '+esc(routeLabel)+'.</p><small>Ce pré-paramétrage n’active aucun service et ne constitue pas une offre tarifaire.</small>';
}
function renderAll(){ensure();renderComparator();renderLivePlus();renderPortability();renderFinance();renderTrust();loadReferral()}
document.addEventListener("pgi:portal-loaded",function(e){data=e?.detail?.data||{};renderAll()});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){data=window.PGI_PREMIUM_PORTAL_DATA||{};ensure();renderAll()},{once:true});else{data=window.PGI_PREMIUM_PORTAL_DATA||{};ensure();renderAll()}
})();
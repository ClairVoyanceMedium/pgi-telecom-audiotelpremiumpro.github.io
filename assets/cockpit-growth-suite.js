(function(){
"use strict";
var DEMO={service:0.80,payout:0.46,expert:0.18,minutes:6600,current:0.40};
var mo=null;
function $(id){return document.getElementById(id)}
function n(v){v=Number(v);return Number.isFinite(v)?v:0}
function money(v){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n(v))}catch(_e){return n(v).toFixed(2)+" €"}}
function parseMoney(v){return n(String(v||"").replace(/\s/g,"").replace("€","").replace(",",".").replace(/[^0-9.-]/g,""))}
function goal(){try{return Math.max(1,n(localStorage.getItem("pgi_cockpit_business_goal"))||2500)}catch(_e){return 2500}}
function setGoal(v){try{localStorage.setItem("pgi_cockpit_business_goal",String(Math.max(1,n(v)||2500)))}catch(_e){}}
function style(){
 if($("cockpit-growth-suite-css"))return;
 var l=document.createElement("link");l.id="cockpit-growth-suite-css";l.rel="stylesheet";l.href="assets/cockpit-growth-suite.css";document.head.appendChild(l)
}
function go(view){document.querySelector('[data-view="'+view+'"]')?.click()}
function ensure(){
 style();
 if($("cockpit-growth-suite"))return true;
 var live=$("live-jackpot-card");if(!live)return false;
 var s=document.createElement("section");s.id="cockpit-growth-suite";s.className="kgs";
 s.innerHTML='<div class="kgs-head"><div><p class="panel-kicker">CENTRE DE CROISSANCE</p><h2>Pilotage commercial & opérationnel avancé</h2><p>Couche indépendante de Business Live : projections, comparaison, portabilité, routage, finance et conformité.</p></div><span>TARIFS DÉMO · NON CONTRACTUELS</span></div>'+
 '<div class="kgs-live"><div><span>Business Live</span><strong id="kgs-live">0,00 €</strong><small>Lecture seule du compteur existant</small></div><div><span>Objectif plateforme</span><strong id="kgs-goal">2 500,00 €</strong><small id="kgs-goal-pct">0 % atteint</small></div><div><span>Projection rythme actuel</span><strong id="kgs-projection">—</strong><small>Indicatif, sans impact sur les CDR</small></div><div><span>Vitesse actuelle</span><strong id="kgs-rate">0,00 € / s</strong><small>Issue de Business Live</small></div></div>'+
 '<div class="kgs-grid">'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>COMPARATEUR COMMERCIAL</span><h3>Scénario de reversement</h3></div><b>DÉMO</b></div><div class="kgs-form"><label>Reversement actuel<input id="kgs-current" type="number" min="0" max="2" step="0.01" value="'+DEMO.current+'"></label><label>Hypothèse PGI<input id="kgs-payout" type="number" min="0" max="2" step="0.01" value="'+DEMO.payout+'"></label><label>Minutes / mois<input id="kgs-minutes" type="number" min="0" step="100" value="'+DEMO.minutes+'"></label></div><div class="kgs-highlight"><span>Écart potentiel indicatif</span><strong id="kgs-gain">—</strong><small id="kgs-gain-year">—</small></div><p>Hypothèses modifiables de démonstration uniquement. Les valeurs réelles viendront du catalogue opérateur contractuel.</p></article>'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>PORTABILITÉ</span><h3>Pipeline de suivi</h3></div><b>5 ÉTAPES</b></div><div class="kgs-timeline"><i class="ok">1</i><span>Demande</span><i>2</i><span>Contrôles</span><i>3</i><span>Opérateur</span><i>4</i><span>Date</span><i>5</i><span>Actif</span></div><button type="button" data-kgs-go="wholesale">Ouvrir les dossiers</button><p>Le statut réel d’un client reste déterminé par son dossier et l’opérateur, jamais par ce visuel.</p></article>'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>ROUTAGE INTELLIGENT</span><h3>Orchestrateur préparé</h3></div><b>PRÊT À BRANCHER</b></div><div class="kgs-list"><div><span>Plages horaires</span><strong>Préparé</strong></div><div><span>Débordement</span><strong>Préparé</strong></div><div><span>Priorités intervenants</span><strong>Préparé</strong></div><div><span>File d’attente</span><strong id="kgs-queue">0</strong></div><div><span>Bascule destination</span><strong>Préparé</strong></div></div><button type="button" data-kgs-go="carriers">Ouvrir le routage</button></article>'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>FINANCE</span><h3>Rapprochement automatique</h3></div><b>CONTRÔLE</b></div><div class="kgs-list"><div><span>CA affiché</span><strong id="kgs-ca">0,00 €</strong></div><div><span>Reversement attendu</span><strong id="kgs-expected">0,00 €</strong></div><div><span>Encaissé</span><strong id="kgs-paid">0,00 €</strong></div><div><span>Écart</span><strong id="kgs-gap">0,00 €</strong></div></div><button type="button" data-kgs-go="finance">Ouvrir Finance</button></article>'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>PAIEMENT MULTICANAL</span><h3>Audiotel + CB + forfait</h3></div><b>NON ACTIVÉ</b></div><div class="kgs-list"><div><span>SVA</span><strong>Architecture prête</strong></div><div><span>CB à la minute</span><strong>Connecteur à brancher</strong></div><div><span>Forfait prépayé</span><strong>Connecteur à brancher</strong></div><div><span>Rapport unifié</span><strong>Structure prête</strong></div></div><p>Aucun paiement CB à la minute n’est déclaré actif avant contrat et branchement du prestataire adapté.</p></article>'+
  '<article class="kgs-card"><div class="kgs-title"><div><span>CONFORMITÉ</span><h3>Centre de confiance</h3></div><b id="kgs-trust">PRÉPARATION</b></div><div class="kgs-list"><div><span>Documents publics</span><strong>Publiés</strong></div><div><span>Support non surtaxé</span><strong>Prévu</strong></div><div><span>KYC clients</span><strong id="kgs-kyc">En attente d’activité</strong></div><div><span>Opérateur attributaire</span><strong id="kgs-operator">À contractualiser</strong></div></div><button type="button" data-kgs-go="wholesale">Ouvrir conformité</button></article>'+
 '</div>'+
 '<article class="kgs-launch"><div><span>ASSISTANT D\'OUVERTURE AUTOMATISÉ</span><h3>Dossier → KYC → numéro → routage → activation → suivi</h3><p id="kgs-launch-state">Le cockpit suit déjà les prérequis de lancement. Cette vue les rassemble en parcours unique.</p></div><div class="kgs-launch-actions"><label>Tarif service démo<input id="kgs-service-demo" type="number" min="0" max="3" step="0.01" value="'+DEMO.service+'"></label><label>Coût intervenant démo<input id="kgs-expert-demo" type="number" min="0" max="3" step="0.01" value="'+DEMO.expert+'"></label></div></article>';
 live.insertAdjacentElement("afterend",s);
 bind();render();return true
}
function bind(){
 ["kgs-current","kgs-payout","kgs-minutes"].forEach(function(id){$(id)?.addEventListener("input",renderComparator)});
 $("kgs-goal")?.addEventListener("click",function(){var v=prompt("Objectif Business Live plateforme en euros",String(goal()));if(v!=null&&n(String(v).replace(",","."))>0){setGoal(String(v).replace(",","."));renderLive()}});
 document.querySelectorAll("[data-kgs-go]").forEach(function(b){b.addEventListener("click",function(){go(b.dataset.kgsGo)})});
 var targets=["live-jackpot","live-jackpot-rate","kpi-ca","kpi-expected","kpi-paid","live-queue","wh-check-kyc","host-active-carrier"].map($).filter(Boolean);
 if(typeof MutationObserver!=="undefined"){mo=new MutationObserver(render);targets.forEach(function(x){mo.observe(x,{childList:true,characterData:true,subtree:true})})}
}
function renderComparator(){
 var cur=n($("kgs-current")?.value),pay=n($("kgs-payout")?.value),mins=n($("kgs-minutes")?.value),gain=Math.max(0,(pay-cur)*mins);
 if($("kgs-gain"))$("kgs-gain").textContent=money(gain)+" / mois";
 if($("kgs-gain-year"))$("kgs-gain-year").textContent=money(gain*12)+" / an · démonstration";
}
function renderLive(){
 var live=parseMoney($("live-jackpot")?.textContent),rate=parseMoney($("live-jackpot-rate")?.textContent),g=goal();
 if($("kgs-live"))$("kgs-live").textContent=money(live);
 if($("kgs-goal"))$("kgs-goal").textContent=money(g);
 if($("kgs-goal-pct"))$("kgs-goal-pct").textContent=Math.min(999,live/g*100).toFixed(1).replace(".",",")+" % atteint";
 if($("kgs-rate"))$("kgs-rate").textContent=money(rate)+" / s";
 var proj=live+rate*3600*8;
 if($("kgs-projection"))$("kgs-projection").textContent=live>0||rate>0?money(proj):"—";
}
function renderFinance(){
 var ca=parseMoney($("kpi-ca")?.textContent),exp=parseMoney($("kpi-expected")?.textContent),paid=parseMoney($("kpi-paid")?.textContent);
 if($("kgs-ca"))$("kgs-ca").textContent=money(ca);
 if($("kgs-expected"))$("kgs-expected").textContent=money(exp);
 if($("kgs-paid"))$("kgs-paid").textContent=money(paid);
 if($("kgs-gap"))$("kgs-gap").textContent=money(Math.max(0,exp-paid));
}
function renderReadiness(){
 if($("kgs-queue"))$("kgs-queue").textContent=$("live-queue")?.textContent||"0";
 if($("kgs-kyc"))$("kgs-kyc").textContent=$("wh-check-kyc")?.textContent||"En attente d’activité";
 if($("kgs-operator"))$("kgs-operator").textContent=$("host-active-carrier")?.textContent||"À contractualiser";
 var gates=["gate-carrier-state","gate-number-state","gate-sip-state","gate-compliance-state"].map(function(id){return String($(id)?.textContent||"")});
 var ready=gates.filter(function(x){return /PRÊT|READY|ACTIF/i.test(x)}).length;
 if($("kgs-launch-state"))$("kgs-launch-state").textContent=ready+"/4 prérequis de lancement actuellement prêts. Les autres basculeront avec les branchements réels.";
 if($("kgs-trust"))$("kgs-trust").textContent=ready>=3?"AVANCÉ":"PRÉPARATION";
}
function render(){if(!ensure())return;renderComparator();renderLive();renderFinance();renderReadiness()}
function boot(){if(ensure()){render();return}var tries=0,t=setInterval(function(){tries++;if(ensure()||tries>40){clearInterval(t);render()}},100)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
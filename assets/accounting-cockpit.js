(function(root){"use strict";
var $=function(id){return document.getElementById(id);},state={data:null,key:"",inflight:null};
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];});}
function money(minor,basis){var n=(Number(minor)||0)/100;try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(n)+(basis?" "+basis:"");}catch(_e){return n.toFixed(2)+" EUR"+(basis?" "+basis:"");}}
function num(v){return new Intl.NumberFormat("fr-FR").format(Number(v)||0);}
function when(v){if(!v)return"N/D";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"N/D";}
function periodLabel(range){if(!range)return"Période active";var a=new Date(range.from),b=new Date(range.to);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))return"Période active";return new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(a)+" au "+new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(b);}
function demo(range){return {schema_version:"audiotel-platform-accounting/1",generated_at:new Date().toISOString(),range:range||{},currency:"EUR",summary:{tracked_cash_in_minor:0,tracked_cash_out_minor:0,tracked_cash_balance_minor:0,operating_contribution_minor:0,operator_receivable_ht_minor:0,client_payable_ht_minor:0,referral_payable_minor:0,subscription_failed_count:0,card_dispute_count:0},revenue:{subscriptions:{collected_minor:0,paid_count:0,failed_count:0,action_required_count:0},portability_priority:{collected_minor:0,paid_count:0},card_fees:{collected_minor:0,refunded_minor:0,net_collected_minor:0,payments_count:0,refund_count:0,dispute_count:0},sva:{upstream_collected_ht_minor:0,margin_booked_ht_minor:0,margin_collected_ht_minor:0,operator_receivable_ht_minor:0}},outflows:{clients:{paid_ht_minor:0,payable_ht_minor:0,scheduled_ht_minor:0,held_ht_minor:0},referrals:{earned_minor:0,paid_minor:0,payable_minor:0,earned_count:0,paid_count:0}},monthly:[],ledger:[],integrity:{ledger_truncated:false,notes:["Mode démonstration : aucun flux réel n’est chargé."]}};}
function kpi(label,value,note,cls){return '<article class="acct-kpi '+(cls||"")+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note||"")+'</small></article>';}
function row(label,value,note,tone){return '<div class="acct-line"><div><strong>'+esc(label)+'</strong><small>'+esc(note||"")+'</small></div><span class="'+esc(tone||"")+'">'+esc(value)+'</span></div>';}
function sourceLabel(v){return({subscription:"Abonnement",portability_priority:"Portabilité prioritaire",card_fee:"Commission CB",card_fee_refund:"Remboursement commission CB",sva_upstream:"Règlement opérateur SVA",sva_client_payout:"Reversement client SVA",referral_reward:"Prime ambassadeur"})[v]||v||"Flux";}
function render(data){
 state.data=data;
 var el=$("accounting-root");if(!el)return;
 var s=data.summary||{},r=data.revenue||{},sub=r.subscriptions||{},prio=r.portability_priority||{},card=r.card_fees||{},sva=r.sva||{},o=data.outflows||{},clients=o.clients||{},refs=o.referrals||{},monthly=Array.isArray(data.monthly)?data.monthly:[],ledger=Array.isArray(data.ledger)?data.ledger:[],integrity=data.integrity||{};
 var monthlyRows=monthly.length?monthly.map(function(x){return '<tr><td>'+esc(x.month)+'</td><td>'+esc(money(x.subscription_minor,"TTC"))+'</td><td>'+esc(money(x.priority_minor,"TTC"))+'</td><td>'+esc(money(x.card_fee_minor))+'</td><td>'+esc(money(x.sva_margin_ht_minor,"HT"))+'</td><td>'+esc(money(x.referral_paid_minor))+'</td><td><strong>'+esc(money(x.contribution_minor))+'</strong></td></tr>';}).join(""):'<tr><td colspan="7" class="acct-empty">Aucun mouvement sur les douze derniers mois.</td></tr>';
 var ledgerRows=ledger.length?ledger.map(function(x){var out=x.direction==="outflow";return '<tr><td>'+esc(when(x.occurred_at))+'</td><td>'+esc(sourceLabel(x.source))+'</td><td>'+esc(x.label||"")+'</td><td>'+esc(x.reference||"N/D")+'</td><td><span class="acct-status">'+esc(x.status||"comptabilisé")+'</span></td><td>'+esc(x.basis||"")+'</td><td class="'+(out?"acct-negative":"acct-positive")+'">'+(out?"− ":"+ ")+esc(money(x.amount_minor))+'</td></tr>';}).join(""):'<tr><td colspan="7" class="acct-empty">Aucune écriture financière sur cette période.</td></tr>';
 var notes=(Array.isArray(integrity.notes)?integrity.notes:[]).map(function(x){return "<li>"+esc(x)+"</li>";}).join("");
 el.innerHTML=
 '<section class="acct-hero"><div><p class="panel-kicker">PILOTAGE COMPTABLE</p><h2>Comptabilité Audiotel Premium Pro</h2><p>Une vue unique des flux réellement enregistrés par la plateforme, sans confondre estimations commerciales, argent client et revenu PGI.</p></div><div class="acct-actions"><span class="acct-period">'+esc(periodLabel(data.range))+'</span><button id="acct-refresh" class="secondary-btn" type="button">Actualiser</button><button id="acct-export" class="secondary-btn" type="button">Exporter CSV</button><button id="acct-print" class="secondary-btn" type="button">Imprimer / PDF</button></div></section>'+
 '<section class="acct-kpis">'+
 kpi("Encaissements suivis",money(s.tracked_cash_in_minor),"Flux enregistrés sur la période","primary")+
 kpi("Décaissements suivis",money(s.tracked_cash_out_minor),"Reversements clients + primes payées","")+
 kpi("Solde opérationnel suivi",money(s.tracked_cash_balance_minor),"Hors TVA SVA non modélisée et frais généraux",Number(s.tracked_cash_balance_minor)>=0?"good":"bad")+
 kpi("Contribution PGI suivie",money(s.operating_contribution_minor),"Produits PGI suivis moins primes payées","good")+
 kpi("À recevoir opérateur",money(s.operator_receivable_ht_minor,"HT"),"Confirmé mais non encaissé","warn")+
 kpi("À payer clients",money(s.client_payable_ht_minor,"HT"),"Reversements devenus payables","warn")+
 kpi("Primes ambassadeurs à payer",money(s.referral_payable_minor),"Récompenses gagnées non réglées","warn")+
 kpi("Alertes financières",num((s.subscription_failed_count||0)+(s.card_dispute_count||0)),"Impayés abonnement + litiges CB",((s.subscription_failed_count||0)+(s.card_dispute_count||0))?"bad":"good")+
 '</section>'+
 '<section class="acct-grid"><article class="acct-panel"><div class="acct-panel-head"><div><p class="panel-kicker">ENTRÉES</p><h3>Revenus et encaissements</h3></div></div>'+
 row("Abonnements",money(sub.collected_minor,"TTC"),num(sub.paid_count)+" facture(s) payée(s)","good")+
 row("Portabilité prioritaire",money(prio.collected_minor,"TTC"),num(prio.paid_count)+" option(s) payée(s)","good")+
 row("Commissions Paiement CB",money(card.net_collected_minor),num(card.payments_count)+" paiement(s), remboursements déduits","good")+
 row("Marge SVA encaissée",money(sva.margin_collected_ht_minor,"HT"),"Marge PGI rattachée aux règlements opérateur","good")+
 row("Règlements opérateur SVA",money(sva.upstream_collected_ht_minor,"HT"),"Flux amont reçu avant reversement client","")+
 '</article><article class="acct-panel"><div class="acct-panel-head"><div><p class="panel-kicker">SORTIES & ENGAGEMENTS</p><h3>Reversements et coûts</h3></div></div>'+
 row("Reversements clients payés",money(clients.paid_ht_minor,"HT"),"Sorties effectivement marquées payées","")+
 row("Reversements clients à payer",money(clients.payable_ht_minor,"HT"),"Montants au statut payable","warn")+
 row("Reversements réconciliés",money(clients.scheduled_ht_minor,"HT"),"Attribués mais pas encore payables","")+
 row("Montants retenus",money(clients.held_ht_minor,"HT"),"Retenues actives sur distributions","warn")+
 row("Primes parrainage gagnées",money(refs.earned_minor),num(refs.earned_count)+" récompense(s) sur la période","")+
 row("Primes parrainage payées",money(refs.paid_minor),num(refs.paid_count)+" règlement(s) sur la période","")+
 '</article></section>'+
 '<section class="acct-grid"><article class="acct-panel"><div class="acct-panel-head"><div><p class="panel-kicker">RISQUES</p><h3>À surveiller</h3></div></div>'+
 row("Échecs abonnement",num(sub.failed_count),num(sub.action_required_count)+" action(s) de paiement requise(s)",sub.failed_count?"bad":"good")+
 row("Litiges Paiement CB",num(card.dispute_count),num(card.refund_count)+" remboursement(s) constaté(s)",card.dispute_count?"bad":"good")+
 row("Créances opérateur",money(sva.operator_receivable_ht_minor,"HT"),"Confirmé non payé par l’opérateur",sva.operator_receivable_ht_minor?"warn":"good")+
 row("Primes en attente",money(refs.payable_minor),"À régler aux ambassadeurs",refs.payable_minor?"warn":"good")+
 '</article><article class="acct-panel acct-doctrine"><div class="acct-panel-head"><div><p class="panel-kicker">RÈGLE COMPTABLE</p><h3>Données séparées par nature</h3></div></div><ul>'+notes+'</ul><p>Le volume des paiements CB encaissé pour le compte du client n’est jamais traité comme un revenu PGI. Seule la commission PGI est reprise ici.</p></article></section>'+
 '<section class="acct-panel acct-wide"><div class="acct-panel-head"><div><p class="panel-kicker">HISTORIQUE</p><h3>Douze derniers mois</h3></div></div><div class="acct-table-wrap"><table><thead><tr><th>Mois</th><th>Abonnements</th><th>Portabilité</th><th>Commission CB</th><th>Marge SVA</th><th>Parrainage payé</th><th>Contribution suivie</th></tr></thead><tbody>'+monthlyRows+'</tbody></table></div></section>'+
 '<section class="acct-panel acct-wide"><div class="acct-panel-head"><div><p class="panel-kicker">JOURNAL</p><h3>Écritures financières de la période</h3></div><span class="acct-counter">'+num(ledger.length)+' ligne(s)'+(integrity.ledger_truncated?" · export limité":"")+'</span></div><div class="acct-table-wrap"><table><thead><tr><th>Date</th><th>Source</th><th>Libellé</th><th>Référence</th><th>Statut</th><th>Base</th><th>Montant</th></tr></thead><tbody>'+ledgerRows+'</tbody></table></div></section>';
 bindActions();
}
function bindActions(){
 var r=$("acct-refresh"),e=$("acct-export"),p=$("acct-print");
 if(r)r.onclick=function(){refresh(state.range||{},true);};
 if(e)e.onclick=exportCsv;
 if(p)p.onclick=function(){window.print();};
}
function exportCsv(){
 if(!state.data)return;
 var rows=[["Date","Source","Libellé","Référence","Statut","Base","Sens","Montant EUR"]];
 (state.data.ledger||[]).forEach(function(x){rows.push([when(x.occurred_at),sourceLabel(x.source),x.label||"",x.reference||"",x.status||"",x.basis||"",x.direction==="outflow"?"Sortie":"Entrée",((Number(x.amount_minor)||0)/100).toFixed(2).replace(".",",")]);});
 function q(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';}
 var csv="\uFEFF"+rows.map(function(x){return x.map(q).join(";");}).join("\r\n");
 var blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="comptabilite-audiotel-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href);},0);
}
function showLoading(){var el=$("accounting-root");if(el)el.innerHTML='<section class="acct-panel acct-loading"><strong>Chargement de la comptabilité…</strong><small>Rapprochement des flux abonnement, SVA, CB, portabilité et parrainage.</small></section>';}
function showError(err){var el=$("accounting-root");if(el)el.innerHTML='<section class="acct-panel acct-error"><strong>Comptabilité temporairement indisponible</strong><small>'+esc(err&&err.code?err.code:"Erreur de chargement")+'</small><button id="acct-retry" class="secondary-btn" type="button">Réessayer</button></section>';var b=$("acct-retry");if(b)b.onclick=function(){refresh(state.range||{},true);};}
async function refresh(range,force){
 range=range||{};state.range=range;
 var from=range.from instanceof Date?range.from.toISOString():range.from,to=range.to instanceof Date?range.to.toISOString():range.to,key=String(from||"")+"|"+String(to||"");
 if(!force&&state.data&&state.key===key){render(state.data);return state.data;}
 if(state.inflight)return state.inflight;
 showLoading();
 state.inflight=(async function(){
   try{
     var data;
     if((root.PGI_CONFIG||{}).mode!=="production"||!root.PGIApi||typeof root.PGIApi.platformAccounting!=="function")data=demo({from:from,to:to});
     else data=await root.PGIApi.platformAccounting({from:from,to:to,limit:1000});
     state.key=key;render(data);return data;
   }catch(err){showError(err);throw err;}
   finally{state.inflight=null;}
 })();
 return state.inflight;
}
root.PGIAccountingCockpit=Object.freeze({refresh:refresh,exportCsv:exportCsv});
})(window);

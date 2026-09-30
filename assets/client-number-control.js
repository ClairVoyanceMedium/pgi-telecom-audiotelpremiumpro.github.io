(function(root){
"use strict";

const $=id=>document.getElementById(id);
const n=value=>{const x=Number(value);return Number.isFinite(x)?x:0;};
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const statusLabels={active:"Actif",assigned:"Attribué",pending:"En attente",suspended:"Suspendu",closed:"Clos",paid:"Payé",payable:"À payer",reconciled:"Rapproché",imported:"Importé",held:"Retenu",draft:"Brouillon"};
let currentData=null;
let selectedNumberId=null;
let styled=false;

function nf(value,digits=0){
  return new Intl.NumberFormat("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n(value));
}
function money(value,currency){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:String(currency||"EUR"),minimumFractionDigits:2,maximumFractionDigits:2}).format(n(value));}
  catch(_e){return nf(value,2)+" "+String(currency||"EUR");}
}
function dateOnly(value){
  if(!value)return"—";
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return"—";
  return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short"}).format(d);
}
function chip(status){
  const s=String(status||"pending"),tone=["active","assigned","paid","reconciled"].includes(s)?"ok":["suspended","held"].includes(s)?"warn":"neutral";
  return '<span class="cp-chip '+tone+'">'+esc(statusLabels[s]||s.replaceAll("_"," "))+"</span>";
}
function injectStyles(){
  if(styled||document.getElementById("client-number-control-style"))return;styled=true;
  const style=document.createElement("style");style.id="client-number-control-style";
  style.textContent=".cp-line-control-mount,.cp-finance-ledger-mount{grid-column:1/-1}.cp-line-control{display:grid;gap:16px}.cp-line-toolbar{display:flex;gap:12px;align-items:end;justify-content:space-between;flex-wrap:wrap}.cp-line-toolbar label{display:grid;gap:6px;min-width:min(100%,340px);font-size:12px;color:var(--muted)}.cp-line-toolbar select{min-height:42px;border:1px solid rgba(120,103,93,.26);border-radius:10px;background:var(--panel,#fff);color:inherit;padding:0 12px}.cp-line-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.cp-line-kpi{padding:14px;border:1px solid rgba(120,103,93,.16);border-radius:14px;background:rgba(120,103,93,.035)}.cp-line-kpi span,.cp-line-kpi small{display:block;color:var(--muted);font-size:11px}.cp-line-kpi strong{display:block;font-size:21px;margin:5px 0 2px}.cp-line-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cp-line-detail{padding:14px;border:1px solid rgba(120,103,93,.16);border-radius:14px}.cp-line-detail h3{margin:0 0 10px;font-size:15px}.cp-line-detail-list{display:grid;gap:8px}.cp-line-detail-row{display:flex;justify-content:space-between;gap:16px;align-items:start}.cp-line-detail-row span{color:var(--muted);font-size:12px}.cp-line-detail-row strong{text-align:right;font-size:13px}.cp-line-note{margin:0;color:var(--muted);font-size:12px}.cp-finance-ledger{grid-column:1/-1}.cp-ledger-summary{display:flex;gap:8px;flex-wrap:wrap}.cp-ledger-summary span{padding:5px 9px;border:1px solid rgba(120,103,93,.16);border-radius:999px;font-size:11px;color:var(--muted)}.cp-ledger-table td,.cp-ledger-table th{white-space:nowrap}.cp-ledger-table td:first-child,.cp-ledger-table th:first-child{white-space:normal}.cp-ledger-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:920px){.cp-line-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-line-detail-grid{grid-template-columns:1fr}}@media(max-width:560px){.cp-line-kpis{grid-template-columns:1fr}.cp-line-detail-row{display:grid;gap:2px}.cp-line-detail-row strong{text-align:left}}";
  document.head.appendChild(style);
}
function numberLabel(row){return row?.display_number||row?.e164||"Numéro";}
function performanceFor(data,id){
  const rows=data?.number_performance||[];
  return rows.find(x=>String(x.sva_number_id)===String(id))||null;
}
function destinationsFor(data,id){
  return (data?.destinations||[]).filter(x=>x.sva_number_id==null||String(x.sva_number_id)===String(id));
}
function renderLineDetails(data){
  const mount=$("client-line-control-mount");if(!mount)return;
  const numbers=data?.numbers||[];
  if(!numbers.length){
    mount.innerHTML='<article class="cp-panel cp-chart-card cp-chart-wide"><div class="cp-panel-head"><div><p class="cp-kicker">PILOTAGE PAR NUMÉRO</p><h2>Centre de contrôle de mes lignes</h2></div><span class="cp-chip neutral">PRÊT</span></div><p class="cp-empty">Aucun numéro n’est encore attribué. Le centre de contrôle s’alimentera automatiquement dès le raccordement d’une ligne réelle.</p></article>';
    return;
  }
  if(!selectedNumberId||!numbers.some(x=>String(x.id)===String(selectedNumberId)))selectedNumberId=String(numbers[0].id);
  const line=numbers.find(x=>String(x.id)===String(selectedNumberId))||numbers[0];
  const perf=performanceFor(data,line.id);
  const calls=n(perf?.calls_total),connected=n(perf?.calls_connected),answer=calls?connected/calls*100:0,minutes=n(perf?.billable_seconds)/60;
  const termsApplied=n(perf?.payout_term_matches)>0;
  const routes=destinationsFor(data,line.id);
  const tariff=line.tariff_code||"Non renseigné";
  const rate=Number.isFinite(Number(line.service_rate_ttc_per_min))?money(line.service_rate_ttc_per_min,line.currency)+"/min":"—";
  const options=numbers.map(x=>'<option value="'+esc(x.id)+'"'+(String(x.id)===String(line.id)?" selected":"")+'>'+esc(numberLabel(x))+"</option>").join("");
  const routeHtml=routes.length?routes.map(x=>'<div class="cp-line-detail-row"><span>'+esc(x.sva_number_id==null?"Routage commun":"Destination")+'</span><strong>'+esc((x.label||"Destination")+" · "+(x.destination_uri||"—"))+" "+chip(x.status)+'</strong></div>').join(""):'<p class="cp-empty">Aucune destination configurée pour cette ligne.</p>';
  mount.innerHTML='<article class="cp-panel cp-chart-card cp-chart-wide cp-line-control">'+
    '<div class="cp-panel-head"><div><p class="cp-kicker">PILOTAGE PAR NUMÉRO</p><h2>Centre de contrôle de mes lignes</h2></div>'+chip(line.assignment_status||line.status)+'</div>'+
    '<div class="cp-line-toolbar"><label>Ligne Audiotel<select id="client-line-select">'+options+'</select></label><button id="client-line-open-calls" class="cp-ghost" type="button">Voir les appels de cette ligne</button></div>'+
    '<div class="cp-line-kpis">'+
      '<div class="cp-line-kpi"><span>Appels</span><strong>'+nf(calls)+'</strong><small>Période sélectionnée</small></div>'+
      '<div class="cp-line-kpi"><span>Décrochés</span><strong>'+nf(answer,1)+' %</strong><small>'+nf(connected)+' appel(s)</small></div>'+
      '<div class="cp-line-kpi"><span>Minutes facturables</span><strong>'+nf(minutes,1)+'</strong><small>Trafic consolidé</small></div>'+
      '<div class="cp-line-kpi"><span>Montant service TTC</span><strong>'+money(perf?.generated_revenue_ttc||0,perf?.currency||line.currency)+'</strong><small>Généré sur la période</small></div>'+
      '<div class="cp-line-kpi"><span>Net client estimé HT</span><strong>'+(termsApplied?money(perf?.estimated_client_net_ht||0,perf?.currency||line.currency):"—")+'</strong><small>'+(termsApplied?"Selon conditions actives":"Conditions de reversement requises")+'</small></div>'+
    '</div>'+
    '<div class="cp-line-detail-grid"><div class="cp-line-detail"><h3>Tarification & statut</h3><div class="cp-line-detail-list">'+
      '<div class="cp-line-detail-row"><span>Numéro</span><strong>'+esc(numberLabel(line))+'</strong></div>'+
      '<div class="cp-line-detail-row"><span>Palier appliqué</span><strong>'+esc(tariff)+'</strong></div>'+
      '<div class="cp-line-detail-row"><span>Prix du service</span><strong>'+esc(rate)+'</strong></div>'+
      '<div class="cp-line-detail-row"><span>Type</span><strong>'+esc(line.number_type||"—")+'</strong></div>'+
      '<div class="cp-line-detail-row"><span>KYC affectation</span><strong>'+esc(line.kyc_status||"—")+'</strong></div>'+
      '<div class="cp-line-detail-row"><span>Mise en service</span><strong>'+esc(dateOnly(line.activated_at||line.valid_from))+'</strong></div>'+
    '</div></div><div class="cp-line-detail"><h3>Routage effectif</h3><div class="cp-line-detail-list">'+routeHtml+'</div></div></div>'+
    '<p class="cp-line-note">Les valeurs affichées proviennent uniquement des données réelles disponibles. Les nouveaux paliers tarifaires et changements opérateur ne seront proposés qu’après raccordement à un catalogue SVA confirmé ; aucun tarif n’est simulé.</p>'+
  '</article>';
  $("client-line-select")?.addEventListener("change",e=>{selectedNumberId=String(e.target.value);renderLineDetails(currentData);});
  $("client-line-open-calls")?.addEventListener("click",()=>{
    const filter=$("call-filter-number");
    if(filter&&[...filter.options].some(o=>String(o.value)===String(line.id))){
      filter.value=String(line.id);filter.dispatchEvent(new Event("change",{bubbles:true}));
    }
    $("client-calls")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
}
function csvCell(value){
  const s=String(value??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function ledgerCsv(rows){
  const out=[["Période début","Période fin","Devise","Reversement opérateur HT","Frais plateforme HT","Net client HT","Montant retenu HT","Non affecté HT","Statut","Échéance","Payé le","Référence"]];
  for(const x of rows)out.push([x.period_start,x.period_end,x.currency,x.upstream_payout_ht,x.platform_fee_ht,x.net_payout_ht,x.held_amount_ht,x.unallocated_amount_ht,x.status,x.payment_due_date||"",x.paid_at||"",x.statement_reference||""]);
  return "\ufeff"+out.map(r=>r.map(csvCell).join(";")).join("\r\n");
}
function downloadLedger(rows){
  const blob=new Blob([ledgerCsv(rows)],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="audiotel-grand-livre-reversements-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderLedger(data){
  const mount=$("client-finance-ledger-mount");if(!mount)return;
  const rows=data?.settlements||[];
  const currencies=[...new Set(rows.map(x=>x.currency).filter(Boolean))];
  const summary=currencies.map(currency=>{
    const same=rows.filter(x=>x.currency===currency),net=same.reduce((s,x)=>s+n(x.net_payout_ht),0);
    return '<span>'+esc(currency)+" · "+esc(money(net,currency))+" net sur "+same.length+" période(s)</span>";
  }).join("");
  const body=rows.length?rows.map(x=>{
    const timing=x.paid_at?"Payé "+dateOnly(x.paid_at):x.payment_due_date?"Échéance "+dateOnly(x.payment_due_date):"—";
    return "<tr><td>"+esc(dateOnly(x.period_start)+" → "+dateOnly(x.period_end))+"</td><td>"+esc(money(x.upstream_payout_ht,x.currency))+"</td><td>"+esc(money(x.platform_fee_ht,x.currency))+"</td><td><strong>"+esc(money(x.net_payout_ht,x.currency))+"</strong></td><td>"+esc(money(x.held_amount_ht,x.currency))+"</td><td>"+esc(money(x.unallocated_amount_ht,x.currency))+"</td><td>"+chip(x.status)+"</td><td>"+esc(timing)+"</td><td>"+esc(x.statement_reference||"—")+"</td></tr>";
  }).join(""):'<tr><td colspan="9" class="cp-empty">Aucune période de reversement disponible.</td></tr>';
  mount.innerHTML='<article class="cp-panel cp-finance-ledger"><div class="cp-panel-head"><div><p class="cp-kicker">TRANSPARENCE FINANCIÈRE</p><h2>Grand livre des reversements</h2></div><div class="cp-ledger-actions"><button id="client-ledger-export" class="cp-ghost" type="button"'+(rows.length?"":" disabled")+'>Exporter CSV</button></div></div>'+
    '<div class="cp-ledger-summary">'+(summary||'<span>Aucune période consolidée</span>')+'</div>'+
    '<p class="cp-muted">Détail des montants opérateur, frais de plateforme, net client, retenues et écarts non affectés. Les statuts évoluent jusqu’au rapprochement et au paiement effectif.</p>'+
    '<div class="cp-table-wrap"><table class="cp-table cp-ledger-table"><caption class="cp-visually-hidden">Grand livre des reversements</caption><thead><tr><th>Période</th><th>Opérateur HT</th><th>Frais HT</th><th>Net client HT</th><th>Retenu</th><th>Non affecté</th><th>Statut</th><th>Règlement</th><th>Référence</th></tr></thead><tbody>'+body+'</tbody></table></div></article>';
  $("client-ledger-export")?.addEventListener("click",()=>downloadLedger(rows));
}
function render(data){
  injectStyles();currentData=data||{};renderLineDetails(currentData);renderLedger(currentData);
}
document.addEventListener("pgi:portal-loaded",event=>render(event.detail?.data||{}));
if(root.PGIClientPortalData)render(root.PGIClientPortalData);
})(window);

import {esc,nf,money,date} from "./tenant-control-utils.js";
const nf1=v=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(Number(v)||0);
let current=null,todayCurrent=null;
function style(){
 if(document.getElementById("tenant-consumption-style"))return;
 const s=document.createElement("style");s.id="tenant-consumption-style";s.textContent=".tcc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.tcc-head p{margin:4px 0 0;color:#71869a;font-size:7.5px;line-height:1.45}.tcc-list{display:grid;gap:7px;margin-top:10px}.tcc-row{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(80px,.7fr)) auto;gap:8px;align-items:center;padding:9px;border:1px solid rgba(128,158,192,.09);border-radius:10px;background:#0a1320}.tcc-row span,.tcc-row strong{display:block}.tcc-row span{color:#6d8499;font-size:6.5px;text-transform:uppercase}.tcc-row strong{margin-top:3px;font-size:8.5px}.tcc-result{margin-top:10px;padding:11px;border:1px solid rgba(128,158,192,.12);border-radius:11px;background:#08111d}.tcc-result.match{border-color:rgba(34,211,165,.26);background:rgba(34,211,165,.045)}.tcc-result.difference{border-color:rgba(239,68,68,.28);background:rgba(239,68,68,.045)}.tcc-status{font-size:11px;font-weight:900}.tcc-result.match .tcc-status{color:#92e9cb}.tcc-result.difference .tcc-status{color:#ffadad}.tcc-diff{margin:8px 0 0;padding-left:18px;color:#b8c9d5;font-size:7.5px;line-height:1.6}.tcc-hash{margin-top:7px;color:#678096;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:6.5px;overflow-wrap:anywhere}.tcc-copy{margin-top:8px}@media(max-width:900px){.tcc-row{grid-template-columns:1fr 1fr}.tcc-row>div:first-child{grid-column:1/-1}.tcc-row button{grid-column:1/-1;min-height:44px}}";
 document.head.appendChild(s);
}
function metricLabel(k){return {calls_total:"Appels",calls_connected:"Décrochés",calls_abandoned:"Abandonnés",calls_failed:"Échoués",billable_seconds:"Secondes facturables",generated_revenue_ttc:"Montant TTC",net_payout_ht:"Reversement net",currency:"Devise"}[k]||k}
function row(r){
 const m=r.metrics||{},currency=m.currency||"EUR";
 return '<div class="tcc-row"><div><span>Référence</span><strong>'+esc(r.reference||r.public_id)+'</strong><small>'+esc(date(r.created_at))+' · SHA '+esc(String(r.snapshot_sha256||"").slice(0,12))+'</small></div><div><span>Appels</span><strong>'+nf(m.calls_total)+'</strong></div><div><span>Minutes</span><strong>'+nf1(Number(m.billable_seconds||0)/60)+'</strong></div><div><span>Montant TTC</span><strong>'+money(m.generated_revenue_ttc,currency)+'</strong></div><div><span>Reversement</span><strong>'+money(m.net_payout_ht,currency)+'</strong></div><button class="td-btn mini" data-consumption-reconcile="'+esc(r.public_id)+'">Vérifier</button></div>';
}
function todayText(x){
 const m=x?.metrics||{},c=m.currency||"EUR";
 return ["Consommation aujourd’hui côté serveur","Période : "+date(x.range?.from)+" → "+date(x.range?.to),"Fuseau : "+(x.tenant_timezone||"—"),"Appels : "+nf(m.calls_total),"Décrochés : "+nf(m.calls_connected),"Minutes facturables : "+nf1(Number(m.billable_seconds||0)/60),"Montant service TTC : "+money(m.generated_revenue_ttc,c),"Reversement net validé : "+money(m.net_payout_ht,c),"Empreinte actuelle : "+(x.snapshot_sha256||"—"),"Calculé le : "+date(x.generated_at)].join("\n");
}
function renderToday(x,root){
 todayCurrent=x;const m=x?.metrics||{},c=m.currency||"EUR";
 root.querySelector("[data-consumption-today]").innerHTML='<div class="tcc-result match"><div class="tcc-status">AUJOURD’HUI CÔTÉ SERVEUR</div><p class="td-empty">'+nf(m.calls_total)+' appels · '+nf(m.calls_connected)+' décrochés · '+nf1(Number(m.billable_seconds||0)/60)+' min · '+money(m.generated_revenue_ttc,c)+' TTC · reversement '+money(m.net_payout_ht,c)+'</p><div class="tcc-hash">'+esc(date(x.range?.from))+' → '+esc(date(x.range?.to))+' · '+esc(x.tenant_timezone||"—")+'<br>SHA '+esc(x.snapshot_sha256||"")+'</div><button class="td-btn mini tcc-copy" data-consumption-today-copy>Copier le récapitulatif du jour</button></div>';
}
function summaryText(x){
 const r=x.receipt,m=r.metrics||{},c=m.currency||"EUR",q=x.reconciliation||{},status=q.status==="match"?"CONFORME":"ÉCART";
 return ["Contrôle consommation "+status,"Référence : "+r.reference,"Période : "+date(r.requested_from)+" → "+date(r.requested_to),"Appels : "+nf(m.calls_total),"Décrochés : "+nf(m.calls_connected),"Minutes facturables : "+nf1(Number(m.billable_seconds||0)/60),"Montant service TTC : "+money(m.generated_revenue_ttc,c),"Reversement net validé : "+money(m.net_payout_ht,c),"Empreinte relevé : "+q.receipt_sha256,"Empreinte recalculée : "+q.current_sha256,"Contrôlé le : "+date(q.checked_at)].join("\n");
}
function renderResult(x,root){
 current=x;const q=x.reconciliation||{},m=x.receipt?.metrics||{},c=m.currency||"EUR",diff=q.differences||[];
 root.querySelector("[data-consumption-result]").innerHTML='<div class="tcc-result '+esc(q.status)+'"><div class="tcc-status">'+(q.status==="match"?"CONFORME — le relevé client correspond aux données sources":"ÉCART DÉTECTÉ — les données sources ont changé ou diffèrent")+'</div><div class="tcc-hash">Relevé '+esc(q.receipt_sha256||"")+'<br>Recalcul '+esc(q.current_sha256||"")+'</div>'+(diff.length?'<ul class="tcc-diff">'+diff.map(d=>'<li>'+esc(metricLabel(d.metric))+' : relevé '+esc(d.stored)+' / source '+esc(d.current)+' / écart '+esc(d.difference??"—")+'</li>').join("")+'</ul>':'<p class="td-empty">Aucun écart sur les agrégats : '+nf(m.calls_total)+' appels, '+nf1(Number(m.billable_seconds||0)/60)+' min, '+money(m.generated_revenue_ttc,c)+'.</p>')+'<button class="td-btn mini tcc-copy" data-consumption-copy>Copier le récapitulatif support</button></div>';
}
export async function mountConsumptionCheck(tenantId,root){
 if(!root)return;style();root.hidden=false;root.innerHTML='<div class="tcc-head"><div><h3>Contrôle consommation & preuve miroir</h3><p>Le contrôle du jour montre immédiatement les agrégats autoritatifs. Les relevés SHA comparent ensuite exactement ce que le client a figé dans son dashboard.</p></div><span class="td-chip">SHA-256</span></div><div data-consumption-today><p class="td-empty">Calcul de la consommation du jour…</p></div><div data-consumption-result></div><div class="tcc-list"><p class="td-empty">Chargement des relevés…</p></div>';
 try{
  const [receipts,today]=await Promise.all([window.PGIApi.tenantConsumptionReceipts(tenantId),window.PGIApi.tenantConsumptionToday(tenantId)]);
  renderToday(today,root);
  const rows=receipts.data||[],list=root.querySelector(".tcc-list");
  list.innerHTML=rows.length?rows.map(row).join(""):'<p class="td-empty">Aucun relevé de contrôle créé par ce client. Le contrôle « aujourd’hui côté serveur » reste disponible ci-dessus.</p>';
 }catch(e){root.querySelector(".tcc-list").innerHTML='<p class="td-empty">Contrôle indisponible : '+esc(e.code||e.message)+'</p>'}
 root.onclick=async e=>{
  const b=e.target.closest("[data-consumption-reconcile]");if(b){b.disabled=true;const old=b.textContent;b.textContent="Vérification…";try{const x=await window.PGIApi.reconcileTenantConsumptionReceipt(tenantId,b.dataset.consumptionReconcile);renderResult(x,root)}catch(err){root.querySelector("[data-consumption-result]").innerHTML='<div class="tcc-result difference"><div class="tcc-status">Contrôle impossible : '+esc(err.code||err.message)+'</div></div>'}finally{b.disabled=false;b.textContent=old}return}
  if(e.target.closest("[data-consumption-copy]")&&current){try{await navigator.clipboard.writeText(summaryText(current));e.target.textContent="Récapitulatif copié";setTimeout(()=>e.target.textContent="Copier le récapitulatif support",1200)}catch{}}
  if(e.target.closest("[data-consumption-today-copy]")&&todayCurrent){try{await navigator.clipboard.writeText(todayText(todayCurrent));e.target.textContent="Récapitulatif copié";setTimeout(()=>e.target.textContent="Copier le récapitulatif du jour",1200)}catch{}}
 };
}

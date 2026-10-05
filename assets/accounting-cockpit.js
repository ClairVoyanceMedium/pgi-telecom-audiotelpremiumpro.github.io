const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const moneyMinor=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format((Number(v)||0)/100)}catch{return ((Number(v)||0)/100).toFixed(2)+" "+c}};
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(Number(v)||0)}catch{return (Number(v)||0).toFixed(2)+" "+c}};
const integer=v=>new Intl.NumberFormat("fr-FR").format(Number(v)||0);
let root=null,current=null,month=new Date().toISOString().slice(0,7),currency="EUR",busy=false;

function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw new Error("API_NOT_CONFIGURED");return b;}
async function fetchAccounting(){
  const q=new URLSearchParams({month,currency}),r=await fetch(apiBase()+"/platform/accounting?"+q.toString(),{credentials:"include",cache:"no-store",headers:{Accept:"application/json"}}),p=await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(new Error(p?.error?.code||"API_HTTP_"+r.status),{code:p?.error?.code||"API_HTTP_"+r.status,status:r.status});
  return p;
}
function css(){
  if(document.getElementById("accounting-cockpit-style"))return;
  const s=document.createElement("style");s.id="accounting-cockpit-style";s.textContent=
  ".acc{display:grid;gap:14px}.acc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}.acc-head h2{margin:0}.acc-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.acc-controls label{display:grid;gap:5px;font-size:11px;color:#8ba0b4}.acc-controls input,.acc-controls select{min-height:38px;border:1px solid rgba(137,164,190,.22);border-radius:9px;background:#07101b;color:#edf7ff;padding:6px 9px}.acc-btn{min-height:38px;border:1px solid rgba(137,164,190,.22);border-radius:9px;background:#101d2c;color:#edf7ff;padding:7px 11px;font-weight:750;cursor:pointer}.acc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.acc-kpi{padding:14px;border:1px solid rgba(137,164,190,.12);border-radius:13px;background:#091522}.acc-kpi span{display:block;color:#8298aa;font-size:10px;text-transform:uppercase;letter-spacing:.05em}.acc-kpi strong{display:block;margin-top:7px;font-size:20px}.acc-kpi small{display:block;margin-top:5px;color:#70869a;line-height:1.4}.acc-section{padding:14px;border:1px solid rgba(137,164,190,.11);border-radius:13px;background:rgba(7,16,27,.72)}.acc-section-head{display:flex;justify-content:space-between;align-items:end;gap:10px;margin-bottom:10px}.acc-section h3{margin:0;font-size:15px}.acc-balance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.acc-balance{padding:11px;border-radius:10px;background:#0b1826}.acc-balance span{display:block;color:#8198aa;font-size:9px;text-transform:uppercase}.acc-balance strong{display:block;margin-top:5px;font-size:15px}.acc-balance small{display:block;color:#71869a;margin-top:3px}.acc-table{overflow:auto}.acc-table table{width:100%;border-collapse:collapse;min-width:1080px}.acc-table th,.acc-table td{padding:8px 7px;border-bottom:1px solid rgba(137,164,190,.09);font-size:10px;text-align:right;white-space:nowrap}.acc-table th:first-child,.acc-table td:first-child{text-align:left}.acc-table th{color:#8da2b5;font-weight:750}.acc-note{margin:0;color:#8195a8;font-size:10px;line-height:1.55}.acc-note strong{color:#dceaf4}.acc-empty{padding:35px 14px;text-align:center;color:#8297aa}.acc-status{font-size:10px;color:#8297aa}.acc-status.bad{color:#f1a5a5}@media(max-width:1050px){.acc-kpis,.acc-balance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.acc-kpis,.acc-balance-grid{grid-template-columns:1fr}.acc-controls{width:100%}.acc-controls label{flex:1;min-width:130px}.acc-controls input,.acc-controls select{width:100%}}@media print{body *{visibility:hidden!important}#accounting-cockpit-root,#accounting-cockpit-root *{visibility:visible!important}#accounting-cockpit-root{position:absolute!important;left:0!important;top:0!important;width:100%!important;background:#fff!important;color:#111!important}#accounting-cockpit-root .acc{gap:10px!important}#accounting-cockpit-root .acc-controls,#accounting-cockpit-root .acc-btn{display:none!important}#accounting-cockpit-root .acc-kpis,#accounting-cockpit-root .acc-balance-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}#accounting-cockpit-root .acc-kpi,#accounting-cockpit-root .acc-section,#accounting-cockpit-root .acc-balance{background:#fff!important;color:#111!important;border:1px solid #bbb!important;break-inside:avoid}#accounting-cockpit-root .acc-kpi span,#accounting-cockpit-root .acc-kpi small,#accounting-cockpit-root .acc-balance span,#accounting-cockpit-root .acc-balance small,#accounting-cockpit-root .acc-note,#accounting-cockpit-root .acc-status{color:#333!important}#accounting-cockpit-root .acc-table{overflow:visible!important}#accounting-cockpit-root .acc-table table{min-width:0!important;font-size:8pt!important}#accounting-cockpit-root .acc-table th,#accounting-cockpit-root .acc-table td{color:#111!important;border-bottom:1px solid #ccc!important;white-space:normal!important;padding:5px 4px!important}@page{size:A4 landscape;margin:10mm}}";
  document.head.appendChild(s);
}
function monthLabel(v){
  const d=new Date(String(v)+"-01T00:00:00Z");
  return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(d):String(v||"");
}
function selectedCards(d){
  const s=d.selected||{},c=d.currency||"EUR";
  return '<div class="acc-kpis">'+
    '<article class="acc-kpi"><span>Abonnements encaissés TTC</span><strong>'+esc(moneyMinor(s.subscriptions_collected_ttc_minor,c))+'</strong><small>'+integer(s.subscriptions_paid_invoices)+' facture(s) Stripe payée(s)</small></article>'+
    '<article class="acc-kpi"><span>Portabilité prioritaire TTC</span><strong>'+esc(moneyMinor(s.portability_priority_collected_ttc_minor,c))+'</strong><small>'+integer(s.portability_priority_sales)+' option(s) encaissée(s)</small></article>'+
    '<article class="acc-kpi"><span>Commissions paiement CB PGI</span><strong>'+esc(moneyMinor((s.card_payment_pgi_fee_minor||0)-(s.card_payment_refunded_fee_minor||0),c))+'</strong><small>Frais PGI nets des remboursements enregistrés</small></article>'+
    '<article class="acc-kpi"><span>Marge SVA encaissée HT</span><strong>'+esc(money(s.sva_margin_collected_ht,c))+'</strong><small>Marge pondérée par les règlements opérateurs réellement reçus</small></article>'+
    '<article class="acc-kpi"><span>Marge SVA comptabilisée HT</span><strong>'+esc(money(s.sva_margin_booked_ht,c))+'</strong><small>Montant commercial attribué à PGI sur les répartitions</small></article>'+
    '<article class="acc-kpi"><span>Reversements clients payés HT</span><strong>'+esc(money(s.client_payout_paid_ht,c))+'</strong><small>'+integer(s.client_payout_paid_count)+' règlement(s) client(s)</small></article>'+
    '<article class="acc-kpi"><span>Primes parrainage acquises</span><strong>'+esc(moneyMinor(s.referral_rewards_earned_minor,c))+'</strong><small>'+integer(s.referral_rewards_earned_count)+' récompense(s) qualifiée(s)</small></article>'+
    '<article class="acc-kpi"><span>Primes parrainage versées</span><strong>'+esc(moneyMinor(s.referral_rewards_paid_minor,c))+'</strong><small>'+integer(s.referral_rewards_paid_count)+' transfert(s) automatique(s)</small></article>'+
  '</div>';
}
function balances(d){
  const b=d.current_balances||{},c=d.currency||"EUR";
  return '<section class="acc-section"><div class="acc-section-head"><div><p class="panel-kicker">À TRAITER</p><h3>Encours actuels</h3></div><span class="acc-status">Situation au '+esc(new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(d.generated_at)))+'</span></div>'+
    '<div class="acc-balance-grid">'+
      '<div class="acc-balance"><span>Primes parrainage à verser</span><strong>'+esc(moneyMinor(b.referral_rewards_payable_minor,c))+'</strong><small>'+integer(b.referral_rewards_payable_count)+' prime(s) · '+integer(b.referral_rewards_queued_count)+' en file · '+integer(b.referral_rewards_processing_count)+' en cours · '+integer(b.referral_rewards_missing_details_count)+' coordonnées à compléter · '+integer(b.referral_rewards_failed_count)+' en reprise automatique</small></div>'+
      '<div class="acc-balance"><span>Reversements clients à payer HT</span><strong>'+esc(money(b.client_payout_payable_ht,c))+'</strong><small>'+integer(b.client_payout_payable_count)+' ligne(s)</small></div>'+
      '<div class="acc-balance"><span>Reversements clients bloqués HT</span><strong>'+esc(money(b.client_payout_blocked_ht,c))+'</strong><small>'+integer(b.client_payout_blocked_count)+' ligne(s) sous contrôle</small></div>'+
      '<div class="acc-balance"><span>Créances opérateurs HT</span><strong>'+esc(money(b.carrier_receivable_ht,c))+'</strong><small>'+integer(b.carrier_receivable_count)+' règlement(s) incomplet(s)</small></div>'+
    '</div></section>';
}
function history(d){
  const rows=Array.isArray(d.monthly_history)?d.monthly_history:[],c=d.currency||"EUR";
  return '<section class="acc-section"><div class="acc-section-head"><div><p class="panel-kicker">HISTORIQUE</p><h3>12 mois de pilotage comptable</h3></div><button class="acc-btn" type="button" data-acc-export>Exporter CSV</button></div><div class="acc-table"><table><thead><tr><th>Mois</th><th>Abonnements TTC</th><th>Priorité TTC</th><th>Commission CB PGI</th><th>Marge SVA encaissée HT</th><th>Marge SVA comptabilisée HT</th><th>Reversements clients payés HT</th><th>Parrainage acquis</th><th>Parrainage versé</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+esc(monthLabel(x.month))+'</td><td>'+esc(moneyMinor(x.subscriptions_collected_ttc_minor,c))+'</td><td>'+esc(moneyMinor(x.portability_priority_collected_ttc_minor,c))+'</td><td>'+esc(moneyMinor((x.card_payment_pgi_fee_minor||0)-(x.card_payment_refunded_fee_minor||0),c))+'</td><td>'+esc(money(x.sva_margin_collected_ht,c))+'</td><td>'+esc(money(x.sva_margin_booked_ht,c))+'</td><td>'+esc(money(x.client_payout_paid_ht,c))+'</td><td>'+esc(moneyMinor(x.referral_rewards_earned_minor,c))+'</td><td>'+esc(moneyMinor(x.referral_rewards_paid_minor,c))+'</td></tr>').join("")+
    '</tbody></table></div></section>';
}
function policy(d){
  const p=d.accounting_policy||{},notes=Array.isArray(p.notes)?p.notes:[];
  return '<section class="acc-section"><div class="acc-section-head"><div><p class="panel-kicker">FIABILITÉ</p><h3>Règles de lecture</h3></div></div><p class="acc-note"><strong>Comptabilité automatisée de pilotage.</strong> Les flux sont calculés depuis les sources financières faisant foi du site. Les montants TTC, HT et les commissions sans détail fiscal disponible restent séparés. Aucun taux de TVA ni conversion de devise n’est inventé. Ce tableau ne remplace pas les écritures fiscales et le journal légal lorsqu’ils ne sont pas fournis par une source comptable connectée.</p>'+
    (notes.length?'<ul class="acc-note">'+notes.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':"")+
  '</section>';
}
function render(d){
  current=d;currency=d.currency||currency;month=d.month||month;
  const currencies=Array.isArray(d.currencies)&&d.currencies.length?d.currencies:[currency];
  root.innerHTML='<div class="acc">'+
    '<div class="acc-head"><div><p class="panel-kicker">COMPTABILITÉ</p><h2>Pilotage comptable Audiotel Premium Pro</h2><p class="acc-note">Vue consolidée des encaissements, marges, reversements et primes, sans mélange artificiel des bases fiscales.</p><p class="acc-note">Période imprimée : '+esc(monthLabel(month))+' · Devise : '+esc(currency)+'</p></div>'+
    '<div class="acc-controls"><label>Mois<input type="month" data-acc-month value="'+esc(month)+'"></label><label>Devise<select data-acc-currency>'+currencies.map(x=>'<option value="'+esc(x)+'" '+(x===currency?"selected":"")+'>'+esc(x)+'</option>').join("")+'</select></label><button class="acc-btn" type="button" data-acc-refresh>Actualiser</button><button class="acc-btn" type="button" data-acc-print>Imprimer</button></div></div>'+
    selectedCards(d)+balances(d)+history(d)+policy(d)+
  '</div>';
  bind();
}
function csvCell(v){return '"'+String(v??"").replace(/"/g,'""')+'"';}
function exportCsv(){
  if(!current)return;
  const c=current.currency||"EUR",rows=[["Mois","Devise","Abonnements encaissés TTC","Portabilité prioritaire TTC","Commission CB PGI nette","Marge SVA encaissée HT","Marge SVA comptabilisée HT","Reversements clients payés HT","Primes parrainage acquises","Primes parrainage versées"]];
  for(const x of current.monthly_history||[])rows.push([x.month,c,(Number(x.subscriptions_collected_ttc_minor)||0)/100,(Number(x.portability_priority_collected_ttc_minor)||0)/100,((Number(x.card_payment_pgi_fee_minor)||0)-(Number(x.card_payment_refunded_fee_minor)||0))/100,Number(x.sva_margin_collected_ht)||0,Number(x.sva_margin_booked_ht)||0,Number(x.client_payout_paid_ht)||0,(Number(x.referral_rewards_earned_minor)||0)/100,(Number(x.referral_rewards_paid_minor)||0)/100]);
  const blob=new Blob(["\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="audiotel-comptabilite-"+month+"-"+c+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bind(){
  root.querySelector("[data-acc-month]")?.addEventListener("change",e=>{month=e.target.value||month;load();});
  root.querySelector("[data-acc-currency]")?.addEventListener("change",e=>{currency=e.target.value||currency;load();});
  root.querySelector("[data-acc-refresh]")?.addEventListener("click",load);
  root.querySelector("[data-acc-print]")?.addEventListener("click",()=>window.print());
  root.querySelector("[data-acc-export]")?.addEventListener("click",exportCsv);
}
async function load(){
  if(!root||busy)return;busy=true;
  root.innerHTML='<div class="acc-empty">Calcul de la comptabilité en cours...</div>';
  try{render(await fetchAccounting());}
  catch(e){root.innerHTML='<div class="acc-empty">Comptabilité indisponible : '+esc(e?.code||e?.message||"erreur")+'.</div>';}
  finally{busy=false;}
}
export async function mountAccounting(host,options={}){
  if(!host)return;const sameHost=root===host;root=host;css();root.hidden=false;
  if(sameHost&&current&&options.force!==true){render(current);return;}
  await load();
}

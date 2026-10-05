const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
let ctx=null,lastData=null;
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return b}
async function getAccounting(months){
  const res=await fetch(apiBase()+"/platform/accounting?months="+encodeURIComponent(months)+"&currency=EUR",{credentials:"include",cache:"no-store",headers:{"Accept":"application/json"}});
  const data=await res.json().catch(()=>null);if(!res.ok){const e=new Error(data?.error?.code||"API_HTTP_"+res.status);e.code=data?.error?.code||"API_HTTP_"+res.status;throw e}return data;
}
function feedback(msg,type=""){ctx?.feedback?.(msg,type)}
function csv(data){
  const h=["Mois","Abonnements TTC","Portabilité prioritaire TTC","Volume CB clients","Commission PGI CB","Marge SVA HT","Opérateur SVA HT","Reversements clients HT","Commissions ambassadeurs acquises","Commissions ambassadeurs versées"];
  const rows=(data.months||[]).map(x=>[x.month,x.subscription_cash_ttc_minor/100,x.priority_portability_cash_ttc_minor/100,x.card_payment_volume_minor/100,x.card_payment_pgi_fee_minor/100,x.sva_platform_fee_ht_minor/100,x.sva_upstream_payout_ht_minor/100,x.sva_client_net_payout_ht_minor/100,x.referral_commissions_earned_minor/100,x.referral_commissions_paid_minor/100]);
  return [h,...rows].map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\n");
}
function downloadCsv(){
  if(!lastData)return;const blob=new Blob(["\ufeff"+csv(lastData)],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="comptabilite-audiotel-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function render(data){
  lastData=data;const root=ctx.root,s=data.summary||{},c=data.currency||"EUR",rows=Array.isArray(data.months)?data.months:[];
  const monthly=rows.slice().reverse().map(x=>'<div class="pa-row"><div><strong>'+esc(x.month)+'</strong><small>Abonnements '+money(x.subscription_cash_ttc_minor,c)+' TTC · portabilité '+money(x.priority_portability_cash_ttc_minor,c)+' TTC · commission CB '+money(x.card_payment_pgi_fee_minor,c)+' · marge SVA '+money(x.sva_platform_fee_ht_minor,c)+' HT · ambassadeurs '+money(x.referral_commissions_earned_minor,c)+'</small></div><span class="pa-badge">'+esc(x.subscription_transactions||0)+' abo</span></div>').join("");
  root.hidden=false;root.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>COMPTABILITÉ EXPERT</p><h2>Pilotage financier automatique</h2></div><button class="pa-btn" type="button" data-accounting-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Abonnements encaissés TTC</span><strong>'+money(s.subscription_cash_ttc_minor,c)+'</strong></div><div><span>Portabilité prioritaire TTC</span><strong>'+money(s.priority_portability_cash_ttc_minor,c)+'</strong></div><div><span>Volume CB clients</span><strong>'+money(s.card_payment_volume_minor,c)+'</strong></div><div><span>Commission PGI sur CB</span><strong>'+money(s.card_payment_pgi_fee_minor,c)+'</strong></div><div><span>Marge SVA HT</span><strong>'+money(s.sva_platform_fee_ht_minor,c)+'</strong></div><div><span>Reversements clients SVA HT</span><strong>'+money(s.sva_client_net_payout_ht_minor,c)+'</strong></div><div><span>Commissions ambassadeurs acquises</span><strong>'+money(s.referral_commissions_earned_minor,c)+'</strong></div><div><span>Commissions ambassadeurs versées</span><strong>'+money(s.referral_commissions_paid_minor,c)+'</strong></div></div>'+
    '<div class="pa-actions"><label class="pa-field" style="margin:0">Période<select id="pa-accounting-months"><option value="6" '+(data.months_requested===6?"selected":"")+'>6 mois</option><option value="12" '+(data.months_requested===12?"selected":"")+'>12 mois</option><option value="24" '+(data.months_requested===24?"selected":"")+'>24 mois</option><option value="36" '+(data.months_requested===36?"selected":"")+'>36 mois</option></select></label><button class="pa-btn" type="button" data-accounting-refresh>Actualiser</button><button class="pa-btn" type="button" data-accounting-csv>Exporter CSV</button><button class="pa-btn" type="button" data-accounting-print>Imprimer</button></div>'+
    '<p class="pa-note"><strong>Contrôle comptable :</strong> '+esc(data.tax_separation_notice||"Les bases TTC et HT restent séparées.")+' Les frais de traitement Stripe ne sont pas inventés : tant qu’ils ne sont pas disponibles dans le grand livre local, ils apparaissent comme non disponibles et ne sont déduits d’aucun résultat.</p>'+
    '<div class="pa-list">'+(monthly||'<p class="pa-note">Aucune écriture sur la période.</p>')+'</div>';
}
async function load(months=12){if(!ctx?.root)return;ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Consolidation comptable en cours...</p>';try{render(await getAccounting(months))}catch(err){ctx.root.innerHTML='<p class="pa-note">Comptabilité indisponible : '+esc(err?.code||"erreur")+'</p>'}}
function handle(e){
  if(e.target.closest("[data-accounting-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-accounting-refresh]")){load(Number(document.getElementById("pa-accounting-months")?.value)||12);return}
  if(e.target.closest("[data-accounting-csv]")){downloadCsv();feedback("Export comptable CSV généré.","ok");return}
  if(e.target.closest("[data-accounting-print]")){window.print();return}
}
export async function open(options={}){if(!options.root)throw Object.assign(new Error("ACCOUNTING_ROOT_MISSING"),{code:"ACCOUNTING_ROOT_MISSING"});ctx=options;if(!ctx.root.dataset.accountingBound){ctx.root.dataset.accountingBound="1";ctx.root.addEventListener("click",handle)}await load(12)}

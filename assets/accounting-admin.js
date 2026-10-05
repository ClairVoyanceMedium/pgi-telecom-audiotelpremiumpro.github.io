const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const moneyMajor=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(Number(v)||0)}catch{return (Number(v)||0).toFixed(2)+" "+c}};
let ctx=null,lastLedger=[];
function base(){return String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"")}
function cookie(n){const p=encodeURIComponent(n)+"=";for(const x of String(document.cookie||"").split(";")){const v=x.trim();if(v.indexOf(p)===0)try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}return""}
async function req(path,method="GET",body=null){
 const h={"Accept":"application/json"};if(body!==null)h["Content-Type"]="application/json";
 if(method!=="GET"){const c=cookie("__Host-pgi_csrf");if(c)h["X-CSRF-Token"]=c;h["Idempotency-Key"]=window.PGIApi.newIdempotencyKey()}
 const r=await fetch(base()+path,{method,credentials:"include",cache:"no-store",headers:h,body:body===null?undefined:JSON.stringify(body)}),p=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(p?.error?.code||"HTTP_"+r.status);e.code=p?.error?.code||"HTTP_"+r.status;throw e}return p;
}
function feedback(m,t=""){ctx?.feedback?.(m,t)}
function currentMonth(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
function downloadCsv(){
 const rows=[["Date","Catégorie","Base","Sens","Débit","Crédit","Montant","Devise","Source"],...lastLedger.map(x=>[x.occurred_at,x.category,x.basis,x.direction,x.debit_account_code,x.credit_account_code,(Number(x.amount_minor||0)/100).toFixed(2),x.currency,x.source_key])];
 const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\n"),a=document.createElement("a");
 a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="comptabilite-audiotel-"+(document.getElementById("acc-month")?.value||currentMonth())+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);
}
function render(d,ledger){
 lastLedger=ledger.data||[];const r=ctx.root,s=d.sva||{},c=d.calls||{},a=d.acquisition||{},card=d.card_payments||{},set=d.settings||{},cur=d.currency||"EUR";
 r.hidden=false;
 r.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>COMPTABILITÉ & PILOTAGE</p><h2>Vue mensuelle automatisée</h2></div><button class="pa-btn" data-acc-close>Fermer</button></div>'+
 '<div class="pa-actions"><label class="pa-field" style="margin:0">Mois<input id="acc-month" type="month" value="'+esc(d.month)+'"></label><button class="pa-btn" data-acc-refresh>Actualiser</button><button class="pa-btn" data-acc-export>Exporter CSV</button></div>'+
 '<div class="pa-state"><div><span>Encaissements tracés</span><strong>'+money(d.cash?.cash_in_minor||0,cur)+'</strong></div><div><span>Décaissements tracés</span><strong>'+money(d.cash?.cash_out_minor||0,cur)+'</strong></div><div><span>Solde de trésorerie tracé</span><strong>'+money(d.cash?.net_cash_minor||0,cur)+'</strong></div><div><span>Charges acquisition acquises</span><strong>'+money(d.accrual?.commercial_acquisition_expense_minor||0,cur)+'</strong></div></div>'+
 '<div class="pa-grid"><section class="pa-card"><h3>Revenus numériques réellement encaissés</h3>'+(d.ledger_breakdown||[]).filter(x=>x.basis==="cash"&&x.direction==="in").map(x=>'<div class="pa-row"><div><strong>'+esc(x.category.replace(/_/g," "))+'</strong><small>'+esc(x.entries)+' écriture(s)</small></div><strong>'+money(x.amount_minor,cur)+'</strong></div>').join("")+'<p class="pa-note">Les montants Stripe proviennent des événements payés réels. Le volume brut des paiements CB clients n’est jamais traité comme un revenu PGI.</p></section>'+
 '<section class="pa-card"><h3>SVA et reversements</h3><div class="pa-state"><div><span>Reversement opérateur attribué</span><strong>'+moneyMajor(s.upstream_payout_ht,cur)+'</strong></div><div><span>Marge PGI comptabilisée</span><strong>'+moneyMajor(s.pgi_margin_booked_ht,cur)+'</strong></div><div><span>Marge PGI collectée</span><strong>'+moneyMajor(s.pgi_margin_collected_ht,cur)+'</strong></div><div><span>Net clients</span><strong>'+moneyMajor(s.client_net_payout_ht,cur)+'</strong></div></div><p class="pa-note">Séparation stricte : opérateur vers PGI, marge PGI, net client, montants non alloués. Les appels en cours restent des estimations opérationnelles.</p></section>'+
 '<section class="pa-card"><h3>Activité téléphonique</h3><div class="pa-state"><div><span>Appels</span><strong>'+esc(c.calls_total||0)+'</strong></div><div><span>Connectés</span><strong>'+esc(c.calls_connected||0)+'</strong></div><div><span>Minutes facturables</span><strong>'+esc(((Number(c.billable_seconds)||0)/60).toFixed(1))+'</strong></div><div><span>Montant service généré</span><strong>'+moneyMajor(c.generated_service_amount_ttc,cur)+'</strong></div></div><p class="pa-note">Le montant service généré est un indicateur d’activité, pas automatiquement le chiffre d’affaires PGI.</p></section>'+
 '<section class="pa-card"><h3>Acquisition clients</h3><div class="pa-state"><div><span>Nouveaux dossiers</span><strong>'+esc(a.new_customers||0)+'</strong></div><div><span>Parrainages clients qualifiés</span><strong>'+esc(a.client_referrals_rewarded||0)+'</strong></div><div><span>Ambassadeurs apportés</span><strong>'+esc(a.ambassador_referrals_claimed||0)+'</strong></div><div><span>Ambassadeurs qualifiés</span><strong>'+esc(a.ambassador_referrals_qualified||0)+'</strong></div></div></section>'+
 '<section class="pa-card"><h3>Paiement CB complémentaire</h3><div class="pa-state"><div><span>Volume client</span><strong>'+money(card.gross_volume_minor||0,cur)+'</strong></div><div><span>Commission PGI</span><strong>'+money(card.pgi_fee_minor||0,cur)+'</strong></div><div><span>Remboursés</span><strong>'+esc(card.refunded_requests||0)+'</strong></div><div><span>Litiges</span><strong>'+esc(card.disputed_requests||0)+'</strong></div></div></section>'+
 '<section class="pa-card"><h3>Préparation comptable</h3><div class="pa-state"><div><span>Régime TVA</span><strong>'+esc(set.vat_mode||"unconfigured")+'</strong></div><div><span>Livres statutaires</span><strong>'+(d.statutory_ready?"PRÉREQUIS RENSEIGNÉS":"NON CERTIFIÉS")+'</strong></div></div><label class="pa-field">Régime TVA<select id="acc-vat"><option value="unconfigured" '+(set.vat_mode==="unconfigured"?"selected":"")+'>À configurer</option><option value="standard" '+(set.vat_mode==="standard"?"selected":"")+'>Régime standard</option><option value="franchise" '+(set.vat_mode==="franchise"?"selected":"")+'>Franchise</option><option value="exempt" '+(set.vat_mode==="exempt"?"selected":"")+'>Exonéré</option><option value="other" '+(set.vat_mode==="other"?"selected":"")+'>Autre</option></select></label><label class="pa-field">Taux TVA en %<input id="acc-vat-rate" type="number" min="0" max="100" step="0.01" value="'+esc(set.vat_rate_bps==null?"":(Number(set.vat_rate_bps)/100).toFixed(2))+'"></label><div class="pa-actions"><button class="pa-btn" data-acc-settings>Enregistrer</button></div><p class="pa-note">Tant que le régime fiscal réel n’est pas validé, le cockpit refuse de fabriquer artificiellement une ventilation HT/TVA. Les sous-comptes proposés doivent être validés avec le professionnel comptable.</p></section></div>'+
 '<section class="pa-card pa-wide"><h3>Plan de comptes proposé</h3><div class="pa-list">'+(set.account_map||[]).map(x=>'<div class="pa-row"><div><strong>'+esc(x.code)+' · '+esc(x.label)+'</strong><small>'+esc(x.nature)+' · '+esc(x.validation)+'</small></div></div>').join("")+'</div></section>'+
 '<section class="pa-card pa-wide"><h3>Journal de preuves</h3><div class="pa-list">'+lastLedger.slice(0,80).map(x=>'<div class="pa-row"><div><strong>'+esc(new Date(x.occurred_at).toLocaleString("fr-FR"))+' · '+esc(x.category.replace(/_/g," "))+'</strong><small>Débit '+esc(x.debit_account_code)+' · Crédit '+esc(x.credit_account_code)+' · '+esc(x.source_type)+'</small></div><strong>'+money(x.amount_minor,x.currency)+'</strong></div>').join("")+'</div></section>';
}
async function load(month){
 ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Consolidation des événements financiers...</p>';
 try{const m=month||currentMonth(),[d,l]=await Promise.all([req("/platform/accounting/overview?month="+encodeURIComponent(m)),req("/platform/accounting/ledger?month="+encodeURIComponent(m)+"&limit=300")]);render(d,l)}
 catch(e){ctx.root.innerHTML='<p class="pa-note">Comptabilité indisponible : '+esc(e.code||"erreur")+'</p>'}
}
async function click(e){
 if(e.target.closest("[data-acc-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
 if(e.target.closest("[data-acc-refresh]"))return load(document.getElementById("acc-month")?.value);
 if(e.target.closest("[data-acc-export]"))return downloadCsv();
 if(e.target.closest("[data-acc-settings]")){
   const mode=document.getElementById("acc-vat").value,raw=document.getElementById("acc-vat-rate").value,rate=raw===""?null:Math.round(Number(raw)*100);
   try{await req("/platform/accounting/settings","POST",{vat_mode:mode,vat_rate_bps:rate,fiscal_year_start_month:1});feedback("Paramètres comptables enregistrés.","ok");await load(document.getElementById("acc-month")?.value)}
   catch(x){feedback(x.code||"Paramètres invalides","error")}
 }
}
export async function open(o={}){ctx=o;if(!ctx.root)throw new Error("ACCOUNTING_ADMIN_ROOT_MISSING");if(!ctx.root.dataset.accBound){ctx.root.dataset.accBound="1";ctx.root.addEventListener("click",click)}await load()}
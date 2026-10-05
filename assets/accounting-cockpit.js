let cacheKey="",cacheValue=null,inflight=null;

function esc(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function money(minor,currency){
  const value=Number(minor||0)/100;
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format(value);}
  catch(_e){return value.toFixed(2)+" "+(currency||"EUR");}
}
function monthLabel(key){
  const date=new Date(String(key)+"-01T12:00:00");
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(date):String(key||"");
}
function dateLabel(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(date):"Non disponible";
}
function zeroData(range,market){
  return {
    schema_version:"audiotel-platform-accounting/1",
    generated_at:new Date().toISOString(),
    range,currency:"EUR",market:market||null,
    integrity:{statutory_ledger:false,tax_conversion_invented:false,mixed_tax_bases:true,note:"Mode démonstration sans données comptables réelles."},
    summary:{subscription_cash_ttc_minor:0,subscription_count:0,portability_priority_cash_ttc_minor:0,portability_priority_count:0,card_fee_cash_minor:0,card_payment_count:0,sva_upstream_collected_ht_minor:0,sva_margin_collected_ht_minor:0,tenant_payouts_paid_ht_minor:0,referral_rewards_paid_minor:0,referral_rewards_earned_minor:0,referral_rewards_unpaid_minor:0,referral_rewards_unpaid_count:0,sva_upstream_booked_ht_minor:0,sva_margin_booked_ht_minor:0,sva_client_net_booked_ht_minor:0,sva_unallocated_ht_minor:0},
    monthly_history:[]
  };
}
async function load(options){
  const range=options.range||{},key=[range.from,range.to,options.market||"",options.production?"prod":"demo"].join("|");
  if(key===cacheKey&&cacheValue)return cacheValue;
  if(!options.production||!options.api||typeof options.api.platformAccounting!=="function"){
    cacheKey=key;cacheValue=zeroData(range,options.market);return cacheValue;
  }
  if(inflight&&inflight.key===key)return inflight.promise;
  const promise=options.api.platformAccounting(range.from,range.to,options.market||null).then(data=>{cacheKey=key;cacheValue=data;return data;}).finally(()=>{if(inflight?.key===key)inflight=null;});
  inflight={key,promise};return promise;
}
function card(label,value,detail,tone=""){
  return '<article class="acct-kpi '+esc(tone)+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></article>';
}
function csv(data){
  const currency=data.currency||"EUR";
  const rows=[
    ["Mois","Abonnements TTC","Portabilité prioritaire TTC","Commission CB","SVA amont encaissé HT","Marge SVA encaissée HT","Reversements clients payés HT","Récompenses ambassadeurs acquises","Récompenses ambassadeurs payées"],
    ...(data.monthly_history||[]).map(r=>[
      r.month,
      (Number(r.subscription_cash_ttc_minor||0)/100).toFixed(2),
      (Number(r.portability_priority_cash_ttc_minor||0)/100).toFixed(2),
      (Number(r.card_fee_cash_minor||0)/100).toFixed(2),
      (Number(r.sva_upstream_collected_ht_minor||0)/100).toFixed(2),
      (Number(r.sva_margin_collected_ht_minor||0)/100).toFixed(2),
      (Number(r.tenant_payouts_paid_ht_minor||0)/100).toFixed(2),
      (Number(r.referral_rewards_earned_minor||0)/100).toFixed(2),
      (Number(r.referral_rewards_paid_minor||0)/100).toFixed(2)
    ])
  ];
  const content="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="comptabilite-audiotel-"+String(data.range?.from||"").slice(0,10)+"-"+String(data.range?.to||"").slice(0,10)+"-"+currency+".csv";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function renderData(root,data,options){
  const s=data.summary||{},currency=data.currency||"EUR",rows=Array.isArray(data.monthly_history)?data.monthly_history:[];
  const production=options.production===true;
  root.innerHTML=
    '<section class="acct-hero"><div><p class="panel-kicker">COMPTABILITÉ DE GESTION AUTOMATISÉE</p><h2>Argent réellement suivi, sans mélanger HT et TTC</h2><p>Chaque source reste dans sa base fiscale connue. Aucune conversion HT/TTC n’est inventée et aucun montant estimé n’est présenté comme encaissé.</p></div><div class="acct-hero-actions"><span class="acct-state '+(production?"ok":"demo")+'">'+(production?"DONNÉES PRODUCTION":"MODE DÉMO")+'</span><button class="secondary-btn" type="button" data-accounting-export '+(!rows.length?"disabled":"")+'>Exporter CSV</button></div></section>'+
    '<section class="acct-grid">'+
      card("Abonnements encaissés",money(s.subscription_cash_ttc_minor,currency),String(s.subscription_count||0)+" facture(s) payée(s), base TTC","emphasis")+
      card("Portabilités prioritaires",money(s.portability_priority_cash_ttc_minor,currency),String(s.portability_priority_count||0)+" paiement(s), base TTC")+
      card("Commissions CB acquises",money(s.card_fee_cash_minor,currency),String(s.card_payment_count||0)+" paiement(s) réglé(s), remboursements exclus")+
      card("Marge SVA encaissée",money(s.sva_margin_collected_ht_minor,currency),"Quote-part opérateur effectivement payée, base HT","positive")+
      card("Reversements clients payés",money(s.tenant_payouts_paid_ht_minor,currency),"Sorties enregistrées au statut payé, base HT")+
      card("Ambassadeurs payés",money(s.referral_rewards_paid_minor,currency),"Récompenses avec référence de versement")+
      card("Ambassadeurs à payer",money(s.referral_rewards_unpaid_minor,currency),String(s.referral_rewards_unpaid_count||0)+" récompense(s) acquise(s) non marquée(s) payée(s)","attention")+
      card("Marge SVA comptabilisée",money(s.sva_margin_booked_ht_minor,currency),"Engagement économique sur la période, base HT")+
    '</section>'+
    '<section class="acct-split"><article class="panel"><div class="panel-head"><div><p class="panel-kicker">SVA</p><h2>Encaissement et engagements</h2></div></div><div class="acct-lines">'+
      '<div><span>Reversement opérateur attribué et encaissé, HT</span><strong>'+esc(money(s.sva_upstream_collected_ht_minor,currency))+'</strong></div>'+
      '<div><span>Marge Audiotel Premium Pro encaissée, HT</span><strong>'+esc(money(s.sva_margin_collected_ht_minor,currency))+'</strong></div>'+
      '<div><span>Reversement client comptabilisé, HT</span><strong>'+esc(money(s.sva_client_net_booked_ht_minor,currency))+'</strong></div>'+
      '<div><span>Reversement client payé, HT</span><strong>'+esc(money(s.tenant_payouts_paid_ht_minor,currency))+'</strong></div>'+
      '<div><span>Montant non affecté, HT</span><strong>'+esc(money(s.sva_unallocated_ht_minor,currency))+'</strong></div>'+
    '</div></article><article class="panel"><div class="panel-head"><div><p class="panel-kicker">AMBASSADEURS</p><h2>Coût d’acquisition suivi</h2></div></div><div class="acct-lines">'+
      '<div><span>Récompenses acquises sur la période</span><strong>'+esc(money(s.referral_rewards_earned_minor,currency))+'</strong></div>'+
      '<div><span>Récompenses versées sur la période</span><strong>'+esc(money(s.referral_rewards_paid_minor,currency))+'</strong></div>'+
      '<div><span>Dette Ambassadeur actuellement acquise</span><strong>'+esc(money(s.referral_rewards_unpaid_minor,currency))+'</strong></div>'+
      '<div><span>Qualification</span><strong>3 mensualités encaissées</strong></div>'+
      '<div><span>Barème</span><strong>10 € / 12 € / 15 € / 20 € fixe</strong></div>'+
    '</div></article></section>'+
    '<section class="panel acct-history"><div class="panel-head"><div><p class="panel-kicker">HISTORIQUE</p><h2>Mois par mois</h2></div><small>Dernière génération : '+esc(dateLabel(data.generated_at))+'</small></div>'+
      '<div class="table-wrap wide"><table><thead><tr><th>Mois</th><th>Abonnements TTC</th><th>Priorité TTC</th><th>Commission CB</th><th>Marge SVA HT encaissée</th><th>Clients payés HT</th><th>Ambassadeurs acquis</th><th>Ambassadeurs payés</th></tr></thead><tbody>'+
      (rows.length?rows.map(r=>'<tr><td>'+esc(monthLabel(r.month))+'</td><td>'+esc(money(r.subscription_cash_ttc_minor,currency))+'</td><td>'+esc(money(r.portability_priority_cash_ttc_minor,currency))+'</td><td>'+esc(money(r.card_fee_cash_minor,currency))+'</td><td>'+esc(money(r.sva_margin_collected_ht_minor,currency))+'</td><td>'+esc(money(r.tenant_payouts_paid_ht_minor,currency))+'</td><td>'+esc(money(r.referral_rewards_earned_minor,currency))+'</td><td>'+esc(money(r.referral_rewards_paid_minor,currency))+'</td></tr>').join(""):'<tr><td colspan="8" class="acct-empty">Aucune écriture source sur cette période.</td></tr>')+
      '</tbody></table></div></section>'+
    '<section class="acct-integrity" role="note"><strong>Contrôle d’intégrité</strong><span>'+esc(data.integrity?.note||"Les bases fiscales disponibles restent séparées.")+'</span><span>Cette vue est un pilotage de gestion automatisé. Elle ne fabrique pas les écritures fiscales, la TVA ou le relevé bancaire qui ne sont pas présents dans les sources.</span></section>';
  const exportButton=root.querySelector("[data-accounting-export]");
  if(exportButton)exportButton.addEventListener("click",()=>csv(data),{once:true});
}
export async function render(options={}){
  const root=options.root;if(!root)return;
  root.innerHTML='<section class="panel acct-loading"><p class="panel-kicker">COMPTABILITÉ</p><h2>Synchronisation des écritures sources…</h2></section>';
  try{const data=await load(options);renderData(root,data,options);}
  catch(error){
    root.innerHTML='<section class="panel acct-error"><p class="panel-kicker">COMPTABILITÉ</p><h2>Données indisponibles</h2><p>'+esc(error?.code||error?.message||"Erreur de synchronisation")+'</p><p>Aucun montant de remplacement n’est affiché afin d’éviter une information comptable fausse.</p></section>';
  }
}
export function invalidate(){cacheKey="";cacheValue=null;}

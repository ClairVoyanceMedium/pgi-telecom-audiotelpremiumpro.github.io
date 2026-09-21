(function(){
"use strict";
var state={range:"today",data:null,user:null,demo:false,googleCredential:null,billingBusy:false};
var I=window.PGIClientI18n||{locale:"fr-FR",t:function(x){return x;},apply:function(){}};
function tr(x){return I.t?I.t(x):x;}
var $=function(id){return document.getElementById(id);};
var qsa=function(sel){return Array.from(document.querySelectorAll(sel));};
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
function nf(v,d){return new Intl.NumberFormat(I.locale||"fr-FR",{maximumFractionDigits:d==null?0:d}).format(n(v));}
function money(v,c){if(v==null||!Number.isFinite(Number(v)))return "—";try{return new Intl.NumberFormat(I.locale||"fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v));}catch(_e){return nf(v,2)+" "+(c||"");}}
function dt(v){if(!v)return "—";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(I.locale||"fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";}
function dateOnly(v){if(!v)return "—";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(I.locale||"fr-FR",{dateStyle:"medium"}).format(d):"—";}
function duration(s){s=Math.max(0,Math.round(n(s)));var m=Math.floor(s/60),r=s%60;return m+" min "+String(r).padStart(2,"0")+" s";}
function statusLabel(v){var m={active:"Actif",pending:"En attente",testing:"Test",suspended:"Suspendu",closed:"Fermé",connected:"Décroché",abandoned:"Abandonné",failed:"Échoué",busy:"Occupé",no_answer:"Sans réponse",open:"En cours",reconciled:"Validé",invoiced:"Facturé",payable:"À payer",paid:"Payé",disputed:"Contesté",blocked_terms:"En attente de validation",blocked_compliance:"En attente de validation",past_due:"Impayé",cancelled:"Annulé",ended:"Terminé",submitted:"Demande reçue",awaiting_documents:"Justificatifs requis",eligibility_check:"Éligibilité en cours",operator_pending:"En attente opérateur",scheduled:"Portabilité planifiée",ported:"Numéro porté",rejected:"Demande refusée"};return tr(m[String(v||"").toLowerCase()]||String(v||"—"));}
function chip(status){var s=String(status||"").toLowerCase();var tone=["active","connected","paid","reconciled","payable","ported"].includes(s)?"ok":["pending","testing","open","invoiced","submitted","awaiting_documents","eligibility_check","operator_pending","scheduled","blocked_terms","blocked_compliance"].includes(s)?"warn":["suspended","closed","failed","past_due","disputed","rejected"].includes(s)?"bad":"neutral";return '<span class="cp-chip '+tone+'">'+esc(statusLabel(status))+"</span>";}
function toast(message){var el=$("client-toast");el.textContent=tr(message);el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){el.hidden=true;},2600);}
function setAuthMessage(message,bad){var el=$("auth-message");el.textContent=message?tr(message):"";el.classList.toggle("bad",Boolean(bad));}
function rangeFor(key){var to=new Date,from=new Date(to);if(key==="today")from.setHours(0,0,0,0);else if(key==="7")from=new Date(to-7*86400000);else if(key==="30")from=new Date(to-30*86400000);else if(key==="month"){from.setDate(1);from.setHours(0,0,0,0)}else if(key==="year"){from.setMonth(0,1);from.setHours(0,0,0,0)}return {from:from.toISOString(),to:to.toISOString()}}
function previousRangeFor(range){
  var from=new Date(range.from),to=new Date(range.to),span=Math.max(86400000,to-from);
  return {from:new Date(from.getTime()-span).toISOString(),to:new Date(from.getTime()-1).toISOString()};
}
function demoData(range){
  var series=[],to=new Date(range&&range.to||Date.now()),from=new Date(range&&range.from||to.getTime()-30*86400000);
  var days=Math.max(1,Math.min(62,Math.ceil((to-from)/86400000)));
  var sums={calls_total:0,calls_connected:0,calls_abandoned:0,calls_failed:0,billable_seconds:0,generated_revenue_ttc:0};
  for(var i=days-1;i>=0;i--){
    var d=new Date(to.getTime()-i*86400000),seed=Math.floor(d.getTime()/86400000);
    var calls=Math.max(8,22+((seed*7)%17)+Math.round(6*Math.sin(seed/2.7)));
    var ratio=.78+((seed%8)/100),connected=Math.min(calls,Math.round(calls*ratio));
    var failed=Math.max(1,Math.round(calls*(.04+((seed%3)/100))));
    var abandoned=Math.max(0,calls-connected-failed);
    var billable=Math.max(0,connected*(132+(seed%47)));
    var revenue=Math.round((connected*(1.62+((seed%11)/100)))*100)/100;
    var row={bucket_date:d.toISOString().slice(0,10),calls_total:calls,calls_connected:connected,calls_abandoned:abandoned,calls_failed:failed,billable_seconds:billable,generated_revenue_ttc:revenue,updated_at:new Date().toISOString()};
    series.push(row);
    Object.keys(sums).forEach(function(k){sums[k]+=Number(row[k]||0);});
  }
  var recent=[];for(var j=0;j<20;j++){var s=new Date(to.getTime()-j*5400000),connected=j%6!==3;recent.push({call_id:j+1,display_number:j%3===0?"0892 98 76 54":"0892 12 34 56",market:"FR",currency:"EUR",started_at:s.toISOString(),ringing_at:new Date(s.getTime()+2100+(j%4)*180).toISOString(),call_status:connected?"connected":j%2?"abandoned":"failed",conversation_seconds:connected?110+j*13:0,billable_seconds:connected?110+j*13:0,retail_service_amount_ttc:connected?Math.round((1.45+j*.11)*100)/100:0,post_dial_delay_ms:2100+(j%4)*180,sip_final_code:connected?200:(j%2?487:503),hangup_cause:connected?"NORMAL_CLEARING":(j%2?"ORIGINATOR_CANCEL":"NORMAL_TEMPORARY_FAILURE"),hangup_party:connected?(j%2?"caller":"callee"):"network",codec:"PCMA",origin_carrier:j%2?"Orange":"SFR",host_carrier:"Opérateur hôte Démo",packet_loss_percent:.28+(j%3)*.11,jitter_ms:2.8+(j%4)*.4,latency_ms:38+(j%5)*3,rtt_ms:72+(j%5)*4,mos:4.25-(j%4)*.04,packets_lost:j%3,dtmf_errors:0});}
  return {
    user:{name:"Camille Martin",role:"owner"},
    tenant:{display_name:"Société Démo",default_currency:"EUR",country_code:"FR",status:"active",customer_type:"business"},
    financial_by_currency:[{currency:"EUR",calls_total:sums.calls_total,calls_connected:sums.calls_connected,calls_abandoned:sums.calls_abandoned,calls_failed:sums.calls_failed,billable_seconds:sums.billable_seconds,generated_revenue_ttc:Math.round(sums.generated_revenue_ttc*100)/100,updated_at:new Date().toISOString()}],
    series:series,
    numbers:[
      {id:1,display_number:"0892 12 34 56",e164:"+33892123456",currency:"EUR",number_type:"premium",service_rate_ttc_per_min:.8,status:"active",assignment_status:"active",kyc_status:"verified",tariff_code:"D080"},
      {id:2,display_number:"0892 98 76 54",e164:"+33892987654",currency:"EUR",number_type:"premium",service_rate_ttc_per_min:.8,status:"active",assignment_status:"active",kyc_status:"verified",tariff_code:"D080"}
    ],
    settlements:[{id:1,currency:"EUR",period_start:"2026-08-01",period_end:"2026-08-31",net_payout_ht:428.75,status:"paid",paid_at:"2026-09-12T10:00:00Z"},{id:2,currency:"EUR",period_start:"2026-09-01",period_end:"2026-09-15",net_payout_ht:231.2,status:"payable",payment_due_date:"2026-09-30"}],
    subscriptions:[{id:1,status:"active",billing_currency:"EUR",current_period_start:"2026-09-01T00:00:00Z",current_period_end:"2026-10-01T00:00:00Z",plan_name:"Accès Audiotel",amount_minor:300,price_currency:"EUR",tax_behavior:"inclusive",billing_interval:"month",last_payment_status:"paid"}],
    portability_requests:[],
    destinations:[{id:1,sva_number_id:1,label:"Standard principal",destination_type:"pstn",destination_uri:"tel:+33123456789",priority:10,status:"active",active_calls:1,max_concurrent_calls:25}],
    recent_calls:recent,
    voice_quality:{calls_total:sums.calls_total,calls_connected:sums.calls_connected,pdd_samples:sums.calls_total,avg_pdd_ms:2380,high_pdd_calls:Math.round(sums.calls_total*.025),quality_samples:sums.calls_total,network_affected_calls:Math.round(sums.calls_total*.018),low_mos_calls:Math.round(sums.calls_total*.012),mos:4.26,packet_loss_percent:.34,jitter_ms:3.4,latency_ms:44,rtt_ms:78,sip_5xx_calls:Math.round(sums.calls_total*.008),caller_hangups:Math.round(sums.calls_connected*.52),callee_hangups:Math.round(sums.calls_connected*.43),network_hangups:Math.round(sums.calls_total*.05)},
    billing_provider:{architecture_ready:true,target_provider:"stripe",connection_state:"not_connected",external_billing_enabled:false,checkout_available:false,customer_portal_available:false,webhook_ingest_enabled:false,subscription_funds_flow:"customer_to_pgi",sva_payout_flow:"carrier_to_pgi_to_customer",pgi_margin_retained:true,client_payout_compliance_gated:true,funds_custody_mode:"payment_compliance_profile"},
    range:range,server_time:new Date().toISOString()
  };
}
function aggregate(data){
  var rows=data.financial_by_currency||[],calls=0,connected=0,billable=0,updated=null;
  rows.forEach(function(x){calls+=n(x.calls_total);connected+=n(x.calls_connected);billable+=n(x.billable_seconds);if(x.updated_at&&(!updated||Date.parse(x.updated_at)>Date.parse(updated)))updated=x.updated_at;});
  var currency=(data.tenant&&data.tenant.default_currency)||((rows[0]&&rows[0].currency)||"EUR");
  var moneyRows=rows.filter(function(x){return x.currency===currency;});
  var revenue=moneyRows.reduce(function(a,x){return a+n(x.generated_revenue_ttc);},0);
  var payoutRows=data.metric_net_payout_by_currency;
  var payout=Array.isArray(payoutRows)
    ?payoutRows.filter(function(x){return x.currency===currency;}).reduce(function(a,x){return a+n(x.net_payout_ht);},0)
    :(data.settlements||[]).filter(function(x){return x.currency===currency&&["reconciled","invoiced","payable","paid"].includes(String(x.status));}).reduce(function(a,x){return a+n(x.net_payout_ht);},0);
  return {calls:calls,connected:connected,billable:billable,currency:currency,revenue:revenue,payout:payout,updated:updated};
}
function svgLine(id,rows,series,options){
  var el=$(id);if(!el)return;rows=(rows||[]).slice(-62);if(!rows.length){el.innerHTML='<text x="360" y="110" text-anchor="middle" class="axis-label">Aucune donnée</text>';return;}
  var W=720,H=220,L=34,R=12,T=28,B=25,plotW=W-L-R,plotH=H-T-B;
  options=options||{};var max=options.max||1;series.forEach(function(s){rows.forEach(function(x){max=Math.max(max,n(s.value(x)));});});
  function px(i){return L+(rows.length===1?plotW/2:i*plotW/Math.max(1,rows.length-1));}
  function py(v){return T+plotH-(n(v)/max*plotH);}
  function fv(s,value){return s.format?s.format(value):nf(value,1);}
  var grid="";for(var g=0;g<=4;g++){var y=T+plotH*g/4;grid+='<line class="grid" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/>';}
  var labels="";var step=Math.max(1,Math.ceil(rows.length/6));rows.forEach(function(x,i){if(i%step===0||i===rows.length-1){var d=new Date(x.bucket_date);labels+='<text class="axis-label" x="'+px(i)+'" y="'+(H-6)+'" text-anchor="middle">'+String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"</text>";}});
  var legend=series.map(function(s,si){if(!s.label)return "";var x=L+si*145,klass=si?"line-secondary":"line-main";return '<line class="'+klass+'" x1="'+x+'" y1="12" x2="'+(x+18)+'" y2="12"/><text class="chart-legend" x="'+(x+24)+'" y="15">'+esc(s.label)+"</text>";}).join("");
  var paths=series.map(function(s,si){var pts=rows.map(function(x,i){return px(i)+","+py(s.value(x));}).join(" ");return '<polyline class="'+(si?"line-secondary":"line-main")+'" points="'+pts+'"/>';}).join("");
  var hits=series.map(function(s,si){return rows.map(function(x,i){var value=n(s.value(x)),raw=String(x.bucket_date||"").slice(0,10),title=raw+" · "+(s.label||"Valeur")+" : "+fv(s,value);return '<circle class="cp-chart-hit '+(si?"secondary":"main")+'" cx="'+px(i)+'" cy="'+py(value)+'" r="7"><title>'+esc(title)+"</title></circle>";}).join("");}).join("");
  el.innerHTML=legend+grid+labels+paths+hits;
}
function renderStatus(data){
  var a=(data.financial_by_currency||[]).reduce(function(o,x){o.total+=n(x.calls_total);o.connected+=n(x.calls_connected);o.abandoned+=n(x.calls_abandoned);o.failed+=n(x.calls_failed);return o;},{total:0,connected:0,abandoned:0,failed:0});
  var total=Math.max(1,a.total),p1=a.connected/total*100,p2=a.abandoned/total*100;
  $("status-total").textContent=nf(a.total);
  $("status-donut").style.background="conic-gradient(var(--ok) 0 "+p1+"%,var(--warn) "+p1+"% "+(p1+p2)+"%,var(--bad) "+(p1+p2)+"% 100%)";
  var rows=[["var(--ok)","Décrochés",a.connected],["var(--warn)","Abandonnés",a.abandoned],["var(--bad)","Échoués",a.failed]];
  $("status-legend").innerHTML=rows.map(function(x){return '<div><i style="background:'+x[0]+'"></i><span>'+x[1]+'</span><strong>'+nf(x[2])+'</strong></div>';}).join("");
}
function renderPayoutChart(data){
  var rows=(data.settlements||[]).slice(0,8).reverse(),el=$("payout-bars"),max=Math.max.apply(null,[1].concat(rows.map(function(x){return n(x.net_payout_ht);})));
  el.innerHTML=rows.length?rows.map(function(x){var pct=Math.max(2,n(x.net_payout_ht)/max*100);return '<div class="cp-hbar"><span>'+esc(dateOnly(x.period_end))+'</span><i><b style="width:'+pct+'%"></b></i><strong>'+esc(money(x.net_payout_ht,x.currency))+'</strong></div>';}).join(""):'<p class="cp-empty">Aucun reversement disponible.</p>';
}
function renderAnalytics(data){
  var rows=data.series||[],a=aggregate(data);
  svgLine("calls-chart",rows,[{label:"Appels",value:function(x){return x.calls_total;},format:function(v){return nf(v);}},{label:"Décrochés",value:function(x){return x.calls_connected;},format:function(v){return nf(v);}}]);
  svgLine("minutes-chart",rows,[{label:"Minutes",value:function(x){return n(x.billable_seconds)/60;},format:function(v){return nf(v,1)+" min";}}]);
  svgLine("revenue-chart",rows,[{label:"Montant TTC",value:function(x){return x.generated_revenue_ttc;},format:function(v){return money(v,a.currency);}}]);
  svgLine("asr-chart",rows,[{label:"Décroché",value:function(x){return n(x.calls_total)?n(x.calls_connected)/n(x.calls_total)*100:0;},format:function(v){return nf(v,1)+" %";}},{label:"Abandons",value:function(x){return n(x.calls_total)?n(x.calls_abandoned)/n(x.calls_total)*100:0;},format:function(v){return nf(v,1)+" %";}}],{max:100});
  svgLine("value-chart",rows,[{label:"Moyenne/appel",value:function(x){return n(x.calls_total)?n(x.generated_revenue_ttc)/n(x.calls_total):0;},format:function(v){return money(v,a.currency);}}]);
  svgLine("duration-chart",rows,[{label:"Durée moyenne",value:function(x){return n(x.calls_connected)?n(x.billable_seconds)/60/n(x.calls_connected):0;},format:function(v){return nf(v,1)+" min";}}]);
  $("minutes-chart-total").textContent=nf(a.billable/60,1)+" min";
  $("revenue-chart-total").textContent=money(a.revenue,a.currency);
  $("asr-chart-total").textContent=nf(a.calls?a.connected/a.calls*100:0,1)+" %";
  $("value-chart-total").textContent=money(a.calls?a.revenue/a.calls:0,a.currency);
  $("duration-chart-total").textContent=nf(a.connected?a.billable/60/a.connected:0,1)+" min";
  renderStatus(data);renderPayoutChart(data);
}
function renderNumbers(data){
  var el=$("numbers-list"),rows=data.numbers||[];$("numbers-count").textContent=String(rows.length);
  el.innerHTML=rows.length?rows.map(function(x){return '<div class="cp-row"><div><strong>'+esc(x.display_number||x.e164)+'</strong><span>'+esc((x.market||data.tenant.country_code||"")+" · "+(x.tariff_code||"Tarif")+" · "+money(x.service_rate_ttc_per_min,x.currency)+"/min")+'</span></div><div>'+chip(x.assignment_status||x.status)+'</div></div>';}).join(""):'<p class="cp-empty">Aucun numéro attribué.</p>';
}
function renderCalls(data){
  var rows=data.recent_calls||[];$("calls-body").innerHTML=rows.length?rows.map(function(x){return "<tr><td>"+esc(dt(x.started_at))+"</td><td>"+esc(x.display_number||x.e164||"—")+"</td><td>"+chip(x.call_status)+"</td><td>"+esc(duration(x.billable_seconds||x.conversation_seconds))+"</td><td>"+esc(money(n(x.retail_service_amount_ttc),x.currency))+"</td><td><button class=\"cp-diagnostic-btn\" type=\"button\" data-call-diagnostic=\""+esc(x.call_id)+"\">Voir</button></td></tr>";}).join(""):'<tr><td colspan="6" class="cp-empty-cell">Aucun appel sur cette période.</td></tr>';
}
function renderSettlements(data){
  var rows=data.settlements||[],el=$("settlements-list");
  el.innerHTML=rows.length?rows.slice(0,6).map(function(x){var note=x.paid_at?"Payé le "+dateOnly(x.paid_at):x.payment_due_date?"Échéance "+dateOnly(x.payment_due_date):"Période clôturée";return '<div class="cp-row"><div><strong>'+esc(money(x.net_payout_ht,x.currency))+'</strong><span>'+esc(dateOnly(x.period_start)+" → "+dateOnly(x.period_end))+' · '+esc(note)+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucun reversement disponible.</p>';
}
function renderSubscriptions(data){
  var rows=data.subscriptions||[],el=$("subscription-list"),provider=data.billing_provider||{},offer=data.billing_offer||null,billingSummary=data.billing_summary||{},currencyInfo=billingSummary.billing_currency||{};
  el.innerHTML=rows.length?rows.slice(0,3).map(function(x){var price=x.amount_minor!=null?money(n(x.amount_minor)/100,x.price_currency||x.billing_currency)+" TTC / "+(x.billing_interval==="year"?"an":"mois"):"Tarif contractuel";return '<div class="cp-row"><div><strong>'+esc(x.plan_name||"Abonnement Audiotel")+'</strong><span>'+esc(price+" · période jusqu’au "+dateOnly(x.current_period_end))+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucun abonnement actif pour le moment.</p>';
  var stateEl=$("client-billing-provider-state"),chipEl=$("client-billing-provider-chip"),start=$("client-billing-start"),manage=$("client-billing-manage"),offerDetail=$("client-billing-offer-detail"),offerChip=$("client-billing-offer-chip");
  var connected=provider.connection_state&&provider.connection_state!=="not_connected";
  if(offer&&offer.amount_minor!=null){
    var cadence=offer.billing_interval==="year"?"an":"mois",offerPrice=money(n(offer.amount_minor)/100,offer.currency)+" TTC / "+cadence;
    if(offerDetail)offerDetail.textContent=offerPrice+" · "+tr("tarif versionné");
    if(offerChip){offerChip.textContent=money(n(offer.amount_minor)/100,offer.currency);offerChip.className="cp-chip ok";}
    if(start)start.textContent=tr("Activer mon abonnement")+" — "+offerPrice;
  }else{
    var resolvedCurrency=currencyInfo.currency||((data.tenant||{}).default_currency)||"EUR";
    if(offerDetail)offerDetail.textContent=tr("Devise automatique")+" : "+resolvedCurrency+" · "+tr("tarif local à configurer");
    if(offerChip){offerChip.textContent=resolvedCurrency;offerChip.className="cp-chip warn";}
  }
  if(stateEl)stateEl.textContent=connected?tr("Prestataire de paiement configuré."):tr("Architecture de paiement prête, prestataire non connecté.");
  if(chipEl){chipEl.textContent=connected?tr("PRÊT"):tr("NON CONNECTÉ");chipEl.className="cp-chip "+(connected?"ok":"neutral");}
  if(start)start.disabled=!provider.checkout_available||!offer;
  if(manage)manage.disabled=!provider.customer_portal_available||!rows.length;
}
function renderOnboarding(data){
  var root=$("client-onboarding");if(!root)return;
  var tenant=data.tenant||{},user=data.user||{},subs=data.subscriptions||[];
  var subscriptionActive=subs.some(function(x){return x.status==="active"&&(!x.current_period_end||Date.parse(x.current_period_end)>Date.now());});
  var complete=tenant.status==="active"&&user.email_verified===true&&tenant.kyc_status==="verified"&&subscriptionActive;
  root.hidden=complete;
  if(complete)return;
  $("onboarding-account").textContent="Compte créé";
  $("onboarding-email").textContent=user.email_verified===true?"E-mail vérifié":"E-mail à vérifier";
  $("onboarding-kyc").textContent=tenant.kyc_status==="verified"?"KYC vérifié":tenant.kyc_status==="rejected"?"KYC à corriger":"KYC en attente";
  $("onboarding-subscription").textContent=subscriptionActive?"Abonnement actif":"Abonnement à activer";
  $("client-onboarding-text").textContent=tenant.status==="pending"
    ?"Votre compte est ouvert. Vous pouvez préparer votre dossier pendant que les validations nécessaires sont effectuées."
    :"Votre espace est actif. Les derniers contrôles restants sont indiqués ci-dessous.";
}
function renderDestinations(data){
  var numbers={};(data.numbers||[]).forEach(function(x){numbers[String(x.id)]=x.display_number||x.e164;});
  var rows=data.destinations||[],el=$("destinations-list");
  el.innerHTML=rows.length?rows.map(function(x){var line=x.sva_number_id?numbers[String(x.sva_number_id)]||"Numéro attribué":"Tous les numéros";var cap=x.max_concurrent_calls?" · "+n(x.active_calls)+"/"+n(x.max_concurrent_calls)+" appels":" · "+n(x.active_calls)+" appel(s)";return '<div class="cp-row"><div><strong>'+esc(x.label)+'</strong><span>'+esc(line+" · "+x.destination_type+" · "+x.destination_uri+cap)+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucune destination affichée.</p>';
}
function render(data){
  window.PGIClientPortalData=data;state.data=data;state.user=data.user||state.user;
  $("tenant-name").textContent=(data.tenant&&data.tenant.display_name)||"Mon entreprise";
  $("tenant-meta").textContent=[data.tenant&&data.tenant.country_code,data.tenant&&data.tenant.default_currency,state.demo?"Démonstration":null].filter(Boolean).join(" · ");
  $("customer-user-name").textContent=(state.user&&state.user.name)||"Utilisateur";
  $("customer-user-role").textContent=statusLabel((state.user&&state.user.role)||"readonly");
  import("./client-access-visibility.js").then(m=>m.a(data,state.demo));
  var resetButton=$("client-metrics-reset"),canReset=state.demo||/^(owner|admin)$/.test(state.user?.role||"");
  if(resetButton)resetButton.hidden=!canReset;
  var a=aggregate(data),rate=a.calls?a.connected/a.calls*100:0;
  $("kpi-calls").textContent=nf(a.calls);$("kpi-answer-rate").textContent=nf(rate,1)+" % décrochés";
  $("kpi-minutes").textContent=nf(a.billable/60,1);$("kpi-revenue").textContent=money(a.revenue,a.currency);$("kpi-payout").textContent=money(a.payout,a.currency);
  $("portal-sync").textContent="Dernière consolidation : "+(a.updated?dt(a.updated):dt(data.server_time));
  $("traffic-total").textContent=nf(a.calls)+" appels";
  renderAnalytics(data);renderNumbers(data);renderCalls(data);renderSettlements(data);renderSubscriptions(data);renderOnboarding(data);renderDestinations(data);renderPortabilitySummary(data);renderVoiceStudio(data);renderServiceCenter(data);if(I.apply)I.apply(document.body);
}
async function loadPortal(){
  var range=rangeFor(state.range),data;
  document.dispatchEvent(new CustomEvent("pgi:portal-loading",{detail:{range:state.range}}));
  try{
    if(state.demo){
      data=demoData(range);
      data.comparison_previous=demoData(previousRangeFor(range)).financial_by_currency;
    }else data=await window.PGICustomerApi.portal(range.from,range.to);
    render(data);
    document.dispatchEvent(new CustomEvent("pgi:portal-loaded",{detail:{range:state.range,serverTime:data&&data.server_time||null,data:data}}));
    return data;
  }catch(error){
    document.dispatchEvent(new CustomEvent("pgi:portal-error",{detail:{range:state.range,code:error&&error.code||"LOAD_FAILED"}}));
    throw error;
  }
}
function showApp(){
  $("customer-auth").hidden=true;$("customer-app").hidden=false;loadPortal().catch(function(e){toast("Chargement impossible : "+(e.code||e.message));});
}
function showLogin(){
  $("customer-app").hidden=true;$("customer-auth").hidden=false;$("login-panel").hidden=false;$("register-panel").hidden=true;$("activation-panel").hidden=true;
}
function showRegister(){
  $("customer-app").hidden=true;$("customer-auth").hidden=false;$("login-panel").hidden=true;$("register-panel").hidden=false;$("activation-panel").hidden=true;
  populateCountries();import("./client-audience.js").then(function(m){m.init()}).catch(function(){});
}
function showActivation(){
  $("customer-app").hidden=true;$("customer-auth").hidden=false;$("login-panel").hidden=true;$("register-panel").hidden=true;$("activation-panel").hidden=false;
}
async function handleGoogleCredential(response,tenantOverride){
  var credential=response&&response.credential?response.credential:state.googleCredential;
  if(!credential)return;
  state.googleCredential=credential;setAuthMessage("");
  var invite=new URLSearchParams(location.search).get("invite")||"";
  var tenant=tenantOverride||$("customer-tenant").value||"";
  try{
    var result=await window.PGICustomerApi.google(credential,tenant,invite);state.googleCredential=null;
    if(result&&result.pending_contract){
      setAuthMessage(tr("Compte Google créé. Votre accès sera activé dès que votre contrat sera rattaché."),false);
      return;
    }
    state.user=result.user;if(invite)history.replaceState(null,"",location.pathname);showApp();
  }catch(err){
    if(err.code==="CUSTOMER_TENANT_REQUIRED"&&err.payload&&Array.isArray(err.payload.tenants)&&err.payload.tenants.length){
      var sel=$("customer-tenant");sel.innerHTML=err.payload.tenants.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name+" · "+x.role)+'</option>';}).join("");$("tenant-choice-wrap").hidden=false;$("google-tenant-continue").hidden=false;setAuthMessage(tr("Compte")+" : "+tr("Confirmer"),false);return;
    }
    var messages={GOOGLE_INVITATION_REQUIRED:"Google account requires a valid invitation for this account.",GOOGLE_INVITATION_EMAIL_MISMATCH:"The Google account email does not match the invitation.",GOOGLE_LINK_REQUIRES_INVITATION:"For security, this Google account must be linked through an invitation.",GOOGLE_AUTH_NOT_CONFIGURED:"Google sign-in is not configured yet."};
    setAuthMessage(messages[err.code]||"Google sign-in failed.",true);
  }
}
async function initGoogle(){
  if(!window.PGICustomerGoogle)return;
  try{await window.PGICustomerGoogle.init({callback:function(r){handleGoogleCredential(r);},loginElement:$("google-login"),activationElement:$("google-activation")});}catch(_e){}
}
var COUNTRY_CODES=("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
var countriesReady=false,portabilityController=null,portabilityPromise=null,serviceCenterController=null,serviceCenterPromise=null,voiceStudioController=null,voiceStudioPromise=null;
function ensurePortability(){
  if(portabilityController)return Promise.resolve(portabilityController);
  if(!portabilityPromise)portabilityPromise=import("./client-portability.js").then(function(m){
    portabilityController=m.createController({getData:function(){return state.data||{};},getDemo:function(){return state.demo;},reload:loadPortal,toast:toast,countryCodes:COUNTRY_CODES,locale:I.locale||"fr-FR"});
    return portabilityController;
  });
  return portabilityPromise;
}
function renderPortabilitySummary(data){
  var rows=data.portability_requests||[],count=$("portability-count"),list=$("portability-list");
  if(count)count.textContent=String(rows.length);
  if(rows.length)ensurePortability().then(function(x){x.render(data);}).catch(function(){});
  else if(list)list.innerHTML='<p class="cp-empty">Aucune demande de portabilité en cours.</p>';
}
function ensureServiceCenter(){
  if(serviceCenterController)return Promise.resolve(serviceCenterController);
  if(!serviceCenterPromise)serviceCenterPromise=import("./client-service-center.js").then(function(m){
    serviceCenterController=m.createController({api:window.PGICustomerApi,reload:loadPortal,toast:toast,locale:I.locale||"fr-FR"});
    return serviceCenterController;
  });
  return serviceCenterPromise;
}
function renderServiceCenter(data){
  if(!$("client-service-center"))return;
  ensureServiceCenter().then(function(x){x.render(data);}).catch(function(){});
}
function ensureVoiceStudio(){
  if(voiceStudioController)return Promise.resolve(voiceStudioController);
  if(!voiceStudioPromise)voiceStudioPromise=import("./client-voice-studio.js").then(function(m){voiceStudioController=m.createController({api:window.PGICustomerApi,getDemo:function(){return state.demo;},getPortal:function(){return state.data||{};},toast:toast,canEdit:function(){return state.demo||["owner","admin"].includes(String((state.user&&state.user.role)||"").toLowerCase());}});return voiceStudioController;});
  return voiceStudioPromise;
}
function renderVoiceStudio(){ensureVoiceStudio().then(function(x){x.load();}).catch(function(){});}
function localeRegion(){
  try{return new Intl.Locale((navigator.languages&&navigator.languages[0])||navigator.language||"fr-FR").region||"FR";}catch(_e){return "FR";}
}
function populateCountries(){
  if(countriesReady)return;
  var select=$("register-country"),current=localeRegion().toUpperCase(),dn=null;
  try{dn=new Intl.DisplayNames([(navigator.languages&&navigator.languages[0])||navigator.language||"fr"],{type:"region"});}catch(_e){}
  var rows=COUNTRY_CODES.map(function(code){return {code:code,label:dn?dn.of(code):code};}).filter(function(x){return x.label;}).sort(function(a,b){return a.label.localeCompare(b.label,undefined,{sensitivity:"base"});});
  select.innerHTML=rows.map(function(x){return '<option value="'+x.code+'">'+esc(x.label)+'</option>';}).join("");
  select.value=COUNTRY_CODES.includes(current)?current:"FR";
  countriesReady=true;updateRegistrationNumberField();
}
function updateRegistrationNumberField(){
  var fr=$("register-country").value==="FR",label=$("register-number-label"),input=$("register-number");
  label.textContent=fr?"SIRET":tr("Numéro d’immatriculation");
  input.placeholder=fr?tr("14 chiffres"):tr("Facultatif");
  input.inputMode=fr?"numeric":"text";
}
async function submitRegistration(e){
  e.preventDefault();setAuthMessage("");
  var password=$("register-password").value,confirm=$("register-password-confirm").value;
  if(password!==confirm){setAuthMessage("Les deux mots de passe sont différents.",true);return;}
  if(password.length<12){setAuthMessage("Le mot de passe doit contenir au moins 12 caractères.",true);return;}
  var payload={
    first_name:$("register-first-name").value.trim(),
    last_name:$("register-last-name").value.trim(),
    account_type:$("register-account-type").value,
    company_name:$("register-company").value.trim(),
    country_code:$("register-country").value,
    registration_number:$("register-number").value.trim(),
    phone:$("register-phone").value.trim(),
    email:$("register-email").value.trim(),
    password:password,
    authority_confirmed:$("register-authority").checked,
    website:$("register-website").value,
    preferred_locale:(navigator.languages&&navigator.languages[0])||navigator.language||"fr-FR",
    timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC")
  };
  try{
    var result=await window.PGICustomerApi.register(payload);
    state.user=result.user;
    setAuthMessage("");
    showApp();
  }catch(err){
    var messages={
      CUSTOMER_ACCOUNT_EXISTS:"Un compte existe déjà avec cette adresse e-mail.",
      INVALID_SIRET:"Le SIRET doit contenir 14 chiffres.",
      INVALID_REGISTRATION_NUMBER:"Le numéro d’immatriculation n’est pas valide.",
      INVALID_PHONE:"Le numéro de téléphone n’est pas valide.",
      REGISTRATION_RATE_LIMITED:"Trop de créations de compte ont été tentées. Réessayez plus tard.",
      REGISTRATION_AUTHORITY_REQUIRED:"Vous devez confirmer être autorisé à créer ce compte.",
      INVALID_CUSTOMER_ACCOUNT_TYPE:"Choisissez Particulier ou Professionnel / entreprise."
    };
    setAuthMessage(messages[err.code]||"Création du compte impossible. Vérifiez les informations saisies.",true);
  }
}
async function submitLogin(e){
  e.preventDefault();setAuthMessage("");
  var email=$("customer-email").value.trim(),password=$("customer-password").value,tenant=$("customer-tenant").value||"";
  try{
    var result=await window.PGICustomerApi.login(email,password,tenant);state.user=result.user;showApp();
  }catch(err){
    if(err.code==="CUSTOMER_TENANT_REQUIRED"&&err.payload&&Array.isArray(err.payload.tenants)&&err.payload.tenants.length){
      var sel=$("customer-tenant");sel.innerHTML=err.payload.tenants.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name+" · "+x.role)+'</option>';}).join("");$("tenant-choice-wrap").hidden=false;setAuthMessage("Choisissez le compte à ouvrir.",false);return;
    }
    setAuthMessage("Connexion refusée. Vérifiez vos identifiants.",true);
  }
}
async function submitActivation(e){
  e.preventDefault();setAuthMessage("");
  var p=$("activation-password").value,c=$("activation-password-confirm").value;
  if(p!==c){setAuthMessage("Les deux mots de passe sont différents.",true);return;}
  var token=new URLSearchParams(location.search).get("invite")||"";
  try{
    var result=await window.PGICustomerApi.activate(token,$("activation-name").value.trim(),p);state.user=result.user;history.replaceState(null,"",location.pathname);showApp();
  }catch(err){setAuthMessage(err.code==="CUSTOMER_ACCOUNT_EXISTS"?"Un compte existe déjà pour cette adresse. Connectez-vous avec votre compte existant.":"Activation impossible ou invitation expirée.",true);}
}
function csvCell(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';}
function downloadCsv(name,rows){
  var csv=rows.map(function(row){return row.map(csvCell).join(";");}).join("\r\n");
  var blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},500);
}
function metricLabel(el){
  var p=el&&el.parentElement,label="";
  if(p){var candidate=p.querySelector("span:not([id]),small:not([id]),h2,h3");label=candidate?String(candidate.textContent||"").trim():"";}
  return label||String(el.id||"Métrique").replace(/[-_]+/g," ");
}
function clientMetricRows(){
  var rows=[["Métrique","Valeur","Identifiant"]],seen={};
  qsa("main strong[id],main span[id]").forEach(function(el){
    var id=String(el.id||"").trim(),value=String(el.textContent||"").replace(/\s+/g," ").trim();
    if(!id||!value||value.length>220||seen[id])return;
    seen[id]=true;rows.push([metricLabel(el),value,id]);
  });
  return rows;
}
function rowsToPlainText(rows){return rows.map(function(row){return row.map(function(v){return String(v==null?"":v);}).join("\t");}).join("\n");}
async function copyPlainText(text){
  if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return;}
  var ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
  var ok=document.execCommand("copy");ta.remove();if(!ok)throw new Error("COPY_FAILED");
}
async function buildClientReportRows(data){
  var a=aggregate(data),calls=await fetchCallsForExport(),rows=[["RAPPORT AUDIOTEL PREMIUM PRO"],["Société",(data.tenant&&data.tenant.display_name)||""],["Période",data.range&&data.range.from||"",data.range&&data.range.to||""],["Appels",a.calls],["Appels décrochés",a.connected],["Minutes facturables",n(a.billable)/60],["Montant service TTC",a.revenue,a.currency],["Reversement net validé",a.payout,a.currency],[],["MÉTRIQUES DU TABLEAU DE BORD"]];
  rows=rows.concat(clientMetricRows());
  rows.push([],["NUMÉROS"],["Numéro","Tarif","État"]);
  (data.numbers||[]).forEach(function(x){rows.push([x.display_number||x.e164,x.tariff_code,statusLabel(x.assignment_status||x.status)]);});
  rows.push([],["REVERSEMENTS"],["Période fin","Net HT","Devise","Statut"]);
  (data.settlements||[]).forEach(function(x){rows.push([x.period_end,n(x.net_payout_ht),x.currency,statusLabel(x.status)]);});
  rows.push([],["APPELS"]);return rows.concat(callRows(calls));
}
async function fetchCallsForExport(){
  if(state.demo)return (state.data&&state.data.recent_calls)||[];
  var range=rangeFor(state.range),rows=[],cursor=null;
  for(var page=0;page<10;page++){var result=await window.PGICustomerApi.calls(range.from,range.to,cursor,100);rows=rows.concat(result.data||[]);cursor=result.next_cursor;if(!cursor)break;}
  return rows;
}
function callRows(rows){var out=[["Date","Numéro","État","Durée secondes","Montant TTC","Devise"]];rows.forEach(function(x){out.push([x.started_at,x.display_number||x.e164||"",statusLabel(x.call_status),n(x.billable_seconds||x.conversation_seconds),n(x.retail_service_amount_ttc),x.currency||""]);});return out;}
async function exportClient(kind){
  try{
    var data=state.data||{},slug=new Date().toISOString().slice(0,10);
    if(kind==="print"){window.print();return;}
    if(kind==="calls"){var calls=await fetchCallsForExport();downloadCsv("audiotel-appels-"+slug+".csv",callRows(calls));toast(calls.length+" appel(s) exporté(s)");return;}
    if(kind==="settlements"){var rows=[["Période début","Période fin","Devise","Reversement opérateur HT","Frais de plateforme HT","Net client HT","Statut","Échéance","Payé le"]];(data.settlements||[]).forEach(function(x){rows.push([x.period_start,x.period_end,x.currency,n(x.upstream_payout_ht),n(x.platform_fee_ht),n(x.net_payout_ht),statusLabel(x.status),x.payment_due_date||"",x.paid_at||""]);});downloadCsv("audiotel-reversements-"+slug+".csv",rows);toast("Reversements exportés");return;}
    if(kind==="numbers"){var nr=[["Numéro","E164","Devise","Tarif","Prix/min","État","KYC"]];(data.numbers||[]).forEach(function(x){nr.push([x.display_number,x.e164,x.currency,x.tariff_code,n(x.service_rate_ttc_per_min),statusLabel(x.assignment_status||x.status),statusLabel(x.kyc_status)]);});downloadCsv("audiotel-numeros-"+slug+".csv",nr);toast("Numéros exportés");return;}
    if(kind==="copy"){var copied=await buildClientReportRows(data);await copyPlainText(rowsToPlainText(copied));toast("Rapport complet copié");return;}
    if(kind==="report"){var reportRows=await buildClientReportRows(data);downloadCsv("audiotel-rapport-"+slug+".csv",reportRows);toast("Rapport complet exporté");return;}
  }catch(err){toast("Export impossible");}
}
async function openBilling(kind){
  if(state.billingBusy)return;
  if(state.demo){toast("Prestataire de paiement non connecté.");return;}
  var action=kind==="manage"?window.PGICustomerApi.createBillingPortal:window.PGICustomerApi.createBillingCheckout;
  var button=kind==="manage"?$("client-billing-manage"):$("client-billing-start"),original=button?button.textContent:"";
  var idempotencyKey=kind==="manage"?null:window.PGICustomerApi.newIdempotencyKey();
  state.billingBusy=true;if(button){button.disabled=true;button.textContent=kind==="manage"?tr("Ouverture de la facturation…"):tr("Ouverture du paiement…");}
  try{
    var result=kind==="manage"?await action():await action(idempotencyKey);
    var target=result&&result.url?new URL(result.url,location.origin):null;
    if(!target||target.protocol!=="https:")throw new Error("INVALID_BILLING_URL");
    location.assign(target.href);
  }catch(err){
    toast(err&&err.code==="PAYMENT_PROVIDER_NOT_CONNECTED"?"Prestataire de paiement non connecté.":"Gestion de l’abonnement indisponible.");
  }finally{
    state.billingBusy=false;
    if(button){button.textContent=original;renderSubscriptions(state.data||{});}
  }
}
function handleBillingReturn(){
  var url=new URL(location.href),result=url.searchParams.get("billing");
  if(!result)return;
  url.searchParams.delete("billing");history.replaceState(null,"",url.pathname+(url.search?"?"+url.searchParams.toString():"")+url.hash);
  if(result==="success")toast("Paiement terminé. Le statut de l’abonnement sera confirmé automatiquement.");
  else if(result==="cancelled")toast("Paiement annulé. Aucun changement n’a été appliqué.");
}
async function changePassword(e){
  e.preventDefault();
  var current=$("current-password").value,newPassword=$("new-password").value,confirm=$("new-password-confirm").value,msg=$("password-message");
  msg.classList.remove("bad");msg.textContent="";
  if(newPassword!==confirm){msg.classList.add("bad");msg.textContent="Les deux nouveaux mots de passe sont différents.";return;}
  if(newPassword.length<12){msg.classList.add("bad");msg.textContent="Le nouveau mot de passe doit contenir au moins 12 caractères.";return;}
  try{
    await window.PGICustomerApi.changePassword(current,newPassword);
    var d=$("client-security-dialog");if(d&&d.open)d.close();
    state.user=null;showLogin();setAuthMessage("Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.",false);
    $("client-password-form").reset();
  }catch(err){
    msg.classList.add("bad");
    msg.textContent=err.code==="INVALID_CURRENT_PASSWORD"?"Le mot de passe actuel est incorrect.":err.code==="PASSWORD_UNCHANGED"?"Choisissez un nouveau mot de passe différent.":"Modification impossible.";
  }
}
function bind(){
  $("customer-login-form").addEventListener("submit",submitLogin);
  $("customer-register-form").addEventListener("submit",submitRegistration);
  $("customer-activation-form").addEventListener("submit",submitActivation);
  $("show-register").addEventListener("click",showRegister);
  $("show-login").addEventListener("click",showLogin);
  $("register-country").addEventListener("change",updateRegistrationNumberField);
  $("customer-logout").addEventListener("click",async function(){try{await window.PGICustomerApi.logout();}catch(_e){}state.user=null;showLogin();});
  $("export-calls").addEventListener("click",function(){exportClient("calls");});
  $("client-relations").addEventListener("click",function(){import("./client-relations.js").then(function(m){return m.open(state.data||{});}).catch(function(){toast("Réclamations momentanément indisponibles.");});});
  $("client-export").addEventListener("click",function(){var d=$("client-export-dialog");if(d&&typeof d.showModal==="function")d.showModal();});
  $("client-security").addEventListener("click",function(){var d=$("client-security-dialog");if(d&&typeof d.showModal==="function")d.showModal();});
  $("client-metrics-reset").addEventListener("click",function(){
    import("./metric-reset.js").then(function(m){
      m.openMetricReset({
        title:"Remettre mes statistiques à zéro",
        note:"Choisissez uniquement les statistiques de votre compte qui doivent repartir de zéro. Vos règlements, contrats et CDR restent conservés.",
        onConfirm:async function(keys){
          if(state.demo){
            toast("Sélection enregistrée en démonstration. En production, seuls ces indicateurs repartiront de zéro.");
            return;
          }
          await window.PGICustomerApi.resetMetrics(keys,window.PGICustomerApi.newIdempotencyKey());
          await loadPortal();
          toast("Les statistiques sélectionnées repartent de zéro.");
        }
      });
    }).catch(function(){toast("Cette action est momentanément indisponible.");});
  });
  $("client-security-close").addEventListener("click",function(){var d=$("client-security-dialog");if(d&&d.open)d.close();});
  $("client-password-form").addEventListener("submit",changePassword);
  $("client-billing-start").addEventListener("click",function(){openBilling("start");});
  $("client-billing-manage").addEventListener("click",function(){openBilling("manage");});
  $("portability-open").addEventListener("click",function(){ensurePortability().then(function(x){x.render(state.data||{portability_requests:[]});x.open();}).catch(function(){toast("Portabilité momentanément indisponible.");});});
  $("google-tenant-continue").addEventListener("click",function(){handleGoogleCredential(null,$("customer-tenant").value||"");});
  qsa("[data-client-export]").forEach(function(b){b.addEventListener("click",function(){var d=$("client-export-dialog");if(d&&d.open)d.close();exportClient(b.dataset.clientExport);});});
  qsa("[data-range]").forEach(function(btn){btn.addEventListener("click",function(){state.range=btn.dataset.range;qsa("[data-range]").forEach(function(x){x.classList.toggle("active",x===btn);});loadPortal().catch(function(){toast("Actualisation impossible");});});});
}
async function init(){
  if(I.apply)I.apply(document.body);
  bind();
  import("./client-mobile.js").then(function(m){m.init();}).catch(function(){});
  initGoogle();
  handleBillingReturn();
  var cfg=window.PGI_CONFIG||{};
  state.demo=cfg.mode==="demo"||!cfg.apiBaseUrl;
  if(state.demo){showApp();return;}
  if(new URLSearchParams(location.search).get("invite")){showActivation();return;}
  try{var me=await window.PGICustomerApi.me();state.user=me.user;showApp();}catch(_e){showLogin();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

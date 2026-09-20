(function(){
"use strict";
var state={range:"30",data:null,user:null,demo:false};
var $=function(id){return document.getElementById(id);};
var qsa=function(sel){return Array.from(document.querySelectorAll(sel));};
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
function nf(v,d){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d==null?0:d}).format(n(v));}
function money(v,c){if(v==null||!Number.isFinite(Number(v)))return "—";try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v));}catch(_e){return nf(v,2)+" "+(c||"");}}
function dt(v){if(!v)return "—";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";}
function dateOnly(v){if(!v)return "—";var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"—";}
function duration(s){s=Math.max(0,Math.round(n(s)));var m=Math.floor(s/60),r=s%60;return m+" min "+String(r).padStart(2,"0")+" s";}
function statusLabel(v){var m={active:"Actif",pending:"En attente",testing:"Test",suspended:"Suspendu",closed:"Fermé",connected:"Décroché",abandoned:"Abandonné",failed:"Échoué",busy:"Occupé",no_answer:"Sans réponse",open:"En cours",reconciled:"Validé",invoiced:"Facturé",payable:"À payer",paid:"Payé",disputed:"Contesté",past_due:"Impayé",cancelled:"Résilié",ended:"Terminé"};return m[String(v||"").toLowerCase()]||String(v||"—");}
function chip(status){var s=String(status||"").toLowerCase();var tone=["active","connected","paid","reconciled","payable"].includes(s)?"ok":["pending","testing","open","invoiced"].includes(s)?"warn":["suspended","closed","failed","past_due","disputed"].includes(s)?"bad":"neutral";return '<span class="cp-chip '+tone+'">'+esc(statusLabel(status))+"</span>";}
function toast(message){var el=$("client-toast");el.textContent=message;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){el.hidden=true;},2600);}
function setAuthMessage(message,bad){var el=$("auth-message");el.textContent=message||"";el.classList.toggle("bad",Boolean(bad));}
function rangeFor(key){
  var to=new Date(),from=new Date(to);
  if(key==="7")from=new Date(to.getTime()-7*86400000);
  else if(key==="30")from=new Date(to.getTime()-30*86400000);
  else if(key==="month"){from=new Date(to);from.setDate(1);from.setHours(0,0,0,0);}
  else if(key==="year"){from=new Date(to);from.setMonth(0,1);from.setHours(0,0,0,0);}
  return {from:from.toISOString(),to:to.toISOString()};
}
function demoData(range){
  var series=[],today=new Date();
  for(var i=29;i>=0;i--){var d=new Date(today.getTime()-i*86400000);var calls=18+((i*7)%19)+Math.round(5*Math.sin(i)),connected=Math.round(calls*.82),failed=Math.max(1,Math.round(calls*.06));series.push({bucket_date:d.toISOString().slice(0,10),calls_total:calls,calls_connected:connected,calls_abandoned:Math.max(0,calls-connected-failed),calls_failed:failed,billable_seconds:calls*148,generated_revenue_ttc:calls*1.87,updated_at:new Date().toISOString()});}
  var recent=[];for(var j=0;j<8;j++){var s=new Date(Date.now()-j*5400000);recent.push({call_id:j+1,display_number:"0892 12 34 56",market:"FR",currency:"EUR",started_at:s.toISOString(),call_status:j===3?"abandoned":"connected",conversation_seconds:j===3?0:120+j*17,billable_seconds:j===3?0:120+j*17,retail_service_amount_ttc:j===3?0:1.6+j*.18});}
  return {
    user:{name:"Camille Martin",role:"owner"},
    tenant:{display_name:"Société Démo",default_currency:"EUR",country_code:"FR",status:"active"},
    financial_by_currency:[{currency:"EUR",calls_total:742,calls_connected:611,calls_abandoned:79,calls_failed:52,billable_seconds:98760,generated_revenue_ttc:1386.4,updated_at:new Date().toISOString()}],
    series:series,
    numbers:[{id:1,display_number:"0892 12 34 56",e164:"+33892123456",currency:"EUR",number_type:"premium",service_rate_ttc_per_min:.8,status:"active",assignment_status:"active",kyc_status:"verified",tariff_code:"D080"}],
    settlements:[{id:1,currency:"EUR",period_start:"2026-08-01",period_end:"2026-08-31",net_payout_ht:428.75,status:"paid",paid_at:"2026-09-12T10:00:00Z"},{id:2,currency:"EUR",period_start:"2026-09-01",period_end:"2026-09-15",net_payout_ht:231.2,status:"payable",payment_due_date:"2026-09-30"}],
    subscriptions:[{id:1,status:"active",billing_currency:"EUR",current_period_start:"2026-09-01T00:00:00Z",current_period_end:"2026-10-01T00:00:00Z",plan_name:"Accès Audiotel",amount_minor:200,price_currency:"EUR",billing_interval:"month",last_payment_status:"paid"}],
    destinations:[{id:1,sva_number_id:1,label:"Standard principal",destination_type:"pstn",destination_uri:"tel:+33123456789",priority:10,status:"active",active_calls:1,max_concurrent_calls:25}],
    recent_calls:recent,range:range,server_time:new Date().toISOString()
  };
}
function aggregate(data){
  var rows=data.financial_by_currency||[],calls=0,connected=0,billable=0,updated=null;
  rows.forEach(function(x){calls+=n(x.calls_total);connected+=n(x.calls_connected);billable+=n(x.billable_seconds);if(x.updated_at&&(!updated||Date.parse(x.updated_at)>Date.parse(updated)))updated=x.updated_at;});
  var currency=(data.tenant&&data.tenant.default_currency)||((rows[0]&&rows[0].currency)||"EUR");
  var moneyRows=rows.filter(function(x){return x.currency===currency;});
  var revenue=moneyRows.reduce(function(a,x){return a+n(x.generated_revenue_ttc);},0);
  var valid=["reconciled","invoiced","payable","paid"];
  var payout=(data.settlements||[]).filter(function(x){return x.currency===currency&&valid.includes(String(x.status));}).reduce(function(a,x){return a+n(x.net_payout_ht);},0);
  return {calls:calls,connected:connected,billable:billable,currency:currency,revenue:revenue,payout:payout,updated:updated};
}
function svgLine(id,rows,series,options){
  var el=$(id);if(!el)return;rows=(rows||[]).slice(-62);if(!rows.length){el.innerHTML='<text x="360" y="110" text-anchor="middle" class="axis-label">Aucune donnée</text>';return;}
  var W=720,H=220,L=34,R=12,T=15,B=25,plotW=W-L-R,plotH=H-T-B;
  options=options||{};var max=options.max||1;series.forEach(function(s){rows.forEach(function(x){max=Math.max(max,n(s.value(x)));});});
  function px(i){return L+(rows.length===1?plotW/2:i*plotW/Math.max(1,rows.length-1));}
  function py(v){return T+plotH-(n(v)/max*plotH);}
  var grid="";for(var g=0;g<=4;g++){var y=T+plotH*g/4;grid+='<line class="grid" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/>';}
  var labels="";var step=Math.max(1,Math.ceil(rows.length/6));rows.forEach(function(x,i){if(i%step===0||i===rows.length-1){var d=new Date(x.bucket_date);labels+='<text class="axis-label" x="'+px(i)+'" y="'+(H-6)+'" text-anchor="middle">'+String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"</text>";}});
  var paths=series.map(function(s,si){var pts=rows.map(function(x,i){return px(i)+","+py(s.value(x));}).join(" ");return '<polyline class="'+(si?"line-secondary":"line-main")+'" points="'+pts+'"/>';}).join("");
  el.innerHTML=grid+labels+paths;
}
function renderStatus(data){
  var a=(data.financial_by_currency||[]).reduce(function(o,x){o.total+=n(x.calls_total);o.connected+=n(x.calls_connected);o.abandoned+=n(x.calls_abandoned);o.failed+=n(x.calls_failed);return o;},{total:0,connected:0,abandoned:0,failed:0});
  var total=Math.max(1,a.total),p1=a.connected/total*100,p2=a.abandoned/total*100;
  $("status-total").textContent=nf(a.total);
  $("status-donut").style.background="conic-gradient(#d9dde1 0 "+p1+"%,#7d858d "+p1+"% "+(p1+p2)+"%,#4a5057 "+(p1+p2)+"% 100%)";
  var rows=[["#d9dde1","Décrochés",a.connected],["#7d858d","Abandonnés",a.abandoned],["#4a5057","Échoués",a.failed]];
  $("status-legend").innerHTML=rows.map(function(x){return '<div><i style="background:'+x[0]+'"></i><span>'+x[1]+'</span><strong>'+nf(x[2])+'</strong></div>';}).join("");
}
function renderPayoutChart(data){
  var rows=(data.settlements||[]).slice(0,8).reverse(),el=$("payout-bars"),max=Math.max.apply(null,[1].concat(rows.map(function(x){return n(x.net_payout_ht);})));
  el.innerHTML=rows.length?rows.map(function(x){var pct=Math.max(2,n(x.net_payout_ht)/max*100);return '<div class="cp-hbar"><span>'+esc(dateOnly(x.period_end))+'</span><i><b style="width:'+pct+'%"></b></i><strong>'+esc(money(x.net_payout_ht,x.currency))+'</strong></div>';}).join(""):'<p class="cp-empty">Aucun reversement disponible.</p>';
}
function renderAnalytics(data){
  var rows=data.series||[],a=aggregate(data);
  svgLine("calls-chart",rows,[{value:function(x){return x.calls_total;}},{value:function(x){return x.calls_connected;}}]);
  svgLine("minutes-chart",rows,[{value:function(x){return n(x.billable_seconds)/60;}}]);
  svgLine("revenue-chart",rows,[{value:function(x){return x.generated_revenue_ttc;}}]);
  svgLine("asr-chart",rows,[{value:function(x){return n(x.calls_total)?n(x.calls_connected)/n(x.calls_total)*100:0;}},{value:function(x){return n(x.calls_total)?n(x.calls_abandoned)/n(x.calls_total)*100:0;}}],{max:100});
  svgLine("value-chart",rows,[{value:function(x){return n(x.calls_total)?n(x.generated_revenue_ttc)/n(x.calls_total):0;}}]);
  svgLine("duration-chart",rows,[{value:function(x){return n(x.calls_connected)?n(x.billable_seconds)/60/n(x.calls_connected):0;}}]);
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
  var rows=data.recent_calls||[];$("calls-body").innerHTML=rows.length?rows.map(function(x){return "<tr><td>"+esc(dt(x.started_at))+"</td><td>"+esc(x.display_number||x.e164||"—")+"</td><td>"+chip(x.call_status)+"</td><td>"+esc(duration(x.billable_seconds||x.conversation_seconds))+"</td><td>"+esc(money(n(x.retail_service_amount_ttc),x.currency))+"</td></tr>";}).join(""):'<tr><td colspan="5" class="cp-empty-cell">Aucun appel sur cette période.</td></tr>';
}
function renderSettlements(data){
  var rows=data.settlements||[],el=$("settlements-list");
  el.innerHTML=rows.length?rows.slice(0,6).map(function(x){var note=x.paid_at?"Payé le "+dateOnly(x.paid_at):x.payment_due_date?"Échéance "+dateOnly(x.payment_due_date):"Période clôturée";return '<div class="cp-row"><div><strong>'+esc(money(x.net_payout_ht,x.currency))+'</strong><span>'+esc(dateOnly(x.period_start)+" → "+dateOnly(x.period_end))+' · '+esc(note)+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucun reversement disponible.</p>';
}
function renderSubscriptions(data){
  var rows=data.subscriptions||[],el=$("subscription-list");
  el.innerHTML=rows.length?rows.slice(0,3).map(function(x){var price=x.amount_minor!=null?money(n(x.amount_minor)/100,x.price_currency||x.billing_currency)+" / "+(x.billing_interval==="year"?"an":"mois"):"Tarif contractuel";return '<div class="cp-row"><div><strong>'+esc(x.plan_name||"Abonnement Audiotel")+'</strong><span>'+esc(price+" · période jusqu’au "+dateOnly(x.current_period_end))+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucun abonnement affiché.</p>';
}
function renderDestinations(data){
  var numbers={};(data.numbers||[]).forEach(function(x){numbers[String(x.id)]=x.display_number||x.e164;});
  var rows=data.destinations||[],el=$("destinations-list");
  el.innerHTML=rows.length?rows.map(function(x){var line=x.sva_number_id?numbers[String(x.sva_number_id)]||"Numéro attribué":"Tous les numéros";var cap=x.max_concurrent_calls?" · "+n(x.active_calls)+"/"+n(x.max_concurrent_calls)+" appels":" · "+n(x.active_calls)+" appel(s)";return '<div class="cp-row"><div><strong>'+esc(x.label)+'</strong><span>'+esc(line+" · "+x.destination_type+" · "+x.destination_uri+cap)+'</span></div>'+chip(x.status)+'</div>';}).join(""):'<p class="cp-empty">Aucune destination affichée.</p>';
}
function render(data){
  state.data=data;state.user=data.user||state.user;
  $("tenant-name").textContent=(data.tenant&&data.tenant.display_name)||"Mon entreprise";
  $("tenant-meta").textContent=[data.tenant&&data.tenant.country_code,data.tenant&&data.tenant.default_currency,state.demo?"Démonstration":null].filter(Boolean).join(" · ");
  $("customer-user-name").textContent=(state.user&&state.user.name)||"Utilisateur";
  $("customer-user-role").textContent=statusLabel((state.user&&state.user.role)||"readonly");
  var a=aggregate(data),rate=a.calls?a.connected/a.calls*100:0;
  $("kpi-calls").textContent=nf(a.calls);$("kpi-answer-rate").textContent=nf(rate,1)+" % décrochés";
  $("kpi-minutes").textContent=nf(a.billable/60,1);$("kpi-revenue").textContent=money(a.revenue,a.currency);$("kpi-payout").textContent=money(a.payout,a.currency);
  $("portal-sync").textContent="Dernière consolidation : "+(a.updated?dt(a.updated):dt(data.server_time));
  $("traffic-total").textContent=nf(a.calls)+" appels";
  renderAnalytics(data);renderNumbers(data);renderCalls(data);renderSettlements(data);renderSubscriptions(data);renderDestinations(data);
}
async function loadPortal(){
  var range=rangeFor(state.range),data;
  if(state.demo)data=demoData(range);
  else data=await window.PGICustomerApi.portal(range.from,range.to);
  render(data);
}
function showApp(){
  $("customer-auth").hidden=true;$("customer-app").hidden=false;loadPortal().catch(function(e){toast("Chargement impossible : "+(e.code||e.message));});
}
function showLogin(){
  $("customer-app").hidden=true;$("customer-auth").hidden=false;$("login-panel").hidden=false;$("activation-panel").hidden=true;
}
function showActivation(){
  $("customer-app").hidden=true;$("customer-auth").hidden=false;$("login-panel").hidden=true;$("activation-panel").hidden=false;
}
async function submitLogin(e){
  e.preventDefault();setAuthMessage("");
  var email=$("customer-email").value.trim(),password=$("customer-password").value,tenant=$("customer-tenant").value||"";
  try{
    var result=await window.PGICustomerApi.login(email,password,tenant);state.user=result.user;showApp();
  }catch(err){
    if(err.code==="CUSTOMER_TENANT_REQUIRED"&&err.payload&&Array.isArray(err.payload.tenants)&&err.payload.tenants.length){
      var sel=$("customer-tenant");sel.innerHTML=err.payload.tenants.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name+" · "+x.role)+'</option>';}).join("");$("tenant-choice-wrap").hidden=false;setAuthMessage("Choisissez la société à ouvrir.",false);return;
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
    if(kind==="settlements"){var rows=[["Période début","Période fin","Devise","Brut HT","Frais plateforme HT","Net client HT","Statut","Échéance","Payé le"]];(data.settlements||[]).forEach(function(x){rows.push([x.period_start,x.period_end,x.currency,n(x.gross_service_amount_ht),n(x.platform_fee_ht),n(x.net_payout_ht),statusLabel(x.status),x.payment_due_date||"",x.paid_at||""]);});downloadCsv("audiotel-reversements-"+slug+".csv",rows);toast("Reversements exportés");return;}
    if(kind==="numbers"){var nr=[["Numéro","E164","Devise","Tarif","Prix/min","État","KYC"]];(data.numbers||[]).forEach(function(x){nr.push([x.display_number,x.e164,x.currency,x.tariff_code,n(x.service_rate_ttc_per_min),statusLabel(x.assignment_status||x.status),statusLabel(x.kyc_status)]);});downloadCsv("audiotel-numeros-"+slug+".csv",nr);toast("Numéros exportés");return;}
    if(kind==="report"){
      var a=aggregate(data),calls=await fetchCallsForExport(),rows=[["RAPPORT AUDIOTEL PREMIUM PRO"],["Société",(data.tenant&&data.tenant.display_name)||""],["Période",data.range&&data.range.from||"",data.range&&data.range.to||""],["Appels",a.calls],["Appels décrochés",a.connected],["Minutes facturables",n(a.billable)/60],["Montant service TTC",a.revenue,a.currency],["Reversement net validé",a.payout,a.currency],[],["NUMÉROS"],["Numéro","Tarif","État"]];
      (data.numbers||[]).forEach(function(x){rows.push([x.display_number||x.e164,x.tariff_code,statusLabel(x.assignment_status||x.status)]);});
      rows.push([],["REVERSEMENTS"],["Période fin","Net HT","Devise","Statut"]);
      (data.settlements||[]).forEach(function(x){rows.push([x.period_end,n(x.net_payout_ht),x.currency,statusLabel(x.status)]);});
      rows.push([],["APPELS"]);rows=rows.concat(callRows(calls));
      downloadCsv("audiotel-rapport-"+slug+".csv",rows);toast("Rapport complet exporté");return;
    }
  }catch(err){toast("Export impossible");}
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
  $("customer-activation-form").addEventListener("submit",submitActivation);
  $("customer-logout").addEventListener("click",async function(){try{await window.PGICustomerApi.logout();}catch(_e){}state.user=null;showLogin();});
  $("export-calls").addEventListener("click",function(){exportClient("calls");});
  $("client-export").addEventListener("click",function(){var d=$("client-export-dialog");if(d&&typeof d.showModal==="function")d.showModal();});
  $("client-security").addEventListener("click",function(){var d=$("client-security-dialog");if(d&&typeof d.showModal==="function")d.showModal();});
  $("client-security-close").addEventListener("click",function(){var d=$("client-security-dialog");if(d&&d.open)d.close();});
  $("client-password-form").addEventListener("submit",changePassword);
  qsa("[data-client-export]").forEach(function(b){b.addEventListener("click",function(){var d=$("client-export-dialog");if(d&&d.open)d.close();exportClient(b.dataset.clientExport);});});
  qsa("[data-range]").forEach(function(btn){btn.addEventListener("click",function(){state.range=btn.dataset.range;qsa("[data-range]").forEach(function(x){x.classList.toggle("active",x===btn);});loadPortal().catch(function(){toast("Actualisation impossible");});});});
}
async function init(){
  bind();
  var cfg=window.PGI_CONFIG||{};
  state.demo=cfg.mode==="demo"||!cfg.apiBaseUrl;
  if(state.demo){showApp();return;}
  if(new URLSearchParams(location.search).get("invite")){showActivation();return;}
  try{var me=await window.PGICustomerApi.me();state.user=me.user;showApp();}catch(_e){showLogin();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

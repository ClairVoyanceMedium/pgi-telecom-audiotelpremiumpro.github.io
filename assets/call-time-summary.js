(function(root){
"use strict";
var clientBusy=false,adminBusy=false,clientLast=0,adminLast=0;
var MIN_REFRESH_MS=60000;
function n(v){v=Number(v);return Number.isFinite(v)?v:0;}
function nf(v,d){return new Intl.NumberFormat("fr-FR",{minimumFractionDigits:d||0,maximumFractionDigits:d||0}).format(n(v));}
function duration(minutes){
  var total=Math.max(0,Math.round(n(minutes)));
  if(total<60)return nf(total)+" min";
  var h=Math.floor(total/60),m=total%60;
  return nf(h)+" h"+(m?" "+String(m).padStart(2,"0")+" min":"");
}
function ranges(){
  var now=new Date(),to=now.toISOString();
  var today=new Date(now);today.setHours(0,0,0,0);
  var week=new Date(today),weekday=week.getDay()||7;week.setDate(week.getDate()-weekday+1);
  var month=new Date(now.getFullYear(),now.getMonth(),1);
  var year=new Date(now.getFullYear(),0,1);
  return {
    today:{from:today.toISOString(),to:to},
    week:{from:week.toISOString(),to:to},
    month:{from:month.toISOString(),to:to},
    year:{from:year.toISOString(),to:to}
  };
}
function ensureStyle(){
  if(document.getElementById("pgi-call-time-style"))return;
  var s=document.createElement("style");s.id="pgi-call-time-style";
  s.textContent=".pgi-call-time-summary{margin:14px 0 18px;padding:15px 16px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));box-shadow:0 12px 32px rgba(0,0,0,.12)}.pgi-call-time-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:12px}.pgi-call-time-head p{margin:0 0 3px;font-size:9px;letter-spacing:.14em;font-weight:800;opacity:.72}.pgi-call-time-head h2{margin:0;font-size:18px}.pgi-call-time-head span{font-size:10px;opacity:.7;text-align:right}.pgi-call-time-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.pgi-call-time-card{min-width:0;padding:13px 14px;border:1px solid rgba(255,255,255,.075);border-radius:13px;background:rgba(0,0,0,.10)}.pgi-call-time-card>span{display:block;font-size:9px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}.pgi-call-time-card strong{display:block;margin-top:7px;font-size:22px;line-height:1.05;font-variant-numeric:tabular-nums}.pgi-call-time-card small{display:block;margin-top:6px;font-size:10px;opacity:.72}.pgi-call-time-summary[data-state=loading] strong{opacity:.55}.pgi-call-time-summary[data-state=error] .pgi-call-time-head span{opacity:.9}@media(max-width:820px){.pgi-call-time-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pgi-call-time-head{align-items:flex-start;flex-direction:column}.pgi-call-time-head span{text-align:left}}@media(max-width:440px){.pgi-call-time-grid{grid-template-columns:1fr 1fr}.pgi-call-time-card{padding:11px}.pgi-call-time-card strong{font-size:18px}}";
  document.head.appendChild(s);
}
function labels(){return {today:"Aujourd’hui",week:"Cette semaine",month:"Ce mois",year:"Cette année"};}
function mount(kind){
  ensureStyle();
  var id=kind==="client"?"client-call-time-summary":"admin-call-time-summary";
  var existing=document.getElementById(id);if(existing)return existing;
  var anchor=kind==="client"?document.getElementById("client-overview"):document.querySelector("#view-overview .kpi-grid, .kpi-grid");
  if(!anchor)return null;
  var section=document.createElement("section"),prefix=kind==="client"?"client":"admin",copy=kind==="client"?"Vos appels uniquement":"Tous les clients et numéros";
  section.id=id;section.className="pgi-call-time-summary";section.setAttribute("aria-label","Temps d’appels cumulés");
  section.innerHTML='<div class="pgi-call-time-head"><div><p>TEMPS D’APPELS CUMULÉ</p><h2>Activité téléphonique</h2></div><span>'+copy+'</span></div><div class="pgi-call-time-grid">'+Object.keys(labels()).map(function(key){return '<article class="pgi-call-time-card"><span>'+labels()[key]+'</span><strong id="'+prefix+'-call-time-'+key+'">Non disponible</strong><small id="'+prefix+'-call-count-'+key+'">: appel</small></article>';}).join("")+'</div>';
  anchor.insertAdjacentElement("afterend",section);
  return section;
}
function setCard(prefix,key,minutes,calls){
  var time=document.getElementById(prefix+"-call-time-"+key),count=document.getElementById(prefix+"-call-count-"+key);
  if(time)time.textContent=duration(minutes);
  if(count){var c=Math.max(0,Math.round(n(calls)));count.textContent=nf(c)+" appel"+(c>1?"s":"");}
}
function setError(kind,message){
  var rootEl=mount(kind);if(!rootEl)return;
  rootEl.dataset.state="error";
  var status=rootEl.querySelector(".pgi-call-time-head span");if(status)status.textContent=message||"Données momentanément indisponibles";
}
function clientAggregate(data){
  var out={minutes:0,calls:0};
  (data&&Array.isArray(data.financial_by_currency)?data.financial_by_currency:[]).forEach(function(row){
    out.minutes+=n(row.billable_seconds)/60;out.calls+=n(row.calls_total);
  });
  return out;
}
function adminAggregate(data){return {minutes:n(data&&data.billable_minutes),calls:n(data&&data.calls_total)};}
async function refreshClient(force){
  var app=document.getElementById("customer-app");
  if(!app||app.hidden||!root.PGICustomerApi||typeof root.PGICustomerApi.comparison!=="function")return;
  var now=Date.now();if(clientBusy||(!force&&now-clientLast<MIN_REFRESH_MS))return;
  clientBusy=true;clientLast=now;var box=mount("client");if(box)box.dataset.state="loading";
  try{
    var rs=ranges(),keys=["today","week","month","year"];
    var data=await Promise.all(keys.map(function(key){return root.PGICustomerApi.comparison(rs[key].from,rs[key].to);}));
    keys.forEach(function(key,i){var a=clientAggregate(data[i]);setCard("client",key,a.minutes,a.calls);});
    if(box)box.dataset.state="ready";
  }catch(_e){setError("client","Vos cumuls sont momentanément indisponibles");}
  finally{clientBusy=false;}
}
async function refreshAdmin(force){
  if(!root.PGIApi||typeof root.PGIApi.summary!=="function")return;
  var now=Date.now();if(adminBusy||(!force&&now-adminLast<MIN_REFRESH_MS))return;
  adminBusy=true;adminLast=now;var box=mount("admin");if(box)box.dataset.state="loading";
  try{
    var rs=ranges(),keys=["today","week","month","year"];
    var data=await Promise.all(keys.map(function(key){return root.PGIApi.summary(rs[key].from,rs[key].to);}));
    keys.forEach(function(key,i){var a=adminAggregate(data[i]);setCard("admin",key,a.minutes,a.calls);});
    if(box)box.dataset.state="ready";
  }catch(_e){setError("admin","Cumuls plateforme momentanément indisponibles");}
  finally{adminBusy=false;}
}
document.addEventListener("pgi:portal-loaded",function(){refreshClient(false);});
root.addEventListener("pgi:dashboard-loaded",function(){refreshAdmin(false);});
root.PGICallTimeSummary=Object.freeze({refreshClient:refreshClient,refreshAdmin:refreshAdmin});
})(window);

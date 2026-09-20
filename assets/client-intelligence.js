(function(){
"use strict";

var portalData=null,previousData=null,calls=[],nextCursor=null,requestSeq=0;
var I=window.PGIClientI18n||{locale:"fr-FR",t:function(x){return x;}};
function t(x){return I.t?I.t(x):x;}
function $(id){return document.getElementById(id);}
function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
function nf(v,d){return new Intl.NumberFormat(I.locale||"fr-FR",{maximumFractionDigits:d==null?0:d}).format(n(v));}
function money(v,c){try{return new Intl.NumberFormat(I.locale||"fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(n(v));}catch(_e){return nf(v,2)+" "+(c||"");}}
function dt(v){var d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(I.locale||"fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";}
function duration(s){s=Math.max(0,Math.round(n(s)));return Math.floor(s/60)+" min "+String(s%60).padStart(2,"0")+" s";}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function statusLabel(v){
  var map={connected:"Décroché",abandoned:"Abandonné",failed:"Échoué",busy:"Occupé",no_answer:"Sans réponse"};
  return t(map[String(v||"").toLowerCase()]||String(v||"—"));
}
function chip(v){
  var s=String(v||"").toLowerCase(),tone=s==="connected"?"ok":(s==="abandoned"||s==="busy"||s==="no_answer")?"warn":"bad";
  return '<span class="cp-chip '+tone+'">'+esc(statusLabel(v))+"</span>";
}
function aggregate(rows,currency){
  rows=rows||[];
  var selected=rows.filter(function(x){return !currency||x.currency===currency;});
  if(!selected.length)selected=rows;
  return selected.reduce(function(a,x){
    a.calls+=n(x.calls_total);a.connected+=n(x.calls_connected);a.abandoned+=n(x.calls_abandoned);
    a.failed+=n(x.calls_failed);a.billable+=n(x.billable_seconds);a.revenue+=n(x.generated_revenue_ttc);
    return a;
  },{calls:0,connected:0,abandoned:0,failed:0,billable:0,revenue:0});
}
function previousRange(range){
  var from=new Date(range.from),to=new Date(range.to),span=Math.max(86400000,to-from);
  return {from:new Date(from.getTime()-span).toISOString(),to:new Date(from.getTime()-1).toISOString()};
}
function percentDelta(current,previous){
  if(!previous)return null;
  return (current-previous)/Math.abs(previous)*100;
}
function deltaText(value,suffix){
  if(value==null||!Number.isFinite(value))return "—";
  var arrow=value>0?"↑":value<0?"↓":"=";
  return arrow+" "+nf(Math.abs(value),1)+(suffix||" %")+" "+t("vs période précédente");
}
function setDelta(id,value,suffix){
  var el=$(id);if(!el)return;
  el.textContent=deltaText(value,suffix);
  el.classList.toggle("up",value>0);el.classList.toggle("down",value<0);
}
function renderComparison(){
  if(!portalData)return;
  var currency=portalData.tenant&&portalData.tenant.default_currency||"EUR";
  var cur=aggregate(portalData.financial_by_currency,currency);
  var prev=aggregate(previousData&&previousData.financial_by_currency,currency);
  var curAsr=cur.calls?cur.connected/cur.calls*100:0,prevAsr=prev.calls?prev.connected/prev.calls*100:0;

  $("compare-calls").textContent=nf(cur.calls);
  $("compare-asr").textContent=nf(curAsr,1)+" %";
  $("compare-minutes").textContent=nf(cur.billable/60,1);
  $("compare-revenue").textContent=money(cur.revenue,currency);

  setDelta("compare-calls-delta",percentDelta(cur.calls,prev.calls));
  setDelta("compare-asr-delta",prev.calls?curAsr-prevAsr:null," pt");
  setDelta("compare-minutes-delta",percentDelta(cur.billable,prev.billable));
  setDelta("compare-revenue-delta",percentDelta(cur.revenue,prev.revenue));

  var label=$("comparison-period-label");
  if(label&&portalData.range){
    var p=previousRange(portalData.range);
    label.textContent=new Intl.DateTimeFormat(I.locale||"fr-FR",{day:"2-digit",month:"2-digit"}).format(new Date(p.from))+" → "+new Intl.DateTimeFormat(I.locale||"fr-FR",{day:"2-digit",month:"2-digit"}).format(new Date(p.to));
  }
}
function median(values){
  var a=values.filter(Number.isFinite).slice().sort(function(x,y){return x-y;});
  if(!a.length)return 0;var m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function insight(tone,title,message){
  return '<div class="cp-insight" data-tone="'+tone+'"><span class="cp-insight-dot" aria-hidden="true"></span><div><strong>'+esc(t(title))+'</strong><p>'+esc(t(message))+"</p></div></div>";
}
function renderInsights(){
  var el=$("client-insights");if(!el||!portalData)return;
  var rows=(portalData.series||[]).filter(function(x){return n(x.calls_total)>0;});
  var insights=[],currency=portalData.tenant&&portalData.tenant.default_currency||"EUR";
  if(rows.length>=5){
    var volumes=rows.map(function(x){return n(x.calls_total);}),base=median(volumes),mad=median(volumes.map(function(v){return Math.abs(v-base);}));
    var latest=rows[rows.length-1],lv=n(latest.calls_total),scale=Math.max(1,1.4826*mad);
    if(Math.abs(lv-base)/scale>2.5&&Math.abs(lv-base)/Math.max(1,base)>.25){
      insights.push(insight("warn","Volume inhabituel",lv>base?"Le volume du dernier jour est nettement supérieur à son niveau habituel.":"Le volume du dernier jour est nettement inférieur à son niveau habituel."));
    }
    var asrValues=rows.map(function(x){return n(x.calls_total)?n(x.calls_connected)/n(x.calls_total)*100:0;}),asrBase=median(asrValues);
    var latestAsr=lv?n(latest.calls_connected)/lv*100:0;
    if(lv>=5&&latestAsr<asrBase-10){
      insights.push(insight("warn","Décroché en baisse","Le taux de décroché du dernier jour est sensiblement sous son niveau habituel. Vérifiez la disponibilité et le routage."));
    }
    var abandonValues=rows.map(function(x){return n(x.calls_total)?n(x.calls_abandoned)/n(x.calls_total)*100:0;}),abandonBase=median(abandonValues);
    var latestAbandon=lv?n(latest.calls_abandoned)/lv*100:0;
    if(lv>=5&&latestAbandon>Math.max(15,abandonBase+10)){
      insights.push(insight("warn","Abandons élevés","La proportion d’appels abandonnés est anormalement élevée sur le dernier jour."));
    }
  }
  if(previousData){
    var cur=aggregate(portalData.financial_by_currency,currency),prev=aggregate(previousData.financial_by_currency,currency);
    var rev=percentDelta(cur.revenue,prev.revenue);
    if(rev!=null&&rev<=-20)insights.push(insight("warn","Montant généré en baisse","Le montant service TTC recule d’au moins 20 % par rapport à la période précédente."));
    else if(rev!=null&&rev>=20)insights.push(insight("ok","Progression du montant généré","Le montant service TTC progresse d’au moins 20 % par rapport à la période précédente."));
    var curDur=cur.connected?cur.billable/cur.connected:0,prevDur=prev.connected?prev.billable/prev.connected:0,dur=percentDelta(curDur,prevDur);
    if(dur!=null&&dur<=-25)insights.push(insight("warn","Durée moyenne en baisse","La durée moyenne des appels décrochés a diminué d’au moins 25 %."));
  }
  if(!insights.length)insights.push(insight("ok","Aucun signal critique","Les indicateurs disponibles ne montrent pas d’écart significatif nécessitant une action immédiate."));
  el.innerHTML=insights.slice(0,4).join("");
}
async function loadPrevious(){
  if(!portalData||!portalData.range)return;
  if(portalData.comparison_previous){
    previousData={financial_by_currency:portalData.comparison_previous,range:previousRange(portalData.range)};
    renderComparison();renderInsights();return;
  }
  var cfg=window.PGI_CONFIG||{};
  if(cfg.mode==="demo"||!cfg.apiBaseUrl)return;
  var p=previousRange(portalData.range);
  try{
    previousData=await window.PGICustomerApi.comparison(p.from,p.to);
    renderComparison();renderInsights();
  }catch(_e){
    previousData=null;renderComparison();renderInsights();
  }
}
function callFilters(){
  return {
    status:$("call-filter-status").value||"",
    numberId:$("call-filter-number").value||"",
    minDuration:$("call-filter-min-duration").value?Math.round(Number($("call-filter-min-duration").value)*60):"",
    minAmount:$("call-filter-min-amount").value||""
  };
}
function filtersActive(f){return Boolean(f.status||f.numberId||f.minDuration!==""||f.minAmount!=="");}
function filterDemo(rows,f){
  return (rows||[]).filter(function(x){
    if(f.status&&String(x.call_status)!==f.status)return false;
    if(f.numberId){
      var assigned=(portalData.numbers||[]).find(function(v){return String(v.id)===String(f.numberId);});
      var display=assigned&&(assigned.display_number||assigned.e164)||"";
      if(display&&String(x.display_number||x.e164||"")!==String(display))return false;
    }
    if(f.minDuration!==""&&n(x.billable_seconds||x.conversation_seconds)<n(f.minDuration))return false;
    if(f.minAmount!==""&&n(x.retail_service_amount_ttc)<n(f.minAmount))return false;
    return true;
  });
}
function renderCallRows(rows,append){
  var body=$("calls-body");if(!body)return;
  var html=rows.map(function(x){
    return "<tr><td>"+esc(dt(x.started_at))+"</td><td>"+esc(x.display_number||x.e164||"—")+"</td><td>"+chip(x.call_status)+"</td><td>"+esc(duration(x.billable_seconds||x.conversation_seconds))+"</td><td>"+esc(money(x.retail_service_amount_ttc,x.currency))+"</td></tr>";
  }).join("");
  if(append)body.insertAdjacentHTML("beforeend",html);
  else body.innerHTML=html||'<tr><td colspan="5" class="cp-empty-cell">'+esc(t("Aucun appel correspondant aux filtres."))+"</td></tr>";
}
function setCallMeta(){
  var meta=$("call-filter-summary"),more=$("call-load-more"),f=callFilters();
  if(meta)meta.textContent=nf(calls.length)+" "+t("appels affichés")+(filtersActive(f)?" · "+t("filtres actifs"):"");
  if(more)more.hidden=!nextCursor;
}
async function loadCalls(append){
  if(!portalData||!portalData.range)return;
  var seq=++requestSeq,f=callFilters(),cfg=window.PGI_CONFIG||{},more=$("call-load-more");
  if(more){more.disabled=true;more.textContent=t("Chargement…");}
  try{
    if(cfg.mode==="demo"||!cfg.apiBaseUrl){
      var demo=filterDemo(portalData.recent_calls||[],f);
      calls=demo;nextCursor=null;renderCallRows(calls,false);setCallMeta();return;
    }
    var result=await window.PGICustomerApi.calls(portalData.range.from,portalData.range.to,append?nextCursor:null,50,f);
    if(seq!==requestSeq)return;
    var page=result.data||[];
    calls=append?calls.concat(page):page;
    nextCursor=result.next_cursor||null;
    renderCallRows(page,append);
    setCallMeta();
  }catch(_e){
    if(seq===requestSeq){
      var meta=$("call-filter-summary");if(meta)meta.textContent=t("Impossible de charger les appels filtrés.");
    }
  }finally{
    if(more){more.disabled=false;more.textContent=t("Charger plus");}
  }
}
function populateNumbers(){
  var select=$("call-filter-number");if(!select||!portalData)return;
  var selected=select.value;
  select.innerHTML='<option value="">'+esc(t("Tous les numéros"))+"</option>"+(portalData.numbers||[]).map(function(x){
    var label=x.display_number||x.e164||"";
    return '<option value="'+esc(x.id)+'">'+esc(label)+"</option>";
  }).join("");
  select.value=selected;
}
function resetFilters(){
  ["call-filter-status","call-filter-number","call-filter-min-duration","call-filter-min-amount"].forEach(function(id){var el=$(id);if(el)el.value="";});
  loadCalls(false);
}
function bindFilters(){
  var timer=null;
  ["call-filter-status","call-filter-number"].forEach(function(id){var el=$(id);if(el)el.addEventListener("change",function(){loadCalls(false);});});
  ["call-filter-min-duration","call-filter-min-amount"].forEach(function(id){var el=$(id);if(el)el.addEventListener("input",function(){clearTimeout(timer);timer=setTimeout(function(){loadCalls(false);},280);});});
  var reset=$("call-filter-reset");if(reset)reset.addEventListener("click",resetFilters);
  var more=$("call-load-more");if(more)more.addEventListener("click",function(){if(nextCursor)loadCalls(true);});
}
function onPortalLoaded(event){
  portalData=event.detail&&event.detail.data||null;previousData=null;calls=[];nextCursor=null;
  if(!portalData)return;
  populateNumbers();
  renderInsights();
  loadPrevious();
  loadCalls(false);
}
function init(){
  bindFilters();
  document.addEventListener("pgi:portal-loaded",onPortalLoaded);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
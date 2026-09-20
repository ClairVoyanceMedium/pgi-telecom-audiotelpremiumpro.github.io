(function(){
"use strict";

var portalData=null,previousData=null,calls=[],nextCursor=null,requestSeq=0;
var I=window.PGIClientI18n||{locale:"fr-FR",t:function(x){return x;}};
function t(x){return I.t?I.t(x):x;}
function $(id){return document.getElementById(id);}
function ensureVoiceUi(){
  if(!document.getElementById("client-voice-styles")){
    var style=document.createElement("style");style.id="client-voice-styles";style.textContent=`
.cp-intelligence-mount{grid-column:1/-1}.cp-client-voice-panel{margin:0}.cp-client-voice-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.cp-client-voice-metric{min-width:0;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:11px;background:rgba(255,255,255,.018)}
.cp-client-voice-metric>span,.cp-client-voice-metric>small{display:block}.cp-client-voice-metric>span{color:#858e97;font-size:7.5px;font-weight:850;text-transform:uppercase;letter-spacing:.045em}.cp-client-voice-metric>strong{display:block;margin:7px 0 4px;font-size:18px;letter-spacing:-.03em}.cp-client-voice-metric>small{color:#737c85;font-size:7.5px;line-height:1.4}
.cp-client-voice-metric.good{border-color:rgba(104,198,154,.18)}.cp-client-voice-metric.warn{border-color:rgba(215,168,92,.25)}.cp-client-voice-metric.bad{border-color:rgba(217,110,104,.3)}.cp-voice-note{margin:9px 2px 0;color:#6f7881;font-size:7.5px;line-height:1.5}
.cp-diagnostic-btn{min-height:30px;padding:0 9px;border:1px solid var(--line);border-radius:8px;background:#171a1d;color:#d6dadd;font-size:8px;font-weight:800;cursor:pointer}.cp-diagnostic-btn:hover{background:#24292e;color:#fff}.cp-diagnostic-card{width:min(760px,calc(100vw - 28px))}
.cp-diagnostic-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cp-diagnostic-grid>div{min-width:0;padding:10px;border:1px solid var(--line);border-radius:10px;background:#101316}.cp-diagnostic-grid span,.cp-diagnostic-grid strong{display:block}.cp-diagnostic-grid span{color:#78818a;font-size:7.5px;font-weight:800;text-transform:uppercase}.cp-diagnostic-grid strong{margin-top:6px;font-size:10px;overflow-wrap:anywhere}
@media(max-width:820px){.cp-client-voice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-diagnostic-grid{grid-template-columns:1fr 1fr}}@media(max-width:680px){.cp-table td:nth-child(6):before{content:"Diagnostic"}.cp-diagnostic-btn{min-height:40px}.cp-diagnostic-grid{grid-template-columns:1fr}}@media(max-width:380px){.cp-client-voice-grid{grid-template-columns:1fr}}
`;document.head.appendChild(style);
  }
  var mount=$("client-voice-mount");
  if(mount&&!$("client-voice-quality")){
    mount.innerHTML='<article class="cp-panel cp-client-voice-panel"><div class="cp-panel-head"><div><p class="cp-kicker">'+t("QUALITÉ & CONNECTIVITÉ")+'</p><h2>'+t("Expérience de mes appels")+'</h2></div><span id="client-voice-samples">'+t("Données techniques")+'</span></div><div id="client-voice-quality" class="cp-client-voice-grid"></div><p class="cp-voice-note">'+t("Ces indicateurs sont des diagnostics techniques de vos appels. Ils ne constituent pas un engagement contractuel de niveau de service.")+'</p></article>';
  }
  var dmount=$("client-call-diagnostic-mount");
  if(dmount&&!$("client-call-diagnostic-dialog")){
    dmount.innerHTML='<dialog id="client-call-diagnostic-dialog" class="cp-export-dialog"><form method="dialog" class="cp-export-card cp-diagnostic-card"><div class="cp-export-head"><div><p class="cp-kicker">'+t("DIAGNOSTIC D’APPEL")+'</p><h2 id="client-call-diagnostic-title">'+t("Détail technique")+'</h2></div><button class="cp-close" value="cancel" aria-label="'+t("Fermer")+'">×</button></div><p class="cp-export-note">'+t("Les informations ci-dessous concernent uniquement cet appel et votre ligne Audiotel.")+'</p><div id="client-call-diagnostic-grid" class="cp-diagnostic-grid"></div></form></dialog>';
  }
}
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
  var serverDate=new Date(portalData.server_time||Date.now()).toISOString().slice(0,10);
  var completed=rows.filter(function(x){return String(x.bucket_date||"").slice(0,10)<serverDate;});
  if(completed.length>=5)rows=completed;
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
function voiceMetric(label,value,note,tone){
  return '<div class="cp-client-voice-metric '+(tone||"")+'"><span>'+esc(t(label))+'</span><strong>'+esc(value)+'</strong><small>'+esc(t(note||""))+'</small></div>';
}
function renderVoiceQuality(){
  var root=$("client-voice-quality");if(!root||!portalData)return;
  var q=portalData.voice_quality||{},calls=n(q.calls_total),connected=n(q.calls_connected),samples=n(q.quality_samples),pddSamples=n(q.pdd_samples);
  var connection=calls?connected/calls*100:null,affected=samples?n(q.network_affected_calls)/samples*100:null,highPdd=pddSamples?n(q.high_pdd_calls)/pddSamples*100:null,sip5=calls?n(q.sip_5xx_calls)/calls*100:null;
  root.innerHTML=[
    voiceMetric("Taux de connexion",connection==null?"—":nf(connection,1)+" %",calls?nf(calls)+" appels analysés":"Aucun appel",connection!=null&&connection<75?"bad":connection!=null&&connection<88?"warn":"good"),
    voiceMetric("Temps avant sonnerie",pddSamples?nf(n(q.avg_pdd_ms)/1000,2)+" s":"—",pddSamples?nf(highPdd,1)+" % au-dessus de 8 s":"Pas de mesure PDD",highPdd!=null&&highPdd>=15?"warn":"good"),
    voiceMetric("Réseau affecté",samples?nf(affected,1)+" %":"—",samples?nf(samples)+" échantillons RTP":"Pas de mesure RTP",affected!=null&&affected>=15?"bad":affected!=null&&affected>=5?"warn":"good"),
    voiceMetric("Qualité voix MOS",samples&&q.mos!=null?nf(q.mos,2):"—",samples?"Moyenne des échantillons":"Pas de mesure MOS",samples&&n(q.mos)<3.5?"bad":samples&&n(q.mos)<4?"warn":"good"),
    voiceMetric("Perte de paquets",samples&&q.packet_loss_percent!=null?nf(q.packet_loss_percent,2)+" %":"—","Diagnostic réseau",samples&&n(q.packet_loss_percent)>=5?"bad":"good"),
    voiceMetric("Jitter",samples&&q.jitter_ms!=null?nf(q.jitter_ms,1)+" ms":"—","Variation du délai",samples&&n(q.jitter_ms)>5?"warn":"good"),
    voiceMetric("Latence",samples&&q.latency_ms!=null?nf(q.latency_ms,0)+" ms":"—","Délai média",samples&&n(q.latency_ms)>150?"bad":"good"),
    voiceMetric("Erreurs SIP 5xx",calls?nf(sip5,1)+" %":"—",nf(q.sip_5xx_calls||0)+" appels",sip5!=null&&sip5>=10?"bad":"good")
  ].join("");
  var badge=$("client-voice-samples");if(badge)badge.textContent=samples?nf(samples)+" "+t("échantillons techniques"):t("Données techniques");
}
function diagnosticValue(label,value){return '<div><span>'+esc(t(label))+'</span><strong>'+esc(value==null||value===""?"—":value)+'</strong></div>';}
function hangupParty(v){return v==="caller"?t("Appelant"):v==="callee"?t("Destinataire"):v==="network"?t("Réseau"):t("Indéterminé");}
function showCallDiagnostic(id){
  var row=calls.find(function(x){return String(x.call_id)===String(id);})||(portalData&&portalData.recent_calls||[]).find(function(x){return String(x.call_id)===String(id);});
  if(!row)return;
  var title=$("client-call-diagnostic-title"),grid=$("client-call-diagnostic-grid"),dialog=$("client-call-diagnostic-dialog");
  if(title)title.textContent=t("Appel")+" #"+row.call_id+" · "+dt(row.started_at);
  var pdd=row.post_dial_delay_ms==null?"—":nf(n(row.post_dial_delay_ms)/1000,2)+" s";
  if(grid)grid.innerHTML=[
    diagnosticValue("Date",dt(row.started_at)),
    diagnosticValue("Numéro",row.display_number||row.e164||"—"),
    diagnosticValue("État",statusLabel(row.call_status)),
    diagnosticValue("Durée",duration(row.billable_seconds||row.conversation_seconds)),
    diagnosticValue("Montant TTC",money(row.retail_service_amount_ttc,row.currency)),
    diagnosticValue("Temps avant sonnerie",pdd),
    diagnosticValue("Code SIP final",row.sip_final_code||"—"),
    diagnosticValue("Cause de fin",row.hangup_cause||"—"),
    diagnosticValue("Qui a raccroché",hangupParty(row.hangup_party)),
    diagnosticValue("Codec",row.codec||"—"),
    diagnosticValue("Réseau d’origine",row.origin_carrier||"—"),
    diagnosticValue("Opérateur hôte",row.host_carrier||"—"),
    diagnosticValue("Perte de paquets",row.packet_loss_percent==null?"—":nf(row.packet_loss_percent,2)+" %"),
    diagnosticValue("Jitter",row.jitter_ms==null?"—":nf(row.jitter_ms,1)+" ms"),
    diagnosticValue("Latence",row.latency_ms==null?"—":nf(row.latency_ms,0)+" ms"),
    diagnosticValue("RTT",row.rtt_ms==null?"—":nf(row.rtt_ms,0)+" ms"),
    diagnosticValue("MOS",row.mos==null?"—":nf(row.mos,2)),
    diagnosticValue("Paquets perdus",row.packets_lost==null?"—":nf(row.packets_lost,0))
  ].join("");
  if(dialog&&typeof dialog.showModal==="function")dialog.showModal();
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
    return "<tr><td>"+esc(dt(x.started_at))+"</td><td>"+esc(x.display_number||x.e164||"—")+"</td><td>"+chip(x.call_status)+"</td><td>"+esc(duration(x.billable_seconds||x.conversation_seconds))+"</td><td>"+esc(money(x.retail_service_amount_ttc,x.currency))+"</td><td><button class=\"cp-diagnostic-btn\" type=\"button\" data-call-diagnostic=\""+esc(x.call_id)+"\">"+esc(t("Voir"))+"</button></td></tr>";
  }).join("");
  if(append)body.insertAdjacentHTML("beforeend",html);
  else body.innerHTML=html||'<tr><td colspan="6" class="cp-empty-cell">'+esc(t("Aucun appel correspondant aux filtres."))+"</td></tr>";
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
  var body=$("calls-body");if(body)body.addEventListener("click",function(event){
    var button=event.target.closest("[data-call-diagnostic]");if(button)showCallDiagnostic(button.dataset.callDiagnostic);
  });
}
function onPortalLoaded(event){
  portalData=event.detail&&event.detail.data||null;previousData=null;calls=[];nextCursor=null;
  if(!portalData)return;
  populateNumbers();
  renderVoiceQuality();
  renderInsights();
  loadPrevious();
  loadCalls(false);
}
function init(){
  ensureVoiceUi();
  bindFilters();
  document.addEventListener("pgi:portal-loaded",onPortalLoaded);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
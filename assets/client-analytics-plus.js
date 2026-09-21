const $=id=>document.getElementById(id);
const COLORS=["#d7a76a","#bd8f70","#68c59a","#e0ad62","#dd766d","#835f4c","#9b806c"];
const WEEKDAYS={1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam",7:"Dim"};
let current=null;

function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function rowsFor(data,dimension){
  const rows=(data?.activity_breakdown||[]).filter(x=>x.dimension===dimension).map(x=>({...x,calls:n(x.calls),connected:n(x.connected),billable_seconds:n(x.billable_seconds)}));
  return rows.length?rows:fallback(data,dimension);
}
function fallback(data,dimension){
  const calls=data?.recent_calls||[],map=new Map();
  for(const x of calls){
    const d=new Date(x.started_at),seconds=n(x.conversation_seconds||x.billable_seconds),number=x.display_number||x.e164||"Numéro",carrier=x.origin_carrier||"Autre";
    let key,label;
    if(dimension==="hour"){key=String(d.getHours()).padStart(2,"0");label=key+"h";}
    else if(dimension==="weekday"){const day=d.getDay()||7;key=String(day);label=WEEKDAYS[day];}
    else if(dimension==="number"){key=number;label=number;}
    else if(dimension==="duration"){
      if(seconds<60){key="1";label="< 1 min"}else if(seconds<180){key="2";label="1–3 min"}else if(seconds<300){key="3";label="3–5 min"}else{key="4";label="5 min et +"}
    }else if(dimension==="carrier"){key=carrier;label=carrier;}else continue;
    const row=map.get(key)||{dimension,key,label,calls:0,connected:0,billable_seconds:0};
    row.calls++;if(x.call_status==="connected")row.connected++;row.billable_seconds+=n(x.billable_seconds);map.set(key,row);
  }
  return [...map.values()];
}
function sortDimension(rows,dimension){
  if(["hour","weekday","duration"].includes(dimension))return rows.slice().sort((a,b)=>Number(a.key)-Number(b.key));
  return rows.slice().sort((a,b)=>b.calls-a.calls||String(a.label).localeCompare(String(b.label)));
}
function renderColumns(id,rows,dimension){
  const el=$(id);if(!el)return;
  rows=sortDimension(rows,dimension);
  const max=Math.max(1,...rows.map(x=>x.calls));
  if(!rows.length){el.className="cp-analytics-bars";el.innerHTML='<p class="cp-empty">Aucune donnée sur cette période.</p>';return}
  el.className="cp-mini-columns";
  el.innerHTML=rows.map((x,i)=>{
    const h=Math.max(3,x.calls/max*100),show=dimension!=="hour"||i%3===0||i===rows.length-1;
    return '<div class="cp-mini-col" title="'+esc(x.label+" · "+x.calls+" appel(s)")+'"><i><b style="height:'+h.toFixed(1)+'%"></b></i><small>'+esc(show?x.label:"")+'</small></div>';
  }).join("");
}
function renderBars(id,rows,limit=10){
  const el=$(id);if(!el)return;
  rows=rows.slice().sort((a,b)=>b.calls-a.calls).slice(0,limit);
  const max=Math.max(1,...rows.map(x=>x.calls));
  el.className="cp-analytics-bars cp-analytics-bars-wide";
  el.innerHTML=rows.length?rows.map(x=>'<div class="cp-analytics-bar"><span title="'+esc(x.label)+'">'+esc(x.label)+'</span><i><b style="width:'+Math.max(2,x.calls/max*100).toFixed(1)+'%"></b></i><strong>'+x.calls+'</strong></div>').join(""):'<p class="cp-empty">Aucune donnée sur cette période.</p>';
}
function compactPieRows(rows,maxParts){
  rows=rows.slice().filter(x=>x.calls>0).sort((a,b)=>b.calls-a.calls);
  if(rows.length<=maxParts)return rows;
  const kept=rows.slice(0,maxParts-1),rest=rows.slice(maxParts-1).reduce((a,x)=>a+x.calls,0);
  kept.push({key:"other",label:"Autres",calls:rest});return kept;
}
function renderPie(pieId,legendId,rows,maxParts=6){
  const pie=$(pieId),legend=$(legendId);if(!pie||!legend)return;
  rows=compactPieRows(rows,maxParts);const total=rows.reduce((a,x)=>a+x.calls,0);
  if(!total){pie.className="cp-pie cp-pie-empty";pie.style.background="";pie.textContent="0 appel";legend.innerHTML='<p class="cp-empty">Aucune donnée sur cette période.</p>';return}
  let at=0;const stops=[];
  rows.forEach((x,i)=>{const next=at+x.calls/total*100;stops.push(COLORS[i%COLORS.length]+" "+at.toFixed(2)+"% "+next.toFixed(2)+"%");at=next});
  pie.className="cp-pie";pie.textContent="";pie.style.background="conic-gradient("+stops.join(",")+")";
  pie.setAttribute("aria-label",rows.map(x=>x.label+" "+Math.round(x.calls/total*100)+"%").join(", "));
  legend.innerHTML=rows.map((x,i)=>'<div><i class="cp-legend-swatch" style="background:'+COLORS[i%COLORS.length]+'"></i><span>'+esc(x.label)+'</span><strong>'+Math.round(x.calls/total*100)+' %</strong></div>').join("");
}
function render(data){
  ensurePanels();current=data;
  const hours=rowsFor(data,"hour"),weekdays=rowsFor(data,"weekday"),numbers=rowsFor(data,"number"),durations=rowsFor(data,"duration"),carriers=rowsFor(data,"carrier");
  renderColumns("client-hour-bars",hours,"hour");renderColumns("client-weekday-bars",weekdays,"weekday");
  renderPie("client-number-pie","client-number-legend",numbers,6);renderPie("client-duration-pie","client-duration-legend",durations,5);
  renderBars("client-carrier-bars",carriers,10);
  const hp=hours.slice().sort((a,b)=>b.calls-a.calls)[0],wp=weekdays.slice().sort((a,b)=>b.calls-a.calls)[0];
  if($("client-hour-peak"))$("client-hour-peak").textContent=hp?"Pic "+hp.label:"—";
  if($("client-weekday-peak"))$("client-weekday-peak").textContent=wp?"Pic "+wp.label:"—";
  if($("client-carrier-count"))$("client-carrier-count").textContent=carriers.length+" opérateur"+(carriers.length>1?"s":"");
}
function csvCell(v){const s=String(v==null?"":v);return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function download(name,type,text){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function analyticsCsv(data){
  const out=[["Dimension","Clé","Libellé","Appels","Décrochés","Secondes facturables"]];
  ["hour","weekday","number","duration","carrier"].forEach(dim=>sortDimension(rowsFor(data,dim),dim).forEach(x=>out.push([dim,x.key,x.label,x.calls,x.connected,x.billable_seconds])));
  return "\ufeff"+out.map(r=>r.map(csvCell).join(";")).join("\r\n");
}
function safeSnapshot(data){
  return {
    exported_at:new Date().toISOString(),
    range:data?.range||null,
    metric_resets:data?.metric_resets||null,
    tenant:data?.tenant?{display_name:data.tenant.display_name,country_code:data.tenant.country_code,default_currency:data.tenant.default_currency}:null,
    financial_by_currency:data?.financial_by_currency||[],
    series:data?.series||[],
    activity_breakdown:["hour","weekday","number","duration","carrier"].flatMap(dim=>rowsFor(data,dim)),
    numbers:data?.numbers||[],
    settlements:data?.settlements||[],
    recent_calls:data?.recent_calls||[],
    voice_quality:data?.voice_quality||null
  };
}
function closeExport(){const d=$("client-export-dialog");if(d?.open)d.close()}
function ensurePanels(){
  const mount=$("client-analytics-plus-mount");if(!mount||mount.dataset.ready)return;mount.dataset.ready="1";
  mount.innerHTML='<article class="cp-panel cp-chart-card"><div class="cp-panel-head"><div><p class="cp-kicker">HEURES</p><h2>Activité par heure</h2></div><span id="client-hour-peak">—</span></div><div id="client-hour-bars" class="cp-analytics-bars" aria-label="Répartition des appels par heure"></div></article>'+
  '<article class="cp-panel cp-chart-card"><div class="cp-panel-head"><div><p class="cp-kicker">JOURS</p><h2>Activité par jour</h2></div><span id="client-weekday-peak">—</span></div><div id="client-weekday-bars" class="cp-analytics-bars" aria-label="Répartition des appels par jour"></div></article>'+
  '<article class="cp-panel cp-chart-card"><div class="cp-panel-head"><div><p class="cp-kicker">NUMÉROS</p><h2>Répartition du trafic</h2></div><span>Sur la période</span></div><div class="cp-pie-wrap"><div id="client-number-pie" class="cp-pie" role="img" aria-label="Camembert des appels par numéro"></div><div id="client-number-legend" class="cp-legend"></div></div></article>'+
  '<article class="cp-panel cp-chart-card"><div class="cp-panel-head"><div><p class="cp-kicker">DURÉES</p><h2>Profil des appels</h2></div><span>Sur la période</span></div><div class="cp-pie-wrap"><div id="client-duration-pie" class="cp-pie" role="img" aria-label="Camembert des appels par durée"></div><div id="client-duration-legend" class="cp-legend"></div></div></article>'+
  '<article class="cp-panel cp-chart-card cp-chart-wide"><div class="cp-panel-head"><div><p class="cp-kicker">ORIGINE DU TRAFIC</p><h2>Opérateurs d’origine</h2></div><span id="client-carrier-count">0 opérateur</span></div><div id="client-carrier-bars" class="cp-analytics-bars cp-analytics-bars-wide" aria-label="Répartition des appels par opérateur d’origine"></div></article>';
}
function bind(){
  ensurePanels();
  $("client-export-analytics")?.addEventListener("click",()=>{if(!current)return;closeExport();download("audiotel-analyses-"+new Date().toISOString().slice(0,10)+".csv","text/csv;charset=utf-8",analyticsCsv(current))});
  $("client-export-snapshot")?.addEventListener("click",()=>{if(!current)return;closeExport();download("audiotel-instantane-"+new Date().toISOString().slice(0,10)+".json","application/json;charset=utf-8",JSON.stringify(safeSnapshot(current),null,2))});
}
document.addEventListener("pgi:portal-loaded",e=>render(e.detail?.data||{}));
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
if(window.PGIClientPortalData)render(window.PGIClientPortalData);

void import("./client-account-proof.js").catch(()=>{});

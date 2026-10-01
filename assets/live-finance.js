(()=>{"use strict";
let d,scheduleData,at=Date.now(),es,retry,busy=false,scheduleBusy=false;
const $=x=>document.getElementById(x),n=x=>Number.isFinite(+x)?+x:0,m=(x,c)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n(x))}catch{return n(x).toFixed(2)+" "+(c||"")}},e=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function tzName(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Paris"}catch(_e){return "Europe/Paris"}}
function zonedParts(value,tz){
  var d=value instanceof Date?value:new Date(value);
  try{
    var p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d),o={};
    p.forEach(function(x){if(x.type!=="literal")o[x.type]=x.value});
    return {date:o.year+"-"+o.month+"-"+o.day,time:o.hour+":"+o.minute};
  }catch(_e){
    var z=new Date(d);return {date:z.getFullYear()+"-"+String(z.getMonth()+1).padStart(2,"0")+"-"+String(z.getDate()).padStart(2,"0"),time:String(z.getHours()).padStart(2,"0")+":"+String(z.getMinutes()).padStart(2,"0")};
  }
}
function zonedLocalIso(date,time,tz){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||"")),h=/^(\d{2}):(\d{2})$/.exec(String(time||""));
  if(!m||!h)throw new Error("INVALID_SCHEDULE_DATE");
  var wanted=Date.UTC(+m[1],+m[2]-1,+m[3],+h[1],+h[2],0),guess=wanted;
  for(var i=0;i<4;i++){
    var p=zonedParts(new Date(guess),tz),pm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date),ph=/^(\d{2}):(\d{2})$/.exec(p.time);
    var seen=Date.UTC(+pm[1],+pm[2]-1,+pm[3],+ph[1],+ph[2],0),delta=wanted-seen;
    guess+=delta;
    if(Math.abs(delta)<60000)break;
  }
  return new Date(guess).toISOString();
}
function scheduleUnitLabel(unit,value){
  var n=Number(value)||1;
  if(unit==="week")return n===1?"semaine":"semaines";
  if(unit==="month")return n===1?"mois":"mois";
  return n===1?"jour":"jours";
}

const stamp=v=>{if(!v)return "—";try{return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v))}catch{return String(v)}};
function ui(){
  if($("live-jackpot-card"))return;
  let b=document.querySelector(".main .topbar");if(!b)return;
  b.insertAdjacentHTML("afterend",
    '<div id="live-jackpot-card" class="live-jackpot live-jackpot-featured" data-active="false">'+
      '<div class="lj-head"><div><span class="lj-label">BUSINESS LIVE</span><strong id="live-jackpot">0,00 €</strong><span id="live-jackpot-calls">Cumul conservé · aucun appel en cours</span></div><div class="lj-speed"><span>VITESSE ACTUELLE</span><b id="live-jackpot-rate">0,00 € / seconde</b></div></div>'+
      '<div class="lj-period"><span>APPELS EN COURS</span><b id="live-jackpot-period">0,00 €</b></div>'+
      '<div class="lj-ranking"><div class="lj-ranking-title"><span>TOP CLIENTS EN DIRECT</span><small>Activité en cours</small></div><div id="live-jackpot-ranking"><small>Aucun client en appel.</small></div></div>'+
      '<div class="lj-actions"><button id="live-jackpot-reset" class="secondary-btn" type="button" hidden>Remettre Business Live à zéro</button><button id="live-jackpot-schedule-toggle" class="secondary-btn" type="button" hidden>Automatiser la remise à zéro</button><small id="live-jackpot-since">Remise à zéro manuelle ou programmée</small></div>'+
      '<div id="live-jackpot-schedule" class="lj-schedule" hidden>'+
        '<div class="lj-schedule-head"><div><span>AUTOMATISATION</span><strong>Remise à zéro programmée</strong></div><label><input id="live-jackpot-schedule-enabled" type="checkbox"> Activer</label></div>'+
        '<div class="lj-schedule-grid">'+
          '<label>Tous les <span><input id="live-jackpot-schedule-value" type="number" min="1" max="3650" step="1" value="1"><select id="live-jackpot-schedule-unit"><option value="day">jour(s)</option><option value="week">semaine(s)</option><option value="month">mois</option></select></span></label>'+
          '<label>À partir du <span><input id="live-jackpot-schedule-date" type="date"><input id="live-jackpot-schedule-time" type="time" step="60"></span></label>'+
          '<label>Fuseau horaire <input id="live-jackpot-schedule-timezone" type="text" autocomplete="off" spellcheck="false"></label>'+
        '</div>'+
        '<p class="lj-schedule-help">Fréquence libre : tous les 120 jours, tous les 2 semaines, tous les 3 mois… Pour une remise à zéro chaque 12 du mois, choisissez une date de départ au 12 puis « tous les 1 mois ».</p>'+
        '<div class="lj-schedule-foot"><button id="live-jackpot-schedule-save" class="secondary-btn" type="button">Enregistrer l’automatisation</button><small id="live-jackpot-schedule-status">Automatisation désactivée.</small></div>'+
      '</div>'+
    '</div>');
  $("live-jackpot-reset").onclick=reset;
  $("live-jackpot-schedule-toggle").onclick=()=>{let p=$("live-jackpot-schedule");p.hidden=!p.hidden};
  $("live-jackpot-schedule-save").onclick=saveSchedule;
  if(!$("live-finance-css")){let l=document.createElement("link");l.id="live-finance-css";l.rel="stylesheet";l.href="assets/live-finance.css";document.head.appendChild(l)}
}
function v(){let r=d?.by_currency||[],x=r[0]||{},s=Math.max(0,Math.min(30,(Date.now()-at)/1e3)),q=n(x.upstream_rate_ht_per_second);return{mix:r.length>1,cur:x.currency||"EUR",calls:n(d?.active_calls),total:n(x.jackpot_upstream_payout_ht)+s*q,live:n(x.live_upstream_payout_ht)+s*q,rate:q}}
function rank(){let z=$("live-jackpot-ranking"),r=(d?.by_client||[]).slice(0,8);z.innerHTML=r.length?r.map((x,i)=>'<div class="lj-rank-row"><b>#'+(i+1)+'</b><span><strong>'+e(x.display_name||x.tenant_public_id||"Client")+'</strong><small>'+n(x.active_calls)+' appel'+(n(x.active_calls)>1?"s":"")+' · +'+m(x.upstream_rate_ht_per_second,x.currency)+'/s</small></span><span><strong>'+m(x.generated_upstream_payout_ht,x.currency)+'</strong><small>Marge PGI '+m(x.pgi_margin_ht,x.currency)+'</small></span></div>').join(""):"<small>Aucun client en appel.</small>"}
function paint(){
  ui();let x=v(),b=$("live-jackpot-reset"),t=$("live-jackpot-schedule-toggle");
  $("live-jackpot-card").dataset.active=x.calls?"true":"false";
  b.hidden=d?.can_reset!==true;t.hidden=d?.can_reset!==true;
  $("live-jackpot").textContent=x.mix?"Multi-devises":m(x.total,x.cur);
  $("live-jackpot-calls").textContent=x.calls?x.calls+" appel"+(x.calls>1?"s":"")+" actif"+(x.calls>1?"s":"")+" · le cumul continue":"Cumul conservé · aucun appel en cours";
  $("live-jackpot-rate").textContent=x.calls&&!x.mix?"+"+m(x.rate,x.cur)+" / seconde":"0,00 € / seconde";
  $("live-jackpot-period").textContent=x.mix?"—":m(x.live,x.cur);
  $("live-jackpot-since").textContent="Depuis le "+(d?.reset_at?new Date(d.reset_at).toLocaleString("fr-FR"):"—")+" · remise à zéro manuelle ou programmée";
  rank();
}
function scheduleText(x){
  if(!x||x.enabled!==true)return "Automatisation désactivée.";
  return "Tous les "+x.interval_value+" "+scheduleUnitLabel(x.interval_unit,x.interval_value)+(x.next_run_at?" · prochaine : "+stamp(x.next_run_at):"");
}
function fillSchedule(x){
  ui();scheduleData=x||null;
  let tz=String(x?.timezone||tzName()),anchor=x?.anchor_at?zonedParts(x.anchor_at,tz):zonedParts(new Date(Date.now()+3600000),tz);
  $("live-jackpot-schedule-enabled").checked=x?.enabled===true;
  $("live-jackpot-schedule-value").value=String(x?.interval_value||1);
  $("live-jackpot-schedule-unit").value=x?.interval_unit||"day";
  $("live-jackpot-schedule-date").value=anchor.date;
  $("live-jackpot-schedule-time").value=anchor.time;
  $("live-jackpot-schedule-timezone").value=tz;
  $("live-jackpot-schedule-status").textContent=scheduleText(x);
}
async function loadSchedule(){
  if(!window.PGIApi?.liveFinanceSchedule)return;
  try{let x=await PGIApi.liveFinanceSchedule();fillSchedule(x);$("live-jackpot-schedule-toggle").hidden=x?.can_manage!==true}
  catch{$("live-jackpot-schedule-status").textContent="Automatisation momentanément indisponible."}
}
async function saveSchedule(){
  if(scheduleBusy||!window.PGIApi?.saveLiveFinanceSchedule)return;
  let status=$("live-jackpot-schedule-status"),button=$("live-jackpot-schedule-save");
  try{
    scheduleBusy=true;button.disabled=true;status.textContent="Enregistrement…";
    let tz=$("live-jackpot-schedule-timezone").value.trim()||tzName();
    let payload={enabled:$("live-jackpot-schedule-enabled").checked,interval_value:Number($("live-jackpot-schedule-value").value),interval_unit:$("live-jackpot-schedule-unit").value,timezone:tz,anchor_at:zonedLocalIso($("live-jackpot-schedule-date").value,$("live-jackpot-schedule-time").value,tz)};
    let saved=await PGIApi.saveLiveFinanceSchedule(payload);fillSchedule(saved);status.textContent=scheduleText(saved);
  }catch{status.textContent="L’automatisation n’a pas pu être enregistrée. Vérifiez la date, l’heure, l’intervalle et le fuseau horaire."}
  finally{scheduleBusy=false;button.disabled=false}
}
async function refresh(){ui();if(!window.PGIApi?.liveFinance)return;try{d=await PGIApi.liveFinance();at=Date.parse(d?.as_of||"")||Date.now();paint()}catch{}}
async function reset(){if(busy||d?.can_reset!==true||!window.PGIApi?.resetLiveFinance)return;if(!confirm("Remettre uniquement Business Live à 0,00 € ? Les appels, CDR, bilans jour/semaine/mois/année, règlements et statistiques officielles resteront inchangés."))return;busy=true;let b=$("live-jackpot-reset");b.disabled=true;try{await PGIApi.resetLiveFinance(PGIApi.newIdempotencyKey());await refresh()}finally{busy=false;b.disabled=false}}
function events(){if(es||!window.PGIApi?.events)return;try{es=PGIApi.events();["live_call.started","live_call.ended","call.ingested","platform.jackpot.reset"].forEach(k=>es.addEventListener(k,refresh));es.onerror=()=>{if(es.readyState===EventSource.CLOSED){try{es.close()}catch{}es=null;clearTimeout(retry);retry=setTimeout(events,5e3)}}}catch{retry=setTimeout(events,1e4)}}
function init(){ui();refresh();loadSchedule();events();setInterval(paint,250);setInterval(refresh,1e4)}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",init,{once:true}):init();
})();
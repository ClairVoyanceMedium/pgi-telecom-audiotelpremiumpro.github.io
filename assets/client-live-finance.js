(function(){"use strict";
var s={data:null,schedule:null,at:0,tick:null,poll:null,es:null,retry:null,busy:false,scheduleBusy:false};
function $(id){return document.getElementById(id)}
function n(v){v=Number(v);return Number.isFinite(v)?v:0}
function money(v,c){try{return new Intl.NumberFormat(navigator.language||"fr-FR",{style:"currency",currency:c||"EUR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v))}catch(_e){return n(v).toFixed(2)+" "+(c||"")}}
function stamp(v){if(!v)return "—";try{return new Intl.DateTimeFormat(navigator.language||"fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v))}catch(_e){return String(v)}}

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

function ui(){
  if($("client-live-money"))return;
  var box=document.querySelector("#client-main .cp-intro");if(!box)return;
  box.insertAdjacentHTML("afterend",
    '<section id="client-live-money" class="cp-live-money cp-live-featured" data-active="false" aria-live="polite">'+
      '<div class="cp-jackpot-main"><span>BUSINESS LIVE</span><strong id="client-live-amount">0,00 €</strong><small id="client-jackpot-rate">Votre compteur démarre à la première seconde facturable</small><small id="client-live-calls">Aucun appel en cours</small></div>'+
      '<div class="cp-jackpot-live"><span>ESTIMATION EN COURS</span><strong id="client-period-payout-estimate">0,00 €</strong><small id="client-jackpot-since">Depuis votre dernière remise à zéro</small></div>'+
      '<div class="cp-jackpot-actions"><button id="client-jackpot-reset" class="cp-primary" type="button" hidden>Remettre à 0,00 €</button><button id="client-live-recalc" class="cp-ghost" type="button">Actualiser</button><button id="client-jackpot-schedule-toggle" class="cp-ghost" type="button" hidden>Automatiser la remise à zéro</button><small id="client-jackpot-state" role="status">Cumul conservé jusqu’à une remise à zéro manuelle ou programmée. Les bilans officiels restent indépendants et les reversements validés font foi.</small></div>'+
      '<div id="client-jackpot-schedule" class="cp-jackpot-schedule" hidden>'+
        '<div class="cp-jackpot-schedule-head"><div><span>AUTOMATISATION</span><strong>Remise à zéro programmée</strong></div><label class="cp-switch"><input id="client-jackpot-schedule-enabled" type="checkbox"><span>Activer</span></label></div>'+
        '<div class="cp-jackpot-schedule-grid">'+
          '<label>Tous les <span class="cp-inline-fields"><input id="client-jackpot-schedule-value" type="number" min="1" max="3650" step="1" value="1"><select id="client-jackpot-schedule-unit"><option value="day">jour(s)</option><option value="week">semaine(s)</option><option value="month">mois</option></select></span></label>'+
          '<label>À partir du <span class="cp-inline-fields"><input id="client-jackpot-schedule-date" type="date"><input id="client-jackpot-schedule-time" type="time" step="60"></span></label>'+
          '<label>Fuseau horaire <input id="client-jackpot-schedule-timezone" type="text" autocomplete="off" spellcheck="false"></label>'+
        '</div>'+
        '<p class="cp-jackpot-schedule-help">Exemples : tous les 120 jours ; tous les 2 semaines ; tous les 1 mois à partir d’un 12 pour remettre à zéro chaque 12 du mois. Pour un 29, 30 ou 31, le dernier jour valide du mois est utilisé lorsque nécessaire.</p>'+
        '<div class="cp-jackpot-schedule-foot"><button id="client-jackpot-schedule-save" class="cp-primary" type="button">Enregistrer l’automatisation</button><small id="client-jackpot-schedule-status" role="status">Automatisation désactivée.</small></div>'+
      '</div>'+
    '</section>');
  $("client-live-recalc").addEventListener("click",refresh);
  $("client-jackpot-reset").addEventListener("click",reset);
  $("client-jackpot-schedule-toggle").addEventListener("click",function(){var p=$("client-jackpot-schedule");p.hidden=!p.hidden});
  $("client-jackpot-schedule-save").addEventListener("click",saveSchedule);
  if(!$("client-live-finance-css")){var l=document.createElement("link");l.id="client-live-finance-css";l.rel="stylesheet";l.href="assets/client-live-finance.css";document.head.appendChild(l)}
}
function values(){var d=s.data||{},cur=d.default_currency||"EUR",rows=d.by_currency||[],row=rows.find(function(x){return x.currency===cur})||rows[0]||{},elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000)),rate=n(row.client_rate_ht_per_second);return{cur:row.currency||cur,calls:n(row.active_calls),total:n(row.jackpot_client_net_ht)+elapsed*rate,live:n(row.live_client_net_ht)+elapsed*rate,rate:rate,resetAt:d.reset_at}}
function paint(){
  ui();var v=values(),card=$("client-live-money"),resetButton=$("client-jackpot-reset"),toggle=$("client-jackpot-schedule-toggle");
  if(card){card.dataset.active=v.calls>0?"true":"false";card.hidden=false}
  if(resetButton)resetButton.hidden=s.data?.can_reset!==true;
  if(toggle)toggle.hidden=s.data?.can_reset!==true;
  if($("client-live-amount"))$("client-live-amount").textContent=money(v.total,v.cur);
  if($("client-period-payout-estimate"))$("client-period-payout-estimate").textContent=money(v.live,v.cur);
  if($("client-live-calls"))$("client-live-calls").textContent=v.calls?v.calls+" appel"+(v.calls>1?"s":"")+" en cours":"Aucun appel en cours";
  if($("client-jackpot-rate"))$("client-jackpot-rate").textContent=v.calls?"+"+money(v.rate,v.cur)+" / seconde":"En attente du prochain appel";
  if($("client-jackpot-since"))$("client-jackpot-since").textContent="Depuis le "+stamp(v.resetAt)+" · estimation en direct, CDR final faisant foi";
}
function scheduleText(x){
  if(!x||x.enabled!==true)return "Automatisation désactivée.";
  var unit=scheduleUnitLabel(x.interval_unit,x.interval_value),next=x.next_run_at?" Prochaine remise à zéro : "+stamp(x.next_run_at)+".":"";
  return "Tous les "+x.interval_value+" "+unit+"."+next;
}
function fillSchedule(x){
  ui();s.schedule=x||null;
  var tz=String(x?.timezone||tzName()),anchor=x?.anchor_at?zonedParts(x.anchor_at,tz):zonedParts(new Date(Date.now()+3600000),tz);
  $("client-jackpot-schedule-enabled").checked=x?.enabled===true;
  $("client-jackpot-schedule-value").value=String(x?.interval_value||1);
  $("client-jackpot-schedule-unit").value=x?.interval_unit||"day";
  $("client-jackpot-schedule-date").value=anchor.date;
  $("client-jackpot-schedule-time").value=anchor.time;
  $("client-jackpot-schedule-timezone").value=tz;
  $("client-jackpot-schedule-status").textContent=scheduleText(x);
}
async function loadSchedule(){
  var api=window.PGICustomerApi,cfg=window.PGI_CONFIG||{};
  if(cfg.mode==="demo"){fillSchedule({enabled:false,interval_unit:"day",interval_value:1,timezone:tzName(),anchor_at:new Date(Date.now()+3600000).toISOString(),can_manage:true});return}
  if(!api||typeof api.jackpotSchedule!=="function")return;
  try{var x=await api.jackpotSchedule();fillSchedule(x);if($("client-jackpot-schedule-toggle"))$("client-jackpot-schedule-toggle").hidden=x?.can_manage!==true}
  catch(_e){if($("client-jackpot-schedule-status"))$("client-jackpot-schedule-status").textContent="Automatisation momentanément indisponible."}
}
async function saveSchedule(){
  if(s.scheduleBusy)return;
  var api=window.PGICustomerApi;if(!api||typeof api.saveJackpotSchedule!=="function")return;
  var status=$("client-jackpot-schedule-status"),button=$("client-jackpot-schedule-save");
  try{
    s.scheduleBusy=true;button.disabled=true;status.textContent="Enregistrement…";
    var tz=$("client-jackpot-schedule-timezone").value.trim()||tzName();
    var payload={enabled:$("client-jackpot-schedule-enabled").checked,interval_value:Number($("client-jackpot-schedule-value").value),interval_unit:$("client-jackpot-schedule-unit").value,timezone:tz,anchor_at:zonedLocalIso($("client-jackpot-schedule-date").value,$("client-jackpot-schedule-time").value,tz)};
    var saved=await api.saveJackpotSchedule(payload);fillSchedule(saved);status.textContent=scheduleText(saved);
  }catch(_e){status.textContent="L’automatisation n’a pas pu être enregistrée. Vérifiez la date, l’heure, l’intervalle et le fuseau horaire."}
  finally{s.scheduleBusy=false;button.disabled=false}
}
async function refresh(){
  ui();var api=window.PGICustomerApi,cfg=window.PGI_CONFIG||{};
  if(cfg.mode==="demo"){s.data={default_currency:"EUR",reset_at:new Date().toISOString(),as_of:new Date().toISOString(),by_currency:[],can_reset:true};s.at=Date.now();paint();return}
  if(!api||typeof api.jackpot!=="function")return;
  try{s.data=await api.jackpot();s.at=Date.parse(s.data&&s.data.as_of||"")||Date.now();paint();schedule(values().calls?10000:30000)}
  catch(err){if(Number(err&&err.status)===403&&$("client-live-money"))$("client-live-money").hidden=true;else if($("client-jackpot-state"))$("client-jackpot-state").textContent="Synchronisation momentanément indisponible."}
}
async function reset(){
  if(s.busy||s.data?.can_reset!==true)return;
  var api=window.PGICustomerApi;if(!api||typeof api.resetJackpot!=="function")return;
  if(!confirm("Remettre uniquement votre Business Live à 0,00 € ? Vos revenus, CDR, règlements et statistiques officielles restent inchangés."))return;
  s.busy=true;var b=$("client-jackpot-reset"),m=$("client-jackpot-state");if(b)b.disabled=true;if(m)m.textContent="Remise à zéro…";
  try{await api.resetJackpot(api.newIdempotencyKey());s.data={...(s.data||{}),reset_at:new Date().toISOString(),as_of:new Date().toISOString(),by_currency:[]};s.at=Date.now();paint();if(m)m.textContent="Business Live remis à 0,00 €. Le compteur repart dès cette seconde.";await refresh()}
  catch(_e){if(m)m.textContent="La remise à zéro n’a pas pu être appliquée."}
  finally{s.busy=false;if(b)b.disabled=false}
}
function schedule(ms){clearTimeout(s.poll);s.poll=setTimeout(function(){refresh().catch(function(){})},ms)}
function stop(){clearTimeout(s.retry);clearTimeout(s.poll);if(s.es){try{s.es.close()}catch(_e){}s.es=null}}
function events(){
  var cfg=window.PGI_CONFIG||{};if(cfg.mode==="demo"||s.es||!cfg.apiBaseUrl||typeof EventSource==="undefined")return;
  try{var es=new EventSource(String(cfg.apiBaseUrl).replace(/\/$/,"")+"/customer/events",{withCredentials:true});s.es=es;["live_call.started","live_call.ended","call.ingested","customer.jackpot.reset"].forEach(function(k){es.addEventListener(k,function(){schedule(80)})});es.onerror=function(){if(es.readyState===EventSource.CLOSED){try{es.close()}catch(_e){}if(s.es===es)s.es=null;clearTimeout(s.retry);s.retry=setTimeout(events,5000);schedule(15000)}}}
  catch(_e){s.retry=setTimeout(events,10000)}
}
document.addEventListener("pgi:portal-loaded",function(){refresh();loadSchedule();events()});
document.addEventListener("pgi:portal-error",function(e){if(String(e.detail&&e.detail.code||"").includes("401"))stop()});
document.addEventListener("click",function(e){if(e.target&&e.target.id==="customer-logout")stop()});
function init(){ui();s.tick=setInterval(paint,250)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
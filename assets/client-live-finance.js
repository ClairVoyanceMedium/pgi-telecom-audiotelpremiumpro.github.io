(function(){
"use strict";
var s={data:null,at:0,tick:null,poll:null,es:null,retry:null};
function $(id){return document.getElementById(id)}
function n(v){v=Number(v);return Number.isFinite(v)?v:0}
function money(v,c){try{return new Intl.NumberFormat(navigator.language||"fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(n(v))}catch(_e){return n(v).toFixed(2)+" "+(c||"")}}
function ui(){
 if($("client-live-money"))return;
 var box=$("client-overview");if(!box)return;
 box.insertAdjacentHTML("afterend",'<section id="client-live-money" class="cp-live-money" data-active="false" aria-live="polite"><div><span>REVERSEMENT EN DIRECT</span><strong id="client-live-amount">0,00 €</strong><small id="client-live-calls">Aucun appel en cours</small></div><div><span>Période + direct</span><strong id="client-period-payout-estimate">0,00 €</strong><small>Estimation. Le CDR final fait foi.</small></div><button id="client-live-recalc" class="cp-ghost" type="button">Recalculer</button></section>');
 $("client-live-recalc").addEventListener("click",reload);
 if(!$("client-live-finance-css")){var l=document.createElement("link");l.id="client-live-finance-css";l.rel="stylesheet";l.href="assets/client-live-finance.css";document.head.appendChild(l)}
}
function values(){
 var d=s.data||{},cur=d.tenant&&d.tenant.default_currency||"EUR";
 var done=(d.financial_by_currency||[]).filter(function(x){return !x.currency||x.currency===cur}).reduce(function(a,x){return a+n(x.estimated_client_net_ht)},0);
 var row=(d.live_financial_by_currency||[]).find(function(x){return !x.currency||x.currency===cur})||{};
 var elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000));
 return {cur:cur,calls:n(row.active_calls),live:n(row.estimated_client_net_ht)+elapsed*n(row.client_rate_ht_per_second),done:done};
}
function paint(){
 ui();var v=values(),card=$("client-live-money");if(card)card.dataset.active=v.calls>0?"true":"false";
 if($("client-live-amount"))$("client-live-amount").textContent=money(v.live,v.cur);
 if($("client-live-calls"))$("client-live-calls").textContent=v.calls?v.calls+" appel"+(v.calls>1?"s":"")+" en cours":"Aucun appel en cours";
 if($("client-period-payout-estimate"))$("client-period-payout-estimate").textContent=money(v.done+v.live,v.cur);
}
function reload(){if(typeof window.PGIReload==="function")return window.PGIReload();return Promise.resolve()}
function schedule(ms){clearTimeout(s.poll);s.poll=setTimeout(function(){Promise.resolve(reload()).catch(function(){})},ms)}
function stop(){clearTimeout(s.retry);clearTimeout(s.poll);if(s.es){try{s.es.close()}catch(_e){}s.es=null}}
function events(){
 var cfg=window.PGI_CONFIG||{};if(cfg.mode==="demo"||s.es||!cfg.apiBaseUrl||typeof EventSource==="undefined")return;
 try{
  var es=new EventSource(String(cfg.apiBaseUrl).replace(/\/$/,"")+"/customer/events",{withCredentials:true});s.es=es;
  ["live_call.started","live_call.ended","call.ingested"].forEach(function(k){es.addEventListener(k,function(){schedule(120)})});
  es.onerror=function(){if(es.readyState===EventSource.CLOSED){try{es.close()}catch(_e){}if(s.es===es)s.es=null;clearTimeout(s.retry);s.retry=setTimeout(events,5000);schedule(15000)}};
 }catch(_e){s.retry=setTimeout(events,10000)}
}
document.addEventListener("pgi:portal-loaded",function(e){s.data=e.detail&&e.detail.data||null;s.at=Date.parse(s.data&&s.data.server_time||"")||Date.now();paint();events();schedule(values().calls?15000:(s.es?120000:30000))});
document.addEventListener("pgi:portal-error",function(e){if(String(e.detail&&e.detail.code||"").includes("401"))stop()});
document.addEventListener("click",function(e){if(e.target&&e.target.id==="customer-logout")stop()});
function init(){ui();s.tick=setInterval(paint,500)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
(function(){
"use strict";
var s={data:null,at:0,tick:null,poll:null,es:null,retry:null};
function $(id){return document.getElementById(id)}
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v)||0)}catch(_e){return (Number(v)||0).toFixed(2)+" "+(c||"")}}
function ui(){
 if($("live-jackpot-card"))return;
 var box=document.querySelector(".panel.realtime .live-stats");if(!box)return;
 box.insertAdjacentHTML("beforebegin",'<div id="live-jackpot-card" class="live-jackpot" data-active="false"><span class="lj-label">REVERSEMENT EN DIRECT</span><strong id="live-jackpot">0,00 €</strong><span id="live-jackpot-calls">Aucun appel en cours</span><small id="live-jackpot-rate">Flux financier en attente</small><div><span>Attendu période + direct</span><b id="live-jackpot-period">0,00 €</b></div><small>Estimation des appels actifs. Le CDR final remplace cette estimation.</small></div>');
 if(!$("live-finance-css")){var l=document.createElement("link");l.id="live-finance-css";l.rel="stylesheet";l.href="assets/live-finance.css";document.head.appendChild(l)}
}
function paint(){
 ui();var d=s.data||{},calls=Number(d.live_calls||0),cur=d.live_currency||d.currency||"EUR",mixed=!!d.live_mixed_currency;
 var elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000));
 var live=Math.max(0,Number(d.live_upstream_payout_ht||0)+elapsed*Number(d.live_upstream_rate_ht_per_second||0));
 var card=$("live-jackpot-card");if(card)card.dataset.active=calls>0?"true":"false";
 if($("live-jackpot"))$("live-jackpot").textContent=mixed?"Multi-devises":money(live,cur);
 if($("live-jackpot-calls"))$("live-jackpot-calls").textContent=calls?calls+" appel"+(calls>1?"s":"")+" en cours":"Aucun appel en cours";
 if($("live-jackpot-rate"))$("live-jackpot-rate").textContent=calls&&!mixed?"+"+money(d.live_upstream_rate_ht_per_second,cur)+" / seconde estimée":"Flux financier en attente";
 if($("live-jackpot-period"))$("live-jackpot-period").textContent=mixed?"—":money(Number(d.expected_payout_ht||0)+live,cur);
}
async function refresh(){
 if(!window.PGIApi||typeof window.PGIApi.summary!=="function")return;
 var now=new Date(),from=new Date(now);from.setHours(0,0,0,0);
 try{s.data=await window.PGIApi.summary(from.toISOString(),now.toISOString());s.at=Date.parse(s.data.live_as_of||"")||Date.now();paint()}catch(_e){}
}
function events(){
 if(s.es||!window.PGIApi||typeof window.PGIApi.events!=="function")return;
 try{
  var es=window.PGIApi.events();s.es=es;
  ["live_call.started","live_call.ended","call.ingested"].forEach(function(n){es.addEventListener(n,refresh)});
  es.onerror=function(){if(es.readyState===EventSource.CLOSED){try{es.close()}catch(_e){}if(s.es===es)s.es=null;clearTimeout(s.retry);s.retry=setTimeout(events,5000)}};
 }catch(_e){s.retry=setTimeout(events,10000)}
}
function init(){ui();refresh();events();s.tick=setInterval(paint,500);s.poll=setInterval(refresh,15000)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
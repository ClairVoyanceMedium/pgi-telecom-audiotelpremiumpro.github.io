(function(){
"use strict";
var s={data:null,at:0,ranking:null,rankAt:0,tick:null,poll:null,es:null,retry:null};
function $(id){return document.getElementById(id)}
function n(v){v=Number(v);return Number.isFinite(v)?v:0}
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v))}catch(_e){return n(v).toFixed(2)+" "+(c||"")}}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(ch){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]})}
function ui(){
 if($("live-jackpot-card"))return;
 var box=document.querySelector(".panel.realtime .live-stats");if(!box)return;
 box.insertAdjacentHTML("beforebegin",'<div id="live-jackpot-card" class="live-jackpot" data-active="false"><div class="lj-head"><div><span class="lj-label">JACKPOT GLOBAL EN DIRECT</span><strong id="live-jackpot">0,00 €</strong><span id="live-jackpot-calls">Aucun appel en cours</span></div><div class="lj-speed"><span>VITESSE ACTUELLE</span><b id="live-jackpot-rate">0,00 € / seconde</b></div></div><div class="lj-period"><span>Aujourd’hui + direct</span><b id="live-jackpot-period">0,00 €</b></div><div class="lj-ranking"><div class="lj-ranking-title"><span>TOP CLIENTS EN DIRECT</span><small>Classement par revenu opérateur généré maintenant</small></div><div id="live-jackpot-ranking"><small>Aucun client en appel.</small></div></div><small>Estimation seconde par seconde. Les CDR et rapprochements opérateur restent l’autorité comptable.</small></div>');
 if(!$("live-finance-css")){var l=document.createElement("link");l.id="live-finance-css";l.rel="stylesheet";l.href="assets/live-finance.css";document.head.appendChild(l)}
}
function renderRanking(){
 var root=$("live-jackpot-ranking"),d=s.ranking||{},rows=(d.by_client||[]).slice(0,8),elapsed=Math.max(0,Math.min(30,(Date.now()-(s.rankAt||Date.now()))/1000));if(!root)return;
 root.innerHTML=rows.length?rows.map(function(x,i){var cur=x.currency||"EUR",generated=n(x.generated_upstream_payout_ht)+elapsed*n(x.upstream_rate_ht_per_second),margin=n(x.pgi_margin_ht)+elapsed*n(x.pgi_margin_rate_ht_per_second);return '<div class="lj-rank-row"><b>#'+(i+1)+'</b><span><strong>'+esc(x.display_name||x.tenant_public_id||"Client")+'</strong><small>'+n(x.active_calls)+' appel'+(n(x.active_calls)>1?"s":"")+' · +'+money(x.upstream_rate_ht_per_second,cur)+'/s</small></span><span><strong>'+money(generated,cur)+'</strong><small>Marge PGI '+money(margin,cur)+'</small></span></div>'}).join(""):'<small>Aucun client en appel.</small>';
}
function paint(){
 ui();var d=s.data||{},calls=n(d.live_calls),cur=d.live_currency||d.currency||"EUR",mixed=!!d.live_mixed_currency,elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000));
 var live=Math.max(0,n(d.live_upstream_payout_ht)+elapsed*n(d.live_upstream_rate_ht_per_second)),card=$("live-jackpot-card");if(card)card.dataset.active=calls>0?"true":"false";
 if($("live-jackpot"))$("live-jackpot").textContent=mixed?"Multi-devises":money(live,cur);
 if($("live-jackpot-calls"))$("live-jackpot-calls").textContent=calls?calls+" appel"+(calls>1?"s":"")+" actifs":"Aucun appel en cours";
 if($("live-jackpot-rate"))$("live-jackpot-rate").textContent=calls&&!mixed?"+"+money(d.live_upstream_rate_ht_per_second,cur)+" / seconde":"0,00 € / seconde";
 if($("live-jackpot-period"))$("live-jackpot-period").textContent=mixed?"—":money(n(d.expected_payout_ht)+live,cur);
 renderRanking();
}
async function refresh(){
 if(!window.PGIApi||typeof window.PGIApi.summary!=="function")return;
 var now=new Date(),from=new Date(now);from.setHours(0,0,0,0);
 try{s.data=await window.PGIApi.summary(from.toISOString(),now.toISOString());s.at=Date.parse(s.data.live_as_of||"")||Date.now();if(typeof window.PGIApi.liveFinance==="function")try{s.ranking=await window.PGIApi.liveFinance();s.rankAt=Date.parse(s.ranking&&s.ranking.as_of||"")||Date.now()}catch(_e){s.ranking=null}paint()}catch(_e){}
}
function events(){
 if(s.es||!window.PGIApi||typeof window.PGIApi.events!=="function")return;
 try{var es=window.PGIApi.events();s.es=es;["live_call.started","live_call.ended","call.ingested"].forEach(function(k){es.addEventListener(k,refresh)});es.onerror=function(){if(es.readyState===EventSource.CLOSED){try{es.close()}catch(_e){}if(s.es===es)s.es=null;clearTimeout(s.retry);s.retry=setTimeout(events,5000)}}}catch(_e){s.retry=setTimeout(events,10000)}
}
function init(){ui();refresh();events();s.tick=setInterval(paint,250);s.poll=setInterval(refresh,10000)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
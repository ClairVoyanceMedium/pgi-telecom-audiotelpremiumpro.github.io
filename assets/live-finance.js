(function(){
"use strict";
var s={data:null,at:0,tick:null,poll:null,es:null,retry:null,busy:false};
function $(id){return document.getElementById(id)}
function n(v){v=Number(v);return Number.isFinite(v)?v:0}
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v))}catch(_e){return n(v).toFixed(2)+" "+(c||"")}}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(ch){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]})}
function stamp(v){if(!v)return "—";try{return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v))}catch(_e){return String(v)}}
function ui(){
 if($("live-jackpot-card"))return;
 var box=document.querySelector(".main .topbar");if(!box)return;
 box.insertAdjacentHTML("afterend",'<div id="live-jackpot-card" class="live-jackpot live-jackpot-featured" data-active="false"><div class="lj-head"><div><span class="lj-label">BUSINESS LIVE</span><strong id="live-jackpot">0,00 €</strong><span id="live-jackpot-calls">Cumul depuis la dernière remise à zéro · aucun appel en cours</span></div><div class="lj-speed"><span>VITESSE ACTUELLE</span><b id="live-jackpot-rate">0,00 € / seconde</b></div></div><div class="lj-period"><span>APPELS EN COURS</span><b id="live-jackpot-period">0,00 €</b></div><div class="lj-ranking"><div class="lj-ranking-title"><span>TOP CLIENTS EN DIRECT</span><small>Classement par revenu opérateur généré maintenant</small></div><div id="live-jackpot-ranking"><small>Aucun client en appel.</small></div></div><div class="lj-actions"><button id="live-jackpot-reset" class="secondary-btn" type="button" hidden>Remettre Business Live à zéro</button><button id="live-jackpot-refresh" class="secondary-btn" type="button">Actualiser</button><small id="live-jackpot-since">Depuis la dernière remise à zéro</small></div><small id="live-jackpot-state">Ce compteur est indépendant des bilans officiels. Les CDR et rapprochements opérateur restent l’autorité comptable.</small></div>');
 $("live-jackpot-refresh").addEventListener("click",refresh);
 $("live-jackpot-reset").addEventListener("click",reset);
 if(!$("live-finance-css")){var l=document.createElement("link");l.id="live-finance-css";l.rel="stylesheet";l.href="assets/live-finance.css";document.head.appendChild(l)}
}
function values(){
 var d=s.data||{},rows=d.by_currency||[],mixed=rows.length>1,row=rows[0]||{},elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000)),rate=n(row.upstream_rate_ht_per_second);
 return {mixed:mixed,cur:row.currency||"EUR",calls:n(d.active_calls),total:n(row.jackpot_upstream_payout_ht)+elapsed*rate,live:n(row.live_upstream_payout_ht)+elapsed*rate,rate:rate,resetAt:d.reset_at};
}
function renderRanking(){
 var root=$("live-jackpot-ranking"),d=s.data||{},rows=(d.by_client||[]).slice(0,8),elapsed=Math.max(0,Math.min(30,(Date.now()-(s.at||Date.now()))/1000));if(!root)return;
 root.innerHTML=rows.length?rows.map(function(x,i){var cur=x.currency||"EUR",generated=n(x.generated_upstream_payout_ht)+elapsed*n(x.upstream_rate_ht_per_second),margin=n(x.pgi_margin_ht)+elapsed*n(x.pgi_margin_rate_ht_per_second);return '<div class="lj-rank-row"><b>#'+(i+1)+'</b><span><strong>'+esc(x.display_name||x.tenant_public_id||"Client")+'</strong><small>'+n(x.active_calls)+' appel'+(n(x.active_calls)>1?"s":"")+' · +'+money(x.upstream_rate_ht_per_second,cur)+'/s</small></span><span><strong>'+money(generated,cur)+'</strong><small>Marge PGI '+money(margin,cur)+'</small></span></div>'}).join(""):'<small>Aucun client en appel.</small>';
}
function paint(){
 ui();var v=values(),card=$("live-jackpot-card"),resetButton=$("live-jackpot-reset");
 if(card)card.dataset.active=v.calls>0?"true":"false";
 if(resetButton)resetButton.hidden=s.data?.can_reset!==true;
 if($("live-jackpot"))$("live-jackpot").textContent=v.mixed?"Multi-devises":money(v.total,v.cur);
 if($("live-jackpot-calls"))$("live-jackpot-calls").textContent=v.calls?v.calls+" appel"+(v.calls>1?"s":"")+" actif"+(v.calls>1?"s":"")+" · le cumul continue":"Cumul conservé · aucun appel en cours";
 if($("live-jackpot-rate"))$("live-jackpot-rate").textContent=v.calls&&!v.mixed?"+"+money(v.rate,v.cur)+" / seconde":"0,00 € / seconde";
 if($("live-jackpot-period"))$("live-jackpot-period").textContent=v.mixed?"—":money(v.live,v.cur);
 if($("live-jackpot-since"))$("live-jackpot-since").textContent="Depuis le "+stamp(v.resetAt)+" · remise à zéro manuelle uniquement";
 renderRanking();
}
async function refresh(){
 ui();if(!window.PGIApi||typeof window.PGIApi.liveFinance!=="function")return;
 try{s.data=await window.PGIApi.liveFinance();s.at=Date.parse(s.data&&s.data.as_of||"")||Date.now();paint()}catch(_e){if($("live-jackpot-state"))$("live-jackpot-state").textContent="Synchronisation momentanément indisponible."}
}
async function reset(){
 if(s.busy||s.data?.can_reset!==true||!window.PGIApi||typeof window.PGIApi.resetLiveFinance!=="function")return;
 if(!confirm("Remettre uniquement Business Live à 0,00 € ? Les appels, CDR, bilans jour/semaine/mois/année, règlements et statistiques officielles resteront inchangés."))return;
 s.busy=true;var b=$("live-jackpot-reset"),m=$("live-jackpot-state");if(b)b.disabled=true;if(m)m.textContent="Remise à zéro du Business Live…";
 try{await window.PGIApi.resetLiveFinance(window.PGIApi.newIdempotencyKey());await refresh();if(m)m.textContent="Business Live remis à zéro. Les bilans officiels restent inchangés."}
 catch(_e){if(m)m.textContent="La remise à zéro du Business Live n’a pas pu être appliquée."}
 finally{s.busy=false;if(b)b.disabled=false}
}
function events(){
 if(s.es||!window.PGIApi||typeof window.PGIApi.events!=="function")return;
 try{var es=window.PGIApi.events();s.es=es;["live_call.started","live_call.ended","call.ingested","platform.jackpot.reset"].forEach(function(k){es.addEventListener(k,refresh)});es.onerror=function(){if(es.readyState===EventSource.CLOSED){try{es.close()}catch(_e){}if(s.es===es)s.es=null;clearTimeout(s.retry);s.retry=setTimeout(events,5000)}}}catch(_e){s.retry=setTimeout(events,10000)}
}
function init(){ui();refresh();events();s.tick=setInterval(paint,250);s.poll=setInterval(refresh,10000)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

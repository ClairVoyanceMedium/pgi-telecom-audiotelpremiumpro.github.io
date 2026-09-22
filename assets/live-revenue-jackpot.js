let live={upstream:0,margin:0,client:0,upstreamRate:0,marginRate:0,clientRate:0,asOf:0,currency:"EUR",mixed:false,calls:0};
const stats=document.querySelector(".live-stats");
if(stats){
  const link=document.createElement("link");link.rel="stylesheet";link.href="assets/live-revenue-jackpot.css";document.head.appendChild(link);
  const box=document.createElement("div");box.className="live-jackpot";box.setAttribute("aria-live","polite");
  box.innerHTML='<div class="live-jackpot-main"><span>JACKPOT LIVE · REVERSEMENT OPÉRATEUR ESTIMÉ</span><strong id="live-jackpot">0,00 €</strong><small id="live-jackpot-detail">0 appel en cours · estimation provisoire</small></div><div class="live-jackpot-split"><div><span>Net clients estimé</span><strong id="live-jackpot-client">0,00 €</strong></div><div><span>Marge PGI estimée</span><strong id="live-jackpot-margin">0,00 €</strong></div></div>';
  stats.before(box);
}
const $=id=>document.getElementById(id);
function money(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v)||0)}catch{return (Number(v)||0).toFixed(2)+" "+(c||"EUR")}}
function projected(base,rate){return Math.max(0,Number(base||0)+Number(rate||0)*Math.max(0,(Date.now()-live.asOf)/1000))}
function tick(){
  if(!$("live-jackpot"))return;
  $("live-jackpot").textContent=live.mixed?"Multi-devises":money(projected(live.upstream,live.upstreamRate),live.currency);
  $("live-jackpot-client").textContent=live.mixed?"—":money(projected(live.client,live.clientRate),live.currency);
  $("live-jackpot-margin").textContent=live.mixed?"—":money(projected(live.margin,live.marginRate),live.currency);
  $("live-jackpot-detail").textContent=live.calls+" appel(s) en cours · estimation avant CDR et rapprochement";
}
function apply(s={}){
  live={upstream:Number(s.live_upstream_estimate_ht||0),margin:Number(s.live_platform_margin_estimate_ht||0),client:Number(s.live_client_net_estimate_ht||0),upstreamRate:Number(s.live_upstream_rate_per_second||0),marginRate:Number(s.live_platform_margin_rate_per_second||0),clientRate:Number(s.live_client_net_rate_per_second||0),asOf:Date.parse(s.live_estimate_as_of||"")||Date.now(),currency:String(s.live_estimate_currency||"EUR"),mixed:Boolean(s.live_estimate_mixed_currency),calls:Number(s.live_calls||0)};tick();
}
window.addEventListener("pgi:live-finance",e=>apply(e.detail||{}));
apply(window.PGILiveFinanceSummary||{});
setInterval(tick,1000);

(function(){
"use strict";

var refresh=null,status=null,detail=null,main=null,lastLoadedAt=null,liveTimer=null,liveData={base:0,rate:0,asOf:0,currency:"EUR",active:0,mixed:false};

function $(id){return document.getElementById(id);}
function formatTime(date){
  try{return new Intl.DateTimeFormat(document.documentElement.lang||"fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(date);}
  catch(_e){return date.toLocaleTimeString();}
}
function setState(kind,label,message){
  if(!status||!detail)return;
  status.textContent=label;
  detail.textContent=message||"";
  var bar=status.closest(".cp-command-bar");
  if(bar){
    bar.dataset.state=kind;
    bar.classList.toggle("is-loading",kind==="loading");
  }
}
function setBusy(busy){
  if(main)main.setAttribute("aria-busy",busy?"true":"false");
  if(refresh){
    refresh.disabled=busy;
    refresh.textContent=busy?"Actualisation…":"Actualiser";
  }
}
function money(v,currency){
  try{return new Intl.NumberFormat(document.documentElement.lang||"fr-FR",{style:"currency",currency:currency||"EUR",maximumFractionDigits:2}).format(Number(v)||0)}
  catch(_e){return (Number(v)||0).toFixed(2)+" "+(currency||"EUR")}
}
function liveTick(){
  var amount=$("client-live-amount"),detail=$("client-live-detail");if(!amount||!detail)return;
  var elapsed=liveData.asOf?Math.max(0,(Date.now()-liveData.asOf)/1000):0;
  var value=Math.max(0,liveData.base+liveData.rate*elapsed);
  amount.textContent=liveData.mixed?"Multi-devises":money(value,liveData.currency);
  detail.textContent=liveData.active?liveData.active+" appel(s) actif(s) · estimation provisoire":"Aucun appel actif · dernier calcul consolidé";
}
function liveLoad(data){
  var x=data&&data.live_payout_estimate||{};
  liveData.base=Number(x.net_payout_estimate_ht||0);liveData.rate=Number(x.net_payout_rate_per_second||0);
  liveData.asOf=Date.parse(x.as_of||data&&data.server_time||"")||Date.now();
  liveData.currency=String(x.currency||data&&data.tenant&&data.tenant.default_currency||"EUR");
  liveData.active=Number(x.active_calls||0);liveData.mixed=Boolean(x.mixed_currency);liveTick();
}
function networkState(){
  if(navigator.onLine===false){
    setState("offline","Hors connexion","Les dernières données affichées restent visibles.");
    if(refresh)refresh.disabled=true;
    return;
  }
  if(lastLoadedAt){
    setState("ready","Données à jour","Dernière actualisation à "+formatTime(lastLoadedAt));
  }else{
    setState("ready","Connexion disponible","Prêt à synchroniser les données.");
  }
  if(refresh)refresh.disabled=false;
}
function refreshPortal(){
  if(navigator.onLine===false)return;
  var active=document.querySelector("[data-range].active");
  if(active){
    active.click();
    return;
  }
  location.reload();
}
function initSectionNav(){
  var links=Array.from(document.querySelectorAll(".cp-section-nav a[href^='#']"));
  if(!links.length||typeof IntersectionObserver==="undefined")return;
  var map=new Map(links.map(function(link){return [link.getAttribute("href").slice(1),link];}));
  var observer=new IntersectionObserver(function(entries){
    var visible=entries.filter(function(entry){return entry.isIntersecting;})
      .sort(function(a,b){return b.intersectionRatio-a.intersectionRatio;})[0];
    if(!visible)return;
    links.forEach(function(link){link.removeAttribute("aria-current");});
    var link=map.get(visible.target.id);
    if(link)link.setAttribute("aria-current","location");
  },{rootMargin:"-18% 0px -68% 0px",threshold:[0,.15,.3,.6]});
  map.forEach(function(_link,id){
    var section=document.getElementById(id);
    if(section)observer.observe(section);
  });
}
function init(){
  refresh=$("client-refresh");
  status=$("client-data-status");
  detail=$("client-data-detail");
  main=$("client-main");
  if(refresh)refresh.addEventListener("click",refreshPortal);
  var liveRefresh=$("client-live-refresh");if(liveRefresh)liveRefresh.addEventListener("click",refreshPortal);
  if(!liveTimer)liveTimer=setInterval(liveTick,1000);

  document.addEventListener("pgi:portal-loading",function(){
    setBusy(true);
    setState("loading","Synchronisation","Actualisation des données en cours.");
  });
  document.addEventListener("pgi:portal-loaded",function(e){
    window.PGI_PREMIUM_PORTAL_DATA=e&&e.detail?e.detail.data||{}:{};
    liveLoad(window.PGI_PREMIUM_PORTAL_DATA);
    lastLoadedAt=new Date();
    setBusy(false);
    networkState();
  });
  document.addEventListener("pgi:portal-error",function(){
    setBusy(false);
    setState("error","Actualisation impossible","Les dernières données disponibles restent affichées.");
  });
  window.addEventListener("online",networkState);
  window.addEventListener("offline",networkState);
  initSectionNav();
  networkState();
  setTimeout(function(){import("./client-premium-plus.js").catch(function(){});},700);
  setTimeout(function(){import("./client-experience-command-center.js").catch(function(){});},900);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
(function(){
"use strict";

var refresh=null,status=null,detail=null,main=null,lastLoadedAt=null;

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

  document.addEventListener("pgi:portal-loading",function(){
    setBusy(true);
    setState("loading","Synchronisation","Actualisation des données en cours.");
  });
  document.addEventListener("pgi:portal-loaded",function(){
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
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
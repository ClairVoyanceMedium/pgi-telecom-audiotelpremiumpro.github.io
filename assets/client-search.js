(function(){
"use strict";

var input=null,clearButton=null,count=null,observer=null,timer=null,scope="all";

var groups=[
  {type:"numbers",selector:"#numbers-list .cp-row",label:"numéro"},
  {type:"settlements",selector:"#settlements-list .cp-row",label:"reversement"},
  {type:"subscriptions",selector:"#subscription-list .cp-row",label:"contrat"},
  {type:"routing",selector:"#destinations-list .cp-row",label:"routage"},
  {type:"calls",selector:"#calls-body tr",label:"appel"}
];

function normalize(value){
  return String(value==null?"":value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/\s+/g," ").trim();
}
function targets(){
  var rows=[];
  groups.forEach(function(group){
    document.querySelectorAll(group.selector).forEach(function(el){
      rows.push({el:el,type:group.type,label:group.label});
    });
  });
  return rows;
}
function summary(counts,total){
  if(!total)return "Aucun résultat";
  var parts=[];
  groups.forEach(function(group){
    var value=counts[group.type]||0;
    if(value)parts.push(value+" "+group.label+(value>1&&group.type!=="routing"?"s":""));
  });
  return parts.join(" · ");
}
function apply(){
  if(!input)return;
  var query=normalize(input.value),rows=targets(),visible=0,counts={};
  rows.forEach(function(item){
    var inScope=scope==="all"||item.type===scope;
    var matches=!query||normalize(item.el.textContent).includes(query);
    var show=inScope&&matches;
    item.el.hidden=!show;
    if(show){
      visible++;
      counts[item.type]=(counts[item.type]||0)+1;
    }
  });
  clearButton.hidden=!query&&scope==="all";
  if(!query&&scope==="all"){
    count.textContent="Recherche dans les appels, numéros, reversements, contrat et routage";
  }else{
    count.textContent=summary(counts,visible);
  }
}
function schedule(){
  clearTimeout(timer);
  timer=setTimeout(apply,50);
}
function setScope(next,button){
  scope=next||"all";
  document.querySelectorAll("[data-search-scope]").forEach(function(el){
    var active=el===button||el.dataset.searchScope===scope;
    el.classList.toggle("active",active);
    el.setAttribute("aria-pressed",active?"true":"false");
  });
  apply();
}
function reset(){
  input.value="";
  var all=document.querySelector('[data-search-scope="all"]');
  setScope("all",all);
  input.focus();
}
function init(){
  input=document.getElementById("client-search");
  clearButton=document.getElementById("client-search-clear");
  count=document.getElementById("client-search-count");
  if(!input||!clearButton||!count)return;

  input.addEventListener("input",schedule);
  input.addEventListener("search",schedule);
  clearButton.addEventListener("click",reset);
  input.addEventListener("keydown",function(event){
    if(event.key==="Escape"&&(input.value||scope!=="all"))reset();
  });
  document.querySelectorAll("[data-search-scope]").forEach(function(button){
    button.setAttribute("aria-pressed",button.dataset.searchScope==="all"?"true":"false");
    button.addEventListener("click",function(){setScope(button.dataset.searchScope,button);});
  });
  document.addEventListener("keydown",function(event){
    var tag=(document.activeElement&&document.activeElement.tagName||"").toLowerCase();
    if(event.key==="/"&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!["input","textarea","select"].includes(tag)){
      event.preventDefault();
      input.focus();
      input.select();
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  observer=new MutationObserver(schedule);
  ["numbers-list","settlements-list","subscription-list","destinations-list","calls-body"].forEach(function(id){
    var el=document.getElementById(id);
    if(el)observer.observe(el,{childList:true,subtree:true});
  });
  apply();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
(function(){
"use strict";

var input=null,clearButton=null,count=null,observer=null,timer=null;

function normalize(value){
  return String(value==null?"":value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/\s+/g," ").trim();
}
function targets(){
  var rows=[];
  ["#numbers-list .cp-row","#settlements-list .cp-row","#subscription-list .cp-row","#destinations-list .cp-row","#calls-body tr"].forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(el){rows.push(el);});
  });
  return rows;
}
function apply(){
  if(!input)return;
  var query=normalize(input.value),rows=targets(),visible=0;
  rows.forEach(function(row){
    var show=!query||normalize(row.textContent).includes(query);
    row.hidden=!show;
    if(show)visible++;
  });
  clearButton.hidden=!query;
  if(!query){
    count.textContent="Recherche dans les appels, numéros, reversements, abonnement et routage";
  }else{
    count.textContent=visible+" résultat"+(visible>1?"s":"")+" affiché"+(visible>1?"s":"");
  }
}
function schedule(){
  clearTimeout(timer);
  timer=setTimeout(apply,60);
}
function init(){
  input=document.getElementById("client-search");
  clearButton=document.getElementById("client-search-clear");
  count=document.getElementById("client-search-count");
  if(!input||!clearButton||!count)return;

  input.addEventListener("input",schedule);
  input.addEventListener("search",schedule);
  clearButton.addEventListener("click",function(){
    input.value="";
    apply();
    input.focus();
  });
  input.addEventListener("keydown",function(event){
    if(event.key==="Escape"&&input.value){
      input.value="";
      apply();
    }
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
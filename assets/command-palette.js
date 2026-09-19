(function(root){
"use strict";
var selectedIndex=0,adminModule=null,ADMIN_URL=new URL("./platform-admin-tools.js",import.meta.url).href;
var commands=[
["view-overview","Navigation","Ouvrir le Cockpit","Accueil et pilotage","dashboard accueil cockpit"],
["view-calls","Navigation","Ouvrir les Appels","CDR et détail","cdr telephone appels"],
["view-finance","Navigation","Ouvrir Finance","CA, reversements, rapprochement","argent marge paiement reversement"],
["view-experts","Navigation","Ouvrir Experts","Disponibilité et performance","equipe consultants experts"],
["view-carriers","Navigation","Ouvrir Opérateurs","SIP, routes, portabilité","operateur carrier sip route"],
["view-wholesale","Navigation","Ouvrir Plateforme SVA","Clients, numéros, KYC","sva wholesale clients numeros kyc"],
["view-system","Navigation","Ouvrir Supervision","NOC, API, CDR, résilience","systeme noc api supervision erreurs"],
["view-settings","Navigation","Ouvrir Paramètres","Configuration et audit","reglages parametres config"],
["platform-admin","Administration","Administrer la plateforme","Tarif abonnement, opérateur, bascule et rollback","client sva tarif abonnement operateur carrier switch rollback"],
["period-today","Période","Afficher aujourd’hui","Période : aujourd’hui","jour today"],
["period-7d","Période","Afficher 7 jours","Période glissante","semaine sept jours"],
["period-week","Période","Afficher cette semaine","Lundi à aujourd’hui","semaine"],
["period-month","Période","Afficher ce mois","Depuis le 1er","mois month"],
["period-year","Période","Afficher cette année","Depuis janvier","annee year annuel"],
["refresh","Action","Actualiser maintenant","Synchroniser les données","refresh synchro actualiser mise a jour"],
["priority","Action","Ouvrir l’action prioritaire","Prochaine étape recommandée","priorite prochaine action"],
["analysis","Action","Basculer analyse / vue essentielle","Cockpit mobile","mobile graphiques analyse essentiel"],
["export","Action","Exporter les appels en CSV","Période et filtres actuels","csv export appels fichier"],
["print-calls","Action","Imprimer les appels / PDF","Vue appels","pdf impression appels"],
["print-finance","Action","Imprimer Finance / PDF","Vue finance","pdf impression finance"]
].map(function(x){return {id:x[0],group:x[1],label:x[2],hint:x[3],keywords:x[4]};});
function byId(id){return document.getElementById(id);}
function normalize(value){
return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function escapeHtml(value){
return String(value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];});
}
function filtered(){
var input=byId("command-search");
var needle=normalize(input?input.value:"");
return commands.filter(function(cmd){
return !needle||normalize(cmd.label+" "+cmd.hint+" "+cmd.group+" "+cmd.keywords).includes(needle);
}).slice(0,18);
}
function render(){
var results=byId("command-results"),list=filtered();
if(!results)return;
if(selectedIndex>=list.length)selectedIndex=Math.max(0,list.length-1);
results.innerHTML=list.length?list.map(function(cmd,index){
return '<button type="button" class="command-result'+(index===selectedIndex?' selected':'')+'" data-command-id="'+escapeHtml(cmd.id)+'" role="option" aria-selected="'+(index===selectedIndex?'true':'false')+'"><span><small>'+escapeHtml(cmd.group)+'</small><strong>'+escapeHtml(cmd.label)+'</strong><em>'+escapeHtml(cmd.hint)+'</em></span><i>↵</i></button>';
}).join(""):'<div class="command-empty">Aucune action correspondante.</div>';
var selected=results.querySelector(".command-result.selected");
if(selected)selected.scrollIntoView({block:"nearest"});
}
function open(initialQuery){
var dialog=byId("command-palette-dialog"),input=byId("command-search");
if(!dialog||typeof dialog.showModal!=="function")return;
selectedIndex=0;
if(input)input.value=initialQuery||"";
render();
if(!dialog.open)dialog.showModal();
setTimeout(function(){if(input){input.focus();input.select();}},20);
}
function close(){
var dialog=byId("command-palette-dialog");
if(dialog&&dialog.open)dialog.close();
}
function execute(id){
close();
if(id==="platform-admin"){
if(!adminModule)adminModule=import(ADMIN_URL);
adminModule.then(function(m){m.open();}).catch(function(){});
return;
}
root.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:id}}));
}
function move(delta){
var list=filtered();
if(!list.length)return;
selectedIndex=(selectedIndex+delta+list.length)%list.length;
render();
}
function init(){
var button=byId("command-palette-btn"),fab=byId("quick-actions-fab"),closeButton=byId("command-palette-close");
var input=byId("command-search"),results=byId("command-results");
if(button)button.addEventListener("click",function(){open();});
if(fab)fab.addEventListener("click",function(){open();});
if(closeButton)closeButton.addEventListener("click",close);
document.querySelectorAll("[data-platform-admin]").forEach(function(b){b.addEventListener("click",function(){execute("platform-admin");});});
if(input){
input.addEventListener("input",function(){selectedIndex=0;render();});
input.addEventListener("keydown",function(e){
if(e.key==="ArrowDown"){e.preventDefault();move(1);}
else if(e.key==="ArrowUp"){e.preventDefault();move(-1);}
else if(e.key==="Enter"){
e.preventDefault();
var list=filtered();
if(list[selectedIndex])execute(list[selectedIndex].id);
}else if(e.key==="Escape"){e.preventDefault();close();}
});
}
if(results)results.addEventListener("click",function(e){
var item=e.target.closest("[data-command-id]");
if(item)execute(item.getAttribute("data-command-id"));
});
document.addEventListener("keydown",function(e){
if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==="k"){
e.preventDefault();
open();
}
});
}
root.PGICommandPalette=Object.freeze({init:init,open:open,close:close});
})(window);

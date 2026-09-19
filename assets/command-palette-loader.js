(function(){
"use strict";
var loading=null;
function button(){return document.getElementById("command-palette-btn");}
function fab(){return document.getElementById("quick-actions-fab");}
function unbind(){
var b=button(),f=fab();
if(b)b.removeEventListener("click",onOpen);
if(f)f.removeEventListener("click",onOpen);
document.removeEventListener("keydown",onKey);
}
function load(open){
if(!loading)loading=import("./command-palette.js").then(function(){
unbind();
if(window.PGICommandPalette)window.PGICommandPalette.init();
return window.PGICommandPalette;
});
return loading.then(function(p){if(open&&p)p.open();});
}
function onOpen(e){if(e)e.preventDefault();load(true);}
function onKey(e){if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==="k"){e.preventDefault();load(true);}}
var b=button(),f=fab();
if(b)b.addEventListener("click",onOpen);
if(f)f.addEventListener("click",onOpen);
document.addEventListener("keydown",onKey);
document.querySelectorAll("[data-platform-admin]").forEach(function(el){
el.addEventListener("click",function(){import("./platform-admin-tools.js").then(function(m){m.open();}).catch(function(){});});
});
})();
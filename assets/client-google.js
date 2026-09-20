(function(root){
"use strict";
var ready=null,initialized=false,callback=null;
function cfg(){return root.PGI_CLIENT_CONFIG||{};}
function load(){
  if(root.google&&root.google.accounts&&root.google.accounts.id)return Promise.resolve(true);
  if(ready)return ready;
  ready=new Promise(function(resolve,reject){
    var s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.async=true;s.defer=true;
    s.onload=function(){resolve(Boolean(root.google&&root.google.accounts&&root.google.accounts.id));};
    s.onerror=function(){reject(new Error("GOOGLE_SDK_LOAD_FAILED"));};document.head.appendChild(s);
  });
  return ready;
}
async function init(options){
  var clientId=String(cfg().googleClientId||"").trim();
  if(!clientId)return false;
  callback=options.callback;
  await load();
  if(!initialized){
    root.google.accounts.id.initialize({client_id:clientId,callback:function(response){if(callback)callback(response);},auto_select:false,itp_support:true,use_fedcm_for_button:true,button_auto_select:false});
    initialized=true;
  }
  document.querySelectorAll("[data-google-note]").forEach(function(el){el.hidden=false;});
  [options.loginElement,options.activationElement].forEach(function(el){
    if(!el)return;el.hidden=false;el.innerHTML="";
    root.google.accounts.id.renderButton(el,{type:"standard",theme:"filled_black",size:"large",shape:"rectangular",text:el===options.activationElement?"signup_with":"continue_with",logo_alignment:"left",width:Math.min(360,Math.max(260,el.clientWidth||340))});
  });
  return true;
}
root.PGICustomerGoogle=Object.freeze({init:init,configured:function(){return Boolean(String(cfg().googleClientId||"").trim());}});
})(window);

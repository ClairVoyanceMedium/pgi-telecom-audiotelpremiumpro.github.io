(function(root){
  "use strict";

  function jsonRead(key){
    try{
      var raw=localStorage.getItem(key);
      if(!raw)return null;
      var value=JSON.parse(raw);
      return value&&typeof value==="object"?value:null;
    }catch(e){return null;}
  }

  function restore(validViews){
    var pref=jsonRead("pgi_ui_preferences")||{};
    var view=validViews&&validViews[pref.view]?pref.view:"overview";
    var allowed=["today","7d","week","month","year","custom"];
    var period=allowed.includes(pref.period)?pref.period:"today";
    var custom=null;
    if(period==="custom"&&pref.custom&&Number.isFinite(Date.parse(pref.custom.from))&&Number.isFinite(Date.parse(pref.custom.to))){
      custom={from:new Date(pref.custom.from),to:new Date(pref.custom.to)};
    }else if(period==="custom"){
      period="today";
    }
    return {view:view,period:period,custom:custom};
  }

  function restoreInto(target,validViews){
    var pref=restore(validViews);
    target.activeView=pref.view;target.period=pref.period;target.custom=pref.custom;
    if(pref.custom){
      var from=document.getElementById("date-from"),to=document.getElementById("date-to");
      if(from)from.value=pref.custom.from.toISOString().slice(0,10);
      if(to)to.value=pref.custom.to.toISOString().slice(0,10);
    }
    Array.prototype.slice.call(document.querySelectorAll(".period")).forEach(function(el){
      el.classList.toggle("active",el.getAttribute("data-period")===pref.period);
    });
    return pref;
  }

  function save(view,period,custom){
    try{
      var payload={view:view,period:period};
      if(period==="custom"&&custom)payload.custom={from:custom.from.toISOString(),to:custom.to.toISOString()};
      localStorage.setItem("pgi_ui_preferences",JSON.stringify(payload));
    }catch(e){}
  }

  function readMarket(){
    try{
      var value=String(localStorage.getItem("pgi_operating_market")||"").trim().toUpperCase();
      return /^[A-Z]{2}$/.test(value)?value:null;
    }catch(e){return null;}
  }

  function saveMarket(value){
    try{
      if(value)localStorage.setItem("pgi_operating_market",String(value).toUpperCase());
      else localStorage.removeItem("pgi_operating_market");
    }catch(e){}
  }

  function readMobileOverview(){
    try{
      var value=localStorage.getItem("pgi_mobile_full_v2");
      return value===null?true:value==="1";
    }catch(e){return true;}
  }

  function saveMobileOverview(expanded){
    try{localStorage.setItem("pgi_mobile_full_v2",expanded?"1":"0");}catch(e){}
  }

  root.PGIWorkspace=Object.freeze({
    restore:restore,
    restoreInto:restoreInto,
    save:save,
    readMarket:readMarket,
    saveMarket:saveMarket,
    readMobileOverview:readMobileOverview,
    saveMobileOverview:saveMobileOverview
  });
})(window);

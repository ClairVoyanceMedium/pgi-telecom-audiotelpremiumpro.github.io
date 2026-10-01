(function(){"use strict";
var ready=false;
async function mount(){
  if(ready)return;
  var api=window.PGICustomerApi,host=document.getElementById("client-live-money");
  if(!api?.jackpotSchedule||!api?.saveJackpotSchedule||!host)return;
  try{
    var schedule=await api.jackpotSchedule();
    if(schedule?.can_manage!==true)return;
    var actions=host.querySelector(".cp-jackpot-actions");if(!actions||document.getElementById("client-jackpot-schedule-open"))return;
    var b=document.createElement("button");b.id="client-jackpot-schedule-open";b.className="cp-ghost";b.type="button";b.textContent="Automatiser";
    var state=document.getElementById("client-jackpot-state");actions.insertBefore(b,state||null);
    if(state)state.textContent="Cumul conservé jusqu’à une remise à zéro manuelle ou programmée. Les bilans officiels restent indépendants et les reversements validés font foi.";
    b.onclick=async function(){try{var m=await import("./business-live-schedule.js");await m.openBusinessLiveSchedule({host:host,load:function(){return api.jackpotSchedule()},save:function(p){return api.saveJackpotSchedule(p)},title:"Remise à zéro automatique du Business Live"})}catch(_e){if(state)state.textContent="Automatisation momentanément indisponible."}};
    ready=true;
  }catch(_e){}
}
document.addEventListener("pgi:portal-loaded",function(){setTimeout(mount,0)});
})();
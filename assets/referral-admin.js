(function(root){"use strict";
const $=id=>document.getElementById(id);
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" €"}};
let busy=false,state=null;
function status(message,bad=false){const el=$("referral-admin-status");if(!el)return;el.textContent=message||"";el.style.color=bad?"#b42318":""}
function render(data){
  state=data||{};const card=$("referral-admin-card");if(!card)return;
  card.hidden=false;$("referral-enabled").checked=state.enabled===true;
  $("referral-reward-eur").value=((Number(state.reward_minor)||0)/100).toFixed(2).replace(".",",");
  $("referral-stat-claimed").textContent=String(state.stats?.claimed||0);
  $("referral-stat-rewarded").textContent=String(state.stats?.rewarded||0);
  $("referral-stat-earned").textContent=money(state.stats?.earned_minor||0,state.currency||"EUR");
  const list=$("referral-admin-rewards"),rows=Array.isArray(state.recent_rewards)?state.recent_rewards:[];
  if(list)list.innerHTML=rows.length?rows.map(x=>'<div class="metric-row"><span>'+String(x.status==="paid"?"Réglé":"À régler")+' · '+String(x.reward_reference||x.public_id||"")+'</span><strong>'+money(x.amount_minor,x.currency)+'</strong></div>').join(""):'<p class="muted">Aucune prime à régler.</p>';
}
async function load(){if(!root.PGIApi?.referralAdminOverview)return;try{render(await root.PGIApi.referralAdminOverview())}catch(e){status(e.code||"Parrainage indisponible",true)}}
async function save(){
  if(busy)return;busy=true;status("Enregistrement...");
  try{
    const raw=String($("referral-reward-eur").value||"0").replace(",",".");
    const minor=Math.round(Number(raw)*100);
    if(!Number.isInteger(minor)||minor<0)throw new Error("Montant invalide");
    const result=await root.PGIApi.saveReferralSettings({enabled:$("referral-enabled").checked,reward_minor:minor,currency:"EUR"},root.PGIApi.newIdempotencyKey());
    render(result);status(result.enabled?"Parrainage activé.":"Parrainage désactivé. Les historiques restent conservés.");
  }catch(e){status(e.code||e.message||"Enregistrement impossible",true)}
  finally{busy=false}
}
function bind(){$("referral-save")?.addEventListener("click",save);load()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})(window);

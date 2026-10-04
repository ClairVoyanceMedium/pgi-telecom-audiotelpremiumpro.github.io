(function(root){"use strict";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" €"}};
let state=null,busy=false;
function rootEl(){return $("client-referrals")}
function hide(){const el=rootEl();if(el)el.hidden=true}
function render(data){
  state=data||{};const el=rootEl();if(!el)return;
  if(state.enabled!==true){el.hidden=true;return}
  el.hidden=false;
  const reward=$("referral-reward");if(reward)reward.textContent=money(state.reward_minor,state.currency);
  const code=$("referral-code"),link=$("referral-link"),create=$("referral-create"),copy=$("referral-copy");
  if(state.code){
    if(code)code.textContent=state.code;
    if(link)link.value=location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(state.code);
    if(create)create.hidden=true;if(copy)copy.hidden=false;
  }else{
    if(code)code.textContent="Non activé";
    if(link)link.value="";
    if(create)create.hidden=false;if(copy)copy.hidden=true;
  }
  const list=$("referral-history");
  if(list){
    const rows=Array.isArray(state.referrals)?state.referrals:[];
    list.innerHTML=rows.length?rows.map(x=>'<div class="cp-row"><div><strong>'+esc(x.status_label||x.status||"Parrainage")+'</strong><span>'+esc(x.claimed_at_label||"")+'</span></div><strong>'+esc(money(x.reward_minor,x.reward_currency))+'</strong></div>').join(""):'<p class="cp-empty">Aucun parrainage qualifié pour le moment.</p>';
  }
}
async function load(){if(!root.PGICustomerApi?.referrals)return;try{render(await root.PGICustomerApi.referrals())}catch{hide()}}
async function create(){
  if(busy||!root.PGICustomerApi?.createReferralCode)return;busy=true;
  try{render(await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey()))}
  finally{busy=false}
}
async function copy(){
  const value=$("referral-link")?.value||"";if(!value)return;
  try{await navigator.clipboard.writeText(value);$("referral-copy").textContent="Lien copié";setTimeout(()=>{$("referral-copy").textContent="Copier le lien"},1500)}catch{}
}
function bind(){
  $("referral-create")?.addEventListener("click",create);
  $("referral-copy")?.addEventListener("click",copy);
  document.addEventListener("pgi:portal-loaded",load);
  load();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})(window);

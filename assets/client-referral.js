const $=id=>document.getElementById(id);
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}};

async function load(){
  const section=$("client-referral");if(!section||!window.PGICustomerApi?.referral)return;
  try{
    const data=await window.PGICustomerApi.referral();
    if(data?.enabled!==true){section.hidden=true;return;}
    section.hidden=false;
    const reward=money(data.reward_minor,data.currency),stats=data.stats||{};
    $("client-referral-reward").textContent=reward+" par parrainage qualifié";
    $("client-referral-code").textContent=data.code||"";
    $("client-referral-link").value=data.share_url||"";
    $("client-referral-stats").textContent=String(Number(stats.referrals||0))+" filleul(s), "+String(Number(stats.rewarded||0))+" récompense(s) acquise(s), "+money(stats.earned_minor||0,data.currency)+" acquis";
  }catch{section.hidden=true;}
}
async function copyLink(){
  const input=$("client-referral-link"),button=$("client-referral-copy");if(!input?.value)return;
  try{await navigator.clipboard.writeText(input.value);if(button){const old=button.textContent;button.textContent="Lien copié";setTimeout(()=>button.textContent=old,1600);}}
  catch{input.focus();input.select();}
}
document.addEventListener("pgi:portal-loaded",load);
document.addEventListener("click",e=>{if(e.target.closest("#client-referral-copy"))copyLink();});

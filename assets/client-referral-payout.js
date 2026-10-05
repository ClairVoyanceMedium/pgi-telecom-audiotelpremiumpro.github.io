const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const labels={pending:"PROGRAMMÉ",processing:"EN COURS",blocked:"STRIPE À FINALISER",paid:"VERSÉ"};
function stateOf(x){return String(x?.reward_payout_state||(x?.reward_status==="paid"?"paid":""))}
async function setup(button,message){
  const api=window.PGICustomerApi;if(!api?.activateCardPayments)return;
  button.disabled=true;message.textContent="Ouverture du parcours sécurisé Stripe...";
  try{
    const r=await api.activateCardPayments(api.newIdempotencyKey());
    if(r?.onboarding?.url)location.href=r.onboarding.url;
    else message.textContent="Configuration Stripe actualisée. Le prochain passage automatique reprendra vos primes.";
  }catch(e){message.textContent="Configuration Stripe indisponible : "+String(e?.code||"service indisponible")+".";
  }finally{button.disabled=false}
}
export function mountReferralPayout(data={}){
  const host=document.getElementById("client-referral-payout");if(!host)return;
  const s=data.summary||{},c=data.currency||"EUR",payable=Math.max(0,Number(s.rewards_payable_minor)||0),paid=Math.max(0,Number(s.rewards_paid_minor)||0);
  const rewards=(Array.isArray(data.recent)?data.recent:[]).filter(x=>x.reward_status).slice(0,6),account=data.payout_account||{};
  const counts={pending:0,processing:0,blocked:0,paid:0};rewards.forEach(x=>{const k=stateOf(x);if(k in counts)counts[k]++});
  if(!payable&&!paid&&!rewards.length){host.innerHTML="";return}
  const action=payable&&account.ready!==true?'<div class="cp-row"><div><strong>Compte Stripe à finaliser</strong><span>Vos primes restent acquises. Finalisez Stripe pour autoriser leur versement automatique.</span></div><button id="client-referral-payout-setup" class="cp-primary" type="button">Finaliser mes versements Stripe</button></div>':payable?'<div class="cp-row"><div><strong>Versements automatiques actifs</strong><span>Votre compte Stripe est prêt. Les primes dues sont traitées automatiquement.</span></div><span class="cp-chip ok">PRÊT</span></div>':"";
  const rows=rewards.map(x=>{const k=stateOf(x),label=labels[k]||String(x.reward_status||"").toUpperCase();return '<div class="cp-row"><div><strong>Prime '+money(x.reward_minor,c)+'</strong><span>Filleul '+esc(String(x.public_id||"").slice(0,8).toUpperCase())+(x.reward_paid_at?" · versée":" · acquise")+'</span></div><span class="cp-chip '+(k==="paid"?"ok":"")+'">'+esc(label)+'</span></div>'}).join("");
  host.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">VERSEMENTS</p><h3>Mes primes automatiques</h3></div><span>'+esc(money(paid,c))+' versé</span></div><div class="cp-row"><div><strong>'+esc(money(payable,c))+' encore dû</strong><span>'+counts.processing+' en cours · '+counts.blocked+' à régulariser côté Stripe</span></div></div>'+action+(rows?'<div class="cp-stack">'+rows+'</div>':"")+'<p id="client-referral-payout-message" class="cp-form-message" aria-live="polite"></p>';
  const b=document.getElementById("client-referral-payout-setup"),m=document.getElementById("client-referral-payout-message");if(b&&m)b.addEventListener("click",()=>setup(b,m),{once:true});
}

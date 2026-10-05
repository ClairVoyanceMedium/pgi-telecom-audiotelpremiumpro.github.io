let loaded=false,busy=false,last=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
function money(minor,currency="EUR"){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:2}).format((Number(minor)||0)/100);}
  catch{return ((Number(minor)||0)/100).toFixed(2)+" "+currency;}
}
function integer(v){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(Number(v)||0);}
function set(id,value){const el=$(id);if(el)el.textContent=value;}
function csvCell(value){const s=String(value??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function downloadCsv(){
  if(!last)return;
  const rows=[
    ["Mois","Abonnements encaissés","Portabilité prioritaire encaissée","Commission CB encaissée","Remboursements commission CB","Marge SVA encaissée","Reversements clients payés","Primes parrainage acquises","Primes parrainage payées","Encaissements totaux","Décaissements totaux","Variation de trésorerie","Revenu commercial suivi","Contribution après parrainage","Nouveaux parrainages","Filleuls validés"],
    ...last.monthly.map(x=>[
      x.month,(x.subscription_cash_in_minor/100).toFixed(2),(x.portability_cash_in_minor/100).toFixed(2),(x.card_fee_cash_in_minor/100).toFixed(2),
      (x.card_fee_refund_cash_out_minor/100).toFixed(2),(x.sva_margin_collected_minor/100).toFixed(2),(x.client_payout_cash_out_minor/100).toFixed(2),
      (x.referral_reward_accrued_minor/100).toFixed(2),(x.referral_reward_paid_minor/100).toFixed(2),(x.total_cash_in_minor/100).toFixed(2),
      (x.total_cash_out_minor/100).toFixed(2),(x.cash_delta_minor/100).toFixed(2),(x.commercial_revenue_tracked_minor/100).toFixed(2),
      (x.contribution_after_referral_minor/100).toFixed(2),x.referrals_claimed,x.referrals_validated
    ])
  ];
  const csv="\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="comptabilite-audiotel-premium-pro-"+new Date().toISOString().slice(0,10)+".csv";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function render(data){
  last=data;const s=data.summary||{},currency=data.currency||"EUR";
  set("acc-cash-in",money(s.total_cash_in_minor,currency));
  set("acc-cash-out",money(s.total_cash_out_minor,currency));
  set("acc-cash-delta",money(s.cash_delta_minor,currency));
  set("acc-commercial",money(s.commercial_revenue_tracked_minor,currency));
  set("acc-referral-cost",money(s.referral_reward_accrued_minor,currency));
  set("acc-contribution",money(s.contribution_after_referral_minor,currency));
  set("acc-payable",money(s.client_payout_payable_minor,currency));
  set("acc-referral-payable",money(s.referral_outstanding_minor,currency));
  set("acc-ambassadors",integer(s.ambassadors));
  set("acc-referrals-pending",integer(s.referrals_pending));
  set("acc-legacy",integer(s.legacy_unpriced_subscription_events));
  const body=$("accounting-table");if(body)body.innerHTML=data.monthly.slice().reverse().map(x=>{
    const cardNet=Number(x.card_fee_cash_in_minor||0)-Number(x.card_fee_refund_cash_out_minor||0);
    return "<tr><td><strong>"+esc(x.month)+"</strong></td><td>"+esc(money(x.subscription_cash_in_minor,currency))+"</td><td>"+esc(money(x.portability_cash_in_minor,currency))+"</td><td>"+esc(money(cardNet,currency))+"</td><td>"+esc(money(x.sva_margin_collected_minor,currency))+"</td><td>"+esc(money(x.referral_reward_accrued_minor,currency))+"</td><td>"+esc(money(x.referral_reward_paid_minor,currency))+"</td><td>"+esc(money(x.client_payout_cash_out_minor,currency))+"</td><td><strong>"+esc(money(x.total_cash_in_minor,currency))+"</strong></td><td>"+esc(money(x.total_cash_out_minor,currency))+"</td><td><strong>"+esc(money(x.cash_delta_minor,currency))+"</strong></td><td><strong>"+esc(money(x.contribution_after_referral_minor,currency))+"</strong></td><td>"+integer(x.referrals_claimed)+" / "+integer(x.referrals_validated)+"</td></tr>";
  }).join("")||'<tr><td colspan="13">Aucune écriture comptable disponible.</td></tr>';
  const status=$("accounting-status");if(status)status.textContent="Données consolidées automatiquement sur "+integer(data.months)+" mois. Référence temporelle : Europe/Paris.";
}
async function load(force=false){
  if(busy||(!force&&loaded&&last))return;
  if(!window.PGIApi||typeof window.PGIApi.accounting!=="function")return;
  busy=true;set("accounting-status","Actualisation de la comptabilité...");
  try{
    const months=Math.max(1,Math.min(36,Number($("accounting-months")?.value)||18));
    const data=await window.PGIApi.accounting(months,"EUR");render(data);loaded=true;
  }catch(error){
    set("accounting-status","Comptabilité indisponible : "+String(error?.code||error?.message||"erreur"));
  }finally{busy=false;}
}
function bind(){
  if($("accounting-months")&&!$("accounting-months").dataset.bound){
    $("accounting-months").dataset.bound="1";$("accounting-months").addEventListener("change",()=>load(true));
  }
  if($("accounting-export")&&!$("accounting-export").dataset.bound){
    $("accounting-export").dataset.bound="1";$("accounting-export").addEventListener("click",downloadCsv);
  }
  if($("accounting-print")&&!$("accounting-print").dataset.bound){
    $("accounting-print").dataset.bound="1";$("accounting-print").addEventListener("click",()=>window.print());
  }
}
export async function renderAccounting(){bind();await load(false);}
export async function refreshAccounting(){bind();await load(true);}

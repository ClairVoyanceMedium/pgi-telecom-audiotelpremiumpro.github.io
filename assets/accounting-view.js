let loaded=false,busy=false,last=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
function money(minor,currency="EUR"){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:2}).format((Number(minor)||0)/100);}
  catch{return ((Number(minor)||0)/100).toFixed(2)+" "+currency;}
}
function integer(v){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(Number(v)||0);}
function set(id,value){const el=$(id);if(el)el.textContent=value;}
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw new Error("API_NOT_CONFIGURED");return b;}
async function accounting(months,currency){
  const q=new URLSearchParams({months:String(months||18),currency:String(currency||"EUR")});
  const res=await fetch(apiBase()+"/platform/accounting?"+q.toString(),{credentials:"include",cache:"no-store",headers:{Accept:"application/json"}});
  const data=await res.json().catch(()=>null);if(!res.ok){const e=new Error(data?.error?.code||"ACCOUNTING_UNAVAILABLE");e.code=data?.error?.code||"ACCOUNTING_UNAVAILABLE";throw e;}return data;
}
function ensureShell(){
  const root=$("accounting-root");if(!root||$("acc-cash-in"))return;
  root.innerHTML='<section class="kpi-grid finance-kpis"><article class="kpi emphasis"><span>Encaissements</span><strong id="acc-cash-in">0,00 €</strong><small>Flux monétaires entrants suivis</small></article><article class="kpi"><span>Décaissements</span><strong id="acc-cash-out">0,00 €</strong><small>Reversements, remboursements et primes payées</small></article><article class="kpi"><span>Variation de trésorerie</span><strong id="acc-cash-delta">0,00 €</strong><small>Encaissements moins décaissements</small></article><article class="kpi"><span>Revenu commercial suivi</span><strong id="acc-commercial">0,00 €</strong><small>Abonnements, priorité, commissions CB, marge SVA</small></article></section><section class="kpi-grid finance-kpis"><article class="kpi"><span>Coût parrainage acquis</span><strong id="acc-referral-cost">0,00 €</strong><small>Primes dues sur filleuls validés</small></article><article class="kpi emphasis"><span>Contribution après parrainage</span><strong id="acc-contribution">0,00 €</strong><small>Revenu commercial suivi moins primes acquises</small></article><article class="kpi"><span>Reversements clients à payer</span><strong id="acc-payable">0,00 €</strong><small>Écritures SVA devenues payables</small></article><article class="kpi"><span>Primes ambassadeurs à payer</span><strong id="acc-referral-payable">0,00 €</strong><small>Récompenses acquises non encore réglées</small></article></section><section class="panel"><div class="panel-head"><div><p class="panel-kicker">COMPTABILITÉ EXPERTE</p><h2>Suivi automatique mois par mois</h2></div><div class="panel-actions"><label>Période<select id="accounting-months"><option value="12">12 mois</option><option value="18" selected>18 mois</option><option value="24">24 mois</option><option value="36">36 mois</option></select></label><button id="accounting-export" class="secondary-btn" type="button">Exporter CSV</button><button id="accounting-print" class="secondary-btn" type="button">Imprimer / PDF</button></div></div><p id="accounting-status" class="muted">Chargement de la comptabilité...</p><div class="recon-grid" style="margin:14px 0"><article class="recon-card"><h3>Ambassadeurs actifs</h3><div class="amount" id="acc-ambassadors">0</div><small>25 filleuls validés ou plus</small></article><article class="recon-card"><h3>Parrainages en attente</h3><div class="amount" id="acc-referrals-pending">0</div><small>Validation en cours sur 3 mensualités</small></article><article class="recon-card"><h3>Factures historiques sans montant</h3><div class="amount" id="acc-legacy">0</div><small>Événements conservés et signalés</small></article></div><div class="table-wrap wide"><table><thead><tr><th>Mois</th><th>Abonnements</th><th>Portabilité prioritaire</th><th>Commission CB nette</th><th>Marge SVA</th><th>Primes acquises</th><th>Primes payées</th><th>Reversements clients</th><th>Encaissements</th><th>Décaissements</th><th>Variation trésorerie</th><th>Contribution</th><th>Parrainages enregistrés / validés</th></tr></thead><tbody id="accounting-table"></tbody></table></div><p class="muted" style="margin-top:14px">Vue de gestion automatisée fondée sur les écritures disponibles. Aucun frais de paiement, taxe ou impôt absent des sources n’est inventé.</p></section>';
}
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
  busy=true;set("accounting-status","Actualisation de la comptabilité...");
  try{
    const months=Math.max(1,Math.min(36,Number($("accounting-months")?.value)||18));
    const data=await accounting(months,"EUR");render(data);loaded=true;
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
export async function renderAccounting(){ensureShell();bind();await load(false);}
export async function refreshAccounting(){ensureShell();bind();await load(true);}

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

export function renderPayoutTermsSection(rows=[]){
  const active=rows.find(x=>x.status==="active"&&x.market_id==null&&x.sva_number_id==null)||null;
  const pct=active?(Number(active.platform_fee_bps||0)/100):"";
  const perMin=active?Number(active.platform_fee_ht_per_min||0):0;
  const delay=active?Number(active.payout_delay_days||0):0;
  const history=rows.slice(0,8).map(x=>'<tr><td>'+esc(x.market||"Tous")+'</td><td>'+esc(x.display_number||"Tous")+'</td><td>'+esc((Number(x.platform_fee_bps||0)/100).toFixed(2))+' %</td><td>'+esc(Number(x.platform_fee_ht_per_min||0).toFixed(4))+'</td><td>'+esc(x.payout_delay_days||0)+' j</td><td>'+esc(x.status)+'</td></tr>').join("");
  return '<section class="td-section"><div class="td-section-head"><h3>Marge PGI & reversement client</h3><span>'+(active?"Configuré":"À configurer")+'</span></div>'+
    '<p class="td-empty">Flux contractuel : opérateur SVA → PGI Telecom → marge PGI → net reversé au client. Sans conditions actives, une nouvelle ligne externe ne peut pas être activée.</p>'+
    '<div class="td-route-form"><input id="td-payout-percent" type="number" min="0" max="100" step="0.01" value="'+esc(pct)+'" placeholder="Commission PGI %"><input id="td-payout-per-min" type="number" min="0" step="0.000001" value="'+esc(perMin)+'" placeholder="Frais PGI HT/min"><input id="td-payout-delay" type="number" min="0" max="365" step="1" value="'+esc(delay)+'" placeholder="Délai paiement (jours)"><button class="td-btn success" data-payout-terms-save>Enregistrer la marge PGI</button></div>'+
    '<div class="td-table-wrap"><table class="td-table"><thead><tr><th>Marché</th><th>Numéro</th><th>Marge %</th><th>HT/min</th><th>Délai</th><th>État</th></tr></thead><tbody>'+(history||'<tr><td colspan="6">Aucune condition de reversement configurée.</td></tr>')+'</tbody></table></div></section>';
}

export async function runPayoutTermsAction(e,api,tenantId){
  const b=e.target.closest("[data-payout-terms-save]");if(!b)return {handled:false};
  const percent=Number(document.getElementById("td-payout-percent")?.value);
  const perMin=Number(document.getElementById("td-payout-per-min")?.value||0);
  const delay=Number(document.getElementById("td-payout-delay")?.value||0);
  if(!Number.isFinite(percent)||percent<0||percent>100)throw Object.assign(new Error("INVALID_PLATFORM_FEE"),{code:"INVALID_PLATFORM_FEE"});if(percent===0&&perMin===0)throw Object.assign(new Error("PGI_MARGIN_REQUIRED"),{code:"PGI_MARGIN_REQUIRED"});
  await api.createTenantPayoutTerms(tenantId,{platform_fee_percent:percent,platform_fee_ht_per_min:perMin,payout_delay_days:delay},api.newIdempotencyKey());
  return {handled:true,message:"Marge PGI et règles de reversement enregistrées."};
}

export function payoutTermsError(e){
  return {INVALID_PLATFORM_FEE:"La marge PGI doit être comprise entre 0 % et 100 %.",PGI_MARGIN_REQUIRED:"Une marge PGI positive est obligatoire : pourcentage ou montant HT/minute.",INVALID_PAYOUT_DELAY:"Le délai de reversement est invalide.",PAYOUT_TERMS_NUMBER_TENANT_MISMATCH:"Le numéro sélectionné n’appartient pas à ce client.",PAYOUT_TERMS_MARKET_MISMATCH:"Le marché sélectionné ne correspond pas au numéro."}[e&&e.code]||(e&&e.code)||"Impossible d’enregistrer les conditions de reversement.";
}

function round6(v){return Math.round((Number(v)+Number.EPSILON)*1e6)/1e6;}

export function computeTenantCallDistribution(upstreamAmountHt,billableSeconds,terms){
  const upstream=Math.max(0,Number(upstreamAmountHt)||0);
  if(!terms)return {upstream_amount_ht:round6(upstream),platform_fee_ht:0,net_payout_ht:0,unallocated_amount_ht:round6(upstream),payout_terms_id:null};
  const bps=Math.min(10000,Math.max(0,Number(terms.platform_fee_bps)||0));
  const perMinute=Math.max(0,Number(terms.platform_fee_ht_per_min)||0);
  if(bps===0&&perMinute===0)return {upstream_amount_ht:round6(upstream),platform_fee_ht:0,net_payout_ht:0,unallocated_amount_ht:round6(upstream),payout_terms_id:Number(terms.id)||null};
  const minutes=Math.max(0,Number(billableSeconds)||0)/60;
  const fee=Math.min(upstream,round6(upstream*bps/10000+perMinute*minutes));
  return {
    upstream_amount_ht:round6(upstream),
    platform_fee_ht:fee,
    net_payout_ht:round6(upstream-fee),
    unallocated_amount_ht:0,
    payout_terms_id:Number(terms.id)
  };
}

export function summarizeTenantDistribution(rows){
  return rows.reduce((a,row)=>{
    a.upstream_payout_ht=round6(a.upstream_payout_ht+Number(row.upstream_amount_ht||0));
    a.platform_fee_ht=round6(a.platform_fee_ht+Number(row.platform_fee_ht||0));
    a.net_payout_ht=round6(a.net_payout_ht+Number(row.net_payout_ht||0));
    a.unallocated_amount_ht=round6(a.unallocated_amount_ht+Number(row.unallocated_amount_ht||0));
    a.max_payout_delay_days=Math.max(a.max_payout_delay_days,Number(row.payout_delay_days||0));
    return a;
  },{upstream_payout_ht:0,platform_fee_ht:0,net_payout_ht:0,unallocated_amount_ht:0,max_payout_delay_days:0});
}

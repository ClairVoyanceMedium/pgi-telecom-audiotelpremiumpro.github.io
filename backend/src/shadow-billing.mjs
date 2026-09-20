function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function r(a,b){return b>0?a/b:0;}
export function assessShadowBilling(rows=[]){
  const rank={healthy:0,waiting_external:1,attention:2,critical:3};
  const currencies=(Array.isArray(rows)?rows:[]).map(row=>{
    const expected=Math.max(0,n(row.expected_payout_ht));
    const confirmed=Math.max(0,n(row.confirmed_payout_ht));
    const paid=Math.max(0,n(row.paid_payout_ht));
    const variance=Math.max(Math.abs(n(row.reconciliation_variance_ht)),Math.abs(confirmed-expected));
    const varianceRatio=r(variance,expected);
    const hasConfirmed=confirmed>0||n(row.confirmed_calls)>0;
    let status="healthy";
    if(expected>0&&!hasConfirmed)status="waiting_external";
    else if(varianceRatio>=.02)status="critical";
    else if(varianceRatio>=.005)status="attention";
    return {currency:String(row.currency||"EUR"),expected_payout_ht:expected,confirmed_payout_ht:confirmed,paid_payout_ht:paid,variance_ht:variance,variance_ratio:varianceRatio,variance_calls:Math.max(0,n(row.variance_calls)),status};
  });
  const status=currencies.reduce((a,x)=>rank[x.status]>rank[a]?x.status:a,"healthy");
  return {schema_version:"audiotel-shadow-billing/1",status,currencies,comparison_window_days:30,external_settlement_required:true,mutates_state:false};
}

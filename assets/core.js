(function(root,factory){
  var api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.PGICore=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function finiteNumber(value,name){
    var n=Number(value);
    if(!Number.isFinite(n))throw new TypeError((name||"value")+" must be a finite number");
    return n;
  }

  function nonNegative(value,name){
    var n=finiteNumber(value,name);
    if(n<0)throw new RangeError((name||"value")+" must be >= 0");
    return n;
  }

  function roundCurrency(value,decimals){
    var d=decimals==null?6:decimals;
    var f=Math.pow(10,d);
    return Math.round((finiteNumber(value,"currency")+Number.EPSILON)*f)/f;
  }

  function billedSeconds(seconds,incrementSeconds,minimumSeconds,rounding){
    var s=Math.floor(nonNegative(seconds,"seconds"));
    var inc=Math.max(1,Math.floor(nonNegative(incrementSeconds||60,"incrementSeconds")));
    var min=Math.floor(nonNegative(minimumSeconds||0,"minimumSeconds"));
    if(s<min)return 0;
    if(s===0)return 0;
    if(rounding==="floor")return Math.floor(s/inc)*inc;
    if(rounding==="nearest")return Math.round(s/inc)*inc;
    return Math.ceil(s/inc)*inc;
  }

  function computeCallFinancials(call,contract){
    call=call||{};
    contract=contract||{};
    var conversationSeconds=nonNegative(call.conversationSeconds||0,"conversationSeconds");
    var serviceRateTtcPerMin=nonNegative(contract.serviceRateTtcPerMin||0,"serviceRateTtcPerMin");
    var payoutRateHtPerMin=nonNegative(contract.payoutRateHtPerMin||0,"payoutRateHtPerMin");
    var mobileDeductionHtPerMin=nonNegative(contract.mobileDeductionHtPerMin||0,"mobileDeductionHtPerMin");
    var incrementSeconds=contract.billingIncrementSeconds||60;
    var minimumSeconds=contract.minimumPayableSeconds||0;
    var rounding=contract.rounding||"ceil";

    var billableSeconds=billedSeconds(conversationSeconds,incrementSeconds,0,rounding);
    var payoutEligibleSeconds=billedSeconds(conversationSeconds,incrementSeconds,minimumSeconds,rounding);
    var serviceMinutes=billableSeconds/60;
    var payoutMinutes=payoutEligibleSeconds/60;
    var deduction=(call.originType==="mobile"?mobileDeductionHtPerMin:0);
    var effectivePayoutRate=Math.max(0,payoutRateHtPerMin-deduction);

    return Object.freeze({
      billableSeconds:billableSeconds,
      payoutEligibleSeconds:payoutEligibleSeconds,
      serviceAmountTtc:roundCurrency(serviceMinutes*serviceRateTtcPerMin),
      expectedPayoutHt:roundCurrency(payoutMinutes*effectivePayoutRate),
      effectivePayoutRateHtPerMin:roundCurrency(effectivePayoutRate)
    });
  }

  function aggregateCalls(rows){
    rows=Array.isArray(rows)?rows:[];
    var out={
      calls:rows.length,connected:0,abandoned:0,failed:0,
      billableSeconds:0,payoutEligibleSeconds:0,conversationSeconds:0,
      generatedRevenueTtc:0,expectedPayoutHt:0,confirmedPayoutHt:0,paidPayoutHt:0,
      expertCostHt:0,technicalCostHt:0,reconciliationVarianceHt:0
    };
    rows.forEach(function(x){
      if(x.status==="connected")out.connected++;
      else if(x.status==="abandoned")out.abandoned++;
      else out.failed++;
      out.billableSeconds+=nonNegative(x.billableSeconds!=null?x.billableSeconds:(x.billable||0)*60,"billableSeconds");
      out.payoutEligibleSeconds+=nonNegative(x.payoutEligibleSeconds!=null?x.payoutEligibleSeconds:(x.payoutEligible||x.billable||0)*60,"payoutEligibleSeconds");
      out.conversationSeconds+=nonNegative(x.conversationSeconds!=null?x.conversationSeconds:(x.conversation||0),"conversationSeconds");
      out.generatedRevenueTtc+=nonNegative(x.serviceAmountTtc!=null?x.serviceAmountTtc:(x.serviceAmount||0),"generatedRevenueTtc");
      out.expectedPayoutHt+=nonNegative(x.expectedPayoutHt!=null?x.expectedPayoutHt:(x.expected||0),"expectedPayoutHt");
      out.confirmedPayoutHt+=nonNegative(x.confirmedPayoutHt!=null?x.confirmedPayoutHt:(x.confirmed||0),"confirmedPayoutHt");
      out.paidPayoutHt+=nonNegative(x.paidPayoutHt!=null?x.paidPayoutHt:(x.paid||0),"paidPayoutHt");
      out.expertCostHt+=nonNegative(x.expertCostHt!=null?x.expertCostHt:(x.expertCost||0),"expertCostHt");
      out.technicalCostHt+=nonNegative(x.technicalCostHt!=null?x.technicalCostHt:(x.cost||0),"technicalCostHt");
    });
    out.generatedRevenueTtc=roundCurrency(out.generatedRevenueTtc);
    out.expectedPayoutHt=roundCurrency(out.expectedPayoutHt);
    out.confirmedPayoutHt=roundCurrency(out.confirmedPayoutHt);
    out.paidPayoutHt=roundCurrency(out.paidPayoutHt);
    out.expertCostHt=roundCurrency(out.expertCostHt);
    out.technicalCostHt=roundCurrency(out.technicalCostHt);
    out.reconciliationVarianceHt=roundCurrency(out.expectedPayoutHt-out.confirmedPayoutHt);
    out.estimatedMarginHt=roundCurrency(out.confirmedPayoutHt-out.expertCostHt-out.technicalCostHt);
    out.acdSeconds=out.connected?out.conversationSeconds/out.connected:0;
    out.asrPercent=out.calls?out.connected/out.calls*100:0;
    return Object.freeze(out);
  }

  function reconcileAmounts(expected,confirmed,tolerance){
    var e=nonNegative(expected||0,"expected");
    var c=nonNegative(confirmed||0,"confirmed");
    var t=nonNegative(tolerance||0,"tolerance");
    var variance=roundCurrency(e-c);
    var absoluteVariance=roundCurrency(Math.abs(variance));
    return Object.freeze({
      expectedHt:roundCurrency(e),
      confirmedHt:roundCurrency(c),
      varianceHt:variance,
      absoluteVarianceHt:absoluteVariance,
      status:absoluteVariance<=t?"matched":"variance"
    });
  }

  return Object.freeze({
    billedSeconds:billedSeconds,
    computeCallFinancials:computeCallFinancials,
    aggregateCalls:aggregateCalls,
    reconcileAmounts:reconcileAmounts,
    roundCurrency:roundCurrency
  });
});

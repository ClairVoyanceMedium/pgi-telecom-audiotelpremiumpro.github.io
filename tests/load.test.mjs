import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const core=require("../assets/core.js");

test("100000 appels restent calculables sans NaN",()=>{
  const rows=[];
  for(let i=0;i<100000;i++){
    const f=core.computeCallFinancials(
      {conversationSeconds:60+(i%1800),originType:i%2?"mobile":"fixed"},
      {serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,mobileDeductionHtPerMin:.06,billingIncrementSeconds:60,minimumPayableSeconds:0}
    );
    rows.push({
      status:i%10===0?"abandoned":"connected",
      billableSeconds:f.billableSeconds,
      payoutEligibleSeconds:f.payoutEligibleSeconds,
      conversationSeconds:60+(i%1800),
      serviceAmountTtc:f.serviceAmountTtc,
      expectedPayoutHt:f.expectedPayoutHt,
      confirmedPayoutHt:f.expectedPayoutHt,
      paidPayoutHt:i%3===0?f.expectedPayoutHt:0,
      expertCostHt:f.billableSeconds/60*.18,
      technicalCostHt:.03
    });
  }
  const a=core.aggregateCalls(rows);
  for(const key of ["generatedRevenueTtc","expectedPayoutHt","confirmedPayoutHt","paidPayoutHt","estimatedMarginHt"]){
    assert.ok(Number.isFinite(a[key]),key+" must be finite");
  }
  assert.equal(a.calls,100000);
});
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const core=require("../assets/core.js");

test("arrondi à la minute supérieure",()=>{
  assert.equal(core.billedSeconds(61,60,0,"ceil"),120);
  assert.equal(core.billedSeconds(60,60,0,"ceil"),60);
  assert.equal(core.billedSeconds(1,60,0,"ceil"),60);
});

test("durée minimale rend un appel non éligible au reversement",()=>{
  const r=core.computeCallFinancials(
    {conversationSeconds:250,originType:"fixed"},
    {serviceRateTtcPerMin:.80,payoutRateHtPerMin:.46,minimumPayableSeconds:300,billingIncrementSeconds:60}
  );
  assert.equal(r.billableSeconds,300);
  assert.equal(r.payoutEligibleSeconds,0);
  assert.equal(r.expectedPayoutHt,0);
  assert.equal(r.serviceAmountTtc,4);
});

test("déduction mobile est appliquée uniquement au reversement",()=>{
  const fixed=core.computeCallFinancials(
    {conversationSeconds:600,originType:"fixed"},
    {serviceRateTtcPerMin:.80,payoutRateHtPerMin:.46,mobileDeductionHtPerMin:.06,billingIncrementSeconds:60}
  );
  const mobile=core.computeCallFinancials(
    {conversationSeconds:600,originType:"mobile"},
    {serviceRateTtcPerMin:.80,payoutRateHtPerMin:.46,mobileDeductionHtPerMin:.06,billingIncrementSeconds:60}
  );
  assert.equal(fixed.expectedPayoutHt,4.6);
  assert.equal(mobile.expectedPayoutHt,4.0);
  assert.equal(fixed.serviceAmountTtc,mobile.serviceAmountTtc);
});

test("confirmé et payé restent distincts",()=>{
  const a=core.aggregateCalls([
    {status:"connected",billableSeconds:600,payoutEligibleSeconds:600,conversationSeconds:590,serviceAmountTtc:8,expectedPayoutHt:4.6,confirmedPayoutHt:4.5,paidPayoutHt:0,expertCostHt:1.8,technicalCostHt:.03},
    {status:"connected",billableSeconds:300,payoutEligibleSeconds:300,conversationSeconds:280,serviceAmountTtc:4,expectedPayoutHt:2.3,confirmedPayoutHt:2.3,paidPayoutHt:2.3,expertCostHt:.9,technicalCostHt:.03}
  ]);
  assert.equal(a.expectedPayoutHt,6.9);
  assert.equal(a.confirmedPayoutHt,6.8);
  assert.equal(a.paidPayoutHt,2.3);
  assert.equal(a.reconciliationVarianceHt,.1);
  assert.equal(a.estimatedMarginHt,4.04);
});

test("les valeurs financières négatives sont refusées",()=>{
  assert.throws(()=>core.computeCallFinancials({conversationSeconds:60},{serviceRateTtcPerMin:-.8}),/>= 0/);
});
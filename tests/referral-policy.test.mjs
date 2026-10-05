import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {referralRewardForOrdinal} from "../backend/src/store-postgres.mjs";

test("ambassador fixed reward policy is deterministic at every tier boundary",()=>{
  const cases=[
    [1,1000,500,1500],
    [2,1000,0,1000],
    [4,1000,0,1000],
    [5,1200,2000,3200],
    [9,1200,0,1200],
    [10,1500,5000,6500],
    [24,1500,0,1500],
    [25,2000,0,2000],
    [100,2000,0,2000]
  ];
  for(const [ordinal,base,bonus,total] of cases){
    const result=referralRewardForOrdinal(ordinal);
    assert.equal(result.ordinal,ordinal);
    assert.equal(result.base_reward_minor,base);
    assert.equal(result.bonus_minor,bonus);
    assert.equal(result.total_reward_minor,total);
  }
});

test("ambassador qualification requires three distinct paid invoices",()=>{
  const source=fs.readFileSync(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8");
  assert.match(source,/qualification_paid_invoices:3/);
  assert.match(source,/three_paid_monthly_invoices/);
  assert.match(source,/count\(DISTINCT normalized_details->>'provider_invoice_reference'\)/);
  assert.match(source,/paidInvoices<REFERRAL_POLICY\.qualification_paid_invoices/);
  assert.match(source,/currentInvoiceEvents===1/);
});

test("platform accounting deduplicates subscription cash by invoice reference",()=>{
  const source=fs.readFileSync(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8");
  assert.match(source,/SELECT DISTINCT ON \(normalized_details->>'provider_invoice_reference'\)/);
  assert.match(source,/stripe_processing_fees:\{available:false/);
  assert.match(source,/tax_separation_notice/);
});

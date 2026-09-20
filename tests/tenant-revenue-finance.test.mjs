import test from "node:test";
import assert from "node:assert/strict";
import {computeTenantCallDistribution,summarizeTenantDistribution} from "../backend/src/tenant-revenue-finance.mjs";

test("PGI retains configured percentage and per-minute margin before client net",()=>{
  const row=computeTenantCallDistribution(10,600,{id:7,platform_fee_bps:2000,platform_fee_ht_per_min:0.05});
  assert.deepEqual(row,{
    upstream_amount_ht:10,
    platform_fee_ht:2.5,
    net_payout_ht:7.5,
    unallocated_amount_ht:0,
    payout_terms_id:7
  });
});

test("PGI fee can never exceed upstream SVA revenue",()=>{
  const row=computeTenantCallDistribution(3,600,{id:8,platform_fee_bps:9000,platform_fee_ht_per_min:1});
  assert.equal(row.platform_fee_ht,3);
  assert.equal(row.net_payout_ht,0);
  assert.equal(row.platform_fee_ht+row.net_payout_ht+row.unallocated_amount_ht,row.upstream_amount_ht);
});

test("zero-margin terms are treated as invalid and never pay 100 percent to the client",()=>{
  const row=computeTenantCallDistribution(8,300,{id:99,platform_fee_bps:0,platform_fee_ht_per_min:0});
  assert.equal(row.platform_fee_ht,0);
  assert.equal(row.net_payout_ht,0);
  assert.equal(row.unallocated_amount_ht,8);
  assert.equal(row.payout_terms_id,99);
});

test("missing commercial terms never defaults to 100 percent client payout",()=>{
  const row=computeTenantCallDistribution(12.345678,180,null);
  assert.equal(row.platform_fee_ht,0);
  assert.equal(row.net_payout_ht,0);
  assert.equal(row.unallocated_amount_ht,12.345678);
  assert.equal(row.payout_terms_id,null);
});

test("tenant distribution preserves the upstream accounting identity",()=>{
  const rows=[
    {...computeTenantCallDistribution(10,600,{id:1,platform_fee_bps:2000,platform_fee_ht_per_min:0}),payout_delay_days:7},
    {...computeTenantCallDistribution(5,300,{id:1,platform_fee_bps:2000,platform_fee_ht_per_min:0}),payout_delay_days:7}
  ];
  const x=summarizeTenantDistribution(rows);
  assert.equal(x.upstream_payout_ht,15);
  assert.equal(x.platform_fee_ht,3);
  assert.equal(x.net_payout_ht,12);
  assert.equal(x.unallocated_amount_ht,0);
  assert.equal(x.max_payout_delay_days,7);
  assert.equal(x.platform_fee_ht+x.net_payout_ht+x.unallocated_amount_ht,x.upstream_payout_ht);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,store,server,index,portal,api]=await Promise.all([
  readFile(new URL("../database/migrations/029_pgi_collected_revenue_distribution.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../index.html",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/api-client.js",import.meta.url),"utf8")
]);

test("Audiotel Premium Pro is visibly the settlement recipient before client payout",()=>{
  assert.match(server,/sva_payout_flow:"carrier_to_pgi_to_customer"/);
  assert.match(server,/pgi_margin_retained:true/);
  assert.match(server,/client_payout_compliance_gated:true/);
  assert.match(index,/OPÉRATEUR → AUDIOTEL PREMIUM PRO → CLIENT/);
  assert.doesNotMatch(index,/Les fonds SVA ne transitent pas par Audiotel Premium Pro/);
  assert.doesNotMatch(portal,/carrier_to_customer/);
});

test("database separates upstream revenue, PGI margin and client net",()=>{
  for(const token of ["tenant_payout_terms","tenant_revenue_distributions","tenant_revenue_distribution_calls","collection_model","platform_fee_bps","platform_fee_ht","net_payout_ht","unallocated_amount_ht"]){
    assert.ok(migration.includes(token),token);
  }
  assert.match(migration,/collection_model text NOT NULL DEFAULT 'pgi_collects'/);
  assert.match(migration,/platform_fee_ht \+ net_payout_ht \+ unallocated_amount_ht/);
  assert.match(migration,/tenant_number_assignments_payout_terms_gate/);
  assert.match(migration,/active external SVA assignment requires PGI payout terms/);
});

test("carrier settlement import automatically rebuilds tenant revenue distributions",()=>{
  assert.match(store,/async function rebuildTenantRevenueDistributions/);
  assert.match(store,/computeTenantCallDistribution/);
  assert.match(store,/summarizeTenantDistribution/);
  assert.match(store,/await rebuildTenantRevenueDistributions\(tx,row\.id/);
  assert.match(store,/await rebuildTenantRevenueDistributions\(tx,settlementId/);
  assert.match(store,/status="blocked_terms"|status=\"blocked_terms\"/);
  assert.match(store,/status="blocked_compliance"|status=\"blocked_compliance\"/);
  assert.match(store,/status="payable"|status=\"payable\"/);
});

test("client money cannot become payable before upstream receipt and compliance",()=>{
  assert.match(store,/const upstreamPaid=String\(first\.upstream_status\)===\"paid\"/);
  assert.match(store,/const kycOk=String\(first\.kyc_status\)===\"verified\"&&Boolean\(first\.bank_account_verified\)/);
  assert.match(store,/upstreamPaid&&complianceId&&kycOk/);
  assert.match(store,/funds_flow_mode IN \('platform_managed','psp_managed'\)/);
});

test("external SVA routing itself requires PGI payout terms",()=>{
  const occurrences=(store.match(/SVA_PAYOUT_TERMS_REQUIRED/g)||[]).length;
  assert.ok(occurrences>=2);
  assert.match(store,/selectCallDestination/);
  assert.match(store,/selectExpert/);
});

test("ported and newly activated external numbers require PGI payout terms",()=>{
  assert.match(store,/PORTABILITY_PAYOUT_TERMS_REQUIRED/);
  assert.match(store,/PAYOUT_TERMS_REQUIRED/);
  assert.match(store,/pgi_tenant_has_payout_terms/);
  assert.match(api,/createTenantPayoutTerms:function/);
  assert.match(server,/\/api\/v1\/platform\/tenants\/:id\/payout-terms/);
});

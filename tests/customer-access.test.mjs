import test from "node:test";
import assert from "node:assert/strict";
import {customerPermissions,hasCustomerPermission,requireCustomerPermission,scopeCustomerPortalData,scopeCustomerAnnualProgressData,CUSTOMER_ROLES} from "../backend/src/customer-access.mjs";

test("customer roles stay explicit and least-privilege",()=>{
  assert.deepEqual(CUSTOMER_ROLES,["owner","admin","finance","operator","analyst","readonly"]);
  assert.equal(hasCustomerPermission({customer_role:"owner"},"team.manage"),true);
  assert.equal(hasCustomerPermission({customer_role:"admin"},"team.manage"),true);
  assert.equal(hasCustomerPermission({customer_role:"finance"},"team.manage"),false);
  assert.equal(hasCustomerPermission({customer_role:"readonly"},"finance.read"),true);
  assert.equal(hasCustomerPermission({customer_role:"readonly"},"finance.export"),false);
});

test("explicit grants and denials override role defaults",()=>{
  assert.equal(hasCustomerPermission({customer_role:"analyst",permission_grants:["finance.export"]},"finance.export"),true);
  assert.equal(hasCustomerPermission({customer_role:"admin",permission_denials:["team.manage"]},"team.manage"),false);
  assert.deepEqual(customerPermissions({customer_role:"finance",permission_grants:["routing.read"],permission_denials:["finance.export"]}).includes("routing.read"),true);
});

test("permission guard fails closed",()=>{
  assert.throws(()=>requireCustomerPermission({customer_role:"readonly"},"team.manage"),e=>e.code==="CUSTOMER_PERMISSION_DENIED"&&e.status===403);
});

test("consolidated portal data is minimized by role permissions",()=>{
  const source={
    financial_by_currency:[{currency:"EUR",calls_total:4,generated_revenue_ttc:12}],
    metric_net_payout_by_currency:[{currency:"EUR",net_payout_ht:8}],
    series:[{bucket_date:"2026-09-22",calls_total:4,generated_revenue_ttc:12}],
    settlements:[{id:1,net_payout_ht:8}],
    subscriptions:[{id:1,status:"active",amount_minor:490,price_currency:"EUR",billing_currency:"EUR"}],
    numbers:[{id:1,display_number:"0890"}],
    destinations:[{id:1,label:"Accueil"}],
    portability_requests:[{id:1,status:"submitted"}],
    service_incidents:[{id:1,title:"Incident"}],
    operational_alerts:[{id:1,title:"Alerte"}]
  };
  const operations=scopeCustomerPortalData({customer_role:"operator"},source);
  assert.equal("generated_revenue_ttc" in operations.financial_by_currency[0],false);
  assert.equal(operations.settlements.length,0);
  assert.equal("amount_minor" in operations.subscriptions[0],false);
  assert.equal(operations.numbers.length,1);
  assert.equal(operations.service_incidents.length,1);
  const finance=scopeCustomerPortalData({customer_role:"finance"},source);
  assert.equal(finance.financial_by_currency[0].generated_revenue_ttc,12);
  assert.equal(finance.numbers.length,0);
  assert.equal(finance.destinations.length,0);
  assert.equal(finance.service_incidents.length,0);
});


test("customer responses never expose PGI internal commercial amounts",()=>{
  const source={
    financial_by_currency:[{currency:"EUR",generated_revenue_ttc:100,expected_payout_ht:70,estimated_client_net_ht:55}],
    live_financial_by_currency:[{currency:"EUR",active_calls:1,estimated_upstream_payout_ht:2,estimated_client_net_ht:1.5,upstream_rate_ht_per_second:.02,client_rate_ht_per_second:.015}],
    number_performance:[{calls_total:10,payout_term_matches:10,generated_revenue_ttc:100,expected_payout_ht:70,estimated_client_net_ht:55}],
    settlements:[{id:1,currency:"EUR",period_start:"2026-01-01",period_end:"2026-01-31",upstream_payout_ht:70,platform_fee_ht:15,net_payout_ht:55,unallocated_amount_ht:0,held_amount_ht:0,status:"paid"}]
  };
  const owner=scopeCustomerPortalData({customer_role:"owner"},source);
  const payload=JSON.stringify(owner);
  for(const forbidden of ["expected_payout_ht","upstream_payout_ht","platform_fee_ht","unallocated_amount_ht","estimated_upstream_payout_ht","upstream_rate_ht_per_second","payout_term_matches"])assert.equal(payload.includes(forbidden),false);
  assert.equal(owner.settlements[0].net_payout_ht,55);
  assert.equal(owner.number_performance[0].net_payout_available,true);
});

test("annual customer progress strips internal operator and PGI amounts",()=>{
  const scoped=scopeCustomerAnnualProgressData({
    summary:[{period:"current",currency:"EUR",calls_total:2,generated_revenue_ttc:20,expected_payout_ht:14,estimated_client_net_ht:11,payout_term_matches:2,net_available:true}],
    daily:[{period:"current",currency:"EUR",day_index:0,calls_total:2,generated_revenue_ttc:20,expected_payout_ht:14,estimated_client_net_ht:11,payout_term_matches:2,net_available:true}]
  });
  const payload=JSON.stringify(scoped);
  assert.equal(payload.includes("expected_payout_ht"),false);
  assert.equal(payload.includes("payout_term_matches"),false);
  assert.equal(scoped.summary[0].net_payout_available,true);
  assert.equal(scoped.daily[0].estimated_client_net_ht,11);
});

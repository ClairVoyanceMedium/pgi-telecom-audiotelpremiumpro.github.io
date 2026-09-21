import test from "node:test";
import assert from "node:assert/strict";
import {customerPermissions,hasCustomerPermission,requireCustomerPermission,scopeCustomerPortalData,CUSTOMER_ROLES} from "../backend/src/customer-access.mjs";

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
    subscriptions:[{id:1,status:"active",amount_minor:300,price_currency:"EUR",billing_currency:"EUR"}],
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

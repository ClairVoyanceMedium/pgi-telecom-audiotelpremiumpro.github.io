import test from "node:test";
import assert from "node:assert/strict";
import {customerPermissions,hasCustomerPermission,requireCustomerPermission,CUSTOMER_ROLES} from "../backend/src/customer-access.mjs";

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

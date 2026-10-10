import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {directSvaCustomerOverview,assertDirectSvaCustomerEnrollment} from "../backend/src/direct-sva-customer.mjs";
import {consolidateProviderNeutralBusinessLive} from "../backend/src/direct-sva-business-live-continuity.mjs";

const account=(tenant_id=101,overrides={})=>({
 tenant_id,business_unit:"direct_sva",access_state:"preparation",
 dashboard_enabled:false,client_contract_accepted:false,...overrides
});
function fakeStore({enrollment,enabled=false,cases=[],numbers=[]}={}){
 const queries=[];
 const store={readSql:{unsafe:async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.includes("FROM direct_sva_customer_accounts"))return enrollment?[enrollment]:[];
  if(sql.includes("FROM direct_sva_admin_switches"))return [{commercial_operation_enabled:enabled}];
  if(sql.includes("FROM direct_sva_customer_cases"))return cases;
  if(sql.includes("FROM direct_sva_number_inventory"))return numbers;
  throw new Error("UNEXPECTED_CUSTOMER_QUERY");
 }}};
 return {store,queries};
}
const released=tenant=>account(tenant,{access_state:"active",dashboard_enabled:true,client_contract_accepted:true});

test("a shared PGI identity never grants access to an unassigned Distribution account",async()=>{
 const x=fakeStore();
 await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:404,code:"DIRECT_SVA_CUSTOMER_ACCESS_NOT_ASSIGNED"});
 assert.equal(x.queries.length,1);
 assert.deepEqual(x.queries[0].args,[101]);
 assert.match(x.queries[0].sql,/business_unit='direct_sva'/);
});

test("prelaunch account, unsanctioned dashboard and absent contract stay inaccessible",async()=>{
 for(const row of [
   account(),account(101,{dashboard_enabled:true}),
   account(101,{access_state:"active",dashboard_enabled:true}),
   account(101,{access_state:"active",client_contract_accepted:true}),
   account(101,{client_contract_accepted:true,dashboard_enabled:true})
 ]){
  const x=fakeStore({enrollment:row,enabled:true});
  await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:403});
  assert.equal(x.queries.length,1,"never read cases/numbers on ineligible accounts");
 }
});

test("an Audiotel account accidentally returned by an adapter can never be shown",async()=>{
 const x=fakeStore({enrollment:account(101,{business_unit:"audiotel_platform",access_state:"active",dashboard_enabled:true,client_contract_accepted:true}),enabled:true});
 await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:403,code:"DIRECT_SVA_CUSTOMER_TENANT_MISMATCH"});
 assert.equal(x.queries.filter(x=>/FROM direct_sva_customer_cases|FROM direct_sva_number_inventory/.test(x.sql)).length,0);
});

test("a Distribution account belonging to another tenant cannot be rendered",async()=>{
 const x=fakeStore({enrollment:released(202),enabled:true});
 await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:403,code:"DIRECT_SVA_CUSTOMER_TENANT_MISMATCH"});
 assert.equal(x.queries.length,2);
});

test("operator commercial lock still blocks a fully eligible hypothetical Distribution customer",async()=>{
 const x=fakeStore({enrollment:released(101),enabled:false});
 await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:403,code:"DIRECT_SVA_CUSTOMER_NOT_RELEASED"});
 assert.equal(x.queries.length,2);
});

test("a future expressly authorized Distribution client receives only their records",async()=>{
 const x=fakeStore({enrollment:released(101),enabled:true,cases:[
  {tenant_id:101,public_reference:"DSVA-CASE001",request_kind:"portability",status:"prepared",initiated_at:new Date("2026-10-01T10:00:00Z"),last_review_at:null}
 ],numbers:[{editor_tenant_id:101,e164:"+33891234567",number_status:"reserved",regulatory_status:"unverified"}]});
 const r=await directSvaCustomerOverview(x.store,{tenant_id:101});
 assert.equal(r.business_unit,"direct_sva");
 assert.equal(r.tenant_scope,"authenticated_customer_only");
 assert.equal(r.source,"direct_sva_only");
 assert.equal(r.client_payouts_enabled,false);
 assert.equal(r.number_provisioning_enabled,false);
 assert.equal(r.account_access,"contract_verified_read_only");
 assert.equal(r.cases.length,1);
 assert.equal(r.numbers.length,1);
 assert.deepEqual(x.queries.map(q=>q.args),[[101],[],[101],[101]]);
 assert.ok(x.queries[2].sql.includes("WHERE tenant_id=$1"));
 assert.ok(x.queries[3].sql.includes("WHERE editor_tenant_id=$1"));
 assert.ok(!JSON.stringify(r).includes("editor_tenant_id"));
});

test("a faulty database adapter returning another tenant's case or number fails the entire response",async()=>{
 for(const change of ["case","number"]){
  const x=fakeStore({enrollment:released(101),enabled:true,
   cases:[{tenant_id:change==="case"?202:101,public_reference:"DSVA-CASE001",request_kind:"new_number",status:"prepared",initiated_at:new Date()}],
   numbers:[{editor_tenant_id:change==="number"?202:101,e164:"+33891234567",number_status:"reserved",regulatory_status:"unverified"}]
  });
  await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id:101}),{status:503,code:"DIRECT_SVA_CROSS_TENANT_RESULT_BLOCKED"});
 }
});

test("invalid, ambiguous or non-user tenant identities are always rejected before database access",async()=>{
 for(const tenant_id of [undefined,null,false,true,0,-1,1.1,{},[],"","01","1e2"," 101","101 ","-1","0","9007199254740995"]){
  const x=fakeStore({enrollment:released(101),enabled:true});
  await assert.rejects(()=>directSvaCustomerOverview(x.store,{tenant_id}),{status:403});
  assert.equal(x.queries.length,0,"invalid tenant must not hit DB");
 }
});

test("Business Live continuity never accepts other tenant call records or unverified source",()=>{
 const context={tenant_id:101,sva_number_id:99,source_host_carrier_id:11,target_host_carrier_id:12,
  operator_cutover_verified:true,cdr_source_verified:true,
  actual_cutover_at:"2026-10-10T12:00:00Z",business_live_reset_at:"2026-10-10T00:00:00Z"};
 const row={tenant_id:202,sva_number_id:99,host_carrier_id:12,canonical_call_key:"CALL-BIZ-00001",
  started_at:"2026-10-10T12:30:00Z",billable_seconds:120,expected_client_net_minor:50,confirmed_client_net_minor:null,paid_client_net_minor:null};
 assert.throws(()=>consolidateProviderNeutralBusinessLive([row],context),{code:"CONTINUITY_CROSS_TENANT_OR_NUMBER"});
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...row,tenant_id:101}],{...context,cdr_source_verified:false}),{code:"CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER"});
 const result=consolidateProviderNeutralBusinessLive([{...row,tenant_id:101},{...row,tenant_id:101}],context);
 assert.equal(result.client_view.calls,1,"replayed CDR must never increase Business Live");
 assert.equal(result.client_view.confirmed_client_net_minor,0);
 assert.equal(result.client_view.paid_client_net_minor,0);
 assert.equal(result.external_network_switch_executed,false);
 assert.equal(result.existing_customer_account_changed,false);
});

test("client portal cannot bypass the backend prelaunch guard or expose private pages to indexing",()=>{
 const backend=fs.readFileSync("backend/server.mjs","utf8");
 const page=fs.readFileSync("site/distribution-sva/espace-client/index.html","utf8");
 assert.match(backend,/pathname\.startsWith\("\/api\/v1\/customer\/direct-sva\/"\)/);
 assert.match(backend,/DIRECT_SVA_PREPARATION_DISABLED/);
 assert.match(backend,/requireActor\(customerActor\)/);
 assert.match(backend,/requireCustomerPermission\(context,"overview\.read"\)/);
 assert.match(page,/<meta name="robots" content="noindex,nofollow,noarchive">/);
 assert.match(page,/href="\/client\.html"/);
});

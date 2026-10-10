import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {withDirectSvaTenantRead} from "../backend/src/direct-sva-tenant-rls-reader.mjs";
function mock({user="pgi_dsva_tenant_reader",bypass=false}={}){
 const log=[];
 const store={readSql:{begin:async fn=>fn({unsafe:async(sql,args=[])=>{
  log.push({sql,args});
  if(sql.startsWith("SELECT current_user"))return [{name:user,bypass}];
  if(sql.startsWith("SELECT tenant_id FROM direct_sva_customer_cases"))
   return log.some(x=>x.sql.includes("set_config"))?[{tenant_id:101}]:[];
  return [];
 }})}};
 return {store,log};
}
test("transaction reader sets fixed role, tenant GUC and checks BYPASSRLS=false",async()=>{
 const {store,log}=mock();
 const result=await withDirectSvaTenantRead(store,101,async(tx,id)=>{
  assert.equal(id,101);
  return tx.unsafe("SELECT tenant_id FROM direct_sva_customer_cases WHERE tenant_id=$1",[id]);
 });
 assert.deepEqual(result,[{tenant_id:101}]);
 assert.equal(log[0].sql,"SET LOCAL ROLE pgi_dsva_tenant_reader");
 assert.deepEqual(log[1].args,["101"]);
 assert.match(log[1].sql,/set_config\('app\.pgi_dsva_tenant_id'/);
 assert.equal(log[2].sql.startsWith("SELECT current_user"),true);
});
test("owner and BYPASSRLS roles are rejected even if a query adapter is confused",async()=>{
 for(const record of [{user:"pgi_telecom_owner",bypass:true},{user:"pgi_dsva_tenant_reader",bypass:true}]){
  const {store}=mock(record);
  await assert.rejects(()=>withDirectSvaTenantRead(store,101,async()=>1),/DIRECT_SVA_RLS_ROLE_VERIFICATION_FAILED/);
 }
});
test("invalid tenant inputs cannot reach the database",async()=>{
 for(const id of [true,0,-1,1.2,"1e2","001"," 101 ",null,{},[],undefined]){
  const {store,log}=mock();
  await assert.rejects(()=>withDirectSvaTenantRead(store,id,async()=>1));
  assert.equal(log.length,0);
 }
});
test("failure to start a transaction or verify a role always blocks access",async()=>{
 await assert.rejects(()=>withDirectSvaTenantRead({},101,async()=>1),/DIRECT_SVA_TRANSACTIONAL_READER_REQUIRED/);
 const store={readSql:{begin:async cb=>cb({unsafe:async(sql)=>sql.startsWith("SELECT current_user")?[]:[]})}};
 await assert.rejects(()=>withDirectSvaTenantRead(store,101,async()=>1),/DIRECT_SVA_RLS_ROLE_VERIFICATION_FAILED/);
});
test("prototype remains outside autoloaded migrations and forbids publication assumptions",()=>{
 const sql=fs.readFileSync("database/security/rls-distribution-prototype.sql","utf8");
 const app=fs.readFileSync("backend/src/direct-sva-customer.mjs","utf8");
 assert.match(sql,/NOBYPASSRLS/);
 assert.match(sql,/pgi\.isolated_rls_test/);
 assert.doesNotMatch(app,/withDirectSvaTenantRead/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/current_setting\('app\.pgi_dsva_tenant_id'/);
});

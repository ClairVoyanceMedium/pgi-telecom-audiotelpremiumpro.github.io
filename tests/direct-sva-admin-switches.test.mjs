import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
 getDirectSvaSwitches,setDirectSvaPreview,setDirectSvaCommercial
} from "../backend/src/direct-sva-admin-switches.mjs";

const admin={role:"admin",sub:"operator-admin-1"};
const reference="ADMIN-UI-20261010-00001";

function mockStore({preview=false,commercial=false}={}){
 const table={
  interface_preview_enabled:preview,
  commercial_operation_enabled:commercial,
  last_changed_at:"2026-10-10T13:00:00Z"
 };
 const statements=[],audits=[];
 const sql={
  unsafe:async (query,args=[])=>{
   statements.push({query,args});
   if(query.includes("FROM direct_sva_admin_switches"))return [{...table}];
   throw Error("unexpected statement");
  },
  begin:async callback=>callback({
   unsafe:async (query,args=[])=>{
    statements.push({query,args});
    if(query.includes("FROM direct_sva_admin_switches"))return [{...table}];
    if(query.startsWith("UPDATE direct_sva_admin_switches")){table.interface_preview_enabled=args[0];return [];}
    if(query.startsWith("INSERT INTO direct_sva_admin_switch_audit")){
     audits.push({query,args});return [];
    }
    throw Error("unexpected statement");
   }
  })
 };
 return {store:{sql},table,statements,audits};
}

test("two switches begin disabled, commercial cannot be enabled from the interface",async()=>{
 const {store}=mockStore();
 const result=await getDirectSvaSwitches(store);
 assert.equal(result.interface_preview_enabled,false);
 assert.equal(result.commercial_operation_enabled,false);
 assert.equal(result.commercial_activation_locked,true);
 assert.equal(result.launch_complete,false);
 assert.equal(result.preview_scope,"authenticated_admin_only");
 assert.equal(result.current_audiotel_unchanged,true);
 assert.equal(Object.keys(result.readiness).length,6);
});

test("only authenticated admin can change private preview",async()=>{
 const {store}=mockStore();
 for(const actor of [null,{role:"finance",sub:"bob"},{role:"readonly",sub:"bob"},{role:"admin",sub:""}]){
  await assert.rejects(
   ()=>setDirectSvaPreview(store,actor,{enabled:true,expected_enabled:false,evidence_reference:reference}),
   {code:"DIRECT_SVA_ADMIN_REQUIRED"}
  );
 }
});

test("preview switch toggles ON and OFF with persistent audit and no business effect",async()=>{
 const {store,table,audits,statements}=mockStore();
 const a=await setDirectSvaPreview(store,admin,{enabled:true,expected_enabled:false,evidence_reference:reference});
 assert.equal(a.interface_preview_enabled,true);
 assert.equal(a.changed,true);
 assert.equal(table.interface_preview_enabled,true);
 assert.equal(a.commercial_operation_enabled,false);
 assert.equal(a.side_effects_executed,false);
 assert.equal(a.activation_authorized,false);
 assert.equal(audits.length,1);
 assert.match(audits[0].args[4],/^[a-f0-9]{64}$/);
 assert.equal(audits[0].args[5],reference);
 const b=await setDirectSvaPreview(store,admin,{enabled:false,expected_enabled:true,evidence_reference:reference});
 assert.equal(b.interface_preview_enabled,false);
 assert.equal(table.interface_preview_enabled,false);
 assert.equal(audits.length,2);
 assert.equal(statements.some(x=>/stripe|hubspot|transfer|sva_number_inventory|call_routing/.test(x.query)),false);
});

test("simultaneous stale clicks are rejected, not silently overwritten",async()=>{
 const {store,table,audits}=mockStore();
 await setDirectSvaPreview(store,admin,{enabled:true,expected_enabled:false,evidence_reference:reference});
 await assert.rejects(()=>setDirectSvaPreview(store,admin,
  {enabled:false,expected_enabled:false,evidence_reference:reference}),
  {code:"DIRECT_SVA_SWITCH_STATE_CHANGED_REFRESH"});
 assert.equal(table.interface_preview_enabled,true);
 assert.equal(audits.length,1);
});

test("malformed switch payloads are refused",async()=>{
 const {store}=mockStore();
 await assert.rejects(()=>setDirectSvaPreview(store,admin,{enabled:"true",expected_enabled:false,evidence_reference:reference}),{status:400});
 await assert.rejects(()=>setDirectSvaPreview(store,admin,{enabled:true,expected_enabled:0,evidence_reference:reference}),{status:400});
 await assert.rejects(()=>setDirectSvaPreview(store,admin,{enabled:true,expected_enabled:false,evidence_reference:"x"}),{status:400});
});

test("commercial launch switch strictly refuses activation even for admin",async()=>{
 const {store,table,statements}=mockStore({preview:true});
 await assert.rejects(()=>setDirectSvaCommercial(store,admin,{enabled:true}),{
  status:409,code:"DIRECT_SVA_COMMERCIAL_APPROVALS_INCOMPLETE"
 });
 assert.equal(table.commercial_operation_enabled,false);
 assert.equal(statements.length,0);
 const off=await setDirectSvaCommercial(store,admin,{enabled:false});
 assert.equal(off.commercial_operation_enabled,false);
 assert.equal(off.changed,false);
 assert.equal(off.side_effects_executed,false);
});

test("DB commercial mismatch fails closed, including when preview is enabled",async()=>{
 const {store}=mockStore({preview:true,commercial:true});
 await assert.rejects(()=>getDirectSvaSwitches(store),{code:"DIRECT_SVA_COMMERCIAL_STATE_INVALID"});
 await assert.rejects(()=>setDirectSvaPreview(store,admin,{enabled:false,expected_enabled:true,evidence_reference:reference}),{
  code:"DIRECT_SVA_COMMERCIAL_STATE_INVALID"
 });
});

test("database migration is append-only, singleton and forbids commercial operation",()=>{
 const text=fs.readFileSync(new URL("../database/migrations/076_direct_sva_admin_switches.sql",import.meta.url),"utf8");
 assert.match(text,/interface_preview_enabled boolean NOT NULL DEFAULT false/);
 assert.match(text,/commercial_operation_enabled boolean NOT NULL DEFAULT false\s+CHECK \(commercial_operation_enabled=false\)/);
 assert.match(text,/PRIMARY KEY DEFAULT 1 CHECK \(id=1\)/);
 assert.match(text,/direct_sva_admin_switch_audit/);
 assert.match(text,/direct_sva_guard_admin_switch_audit_immutable/);
 assert.doesNotMatch(text,/\bDROP\s+TABLE|\bALTER TABLE|\bTRUNCATE|\bDELETE FROM/i);
});

test("API requires admin and CSRF and remains separated from operator activation routes",()=>{
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 for(const route of [
  "/api/v1/platform/direct-sva-switches",
  "/api/v1/platform/direct-sva-switches/interface",
  "/api/v1/platform/direct-sva-switches/commercial"
 ])assert.ok(server.includes('pathname==="'+route+'"'));
 assert.match(server,/setDirectSvaPreview\(store,actor,body\)/);
 assert.match(server,/setDirectSvaCommercial\(store,actor,body\)/);
 const excerpt=server.slice(server.indexOf('pathname==="/api/v1/platform/direct-sva-switches"'),server.indexOf('if(method==="GET"&&pathname==="/api/v1/customer/security/passkeys"'));
 assert.ok((excerpt.match(/requireRole\(actor,\["admin"\]\)/g)||[]).length>=3);
 assert.ok((excerpt.match(/requireCsrf\(req,actor,config\)/g)||[]).length>=2);
 assert.match(excerpt,/directSwitchState\.interface_preview_enabled/);
 assert.match(excerpt,/DIRECT_SVA_PREPARATION_DISABLED/);
 assert.match(excerpt,/pathname\.startsWith\("\/api\/v1\/customer\/direct-sva\/"\)/);
});

test("admin UI has two accessible toggle controls and lazy module loading",()=>{
 const ui=fs.readFileSync(new URL("../assets/direct-sva-switches.js",import.meta.url),"utf8");
 const acct=fs.readFileSync(new URL("../assets/accounting-cockpit.js",import.meta.url),"utf8");
 const builder=fs.readFileSync(new URL("../scripts/build-static.mjs",import.meta.url),"utf8");
 assert.match(ui,/data-dss-preview/);
 assert.match(ui,/data-dss-commercial/);
 assert.match(ui,/role="switch"/);
 assert.match(ui,/disabled aria-disabled="true"/);
 assert.match(ui,/Exploitation commerciale SVA directe/);
 assert.match(ui,/credentials:"include"/);
 assert.match(ui,/X-CSRF-Token/);
 assert.match(acct,/import\("\.\/direct-sva-switches\.js"\)/);
 assert.match(acct,/privatePreviewEnabled===true/);
 assert.match(acct,/renderDirectAdminSwitches/);
 assert.match(builder,/"assets\/direct-sva-switches\.js"/);
 assert.match(builder,/"assets\/direct-sva-cockpit\.js"/);
});

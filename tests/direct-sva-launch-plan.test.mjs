import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {DIRECT_SVA_RELEASE_SEQUENCE,evaluateDirectSvaReleasePlan} from "../backend/src/direct-sva-launch-plan.mjs";
import {DIRECT_SVA_OPERATOR_GATES} from "../backend/src/direct-sva-operator-readiness.mjs";

test("direct SVA release remains entirely disabled with no evidence",()=>{
 const result=evaluateDirectSvaReleasePlan({},new Date("2026-10-10T05:00:00Z"));
 assert.equal(result.business_unit,"direct_sva");
 assert.equal(result.legal_entity_count,1);
 assert.equal(result.steps.length,8);
 assert.equal(result.eligible_for_external_final_review,false);
 assert.equal(result.site_publication_permitted,false);
 assert.equal(result.customer_portal_activation_permitted,false);
 assert.equal(result.direct_numbers_activation_permitted,false);
 assert.equal(result.finance_transfer_permitted,false);
 assert.equal(result.crm_write_permitted,false);
 assert.equal(result.production_deployment_permitted,false);
});

test("no documentary fixture may force a deploy even if all checkboxes are true",()=>{
 const now=new Date("2026-10-10T05:00:00Z");
 const operator_evidence=Object.fromEntries(DIRECT_SVA_OPERATOR_GATES.map(g=>[g.key,{
  status:"verified",issuer:g.issuer,reference:"DOC-FAKE-TEST-00001",
  verified_at:"2026-10-09T05:00:00Z"
 }]));
 const names=["google_analytics","google_search_console","hubspot","accounting","sva_network","payments"];
 const integration_evidence=Object.fromEntries(names.map(k=>[k,{status:"verified",reference:"DOC-FAKE-TEST-00002"}]));
 const completed_steps=Object.fromEntries(DIRECT_SVA_RELEASE_SEQUENCE.map(t=>[t.step,{approved:true,reference:"DOC-FAKE-TEST-00003"}]));
 const result=evaluateDirectSvaReleasePlan({operator_evidence,integration_evidence,completed_steps,
  owner_approval:{explicit:true,reference:"TOP-DEPART-TEST-FAKE"}},now);
 assert.equal(result.legal_review_proofs_complete,true);
 assert.equal(result.crm_analytics_proofs_complete,true);
 assert.equal(result.technical_steps_documented,true);
 assert.equal(result.owner_top_depart_recorded,true);
 assert.equal(result.eligible_for_external_final_review,true);
 assert.equal(result.production_deployment_permitted,false);
 assert.equal(result.site_publication_permitted,false);
 assert.equal(result.finance_transfer_permitted,false);
});

test("staged navigation does not link the future distributor from live website",()=>{
 const builder=fs.readFileSync(new URL("../scripts/build-static.mjs",import.meta.url),"utf8");
 const future=fs.readFileSync(new URL("../site/distribution-sva/index.html",import.meta.url),"utf8");
 const home=fs.readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
 assert.match(future,/Navigation de la distribution directe/);
 assert.ok(!home.includes('href="/distribution-sva/"'));
 assert.ok(!builder.includes('"site/distribution-sva/index.html"'));
});

test("server navigation remains independently gated from the normal customer portal",()=>{
 const source=fs.readFileSync(new URL("../backend/src/static-site.mjs",import.meta.url),"utf8");
 assert.match(source,/site\\\/distribution-sva/);
 assert.match(source,/Cache-Control":"no-store"/);
 assert.match(source,/clientUi=requestPath==="\/client.html"\|\|/);
 assert.match(source,/X-Robots-Tag":"noindex, nofollow, noarchive"/);
});

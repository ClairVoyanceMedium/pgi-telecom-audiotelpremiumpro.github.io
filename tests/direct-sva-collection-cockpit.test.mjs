// Tests distributor-only route and cockpit safe preview. No real receipt is created.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {assertDirectSvaCockpitPayload} from "../assets/direct-sva-cockpit.js";
import {prepareDirectSvaCollectionAccounting} from "../backend/src/direct-sva-collection-planner.mjs";

const statement={operator_reference:"OPERATEUR-FICTIF",statement_reference:"RELEVE-FICTIF",
 period:"2026-10",currency:"EUR",rows:[
  {cdr_reference:"APPEL-FICTIF-001",called_number:"+33891234567",billable_seconds:60,
   upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800}
 ]};
const receipt={reference:"ENCAISSEMENT-FICTIF",operator_reference:"OPERATEUR-FICTIF",
 statement_reference:"RELEVE-FICTIF",bank_statement_reference:"EXTRAIT-FICTIF-BANQUE",
 booking_date:"2026-10-10",amount_minor:300,currency:"EUR"};
function response(){
 return prepareDirectSvaCollectionAccounting({
  statement,receipts:[receipt],recognition_date:"2026-10-09",
  contract_model:"intermediary_net_preview"
 });
}
const invalid={message:"DIRECT_SVA_COCKPIT_RESPONSE_INVALID"};

test("cash preview is accepted in the distributor cockpit only as an unverified plan",()=>{
 const out=response();
 assert.equal(assertDirectSvaCockpitPayload(out,"collection"),out);
 assert.equal(out.bank_confirmation_verified,false);
});
test("a claimed bank confirmation is forbidden in the preparation cockpit",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({...response(),bank_confirmation_verified:true},"collection"),invalid);
});
test("a claimed payout capability is forbidden in the preparation cockpit",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({...response(),payout_authorized:true},"collection"),invalid);
});
test("mismatched operator margin amounts cannot render",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({...response(),total_pgi_margin_preview_minor:400},"collection"),invalid);
});
test("missing booking lines cannot render in the accounting preview",()=>{
 const a=response();
 assert.throws(()=>assertDirectSvaCockpitPayload({...a,journal_proposals:[
  {...a.journal_proposals[0],lines:a.journal_proposals[0].lines.slice(0,1)}
 ]},"collection"),invalid);
});
test("the API is private, CSRF protected and returns pure preview",()=>{
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/collections\/preview"/);
 assert.match(server,/requireRole\(actor,\["admin","finance"\]\);requireCsrf\(req,actor,config\)/);
 assert.match(server,/prepareDirectSvaCollectionAccounting\(body\)/);
});
test("the distributor cockpit provides a distinct manual simulation area",()=>{
 const src=fs.readFileSync(new URL("../assets/direct-sva-cockpit.js",import.meta.url),"utf8");
 assert.match(src,/data-ds-collection-payload/);
 assert.match(src,/data-ds-collection-preview/);
 assert.match(src,/showCollectionPreview\(assertDirectSvaCockpitPayload\(result,"collection"\)\)/);
 assert.match(src,/aucune écriture enregistrée, aucun paiement/);
});

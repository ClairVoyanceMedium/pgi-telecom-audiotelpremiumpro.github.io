import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root=new URL("../",import.meta.url);
const pageDirs=[
  "", "business-live/", "conditions/", "confidentialite/", "conformite/",
  "espace-client/", "mentions-legales/", "reclamations/", "solutions/", "transition/"
];

test("all future distribution pages use the distinct PGI Telecom Distribution brand",()=>{
  for(const dir of pageDirs){
    const page=fs.readFileSync(new URL("site/distribution-sva/"+dir+"index.html",root),"utf8");
    assert.match(page,/<strong>PGI Telecom Distribution<\/strong>/,"header "+dir);
    assert.match(page,/<title>[^<]*PGI Telecom Distribution[^<]*<\/title>/,"title "+dir);
    assert.match(page,/PGI Telecom Distribution\. Tous droits réservés\./,"footer "+dir);
    assert.doesNotMatch(page,/PGI Telecom \| Distribution directe SVA\. Tous droits réservés\./,"outdated footer "+dir);
    assert.match(page,/Audiotel Premium Pro/,"the existing Audiotel business remains clearly named "+dir);
    assert.doesNotMatch(page,/<strong>PGI Telecom<\/strong><small>(?:Distribution directe SVA|Future distribution SVA)/,"outdated header "+dir);
  }
});

test("the historical Audiotel site and accounting heading keep their original identity",()=>{
  const current=fs.readFileSync(new URL("site/index.html",root),"utf8");
  assert.match(current,/Audiotel Premium Pro/);
  assert.doesNotMatch(current,/PGI Telecom Distribution/);
  const accounting=fs.readFileSync(new URL("assets/accounting-cockpit.js",root),"utf8");
  assert.match(accounting,/Pilotage comptable Audiotel Premium Pro/);
  assert.match(accounting,/Comptabilité PGI Telecom Distribution/);
});

test("the two business units retain separate canonical technical identifiers",()=>{
  const integrations=fs.readFileSync(new URL("backend/src/direct-sva-integrations.mjs",root),"utf8");
  assert.match(integrations,/key:"audiotel_platform",label:"Audiotel Premium Pro"/);
  assert.match(integrations,/key:"direct_sva",label:"PGI Telecom Distribution"/);
  assert.match(integrations,/dealname:"PGI Telecom Distribution "\+planned\.source_reference/);
});

test("migration 080 renames only direct_sva, without opening the commercial activity",()=>{
  const migration=fs.readFileSync(new URL("database/migrations/080_pgi_telecom_distribution_brand.sql",root),"utf8");
  assert.match(migration,/UPDATE pgi_company_business_units\s+SET display_name='PGI Telecom Distribution'/);
  assert.match(migration,/WHERE unit_code='direct_sva'/);
  assert.match(migration,/AND lifecycle_status='preparation'/);
  assert.doesNotMatch(migration,/\b(?:DELETE|DROP|TRUNCATE|ALTER)\s+(?:TABLE|FROM)/i);
  assert.equal((migration.match(/\bUPDATE pgi_company_business_units\b/g)||[]).length,1);
});

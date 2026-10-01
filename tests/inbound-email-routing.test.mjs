import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const hubspot=read("backend/src/hubspot-crm.mjs");
const resend=read("backend/src/resend-email.mjs");
const dispatcher=read("backend/src/email-dispatcher.mjs");
const migration=read("database/migrations/063_email_thread_customer_resolution.sql");

test("les réponses email se rattachent au bon dossier sans faire confiance à une simple référence APP",()=>{
  assert.match(migration,/provider_message_id/);
  assert.match(migration,/CREATE TABLE inbound_email_correlations/);
  assert.match(migration,/Stores no email body/i);
  assert.match(store,/resolveInboundCustomerEmail/);
  assert.match(store,/sender_plus_dossier/);
  assert.match(store,/sender_exact/);
  assert.match(store,/dossier_hint/);
  assert.match(store,/customer\.email\.inbound_resolved/);
  assert.match(store,/body_logged:false/);
  assert.match(dispatcher,/provider_message_id=COALESCE/);
  assert.match(resend,/in-reply-to/);
  assert.match(resend,/references/);
  assert.match(resend,/resolveCustomer/);
  assert.match(server,/syncHubSpotInboundEmail/);
  assert.match(server,/resolveInboundCustomerEmail/);
});

test("HubSpot reçoit le dossier depuis PostgreSQL et le rend repérable dans la transaction",()=>{
  assert.match(server,/syncHubSpotCommercialTenant\(store,registered\.tenant_public_id/);
  assert.match(hubspot,/dossier_ref:clean\(detail\?\.tenant\?\.dossier_ref/);
  assert.match(hubspot,/dealName/);
  assert.match(hubspot,/Email entrant rattaché automatiquement au dossier PGI/);
  assert.match(hubspot,/Référence dossier/);
});

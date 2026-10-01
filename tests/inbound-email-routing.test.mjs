import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const hubspot=read("backend/src/hubspot-crm.mjs");
const resend=read("backend/src/resend-email.mjs");
const dispatcher=read("backend/src/email-dispatcher.mjs");

test("les réponses email se rattachent au bon dossier sans faire confiance à une simple référence APP",()=>{
  assert.match(dispatcher,/jsonb_build_object\('provider_message_id'/);
  assert.match(store,/metadata->>'provider_message_id'/);
  assert.match(store,/resolveInboundCustomerEmail/);
  assert.match(store,/sender_plus_dossier/);
  assert.match(store,/sender_exact/);
  assert.match(store,/dossier_hint/);
  assert.match(store,/customer\.email\.inbound_resolved/);
  assert.match(store,/body_logged:false/);
  assert.match(resend,/in-reply-to/);
  assert.match(resend,/references/);
  assert.match(resend,/resolveCustomer/);
  assert.match(server,/syncHubSpotInboundEmail/);
  assert.match(server,/resolveInboundCustomerEmail/);
});

test("HubSpot conserve le dossier existant comme contexte sans transformer le support en transaction commerciale",()=>{
  assert.match(server,/syncHubSpotCommercialTenant\(store,registered\.tenant_public_id/);
  assert.match(hubspot,/dossier_ref:clean\(detail\?\.tenant\?\.dossier_ref/);
  assert.match(hubspot,/Email entrant de support rattaché automatiquement/);
  assert.match(hubspot,/Référence dossier existante/);
  const start=hubspot.indexOf("export async function syncHubSpotInboundEmail");
  const end=hubspot.indexOf("export async function syncHubSpotCustomerIncident",start);
  const source=hubspot.slice(start,end);
  assert.match(source,/ensureSupportTicket/);
  assert.doesNotMatch(source,/syncHubSpotCommercialTenant/);
  assert.doesNotMatch(source,/ensureCommercialDeal/);
});

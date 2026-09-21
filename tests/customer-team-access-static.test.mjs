import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const premium=fs.readFileSync("assets/client-premium-plus.js","utf8");
const api=fs.readFileSync("assets/client-portal-api.js","utf8");
const visibility=fs.readFileSync("assets/client-access-visibility.js","utf8");
const teamUi=fs.readFileSync("assets/client-team-access.js","utf8");
const migration=fs.readFileSync("database/migrations/054_customer_team_access.sql","utf8");
const worker=fs.readFileSync("service-worker.js","utf8");

test("customer team access stays server-authorized",()=>{
  assert.match(server,/\/api\/v1\/customer\/team/);
  assert.match(server,/requireCustomerPermission\(context,"team\.manage"\)/);
  assert.match(server,/CUSTOMER_OWNER_REQUIRED/);
  assert.match(server,/customerSessionCookie\(issued\.token/);
  assert.match(server,/scopeCustomerPortalData\(context,rawData\)/);
  assert.match(store,/LAST_CUSTOMER_OWNER_REQUIRED/);
  assert.match(store,/SELF_ACCESS_CHANGE_FORBIDDEN/);
  assert.match(store,/permission_grants,m\.permission_denials/);
});

test("team access changes remain append-only and auditable",()=>{
  assert.match(migration,/CREATE TABLE customer_tenant_access_events/);
  assert.match(migration,/append-only/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON customer_tenant_access_events/);
  assert.match(store,/invitation_created/);
  assert.match(store,/member_role_changed/);
  assert.match(store,/member_status_changed/);
  assert.match(store,/invitation_revoked/);
});

test("team UI is Premium+ lazy content, not critical PWA shell",()=>{
  assert.match(premium,/label:"Équipe"/);
  assert.match(premium,/import\("\.\/client-team-access\.js"\)/);
  assert.doesNotMatch(worker,/assets\/client-team-access\.js|assets\/client-access-visibility\.js/);
  assert.doesNotMatch(api,/\/customer\/team/);
  assert.match(teamUi,/\/customer\/team/);
  assert.match(teamUi,/Idempotency-Key/);
  assert.match(visibility,/finance\.read/);
  assert.match(visibility,/routing\.read/);
  assert.match(visibility,/incidents\.read/);
  assert.match(teamUi,/Aucun e-mail automatique n’a été envoyé/);
  assert.match(teamUi,/Copier le lien/);
  assert.doesNotMatch(teamUi,/activationLink=activationLink/);
});

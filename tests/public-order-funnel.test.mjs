import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const site=fs.readFileSync("site/site.js","utf8");
const audience=fs.readFileSync("assets/client-audience.js","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");

test("public order intent is private, short-lived and consumed by registration",()=>{
  assert.match(site,/pgi_public_order_intent_v1/);
  assert.match(site,/sessionStorage\.setItem/);
  assert.match(audience,/age>3600000/);
  assert.match(audience,/sessionStorage\.removeItem/);
  assert.match(audience,/register-first-name/);
  assert.match(audience,/register-email/);
  assert.match(audience,/dataset\.acquisitionSource="public_marketing_site"/);
});

test("client registration carries acquisition source and service intent",()=>{
  assert.match(portal,/acquisition_source:/);
  assert.match(portal,/service_intent:/);
  assert.match(portal,/params\.get\("register"\)==="1"/);
  assert.match(store,/public_marketing_site/);
  assert.match(store,/serviceIntent/);
  assert.match(store,/\["new_number","portability","advice"\]/);
  assert.match(store,/signup_source:acquisitionSource==="public_marketing_site"\?"public_marketing_site":"self_service_email"/);
});

test("GitHub Pages registration preview never pretends a real request was sent",()=>{
  assert.match(audience,/aucune demande réelle n’est envoyée depuis GitHub Pages/);
  assert.match(audience,/mode==="demo"/);
});

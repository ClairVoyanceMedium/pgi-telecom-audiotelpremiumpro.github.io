import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const site=fs.readFileSync("site/site.js","utf8");
const siteHtml=fs.readFileSync("site/index.html","utf8");
const audience=fs.readFileSync("assets/client-audience.js","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const api=fs.readFileSync("assets/client-portal-api.js","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");

test("public order intent is private, short-lived and consumed by registration",()=>{
  assert.match(site,/pgi_public_order_intent_v1/);
  assert.match(site,/sessionStorage\.setItem/);
  assert.match(audience,/age>3600000/);
  assert.match(audience,/sessionStorage\.removeItem/);
  assert.match(audience,/register-first-name/);
  assert.match(audience,/register-email/);
  assert.match(audience,/PGIOrderMeta=\{acquisition_source:"public_marketing_site"/);
  assert.match(site,/sessionStorage\.setItem/);
  assert.match(site,/catch\(_e\).*hidden=false;return/s);
  assert.match(site,/button\[type="submit"\]/);
  assert.match(siteHtml,/id="order-status"/);
  assert.match(siteHtml,/JavaScript doit être activé/);
});

test("client registration prevents duplicate button submits while request is pending",()=>{
  assert.match(portal,/var b=e\.submitter/);
  assert.match(portal,/b\.disabled=true/);
  assert.match(portal,/finally\{/);
  assert.match(portal,/b\.disabled=false/);
});

test("client registration carries acquisition source and service intent",()=>{
  assert.match(api,/PGIOrderMeta/);
  assert.match(portal,/location\.search\.includes\("register=1"\)/);
  assert.match(store,/public_marketing_site/);
  assert.match(store,/serviceIntent/);
  assert.match(store,/\["new_number","portability","advice"\]/);
  assert.match(store,/signup_source:acquisitionSource==="public_marketing_site"\?"public_marketing_site":"self_service_email"/);
});

test("GitHub Pages registration preview never pretends a real request was sent",()=>{
  assert.match(audience,/aucune demande réelle n’est envoyée depuis GitHub Pages/);
  assert.match(audience,/mode==="demo"/);
});

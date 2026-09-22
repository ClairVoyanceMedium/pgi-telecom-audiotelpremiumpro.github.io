import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const store=read("backend/src/store-postgres.mjs");
const access=read("backend/src/customer-access.mjs");
const adminHtml=read("index.html");
const adminJs=read("assets/app.js");
const jackpot=read("assets/live-revenue-jackpot.js");
const clientHtml=read("client.html");
const clientPremium=read("assets/client-premium.js");
const marketing=read("site/index.html");
const build=read("scripts/build-static.mjs");
const size=read("scripts/check-size.mjs");

test("live revenue uses current carrier and tenant commercial terms",()=>{
  for(const token of [
    "live_upstream_estimate_ht","live_platform_margin_estimate_ht","live_client_net_estimate_ht",
    "live_payout_estimate","carrier_contracts","tenant_payout_terms","net_payout_rate_per_second"
  ])assert.ok(store.includes(token),token);
  assert.match(store,/active_route_elapsed_time_and_current_contract_terms/);
  assert.match(store,/call_destination\.busy/);
  assert.match(store,/expert\.busy/);
});

test("client live finance stays permission-gated and explicitly provisional",()=>{
  assert.match(access,/out\.live_payout_estimate=null/);
  for(const id of ["client-live-earnings","client-live-amount","client-live-detail","client-live-refresh"])
    assert.ok(clientHtml.includes('id="'+id+'"'),id);
  assert.match(clientHtml,/estimatif jusqu’à la fin de l’appel/);
  assert.match(clientPremium,/net_payout_rate_per_second/);
  assert.match(clientPremium,/setInterval\(liveTick,1000\)/);
  assert.match(clientPremium,/15000/);
  assert.match(clientPremium,/app\.hidden/);
});

test("staff cockpit exposes upstream, client net and PGI margin live without calling them settled",()=>{
  assert.match(adminJs,/live-revenue-jackpot\.js/);
  assert.match(adminJs,/pgi:live-finance/);
  assert.match(adminJs,/call_destination\.busy/);
  for(const id of ["live-jackpot","live-jackpot-client","live-jackpot-margin","live-jackpot-detail"])
    assert.ok(jackpot.includes('id="'+id+'"'),id);
  assert.match(jackpot,/REVERSEMENT OPÉRATEUR ESTIMÉ/);
  assert.match(jackpot,/live_upstream_rate_per_second/);
  assert.match(jackpot,/estimation avant CDR et rapprochement/);
  assert.doesNotMatch(adminHtml,/id="live-jackpot"/);
});

test("public trust copy never invents an ARCEP approval and keeps the low-price referral rationale",()=>{
  assert.match(marketing,/Un prix bas qui repose aussi sur le bouche-à-oreille/);
  assert.match(marketing,/réduit notre dépendance aux campagnes publicitaires coûteuses/);
  assert.match(marketing,/data-compliance-proof="arcep"/);
  assert.match(marketing,/data-compliance-proof="af2m"/);
  assert.match(marketing,/Aucun agrément, validation réglementaire ou raccordement opérateur n’est présenté comme acquis sans preuve/);
  assert.doesNotMatch(marketing,/valid[ée]e? par l['’ ]?ARCEP/i);
  assert.doesNotMatch(marketing,/certifi[ée]e? par l['’ ]?ARCEP/i);
});

test("new marketing stylesheet is shipped and explicitly performance-budgeted",()=>{
  assert.match(build,/"site\/site-v155\.css"/);
  assert.match(build,/site\/site-v155\.css/);
  assert.match(size,/"site\/site-v155\.css":2\*1024/);
});

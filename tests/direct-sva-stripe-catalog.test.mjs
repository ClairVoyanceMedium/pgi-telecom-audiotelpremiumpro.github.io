import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
 DIRECT_SVA_STRIPE_PRODUCT_ID,AUDIOTEL_EXISTING_STRIPE_PRODUCT_ID,
 inspectDirectSvaStripeCatalog,isDirectSvaStripeEvent,inspectVerifiedDirectSvaStripeEvent
} from "../backend/src/direct-sva-stripe-catalog.mjs";

const manifest=JSON.parse(fs.readFileSync("config/pgi-direct-sva-stripe-catalog.json","utf8"));
const own=()=>({...manifest.catalog_product,livemode:true,metadata:{...manifest.catalog_product.metadata}});
const audiotel=()=>({id:AUDIOTEL_EXISTING_STRIPE_PRODUCT_ID,active:true,metadata:{platform:"pgi-telecom-audiotel-premium-pro"}});
const envelope=(metadata={},type="checkout.session.completed",other={})=>({
 id:"evt_Fixture20261010",type,data:{object:{metadata,...other}}
});
test("real Stripe Distribution catalog manifest is inactive and has no price",()=>{
 const r=inspectDirectSvaStripeCatalog([own(),audiotel()],[],[]);
 assert.equal(manifest.livemode,true);
 assert.equal(r.stripe_product_id,manifest.catalog_product.id);
 assert.equal(r.stripe_product_created,true);
 assert.equal(r.state,"catalog_prepared_inactive");
 assert.equal(r.product_active,false);
 assert.equal(r.product_has_default_price,false);
 assert.equal(r.configured_distribution_prices,0);
 assert.equal(r.active_distribution_webhook_endpoints,0);
 assert.equal(r.ready_to_charge,false);
 assert.equal(r.ready_to_payout,false);
 assert.equal(r.existing_audiotel_unchanged,true);
});
test("existing Audiotel catalog ID cannot be replaced or recategorized as Distribution",()=>{
 assert.throws(()=>inspectDirectSvaStripeCatalog([own()],[],[]),{code:"DIRECT_SVA_STRIPE_AUDIOTEL_ISOLATION_FAILED"});
 assert.throws(()=>inspectDirectSvaStripeCatalog([own(),{...audiotel(),metadata:{pgi_business_unit:"direct_sva"}}],[],[]),{code:"DIRECT_SVA_STRIPE_AUDIOTEL_ISOLATION_FAILED"});
 assert.throws(()=>inspectDirectSvaStripeCatalog([own(),own(),audiotel()],[],[]),{code:"DIRECT_SVA_STRIPE_PRODUCT_MISSING_OR_DUPLICATED"});
 assert.throws(()=>inspectDirectSvaStripeCatalog([{...own(),metadata:{pgi_business_unit:"audiotel_platform"}},audiotel()],[],[]),{code:"DIRECT_SVA_STRIPE_CATALOG_METADATA_DRIFT"});
});
test("a future price or webhook does not silently enable charging or payments",()=>{
 const r=inspectDirectSvaStripeCatalog([own(),audiotel()],[
  {id:"price_Future",product:DIRECT_SVA_STRIPE_PRODUCT_ID,active:true,metadata:{pgi_business_unit:"direct_sva"}}
 ],[{url:"https://audiotel-premium-pro.com/api/v1/billing/stripe/direct-sva-webhook",status:"enabled"}]);
 assert.equal(r.state,"catalog_configuration_requires_review");
 assert.equal(r.ready_to_charge,false);
 assert.equal(r.ready_to_payout,false);
 assert.equal(r.active_distribution_prices,1);
 assert.equal(r.active_distribution_webhook_endpoints,1);
 assert.throws(()=>inspectDirectSvaStripeCatalog([own(),audiotel()],[
  {product:DIRECT_SVA_STRIPE_PRODUCT_ID,active:false,metadata:{pgi_business_unit:"audiotel_platform"}}
 ],[]),{code:"DIRECT_SVA_STRIPE_PRICE_CROSS_BUSINESS"});
});
test("Stripe webhook events are attributed to Distribution by business tag or product ID",()=>{
 assert.equal(isDirectSvaStripeEvent(envelope({pgi_business_unit:"direct_sva"})),true);
 assert.equal(isDirectSvaStripeEvent(envelope({pgi_stripe_product_id:DIRECT_SVA_STRIPE_PRODUCT_ID})),true);
 assert.equal(isDirectSvaStripeEvent(envelope({pgi_business_unit:"audiotel_platform"})),false);
 assert.equal(isDirectSvaStripeEvent(envelope({platform:"pgi-telecom-audiotel-premium-pro"})),false);
 assert.equal(isDirectSvaStripeEvent(envelope({}, "product.updated",{id:DIRECT_SVA_STRIPE_PRODUCT_ID})),true);
 assert.equal(isDirectSvaStripeEvent(envelope({}, "invoice.paid",{
  parent:{subscription_details:{metadata:{pgi_business_unit:"direct_sva"}}}
 })),true);
 assert.equal(isDirectSvaStripeEvent(envelope({}, "invoice.paid",{
  lines:{data:[{pricing:{price_details:{product:DIRECT_SVA_STRIPE_PRODUCT_ID}}}]}
 })),true);
});
test("catalog activity requires a verified Stripe signature; cannot write financial events",()=>{
 const event=envelope({pgi_business_unit:"direct_sva",pgi_stripe_product_id:DIRECT_SVA_STRIPE_PRODUCT_ID,
  pgi_legal_entity:"pgi_primary",pgi_cost_center:"DSVA",pgi_source_reference:"DSVA-AUDIT-20261010"});
 assert.throws(()=>inspectVerifiedDirectSvaStripeEvent(event),{code:"DIRECT_SVA_STRIPE_SIGNATURE_NOT_VERIFIED"});
 const r=inspectVerifiedDirectSvaStripeEvent(event,{signature_verified:true});
 assert.equal(r.belongs_to_distribution,true);
 assert.equal(r.financial_write_allowed,false);
 assert.equal(r.requires_manual_review,true);
 assert.equal(r.reference,"DSVA-AUDIT-20261010");
 assert.throws(()=>inspectVerifiedDirectSvaStripeEvent(envelope({...event.data.object.metadata,pgi_cost_center:"APP"}),{signature_verified:true}),
  {code:"DIRECT_SVA_STRIPE_EVENT_CATALOG_MISMATCH"});
});
test("an Audiotel signed event remains attributed to the existing business unit",()=>{
 const event=envelope({platform:"pgi-telecom-audiotel-premium-pro",tenant_public_id:"existing_audiotel_tenant"});
 const r=inspectVerifiedDirectSvaStripeEvent(event,{signature_verified:true});
 assert.equal(r.business_unit,"audiotel_platform");
 assert.equal(r.belongs_to_distribution,false);
 assert.equal(r.financial_write_allowed,false);
});
test("existing Audiotel billing webhook screens Distribution only AFTER verifying Stripe signature",()=>{
 const server=fs.readFileSync("backend/server.mjs","utf8");
 const begin=server.indexOf('pathname==="/api/v1/billing/stripe/webhook"');
 const handler=server.slice(begin,begin+3500);
 const verified=handler.indexOf("await verifyStripeWebhook(req,config)");
 const screened=handler.indexOf("if(isDirectSvaStripeEvent(event))");
 const normalizer=handler.indexOf("normalizeStripeBillingEvent(event,config)");
 assert.ok(begin>=0);
 assert.ok(verified>=0);
 assert.ok(screened>verified);
 assert.ok(normalizer>screened);
 assert.match(handler,/distribution_uses_separate_financial_pipeline/);
});

test("Distribution Stripe product appears in its own cockpit without authorizing activity",()=>{
 const overview=fs.readFileSync("backend/src/direct-sva-integrations.mjs","utf8");
 const cockpit=fs.readFileSync("assets/direct-sva-cockpit.js","utf8");
 assert.match(overview,/stripe_catalog:Object\.freeze/);
 assert.match(overview,/distribution_checkout_authorized:false/);
 assert.match(overview,/distribution_webhook_activated:false/);
 assert.match(overview,/payouts_authorized:false/);
 assert.match(cockpit,/Stripe \| PGI Telecom Distribution/);
 assert.match(cockpit,/Dernière vérification externe/);
 assert.match(cockpit,/État observé lors du contrôle/);
});

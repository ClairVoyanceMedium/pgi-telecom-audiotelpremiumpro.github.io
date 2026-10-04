import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
test("revenue growth features remain wired without adding a provider subscription",()=>{
  const billing=read("backend/src/stripe-billing.mjs"),server=read("backend/server.mjs"),store=read("backend/src/store-postgres.mjs"),api=read("assets/client-portal-api.js"),portability=read("assets/client-portability.js"),offer=read("assets/client-portability-offer.js"),referrals=read("assets/client-referrals.js"),cards=read("assets/client-card-payments.js"),opening=read("site/site.js");
  assert.match(billing,/createStripePortabilityPriorityCheckout/);assert.match(billing,/createStripeCustomerCredit/);assert.match(billing,/pgi_payment_kind:"portability_priority"/);
  assert.match(server,/customer\/referrals/);assert.match(server,/priority-checkout/);assert.match(server,/firstPaidReferral/);
  assert.match(store,/priority_payment_status/);assert.match(store,/THEN 5 ELSE 20/);assert.match(store,/referral_status:"pending"/);assert.match(store,/referral_status:"rewarded"/);
  assert.match(api,/createPortabilityPriorityCheckout/);assert.match(api,/referrals:function/);assert.match(portability,/File standard/);assert.match(portability,/Passer en prioritaire/);
  assert.match(referrals,/premier abonnement réellement payé/);assert.match(cards,/ccp-share/);assert.match(cards,/ccp-email-share/);assert.match(opening,/referral_code:referralCode/);
  assert.match(offer,/PRIORITAIRE · 9,90€ TTC une fois/);assert.match(offer,/STANDARD · 0€/);
});
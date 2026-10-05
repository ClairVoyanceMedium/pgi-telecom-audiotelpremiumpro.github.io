import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {normalizeStripeReferralRecipientAccount} from "../backend/src/stripe-connect.mjs";

const read=file=>fs.readFileSync(file,"utf8");
const migration=read("database/migrations/068_referral_automatic_payouts.sql");
const stripe=read("backend/src/stripe-connect.mjs");
const automation=read("backend/src/referral-payout-automation.mjs");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const vercel=JSON.parse(read("vercel.json"));
const client=read("assets/client-referral.js");
const accounting=read("assets/accounting-cockpit.js");

test("recipient readiness uses the Stripe Accounts v2 transfer capability",()=>{
  const ready=normalizeStripeReferralRecipientAccount({
    id:"acct_ReferralPayout123",
    configuration:{recipient:{capabilities:{stripe_balance:{
      stripe_transfers:{status:"active"},
    }}}},
    requirements:{summary:{minimum_deadline:{status:""}}}
  });
  assert.equal(ready.status,"active");
  assert.equal(ready.transfers_enabled,true);

  const blocked=normalizeStripeReferralRecipientAccount({
    id:"acct_ReferralPayout123",
    configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"inactive"}}}}},
    requirements:{summary:{minimum_deadline:{status:"currently_due"}}}
  });
  assert.equal(blocked.transfers_enabled,false);
  assert.equal(blocked.status,"onboarding");
});

test("referral transfers have idempotency and immutable provider references",()=>{
  assert.match(stripe,/configuration:\{\s*recipient:\{[\s\S]*stripe_balance:\{stripe_transfers:\{requested:true\}\}/);
  assert.match(stripe,/formRequest\(config,"\/v1\/transfers"/);
  assert.match(automation,/idempotency_key:"referral-reward\/"\+item\.public_id/);
  assert.match(migration,/UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_ref_uidx/);
  assert.match(store,/provider_transfer_reference/);
  assert.match(store,/referral\.reward\.paid\.auto/);
});

test("automatic payouts fail closed and retry without admin intervention",()=>{
  assert.match(store,/FOR UPDATE SKIP LOCKED/);
  assert.match(store,/payout_state='processing'/);
  assert.match(store,/REFERRAL_PAYOUT_IN_PROGRESS/);
  assert.doesNotMatch(migration,/payouts_enabled/);
  assert.match(automation,/REFERRAL_PAYOUT_ACCOUNT_REQUIRED/);
  assert.match(automation,/INSUFFICIENT_FUNDS/);
  assert.match(automation,/failAutomaticReferralPayout/);
  assert.match(server,/\/api\/v1\/internal\/referral-payouts\/run/);
  assert.ok(vercel.crons.some(x=>x.path==="/api/v1/internal/referral-payouts/run"&&x.schedule==="*/5 * * * *"));
});

test("customer self-service and accounting print are wired",()=>{
  assert.match(server,/\/api\/v1\/customer\/referral\/payout-account/);
  assert.match(client,/client-referral-payout-connect/);
  assert.match(client,/Versements automatiques activés/);
  assert.match(accounting,/data-acc-print/);
  assert.match(accounting,/window\.print\(\)/);
});

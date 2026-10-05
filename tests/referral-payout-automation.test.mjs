import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {processReferralPayoutWork} from "../backend/src/referral-payout-automation.mjs";

const config={
  stripeSecretKey:"sk_test_abcdefghijklmnopqrstuvwxyz123456",
  stripeApiVersion:"2026-08-26.dahlia",
  publicBaseUrl:"https://audiotel-premium-pro.com"
};

function jsonResponse(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

test("earned referral reward transfers funds before it is marked paid",async t=>{
  const original=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes("/v2/core/accounts/acct_referrer")){
      return jsonResponse({
        id:"acct_referrer",
        configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"active"}}}}},
        requirements:{summary:{}}
      });
    }
    if(String(url).includes("/v1/transfers?")){
      return jsonResponse({object:"list",data:[]});
    }
    if(String(url).endsWith("/v1/transfers")){
      return jsonResponse({id:"tr_reward123",amount:1200,currency:"eur",created:1791230000});
    }
    throw new Error("unexpected fetch "+url);
  };
  t.after(()=>{global.fetch=original;});

  let settled=null,deferred=null;
  const store={
    prepareReferralRewardPayout:async()=>({
      id:7,public_id:"b373a1bd-1e2a-4fc9-a38d-aebda0d2c5e7",
      tenant_id:12,tenant_public_id:"beefbeef-2222-4444-8888-abcdefabcdef",
      amount_minor:1200,currency:"EUR",status:"earned",
      provider_account_reference:"acct_referrer"
    }),
    settleAutomatedCustomerReferralReward:async(id,input)=>{settled={id,input};return {id,status:"paid"};},
    deferReferralRewardPayout:async(id,reason)=>{deferred={id,reason};}
  };

  const result=await processReferralPayoutWork({payload:{reward_id:7}},{store,config});
  assert.equal(result.paid,true);
  assert.equal(deferred,null);
  assert.deepEqual(settled,{
    id:7,
    input:{provider:"stripe",transfer_reference:"tr_reward123",destination_account:"acct_referrer"}
  });
  assert.equal(calls.length,3);
  assert.match(calls[0].url,/\/v2\/core\/accounts\/acct_referrer/);
  assert.match(calls[1].url,/\/v1\/transfers\?/);
  assert.match(calls[1].url,/transfer_group=referral_reward_b373a1bd-1e2a-4fc9-a38d-aebda0d2c5e7/);
  assert.match(calls[2].url,/\/v1\/transfers$/);
  assert.equal(calls[2].options.headers["Idempotency-Key"],"referral-reward-v1-b373a1bd-1e2a-4fc9-a38d-aebda0d2c5e7");
  const form=new URLSearchParams(calls[2].options.body);
  assert.equal(form.get("amount"),"1200");
  assert.equal(form.get("currency"),"eur");
  assert.equal(form.get("destination"),"acct_referrer");
  assert.equal(form.get("metadata[pgi_referral_reward]"),"b373a1bd-1e2a-4fc9-a38d-aebda0d2c5e7");
});

test("missing beneficiary account keeps the reward payable without calling Stripe",async t=>{
  const original=global.fetch;
  let fetched=false;
  global.fetch=async()=>{fetched=true;throw new Error("should not fetch");};
  t.after(()=>{global.fetch=original;});
  let deferred=null,settled=false;
  const store={
    prepareReferralRewardPayout:async()=>({
      id:8,public_id:"reward-8",tenant_id:13,tenant_public_id:"tenant-13",
      amount_minor:1000,currency:"EUR",status:"earned",provider_account_reference:null
    }),
    deferReferralRewardPayout:async(id,reason,seconds)=>{deferred={id,reason,seconds};},
    settleAutomatedCustomerReferralReward:async()=>{settled=true;}
  };
  const result=await processReferralPayoutWork({payload:{reward_id:8}},{store,config});
  assert.equal(result.deferred,true);
  assert.equal(result.reason,"account_required");
  assert.equal(fetched,false);
  assert.equal(settled,false);
  assert.equal(deferred.id,8);
  assert.equal(deferred.reason,"REFERRAL_PAYOUT_ACCOUNT_REQUIRED");
  assert.equal(deferred.seconds,21600);
});

test("inactive transfer capability is requested then safely deferred when still pending",async t=>{
  const original=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(calls.length===1)return jsonResponse({
      id:"acct_pending",
      configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"inactive"}}}}},
      requirements:{summary:{minimum_deadline:{status:"currently_due"}}}
    });
    if(calls.length===2)return jsonResponse({
      id:"acct_pending",
      configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"pending"}}}}},
      requirements:{summary:{minimum_deadline:{status:"currently_due"}}}
    });
    throw new Error("transfer must not be created while capability is pending");
  };
  t.after(()=>{global.fetch=original;});
  let deferred=null,settled=false;
  const store={
    prepareReferralRewardPayout:async()=>({
      id:9,public_id:"reward-9",tenant_id:14,tenant_public_id:"tenant-14",
      amount_minor:1500,currency:"EUR",status:"earned",provider_account_reference:"acct_pending"
    }),
    deferReferralRewardPayout:async(id,reason,seconds)=>{deferred={id,reason,seconds};},
    settleAutomatedCustomerReferralReward:async()=>{settled=true;}
  };
  const result=await processReferralPayoutWork({payload:{reward_id:9}},{store,config});
  assert.equal(result.deferred,true);
  assert.equal(result.reason,"onboarding_required");
  assert.equal(settled,false);
  assert.equal(calls.length,2);
  assert.equal(calls[1].options.method,"POST");
  assert.equal(calls[1].options.headers["Idempotency-Key"],"referral-capability-v1-acct_pending");
  assert.match(String(calls[1].options.body),/"stripe_transfers":\{"requested":true\}/);
  assert.match(deferred.reason,/REFERRAL_PAYOUT_ONBOARDING_REQUIRED:pending/);
});

test("an existing matching Stripe transfer is reconciled instead of recreated",async t=>{
  const original=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes("/v2/core/accounts/acct_existing")){
      return jsonResponse({
        id:"acct_existing",
        configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"active"}}}}},
        requirements:{summary:{}}
      });
    }
    if(String(url).includes("/v1/transfers?")){
      return jsonResponse({
        object:"list",
        data:[{
          id:"tr_existing123",
          amount:2000,
          currency:"eur",
          destination:"acct_existing",
          transfer_group:"referral_reward_existing-reward",
          metadata:{pgi_referral_reward:"existing-reward"},
          reversed:false,
          created:1791230000
        }]
      });
    }
    throw new Error("a second transfer must not be created");
  };
  t.after(()=>{global.fetch=original;});
  let settled=null;
  const store={
    prepareReferralRewardPayout:async()=>({
      id:10,public_id:"existing-reward",tenant_id:15,tenant_public_id:"tenant-15",
      amount_minor:2000,currency:"EUR",status:"earned",provider_account_reference:"acct_existing"
    }),
    settleAutomatedCustomerReferralReward:async(id,input)=>{settled={id,input};return {id,status:"paid"};},
    deferReferralRewardPayout:async()=>{}
  };
  const result=await processReferralPayoutWork({payload:{reward_id:10}},{store,config});
  assert.equal(result.paid,true);
  assert.equal(result.transfer_reference,"tr_existing123");
  assert.equal(calls.length,2);
  assert.equal(settled.input.transfer_reference,"tr_existing123");
});

test("production contract keeps automatic referral payouts durable and non-manual",()=>{
  const stripe=fs.readFileSync("backend/src/stripe-connect.mjs","utf8");
  const automation=fs.readFileSync("backend/src/referral-payout-automation.mjs","utf8");
  const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
  const server=fs.readFileSync("backend/server.mjs","utf8");
  const migration=fs.readFileSync("database/migrations/069_automatic_referral_reward_payouts.sql","utf8");
  const admin=fs.readFileSync("assets/referral-admin.js","utf8");
  const view=fs.readFileSync("assets/referral-admin-view.js","utf8");
  const accounting=fs.readFileSync("assets/accounting-cockpit.js","utf8");
  const vercel=JSON.parse(fs.readFileSync("vercel.json","utf8"));

  assert.match(stripe,/configuration:\{recipient:\{capabilities:\{stripe_balance:\{stripe_transfers:\{requested:true\}\}\}\}\}/);
  assert.match(stripe,/formRequest\(config,"\/v1\/transfers"/);
  assert.match(stripe,/transfer_group/);
  assert.match(automation,/findStripeReferralTransfer/);
  assert.match(automation,/referral-reward-v1-/);
  assert.match(store,/async settleAutomatedCustomerReferralReward/);
  assert.match(store,/status='paid'.*payout_state='paid'/s);
  assert.match(store,/async scanReferralPayoutAutomation/);
  assert.match(server,/\/api\/v1\/internal\/referral-payouts\/run/);
  assert.ok(vercel.crons.some(x=>x.path==="/api/v1/internal/referral-payouts/run"&&x.schedule==="* * * * *"));
  assert.match(migration,/payout_transfer_reference/);
  assert.match(migration,/customer_referral_rewards_transfer_unique/);
  assert.doesNotMatch(admin,/settleReferralReward/);
  assert.doesNotMatch(view,/data-referral-paid/);
  assert.match(view,/Paiement automatique/);
  assert.match(accounting,/Imprimer \/ PDF/);
  assert.match(accounting,/Exporter CSV/);
});

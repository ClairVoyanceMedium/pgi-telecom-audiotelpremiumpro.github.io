import {randomUUID} from "node:crypto";
import {
  retrieveStripeConnectedAccount,
  requestStripeReferralPayoutCapability,
  normalizeStripeReferralPayoutCapability,
  createStripeReferralTransfer
} from "./stripe-connect.mjs";

const QUEUE_NAME="referral_payout";
const DEFAULT_LIMIT=8;
const ACCOUNT_RETRY_SECONDS=6*3600;

export function createReferralPayoutQueueHandlers({store,config}={}){
  if(!store?.sql||!config?.stripeSecretKey)return {};
  return {
    [QUEUE_NAME]:(item,ctx)=>processReferralPayoutWork(item,{...ctx,store,config})
  };
}

export async function processReferralPayoutWork(item,{store,config}={}){
  const rewardId=Number(item?.payload?.reward_id);
  if(!Number.isInteger(rewardId)||rewardId<=0)throw codedError("REFERRAL_PAYOUT_INVALID_REWARD");
  if(typeof store.prepareReferralRewardPayout!=="function")throw codedError("REFERRAL_PAYOUT_STORE_UNAVAILABLE");

  const reward=await store.prepareReferralRewardPayout(rewardId);
  if(!reward||reward.status==="paid")return {skipped:true,reason:"already_paid_or_missing"};
  if(reward.status!=="earned")return {skipped:true,reason:"not_payable"};

  const accountId=String(reward.provider_account_reference||"");
  if(!/^acct_[A-Za-z0-9]+$/.test(accountId)){
    await store.deferReferralRewardPayout(rewardId,"REFERRAL_PAYOUT_ACCOUNT_REQUIRED",ACCOUNT_RETRY_SECONDS);
    return {deferred:true,reason:"account_required"};
  }

  let remote=await retrieveStripeConnectedAccount(config,accountId);
  let capability=normalizeStripeReferralPayoutCapability(remote);
  if(!capability.transfers_enabled){
    remote=await requestStripeReferralPayoutCapability(config,accountId,{
      idempotency_key:"referral-capability-v1-"+accountId
    });
    capability=normalizeStripeReferralPayoutCapability(remote);
  }

  if(!capability.transfers_enabled){
    await store.deferReferralRewardPayout(
      rewardId,
      "REFERRAL_PAYOUT_ONBOARDING_REQUIRED:"+String(capability.transfers_status||"unknown"),
      ACCOUNT_RETRY_SECONDS
    );
    return {deferred:true,reason:"onboarding_required",capability};
  }

  const transfer=await createStripeReferralTransfer(config,{
    destination_account:accountId,
    amount_minor:Number(reward.amount_minor),
    currency:String(reward.currency||"EUR"),
    reward_public_id:String(reward.public_id||rewardId),
    tenant_public_id:String(reward.tenant_public_id||""),
    idempotency_key:"referral-reward-v1-"+String(reward.public_id||rewardId)
  });

  const settled=await store.settleAutomatedCustomerReferralReward(rewardId,{
    provider:transfer.provider,
    transfer_reference:transfer.transfer_reference,
    destination_account:transfer.destination_account
  });
  return {paid:true,transfer_reference:transfer.transfer_reference,reward:settled};
}

export async function runReferralPayoutAutomation({store,config,limit=DEFAULT_LIMIT,ownerId}={}){
  if(!store||!config?.stripeSecretKey)return {enabled:false,scanned:0,claimed:0,paid:0,deferred:0,failed:0};
  const take=Math.max(1,Math.min(25,Number(limit)||DEFAULT_LIMIT));
  const owner=String(ownerId||("referral-cron-"+randomUUID())).slice(0,160);
  const scan=typeof store.scanReferralPayoutAutomation==="function"
    ?await store.scanReferralPayoutAutomation(take*3)
    :[];
  if(typeof store.claimWork!=="function")return {enabled:true,scanned:scan.length,claimed:0,paid:0,deferred:0,failed:0};

  const work=await store.claimWork(QUEUE_NAME,owner,take,60);
  let paid=0,deferred=0,failed=0,skipped=0;
  const results=[];
  for(const item of work){
    try{
      const result=await processReferralPayoutWork(item,{store,config});
      await store.completeWork(item.id,owner);
      if(result?.paid)paid++;
      else if(result?.deferred)deferred++;
      else skipped++;
      results.push({work_id:Number(item.id),reward_id:Number(item?.payload?.reward_id),state:result?.paid?"paid":result?.deferred?"deferred":"skipped"});
    }catch(error){
      failed++;
      let queueState="retry";
      try{
        const failure=await store.failWork(item.id,owner,String(error?.code||error?.message||"REFERRAL_PAYOUT_FAILED"),300);
        queueState=String(failure?.state||queueState);
      }catch(leaseError){
        if(leaseError?.code!=="WORK_LEASE_LOST")throw leaseError;
        queueState="lease_lost";
      }
      if(typeof store.recordReferralRewardPayoutFailure==="function"){
        await store.recordReferralRewardPayoutFailure(Number(item?.payload?.reward_id),String(error?.code||error?.message||"REFERRAL_PAYOUT_FAILED"),queueState).catch(()=>{});
      }
      results.push({work_id:Number(item.id),reward_id:Number(item?.payload?.reward_id),state:queueState,error:String(error?.code||error?.message||"REFERRAL_PAYOUT_FAILED").slice(0,160)});
    }
  }
  return {enabled:true,scanned:scan.length,claimed:work.length,paid,deferred,failed,skipped,results};
}

function codedError(code){
  const e=new Error(code);e.code=code;return e;
}

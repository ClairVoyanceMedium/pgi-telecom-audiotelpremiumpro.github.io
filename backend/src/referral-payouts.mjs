import {createStripeReferralTransfer} from "./stripe-connect.mjs";

function retryDelaySeconds(attempt,errorCode=""){
  const n=Math.max(0,Math.min(10,Number(attempt)||0)),code=String(errorCode||"").toUpperCase();
  if(/DESTINATION|ACCOUNT|CAPABILITY|TRANSFER.*NOT/.test(code))return 6*3600;
  if(/INSUFFICIENT|BALANCE/.test(code))return Math.min(6*3600,900*Math.pow(2,Math.min(n,4)));
  return Math.min(2*3600,120*Math.pow(2,Math.min(n,6)));
}
function nextAttemptIso(seconds){return new Date(Date.now()+Math.max(60,Number(seconds)||60)*1000).toISOString()}
function readiness(item){
  if(!/^acct_[A-Za-z0-9]+$/.test(String(item?.provider_account_reference||"")))return {ready:false,state:"destination_missing",code:"REFERRAL_PAYOUT_DESTINATION_MISSING",delay:6*3600};
  if(String(item?.account_status||"")!=="active"||item?.payouts_enabled!==true||item?.details_submitted!==true)return {ready:false,state:"destination_not_ready",code:"REFERRAL_PAYOUT_DESTINATION_NOT_READY",delay:3600};
  return {ready:true};
}
export async function drainReferralRewardPayouts({store,config,limit=25}={}){
  if(!store||typeof store.openReferralRewardPayoutBatch!=="function")return {enabled:false,processed:0,paid:0,deferred:0};
  if(!/^sk_(test|live)_/.test(String(config?.stripeSecretKey||"")))return {enabled:false,processed:0,paid:0,deferred:0};
  const batch=await store.openReferralRewardPayoutBatch(limit),stats={enabled:true,processed:0,paid:0,deferred:0};
  for(const item of batch){
    stats.processed++;
    const ready=readiness(item);
    if(!ready.ready){
      await store.deferCustomerReferralRewardPayout(item.id,{state:ready.state,error_code:ready.code,next_attempt_at:nextAttemptIso(ready.delay),destination_reference:item.provider_account_reference||null});
      stats.deferred++;continue;
    }
    try{
      const transfer=await createStripeReferralTransfer(config,{destination_account:item.provider_account_reference,amount_minor:item.amount_minor,currency:item.currency,reward_public_id:item.public_id,tenant_public_id:item.tenant_public_id,idempotency_key:"referral-reward:"+item.public_id});
      await store.confirmCustomerReferralRewardPayout(item.id,{transfer_reference:transfer.provider_transfer_reference,destination_reference:item.provider_account_reference});
      stats.paid++;
    }catch(error){
      const code=String(error?.code||"STRIPE_REFERRAL_TRANSFER_FAILED").toUpperCase(),destinationIssue=/DESTINATION|ACCOUNT|CAPABILITY|TRANSFER.*NOT/.test(code);
      await store.deferCustomerReferralRewardPayout(item.id,{state:destinationIssue?"destination_not_ready":"retry_scheduled",error_code:code,next_attempt_at:nextAttemptIso(retryDelaySeconds(item.payout_attempt_count,code)),destination_reference:item.provider_account_reference});
      stats.deferred++;
    }
  }
  return stats;
}

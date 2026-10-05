import {
  createStripeReferralTransfer,
  retrieveStripeReferralRecipientAccount,
  normalizeStripeReferralRecipientAccount
} from "./stripe-connect.mjs";

function retryDelayMs(attempt,errorCode){
  const code=String(errorCode||"").toUpperCase();
  if(code.includes("INSUFFICIENT_FUNDS"))return 30*60*1000;
  const step=Math.max(0,Math.min(7,Number(attempt||1)-1));
  return Math.min(24*60*60*1000,15*60*1000*(2**step));
}
function nextIso(ms){return new Date(Date.now()+ms).toISOString();}
function waitingCode(code){
  const v=String(code||"").toUpperCase();
  return v.includes("CAPABILITY")||v.includes("ACCOUNT")||v.includes("REQUIREMENT")||v.includes("RECIPIENT");
}

export async function runReferralAutomaticPayouts({store,config,limit=25}={}){
  if(!store||typeof store.claimAutomaticReferralPayoutBatch!=="function")return {scanned:0,paid:0,retry:0,waiting_account:0,failed:0,results:[]};
  const batch=await store.claimAutomaticReferralPayoutBatch(limit);
  const results=[];
  let paid=0,retry=0,waiting=0,failed=0;
  for(const item of batch){
    try{
      if(!item.provider_account_reference){
        const next=nextIso(12*60*60*1000);
        await store.failAutomaticReferralPayout(item.id,{state:"waiting_account",error_code:"REFERRAL_PAYOUT_ACCOUNT_REQUIRED",next_attempt_at:next});
        waiting++;results.push({id:item.id,state:"waiting_account",next_attempt_at:next});continue;
      }
      let normalized;
      try{
        const remote=await retrieveStripeReferralRecipientAccount(config,item.provider_account_reference);
        normalized=normalizeStripeReferralRecipientAccount(remote);
        if(typeof store.syncCustomerReferralPayoutAccount==="function")await store.syncCustomerReferralPayoutAccount(item.tenant_id,normalized);
      }catch(error){
        const code=String(error?.code||"STRIPE_REFERRAL_ACCOUNT_STATUS_UNAVAILABLE");
        const next=nextIso(retryDelayMs(item.payout_attempt_count,code));
        await store.failAutomaticReferralPayout(item.id,{state:waitingCode(code)?"waiting_account":"retry",error_code:code,next_attempt_at:next});
        if(waitingCode(code))waiting++;else retry++;
        results.push({id:item.id,state:waitingCode(code)?"waiting_account":"retry",error_code:code,next_attempt_at:next});continue;
      }
      if(normalized.transfers_enabled!==true){
        const next=nextIso(6*60*60*1000);
        await store.failAutomaticReferralPayout(item.id,{state:"waiting_account",error_code:"REFERRAL_PAYOUT_ACCOUNT_NOT_READY",next_attempt_at:next});
        waiting++;results.push({id:item.id,state:"waiting_account",next_attempt_at:next});continue;
      }
      const transfer=await createStripeReferralTransfer(config,{
        destination_account:item.provider_account_reference,
        tenant_public_id:item.tenant_public_id,
        reward_public_id:item.public_id,
        amount_minor:item.amount_minor,
        currency:item.currency,
        idempotency_key:"referral-reward/"+item.public_id
      });
      const completed=await store.completeAutomaticReferralPayout(item.id,transfer);
      paid++;results.push({id:item.id,state:"paid",provider_transfer_reference:completed.provider_transfer_reference||transfer.provider_transfer_reference});
    }catch(error){
      failed++;
      const code=String(error?.code||"REFERRAL_PAYOUT_FAILED");
      const state=waitingCode(code)?"waiting_account":"retry";
      const next=nextIso(state==="waiting_account"?6*60*60*1000:retryDelayMs(item.payout_attempt_count,code));
      try{await store.failAutomaticReferralPayout(item.id,{state,error_code:code,next_attempt_at:next});}catch{}
      if(state==="waiting_account")waiting++;else retry++;
      results.push({id:item.id,state,error_code:code,next_attempt_at:next});
    }
  }
  return {scanned:batch.length,paid,retry,waiting_account:waiting,failed,results};
}

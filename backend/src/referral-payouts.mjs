import {createStripeReferralTransfer,retrieveStripeConnectedAccount,normalizeStripeConnectedAccount} from "./stripe-connect.mjs";

function cleanCode(value){
  return String(value||"REFERRAL_PAYOUT_FAILED").trim().toUpperCase().replace(/[^A-Z0-9_]+/g,"_").slice(0,120)||"REFERRAL_PAYOUT_FAILED";
}
function liveReady(config){
  return Boolean(
    config?.externalBillingEnabled===true&&
    config?.stripeLiveMode===true&&
    /^sk_live_[A-Za-z0-9]+$/.test(String(config?.stripeSecretKey||""))
  );
}
function blockedProviderError(code){
  return /ACCOUNT_(INVALID|CLOSED|DISABLED)|DESTINATION|TRANSFERS?_NOT_ALLOWED|CAPABILIT|REQUIREMENTS|RECIPIENT/.test(code);
}

export async function runReferralRewardPayouts({store,config,limit=25,transfer=createStripeReferralTransfer}={}){
  if(!store||typeof store.claimReferralRewardPayoutBatch!=="function")return {enabled:false,reason:"store_unavailable",claimed:0,paid:0,blocked:0,retry:0};
  if(!liveReady(config))return {enabled:false,reason:"stripe_live_not_ready",claimed:0,paid:0,blocked:0,retry:0};
  const take=Math.max(1,Math.min(50,Number(limit)||25));
  let accounts_refreshed=0,account_refresh_failed=0;
  if(typeof store.referralPayoutAccountsNeedingRefresh==="function"&&typeof store.syncCustomerCardPaymentAccount==="function"){
    const accounts=await store.referralPayoutAccountsNeedingRefresh(take);
    for(const account of accounts){
      try{
        const remote=await retrieveStripeConnectedAccount(config,account.provider_account_reference);
        await store.syncCustomerCardPaymentAccount(account.tenant_id,normalizeStripeConnectedAccount(remote));
        accounts_refreshed++;
      }catch{account_refresh_failed++}
    }
  }
  const claim=await store.claimReferralRewardPayoutBatch(take);
  const items=Array.isArray(claim)?claim:Array.isArray(claim?.items)?claim.items:[];
  const result={
    enabled:true,
    claimed:items.length,
    account_blocked:Number(claim?.account_blocked||0),
    accounts_refreshed,
    account_refresh_failed,
    paid:0,
    blocked:0,
    retry:0,
    results:[]
  };
  for(const item of items){
    try{
      const sent=await transfer(config,{
        destination_account:item.provider_destination_reference,
        amount_minor:Number(item.amount_minor),
        currency:item.currency,
        reward_public_id:item.public_id,
        tenant_public_id:item.tenant_public_id,
        idempotency_key:"pgi-referral-reward:"+String(item.public_id)
      });
      const completed=await store.completeReferralRewardPayout(item.id,{
        provider:"stripe",
        provider_transfer_reference:sent.provider_transfer_reference,
        provider_destination_reference:item.provider_destination_reference,
        paid_at:sent.created_at||new Date().toISOString()
      });
      result.paid++;
      result.results.push({reward_public_id:item.public_id,state:"paid",provider_transfer_reference:sent.provider_transfer_reference,duplicate:Boolean(completed?.already_paid)});
    }catch(error){
      const code=cleanCode(error?.code||error?.message);
      const blocked=blockedProviderError(code);
      await store.failReferralRewardPayout(item.id,code,{blocked});
      if(blocked)result.blocked++;else result.retry++;
      result.results.push({reward_public_id:item.public_id,state:blocked?"blocked":"retry",code});
    }
  }
  return result;
}

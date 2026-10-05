import {randomUUID} from "node:crypto";
import {createStripeReferralRecipientAccount,ensureStripeReferralRecipient,retrieveStripeConnectedAccount,normalizeStripeReferralPayoutAccount,findStripeReferralTransfer,createStripeReferralTransfer} from "./stripe-connect.mjs";
const HOUR=3600000;
export function createReferralPayoutQueueHandlers({store,config}={}){
  if(!store?.sql||!config?.stripeSecretKey)return {};
  return {referral_payout:(item)=>processReferralPayoutWork(item,{store,config})};
}
export async function processReferralPayoutWork(item,{store,config}){
  const rewardId=Number(item?.payload?.reward_id);if(!Number.isInteger(rewardId)||rewardId<=0)throw coded("REFERRAL_PAYOUT_WORK_INVALID");
  let task=await store.referralPayoutPreparation(rewardId);if(task.status==="paid"||task.status==="cancelled")return {state:"settled"};
  let accountId=String(task.payout_account_reference||task.card_account_reference||"");
  try{
    if(!accountId){
      const created=await createStripeReferralRecipientAccount(config,{email:task.billing_email,country_code:task.country_code||"FR",idempotency_key:"referral-recipient-account/"+task.tenant_public_id});
      const normalized=normalizeStripeReferralPayoutAccount(created);accountId=normalized.provider_account_reference;
      await store.upsertCustomerReferralPayoutAccount(task.tenant_id,{...normalized,metadata:{source:"automatic_referral_reward"}});
    }else{
      const configured=await ensureStripeReferralRecipient(config,accountId,{idempotency_key:"referral-recipient/"+task.tenant_public_id});
      const normalized=normalizeStripeReferralPayoutAccount(configured);
      await store.upsertCustomerReferralPayoutAccount(task.tenant_id,{...normalized,metadata:{source:task.payout_account_reference?"referral_payout":"shared_card_payment_account"}});
    }
    const remote=await retrieveStripeConnectedAccount(config,accountId),normalized=normalizeStripeReferralPayoutAccount(remote);
    await store.syncCustomerReferralPayoutAccount(task.tenant_id,normalized);
    if(normalized.transfers_enabled!==true||normalized.payouts_enabled!==true){
      await store.deferCustomerReferralPayout(rewardId,{status:"onboarding",destination:accountId,error:"REFERRAL_PAYOUT_ONBOARDING_REQUIRED",next_attempt_at:new Date(Date.now()+6*HOUR).toISOString()});return {state:"onboarding"};
    }
    await store.beginCustomerReferralPayout(rewardId,accountId);task=await store.referralPayoutPreparation(rewardId);
    const group="PGI_REFERRAL_"+String(task.public_id).replace(/[^A-Za-z0-9_-]/g,"_");
    let transfer=await findStripeReferralTransfer(config,{destination:accountId,transfer_group:group});
    if(transfer)validateRecoveredTransfer(transfer,task,accountId,group);
    else transfer=await createStripeReferralTransfer(config,{amount_minor:task.amount_minor,currency:task.currency,destination:accountId,transfer_group:group,reward_public_id:task.public_id,idempotency_key:"referral-reward/"+task.public_id});
    const completed=await store.completeCustomerReferralPayout(rewardId,{provider_transfer_reference:transfer.id,destination:accountId});
    return {state:"paid",transfer_reference:transfer.id,replayed:completed.already_paid===true};
  }catch(error){
    const code=String(error?.code||error?.message||"REFERRAL_PAYOUT_FAILED").toUpperCase().slice(0,180);
    if(code.includes("BALANCE_INSUFFICIENT")||code.includes("INSUFFICIENT_FUNDS")){await store.deferCustomerReferralPayout(rewardId,{status:"retry",destination:accountId,error:"PLATFORM_BALANCE_INSUFFICIENT",next_attempt_at:new Date(Date.now()+HOUR).toISOString()});return {state:"retry_balance"};}
    if(error?.status===422||/CAPABIL|REQUIREMENT|PAYOUT|RECIPIENT|ACCOUNT/.test(code)){await store.deferCustomerReferralPayout(rewardId,{status:"onboarding",destination:accountId,error:code,next_attempt_at:new Date(Date.now()+6*HOUR).toISOString()});return {state:"onboarding"};}
    await store.failCustomerReferralPayout(rewardId,{destination:accountId,error:code,next_attempt_at:new Date(Date.now()+15*60000).toISOString()}).catch(()=>{});throw error;
  }
}
export async function runReferralPayoutBatch({store,config,limit=50,workerId}={}){
  if(!store?.claimWork||!config?.stripeSecretKey)return {scanned:0,processed:0,failed:0};
  const queued=typeof store.scanReferralPayoutAutomation==="function"?await store.scanReferralPayoutAutomation(limit):[],owner=String(workerId||"referral-payout-cron:"+randomUUID()),handler=createReferralPayoutQueueHandlers({store,config}).referral_payout;
  if(typeof handler!=="function")return {scanned:Array.isArray(queued)?queued.length:0,processed:0,failed:0};
  let processed=0,failed=0;
  for(let round=0;round<4&&processed+failed<limit;round++){
    const work=await store.claimWork("referral_payout",owner,Math.min(25,limit-processed-failed),90);if(!work.length)break;
    for(const item of work){try{await handler(item,{store,config,ownerId:owner});await store.completeWork(item.id,owner);processed++;}catch(error){await store.failWork(item.id,owner,error?.message||"referral payout failed",30).catch(()=>{});failed++;}}
  }
  return {scanned:Array.isArray(queued)?queued.length:0,processed,failed};
}
function validateRecoveredTransfer(transfer,task,destination,group){
  if(String(transfer?.destination||"")!==destination)throw coded("REFERRAL_TRANSFER_DESTINATION_MISMATCH");
  if(String(transfer?.transfer_group||"")!==group)throw coded("REFERRAL_TRANSFER_GROUP_MISMATCH");
  if(Number(transfer?.amount)!==Number(task.amount_minor))throw coded("REFERRAL_TRANSFER_AMOUNT_MISMATCH");
  if(String(transfer?.currency||"").toUpperCase()!==String(task.currency||"").toUpperCase())throw coded("REFERRAL_TRANSFER_CURRENCY_MISMATCH");
  const metadata=transfer?.metadata&&typeof transfer.metadata==="object"?transfer.metadata:{};
  if(metadata.pgi_referral_reward&&String(metadata.pgi_referral_reward)!==String(task.public_id))throw coded("REFERRAL_TRANSFER_METADATA_MISMATCH");
}
function coded(code){const e=new Error(code);e.code=code;return e;}

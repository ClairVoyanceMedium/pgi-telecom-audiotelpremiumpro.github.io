import {retrieveStripeTransferRecipient,createStripeReferralTransfer} from "./stripe-connect.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanCode(error){
  return String(error?.code||"REFERRAL_PAYOUT_FAILED").trim().replace(/[^A-Z0-9_]+/gi,"_").toUpperCase().slice(0,120)||"REFERRAL_PAYOUT_FAILED";
}
function cleanMessage(error){
  return String(error?.message||error?.code||"Referral payout failed").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").slice(0,500);
}

export function createReferralPayoutQueueHandlers({store,config}){
  if(!store)throw new TypeError("store is required");
  return {
    referral_payout:async(item,{heartbeat}={})=>{
      if(config?.referralAutopayoutEnabled!==true)return {disabled:true};
      const payoutPublicId=String(item?.payload?.payout_public_id||"").trim();
      if(!UUID.test(payoutPublicId))throw Object.assign(new Error("INVALID_REFERRAL_PAYOUT"),{code:"INVALID_REFERRAL_PAYOUT"});

      const context=await store.referralPayoutContext(payoutPublicId);
      if(context?.done===true)return {done:true,replayed:true};

      const accountRef=String(context?.provider_account_reference||"").trim();
      if(!/^acct_[A-Za-z0-9]+$/.test(accountRef)||context?.account_status!=="active"||context?.payouts_enabled!==true){
        await store.markReferralPayoutRecipientMissing(payoutPublicId,{
          provider_account_reference:/^acct_[A-Za-z0-9]+$/.test(accountRef)?accountRef:null,
          code:"STRIPE_RECIPIENT_NOT_READY",
          message:"Compte Stripe non prêt pour les versements automatiques."
        });
        return {done:false,blocked:true};
      }

      let recipient;
      try{
        recipient=await retrieveStripeTransferRecipient(config,accountRef);
      }catch(error){
        const final=Number(item?.attempts||0)>=Number(item?.max_attempts||20);
        await store.markReferralPayoutFailure(payoutPublicId,{
          final,provider_account_reference:accountRef,code:cleanCode(error),message:cleanMessage(error)
        });
        throw error;
      }

      if(recipient.transfer_ready!==true){
        await store.markReferralPayoutRecipientMissing(payoutPublicId,{
          provider_account_reference:accountRef,
          code:recipient.transfer_capability==="active"?"STRIPE_PAYOUTS_NOT_ENABLED":"STRIPE_TRANSFERS_NOT_ACTIVE",
          message:"Le compte Stripe doit terminer sa vérification avant de recevoir automatiquement une prime."
        });
        return {done:false,blocked:true};
      }

      await store.markReferralPayoutProcessing(payoutPublicId,accountRef);
      if(typeof heartbeat==="function")await heartbeat();

      try{
        const transfer=await createStripeReferralTransfer(config,{
          connected_account_reference:accountRef,
          amount_minor:Number(context.amount_minor),
          currency:String(context.currency||"EUR"),
          reward_public_id:String(context.reward_public_id||""),
          payout_public_id:payoutPublicId,
          idempotency_key:String(context.idempotency_key||"")
        });
        const completed=await store.completeReferralPayout(payoutPublicId,{
          provider_account_reference:accountRef,
          provider_transfer_reference:transfer.id,
          balance_transaction_reference:transfer.balance_transaction||null,
          transferred_at:new Date().toISOString()
        });
        return {done:true,transfer_id:transfer.id,result:completed};
      }catch(error){
        const final=Number(item?.attempts||0)>=Number(item?.max_attempts||20);
        await store.markReferralPayoutFailure(payoutPublicId,{
          final,provider_account_reference:accountRef,code:cleanCode(error),message:cleanMessage(error)
        });
        throw error;
      }
    }
  };
}

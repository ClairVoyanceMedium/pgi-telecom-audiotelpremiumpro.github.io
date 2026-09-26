import {scheduleStripeSubscriptionCancellation} from "./stripe-billing.mjs";

export function createSubscriptionCancellationQueueHandlers({store,config}){
  return {
    "subscription-cancellation":async item=>{
      const publicId=String(item?.payload?.request_public_id||"").trim();
      if(!publicId)return;
      const request=await store.subscriptionCancellationRequest(publicId);
      if(["scheduled","effective"].includes(String(request.status)))return;
      try{
        const provider=await scheduleStripeSubscriptionCancellation(
          config,
          request.provider_subscription_reference,
          "subscription-cancellation/"+request.public_id
        );
        if(provider.cancel_at_period_end!==true)throw failure("STRIPE_CANCELLATION_NOT_SCHEDULED");
        await store.markSubscriptionCancellationRequest(request.public_id,"scheduled",{provider});
      }catch(error){
        await store.markSubscriptionCancellationRequest(request.public_id,"provider_pending",{error_code:error?.code||error?.message||"PROVIDER_CANCELLATION_FAILED"});
        throw error;
      }
    }
  };
}
function failure(code){const e=new Error(code);e.code=code;return e;}

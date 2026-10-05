import {randomUUID} from "node:crypto";
import {evaluateAlerts} from "./alerts.mjs";
import {drainTransactionalEmails,drainDunningTransactionalEmails} from "./email-dispatcher.mjs";
import {retrieveStripeCardCheckout,retrieveStripeConnectedAccount,ensureStripeTransferRecipient,normalizeStripeConnectedAccount,createStripeReferralTransfer} from "./stripe-connect.mjs";

export function startWorkers({store,eventBus,config,queueHandlers={}}){
  let stopped=false;
  const ownerId=randomUUID();
  const timers=[];
  const stats={
    outboxRuns:0,outboxErrors:0,alertsRuns:0,alertsErrors:0,
    queueRuns:0,queueErrors:0,queueProcessed:0,queueDeadLetters:0,
    referralPayoutRuns:0,referralPayoutPaid:0,referralPayoutDeferred:0,referralPayoutErrors:0,
    lastOutboxSuccessAt:null,lastAlertsSuccessAt:null,lastQueueSuccessAt:null,lastReferralPayoutSuccessAt:null,
    lastOutboxErrorAt:null,lastAlertsErrorAt:null,lastQueueErrorAt:null,lastReferralPayoutErrorAt:null
  };

  const runOutbox=async()=>{
    if(stopped)return;
    stats.outboxRuns++;
    try{
      await store.drainOutbox(async event=>{
        eventBus.publish("outbox.event",{
          event_type:event.event_type,
          aggregate_type:event.aggregate_type,
          aggregate_id:event.aggregate_id
        },{relay:false});
      },100);
      if(config.transactionalEmailEnabled)await drainTransactionalEmails({store,config,limit:100});
      stats.lastOutboxSuccessAt=new Date().toISOString();
    }catch{
      stats.outboxErrors++;
      stats.lastOutboxErrorAt=new Date().toISOString();
    }
  };

  const runAlerts=async()=>{
    if(stopped)return;
    stats.alertsRuns++;
    try{
      if(typeof store.acquireWorkerLease==="function"){
        const acquired=await store.acquireWorkerLease("alerts",ownerId,config.workerLeaseSeconds||45);
        if(!acquired){
          stats.lastAlertsSuccessAt=new Date().toISOString();
          return;
        }
      }
      const now=new Date();
      const from=new Date(now.getTime()-24*3600000);
      const [summary,system]=await Promise.all([
        store.summary(from.toISOString(),now.toISOString()),
        store.systemSnapshot()
      ]);
      const alerts=evaluateAlerts({
        ...summary,
        cdr_lag_seconds:system.cdr_lag_seconds,
        outbox_pending:system.outbox_pending
      },{
        varianceWarnHt:Math.max(config.reconciliationToleranceHt,1)
      });
      for(const a of alerts)eventBus.publish("alert",a);
      if(typeof store.scanUnpaidSubscriptions==="function")await store.scanUnpaidSubscriptions(500);
      if(config.transactionalEmailEnabled)await drainDunningTransactionalEmails({store,config,limit:100});
      if(typeof store.scanRegulatoryReviews==="function")await store.scanRegulatoryReviews(1000);
      if(typeof store.scanVoiceIncidents==="function")await store.scanVoiceIncidents();
      if(typeof store.scanTenantServiceIncidents==="function")await store.scanTenantServiceIncidents(250);
      if(typeof store.scanPortabilityAutomation==="function")await store.scanPortabilityAutomation(100);
      if(typeof store.scanOutboundPortabilityAutomation==="function")await store.scanOutboundPortabilityAutomation(100);
      if(typeof store.runDueBusinessLiveResets==="function")await store.runDueBusinessLiveResets(250);
      if(config.stripeSecretKey&&typeof store.openCardPaymentReconciliationBatch==="function"&&typeof store.applyCardPaymentProviderEvent==="function"){
        const batch=await store.openCardPaymentReconciliationBatch(25);
        for(const item of batch){
          try{
            const snapshot=await retrieveStripeCardCheckout(config,item.provider_account_reference,item.provider_checkout_session_reference);
            if(snapshot.status!=="open"){
              await store.applyCardPaymentProviderEvent({
                provider:"stripe",
                provider_event_id:"worker:"+snapshot.provider_checkout_session_reference+":"+snapshot.status,
                event_type:"checkout.session.reconciled",
                event_time:new Date().toISOString(),
                connected_account_reference:item.provider_account_reference,
                request_public_id:item.request_public_id,
                status:snapshot.status,
                provider_checkout_session_reference:snapshot.provider_checkout_session_reference,
                provider_payment_intent_reference:snapshot.provider_payment_intent_reference,
                payload_sha256:"0".repeat(64)
              });
            }
          }catch(_error){}
        }
      }
      if(config.stripeSecretKey&&typeof store.claimReferralRewardPayoutBatch==="function"){
        stats.referralPayoutRuns++;
        const rewards=await store.claimReferralRewardPayoutBatch(25);
        for(const reward of rewards){
          try{
            const destination=String(reward.provider_account_reference||"");
            if(!/^acct_[A-Za-z0-9]+$/.test(destination)){
              await store.deferReferralRewardPayout(reward.id,{
                state:"action_required",
                error_code:"REFERRAL_PAYOUT_ACCOUNT_REQUIRED",
                delay_seconds:21600
              });
              stats.referralPayoutDeferred++;
              continue;
            }
            let remote=await retrieveStripeConnectedAccount(config,destination);
            let normalized=normalizeStripeConnectedAccount(remote);
            if(normalized.transfers_requested!==true){
              remote=await ensureStripeTransferRecipient(config,destination,{idempotency_key:"referral-recipient/"+destination});
              normalized=normalizeStripeConnectedAccount(remote);
            }
            if(typeof store.syncCustomerCardPaymentAccount==="function"){
              await store.syncCustomerCardPaymentAccount(reward.tenant_id,normalized);
            }
            if(normalized.transfers_enabled!==true){
              await store.deferReferralRewardPayout(reward.id,{
                state:"action_required",
                error_code:"REFERRAL_PAYOUT_STRIPE_ONBOARDING_REQUIRED",
                destination_reference:destination,
                delay_seconds:21600
              });
              stats.referralPayoutDeferred++;
              continue;
            }
            const transfer=await createStripeReferralTransfer(config,{
              connected_account:destination,
              tenant_public_id:reward.tenant_public_id,
              reward_public_id:reward.public_id,
              amount_minor:reward.amount_minor,
              currency:reward.currency
            });
            await store.completeReferralRewardPayout(reward.id,transfer);
            stats.referralPayoutPaid++;
            stats.lastReferralPayoutSuccessAt=new Date().toISOString();
          }catch(error){
            const code=String(error?.code||"REFERRAL_PAYOUT_FAILED").toUpperCase().slice(0,120);
            const actionRequired=Number(error?.status)===422&&/(ACCOUNT|CAPABILITY|REQUIRE|IDENTITY|ONBOARD|RECIPIENT|PAYOUT)/.test(code);
            const attempt=Math.max(1,Number(reward.payout_attempt_count||1));
            const delay=actionRequired?21600:Math.min(21600,Math.max(900,900*Math.pow(2,Math.min(4,attempt-1))));
            try{
              await store.deferReferralRewardPayout(reward.id,{
                state:actionRequired?"action_required":"retry",
                error_code:code,
                destination_reference:reward.provider_account_reference||null,
                delay_seconds:delay
              });
              stats.referralPayoutDeferred++;
            }catch(_deferError){}
            stats.referralPayoutErrors++;
            stats.lastReferralPayoutErrorAt=new Date().toISOString();
          }
        }
      }
      stats.lastAlertsSuccessAt=new Date().toISOString();
    }catch{
      stats.alertsErrors++;
      stats.lastAlertsErrorAt=new Date().toISOString();
    }
  };

  const runQueues=async()=>{
    if(stopped||typeof store.claimWork!=="function")return;
    const queueNames=Object.keys(queueHandlers||{}).sort();
    if(!queueNames.length)return;
    stats.queueRuns++;
    try{
      for(const queueName of queueNames){
        const handler=queueHandlers[queueName];
        if(typeof handler!=="function")continue;
        const work=await store.claimWork(
          queueName,ownerId,
          config.workQueueBatchSize||25,
          config.workQueueLeaseSeconds||60
        );
        for(const item of work){
          const leaseSeconds=config.workQueueLeaseSeconds||60;
          const heartbeat=()=>typeof store.extendWorkLease==="function"
            ?store.extendWorkLease(item.id,ownerId,leaseSeconds)
            :Promise.resolve(null);
          const heartbeatTimer=typeof store.extendWorkLease==="function"
            ?setInterval(()=>{Promise.resolve(heartbeat()).catch(()=>{});},Math.max(5000,Math.floor(leaseSeconds*1000/3)))
            :null;
          heartbeatTimer?.unref?.();
          try{
            await handler(item,{store,eventBus,config,ownerId,heartbeat});
            await store.completeWork(item.id,ownerId);
            stats.queueProcessed++;
          }catch(error){
            let result=null;
            try{
              result=await store.failWork(
                item.id,ownerId,error?.message||"queue handler failed",
                config.workQueueRetryBaseSeconds||15
              );
            }catch(leaseError){
              if(leaseError?.code!=="WORK_LEASE_LOST")throw leaseError;
            }
            if(result?.state==="dead_lettered")stats.queueDeadLetters++;
            stats.queueErrors++;
            stats.lastQueueErrorAt=new Date().toISOString();
          }finally{
            if(heartbeatTimer)clearInterval(heartbeatTimer);
          }
        }
      }
      stats.lastQueueSuccessAt=new Date().toISOString();
    }catch{
      stats.queueErrors++;
      stats.lastQueueErrorAt=new Date().toISOString();
    }
  };

  timers.push(setInterval(runOutbox,1000));
  timers.push(setInterval(runAlerts,30000));
  timers.push(setInterval(runQueues,config.workQueuePollMs||1000));
  for(const t of timers)t.unref?.();

  runOutbox();
  runAlerts();
  runQueues();

  return {
    stats,
    stop(){
      stopped=true;
      for(const t of timers)clearInterval(t);
      if(typeof store.releaseWorkerLease==="function"){
        Promise.resolve(store.releaseWorkerLease("alerts",ownerId)).catch(()=>{});
      }
    }
  };
}

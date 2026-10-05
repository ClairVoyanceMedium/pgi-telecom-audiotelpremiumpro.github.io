import {randomUUID} from "node:crypto";
import {evaluateAlerts} from "./alerts.mjs";
import {drainTransactionalEmails,drainDunningTransactionalEmails} from "./email-dispatcher.mjs";
import {retrieveStripeCardCheckout,retrieveStripeConnectedAccount,normalizeStripeConnectedAccount,createStripeReferralTransfer} from "./stripe-connect.mjs";

export function startWorkers({store,eventBus,config,queueHandlers={}}){
  let stopped=false;
  const ownerId=randomUUID();
  const timers=[];
  const stats={
    outboxRuns:0,outboxErrors:0,alertsRuns:0,alertsErrors:0,
    referralPayoutProcessed:0,referralPayoutDeferred:0,referralPayoutErrors:0,
    queueRuns:0,queueErrors:0,queueProcessed:0,queueDeadLetters:0,
    lastOutboxSuccessAt:null,lastAlertsSuccessAt:null,lastQueueSuccessAt:null,
    lastOutboxErrorAt:null,lastAlertsErrorAt:null,lastQueueErrorAt:null
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

  function referralRetryAt(attempt){
    const n=Math.max(1,Math.trunc(Number(attempt)||1));
    const seconds=Math.min(3600,Math.max(60,60*Math.pow(2,Math.min(6,n-1))));
    return new Date(Date.now()+seconds*1000).toISOString();
  }
  function referralMissingDetailsRetryAt(){
    return new Date(Date.now()+6*3600000).toISOString();
  }

  const runAlerts=async()=>{
    if(stopped)return;
    stats.alertsRuns++;
    try{
      if(typeof store.acquireWorkerLease==="function"){
        const acquired=await store.acquireWorkerLease("alerts",ownerId,config.workerLeaseSeconds||45);
        if(!acquired){
          if(config.stripeSecretKey&&typeof store.claimCustomerReferralPayoutBatch==="function"){
        const payoutBatch=await store.claimCustomerReferralPayoutBatch(20);
        for(const reward of payoutBatch){
          let accountRef=String(reward.provider_account_reference||"");
          let transfersEnabled=reward.transfers_enabled===true;
          if(accountRef&&!transfersEnabled&&typeof store.syncCustomerCardPaymentAccount==="function"){
            try{
              const remote=await retrieveStripeConnectedAccount(config,accountRef);
              const normalized=normalizeStripeConnectedAccount(remote);
              await store.syncCustomerCardPaymentAccount(reward.tenant_id||reward.referrer_tenant_id||0,normalized).catch(()=>null);
              transfersEnabled=normalized.transfers_enabled===true;
            }catch(_error){}
          }
          if(!accountRef||!transfersEnabled){
            await store.deferCustomerReferralPayout(reward.id,{
              status:"missing_payout_details",
              error_code:!accountRef?"REFERRAL_PAYOUT_ACCOUNT_MISSING":"REFERRAL_PAYOUT_ACCOUNT_NOT_READY",
              retry_at:referralMissingDetailsRetryAt()
            });
            stats.referralPayoutDeferred++;
            continue;
          }
          try{
            const transfer=await createStripeReferralTransfer(config,{
              connected_account:accountRef,
              tenant_public_id:reward.tenant_public_id,
              reward_public_id:reward.public_id,
              amount_minor:reward.amount_minor,
              currency:reward.currency,
              idempotency_key:"referral-reward/"+reward.public_id+"/v1"
            });
            await store.completeCustomerReferralPayout(reward.id,transfer);
            stats.referralPayoutProcessed++;
          }catch(error){
            await store.deferCustomerReferralPayout(reward.id,{
              status:"failed",
              error_code:error?.code||"REFERRAL_PAYOUT_TRANSFER_FAILED",
              retry_at:referralRetryAt(reward.payout_attempt_count)
            }).catch(()=>null);
            stats.referralPayoutErrors++;
          }
        }
      }
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

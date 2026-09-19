import {randomUUID} from "node:crypto";
import {evaluateAlerts} from "./alerts.mjs";

export function startWorkers({store,eventBus,config,queueHandlers={}}){
  let stopped=false;
  const ownerId=randomUUID();
  const timers=[];
  const stats={
    outboxRuns:0,outboxErrors:0,alertsRuns:0,alertsErrors:0,
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

import {evaluateAlerts} from "./alerts.mjs";

export function startWorkers({store,eventBus,config}){
  let stopped=false;
  const timers=[];
  const stats={
    outboxRuns:0,outboxErrors:0,alertsRuns:0,alertsErrors:0,
    lastOutboxSuccessAt:null,lastAlertsSuccessAt:null,
    lastOutboxErrorAt:null,lastAlertsErrorAt:null
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
        });
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
      stats.lastAlertsSuccessAt=new Date().toISOString();
    }catch{
      stats.alertsErrors++;
      stats.lastAlertsErrorAt=new Date().toISOString();
    }
  };

  timers.push(setInterval(runOutbox,1000));
  timers.push(setInterval(runAlerts,30000));
  for(const t of timers)t.unref?.();

  runOutbox();
  runAlerts();

  return {
    stats,
    stop(){
      stopped=true;
      for(const t of timers)clearInterval(t);
    }
  };
}

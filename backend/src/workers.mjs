import {evaluateAlerts} from "./alerts.mjs";

export function startWorkers({store,eventBus,config}){
  let stopped=false;
  const timers=[];

  const runOutbox=async()=>{
    if(stopped)return;
    try{
      await store.drainOutbox(async event=>{
        eventBus.publish("outbox.event",{
          event_type:event.event_type,
          aggregate_type:event.aggregate_type,
          aggregate_id:event.aggregate_id
        });
      },100);
    }catch{}
  };

  const runAlerts=async()=>{
    if(stopped)return;
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
    }catch{}
  };

  timers.push(setInterval(runOutbox,1000));
  timers.push(setInterval(runAlerts,30000));
  for(const t of timers)t.unref?.();

  runOutbox();
  runAlerts();

  return {
    stop(){
      stopped=true;
      for(const t of timers)clearInterval(t);
    }
  };
}

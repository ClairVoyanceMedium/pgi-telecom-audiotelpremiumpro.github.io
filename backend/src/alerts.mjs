export function evaluateAlerts(snapshot,thresholds={}){
  const t={
    minCallsForAsr:Number(thresholds.minCallsForAsr??20),
    asrWarnPercent:Number(thresholds.asrWarnPercent??75),
    varianceWarnHt:Number(thresholds.varianceWarnHt??1),
    cdrStaleSeconds:Number(thresholds.cdrStaleSeconds??120),
    outboxWarn:Number(thresholds.outboxWarn??100)
  };
  const alerts=[];
  if(snapshot.calls_total>=t.minCallsForAsr&&snapshot.asr_percent<t.asrWarnPercent){
    alerts.push(alert("warning","asr_low","ASR sous le seuil",snapshot.asr_percent));
  }
  if(Math.abs(snapshot.reconciliation_variance_ht||0)>t.varianceWarnHt){
    alerts.push(alert("warning","financial_variance","Écart financier à rapprocher",snapshot.reconciliation_variance_ht));
  }
  if(Number(snapshot.cdr_lag_seconds||0)>t.cdrStaleSeconds){
    alerts.push(alert("critical","cdr_stale","Ingestion CDR en retard",snapshot.cdr_lag_seconds));
  }
  if(Number(snapshot.outbox_pending||0)>t.outboxWarn){
    alerts.push(alert("warning","outbox_backlog","File outbox élevée",snapshot.outbox_pending));
  }
  return alerts;
}
function alert(severity,code,message,value){
  return Object.freeze({severity,code,message,value,at:new Date().toISOString()});
}

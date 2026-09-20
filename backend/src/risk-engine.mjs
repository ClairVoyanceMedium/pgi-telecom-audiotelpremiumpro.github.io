function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function q(a,b){return b>0?a/b:0;}
export function assessOperationalRisk(features={}){
  const calls=Math.max(0,n(features.calls_7d)),failed=Math.max(0,n(features.failed_7d));
  const expected=Math.max(0,n(features.expected_7d)),variance=Math.abs(n(features.variance_7d));
  const lastHour=Math.max(0,n(features.calls_last_hour)),avgHourly=Math.max(0,n(features.avg_hourly_7d));
  const failureRatio=q(failed,calls),varianceRatio=q(variance,expected);
  const surgeRatio=avgHourly>0?lastHour/avgHourly:(lastHour>0?10:0);
  let score=0;const signals=[];
  const add=(points,code,label,value)=>{score+=points;signals.push({code,label,value,points});};
  if(failureRatio>=.20)add(30,"CALL_FAILURE_RATE_CRITICAL","Taux d'appels en échec élevé",failureRatio);
  else if(failureRatio>=.10)add(20,"CALL_FAILURE_RATE_HIGH","Taux d'appels en échec supérieur au seuil interne",failureRatio);
  else if(failureRatio>=.05)add(8,"CALL_FAILURE_RATE_WATCH","Taux d'appels en échec à surveiller",failureRatio);
  if(surgeRatio>=8)add(25,"TRAFFIC_SURGE_CRITICAL","Volume horaire très supérieur à la moyenne 7 jours",surgeRatio);
  else if(surgeRatio>=3)add(15,"TRAFFIC_SURGE","Pic de trafic inhabituel",surgeRatio);
  if(varianceRatio>=.02)add(25,"FINANCIAL_VARIANCE_CRITICAL","Écart de rapprochement supérieur à 2 %",varianceRatio);
  else if(varianceRatio>=.005)add(12,"FINANCIAL_VARIANCE","Écart de rapprochement supérieur à 0,5 %",varianceRatio);
  if(n(features.service_critical)>0)add(20,"SERVICE_CRITICAL","Incident(s) critique(s) ouvert(s)",n(features.service_critical));
  if(n(features.regulatory_blocking)>0)add(25,"REGULATORY_BLOCKING","Blocage(s) réglementaire(s)",n(features.regulatory_blocking));
  if(n(features.queue_dead_lettered)>0)add(25,"DEAD_LETTER","Tâche(s) en dead-letter",n(features.queue_dead_lettered));
  score=Math.min(100,score);
  const level=score>=70?"critical":score>=40?"high":score>=20?"attention":"healthy";
  return {schema_version:"audiotel-risk/1",score,level,signals,metrics:{calls_7d:calls,failure_ratio:failureRatio,traffic_surge_ratio:surgeRatio,reconciliation_variance_ratio:varianceRatio},privacy:"aggregate_only",mutates_state:false};
}

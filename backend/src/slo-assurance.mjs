function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
export function assessOperationalSlo(features={}){
  const regionsTotal=Math.max(0,n(features.regions_total)),regionsReady=Math.max(0,n(features.regions_ready));
  const regionTarget=regionsTotal>=2?2:(regionsTotal===1?1:0);
  const objectives=[
    {key:"cdr_freshness",label:"Fraîcheur CDR ≤ 300 s",target:300,value:Math.max(0,n(features.cdr_lag_seconds)),pass:n(features.cdr_lag_seconds)<=300},
    {key:"queue_age",label:"File de travail ≤ 120 s",target:120,value:Math.max(0,n(features.queue_oldest_seconds)),pass:n(features.queue_oldest_seconds)<=120},
    {key:"dead_letter",label:"Aucune dead-letter",target:0,value:Math.max(0,n(features.queue_dead_lettered)),pass:n(features.queue_dead_lettered)===0},
    {key:"critical_incidents",label:"Aucun incident critique ouvert",target:0,value:Math.max(0,n(features.service_critical)),pass:n(features.service_critical)===0},
    {key:"resolution_overdue",label:"Aucune résolution SLA dépassée",target:0,value:Math.max(0,n(features.resolution_overdue)),pass:n(features.resolution_overdue)===0},
    {key:"region_resilience",label:"Régions prêtes",target:regionTarget,value:regionsReady,pass:regionTarget===0||regionsReady>=regionTarget}
  ];
  const score=Math.round(100*objectives.filter(x=>x.pass).length/objectives.length);
  const critical=objectives.some(x=>!x.pass&&["dead_letter","critical_incidents","region_resilience"].includes(x.key));
  return {schema_version:"audiotel-slo/1",score,state:critical?"critical":(score===100?"healthy":"burning"),objectives,api_availability:{target_percent:99.9,measurement:"prometheus_burn_rate",current_percent:null},note:"La disponibilité API réelle reste mesurée par Prometheus ; ce snapshot couvre les SLO opérationnels internes.",mutates_state:false};
}

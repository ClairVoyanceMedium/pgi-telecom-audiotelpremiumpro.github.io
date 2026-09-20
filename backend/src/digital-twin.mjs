function num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
function impact(level,title,detail){return {level,title,detail};}

export function simulateDigitalTwin(scenario,baseline={},params={}){
  scenario=String(scenario||"").trim().toLowerCase();
  const supported=["carrier_outage","traffic_spike","mass_portability","regulatory_expiry","billing_failure","region_failure","database_failure","worker_backlog","settlement_mismatch","hyperscale_growth"];
  if(!supported.includes(scenario)){const e=new Error("Unsupported digital twin scenario");e.code="UNSUPPORTED_DIGITAL_TWIN_SCENARIO";throw e;}

  const activeAssignments=num(baseline.active_assignments);
  const activeSubscriptions=num(baseline.active_subscriptions);
  const readyNumbers=num(baseline.ready_numbers);
  const totalNumbers=num(baseline.total_numbers);
  const routeStandbyReady=Boolean(baseline.route_standby_ready);
  const capacity=Math.max(0,num(baseline.destination_capacity));
  const currentConcurrent=Math.max(0,num(baseline.current_concurrent));
  const regionsReady=Math.max(0,num(baseline.regions_ready));
  const regionsTotal=Math.max(0,num(baseline.regions_total));
  const drTargets=Math.max(0,num(baseline.dr_targets));
  const queuePending=Math.max(0,num(baseline.queue_pending));
  const queueDead=Math.max(0,num(baseline.queue_dead_lettered));
  const bucketCapacity=Math.max(1,num(baseline.bucket_capacity,4096));
  const readReplica=Boolean(baseline.read_replica_enabled);
  const impacts=[];
  let severity="info",affected=0,estimatedLoad=currentConcurrent;

  if(scenario==="carrier_outage"){
    affected=activeAssignments;
    if(routeStandbyReady){
      severity="warning";
      impacts.push(impact("warning","Bascule opérateur requise",affected+" affectation(s) dépendent de la route principale ; une route de secours est déclarée prête."));
    }else{
      severity="critical";
      impacts.push(impact("critical","Risque d’indisponibilité SVA",affected+" affectation(s) pourraient perdre leur route faute de secours prêt."));
    }
  }

  if(scenario==="traffic_spike"){
    const multiplier=clamp(num(params.multiplier,3),1,100);
    estimatedLoad=Math.ceil(Math.max(1,currentConcurrent||activeAssignments)*multiplier);
    affected=Math.max(0,estimatedLoad-capacity);
    if(capacity===0){
      severity="critical";
      impacts.push(impact("critical","Capacité inconnue ou nulle","Aucune capacité de destination exploitable n’est disponible pour projeter la charge."));
    }else if(estimatedLoad>capacity){
      severity="critical";
      impacts.push(impact("critical","Capacité dépassée",estimatedLoad+" appels simultanés estimés pour une capacité déclarée de "+capacity+"."));
    }else if(estimatedLoad>capacity*.75){
      severity="warning";
      impacts.push(impact("warning","Marge de capacité réduite",estimatedLoad+" appels simultanés estimés, soit plus de 75 % de la capacité."));
    }else impacts.push(impact("info","Capacité suffisante",estimatedLoad+" appels simultanés estimés pour "+capacity+" disponibles."));
  }

  if(scenario==="mass_portability"){
    const requested=Math.max(1,Math.floor(num(params.count,1000)));
    const batch=Math.max(1,Math.floor(num(params.batch_size,250)));
    const waves=Math.ceil(requested/batch);
    affected=requested;
    severity=requested>5000?"warning":"info";
    impacts.push(impact(severity,"Portabilité en lots",requested+" numéro(s) simulés en "+waves+" vague(s) de "+batch+" maximum, sans modifier les dossiers réels."));
  }

  if(scenario==="regulatory_expiry"){
    affected=Math.max(0,readyNumbers);
    severity=affected?"critical":"info";
    impacts.push(impact(severity,"Expiration réglementaire simulée",affected+" numéro(s) actuellement prêt(s) seraient à revalider avant toute nouvelle activation."));
    if(totalNumbers>readyNumbers)impacts.push(impact("warning","Dette de conformité existante",(totalNumbers-readyNumbers)+" numéro(s) ne sont déjà pas dans l’état prêt."));
  }

  if(scenario==="billing_failure"){
    const percent=clamp(num(params.percent,10),0,100);
    affected=Math.ceil(activeSubscriptions*percent/100);
    severity=percent>=50?"critical":(percent>=20?"warning":"info");
    impacts.push(impact(severity,"Échec d’abonnements",affected+" abonnement(s) actif(s) seraient affectés sur "+activeSubscriptions+" pour un scénario à "+percent+" %."));
  }

  if(scenario==="region_failure"){
    affected=activeAssignments;
    if(regionsReady>1&&drTargets>0){
      severity="warning";
      impacts.push(impact("warning","Bascule inter-région",regionsReady+" région(s) sont prêtes et "+drTargets+" cible(s) DR sont déclarées."));
    }else{
      severity="critical";
      impacts.push(impact("critical","Résilience régionale insuffisante","Le scénario laisse moins de deux régions prêtes ou aucune cible DR exploitable."));
    }
  }

  if(scenario==="database_failure"){
    affected=activeAssignments;
    if(regionsReady>1&&drTargets>0){
      severity="warning";
      impacts.push(impact("warning","Perte base principale simulée","La plateforme dispose de plusieurs régions et de cibles DR, mais la reprise d’écriture doit être validée par un exercice de restauration/bascule."));
    }else{
      severity="critical";
      impacts.push(impact("critical","Reprise base insuffisamment redondante","Le scénario ne dispose pas d’assez de régions/cibles DR déclarées pour absorber sereinement la perte de la base principale."));
    }
    if(readReplica)impacts.push(impact("info","Réplique de lecture disponible","Une réplique de lecture est configurée ; elle réduit l’impact lecture mais ne prouve pas une reprise d’écriture."));
  }

  if(scenario==="worker_backlog"){
    const pending=Math.max(0,Math.floor(num(params.pending,queuePending||1000)));
    affected=pending;
    severity=queueDead>0||pending>=1000?"critical":(pending>=100?"warning":"info");
    impacts.push(impact(severity,"Backlog workers simulé",pending+" tâche(s) en attente et "+queueDead+" dead-letter(s) dans le scénario."));
  }

  if(scenario==="settlement_mismatch"){
    const percent=clamp(num(params.percent,3),0,100);
    affected=Math.ceil(activeAssignments*percent/100);
    severity=percent>=2?"critical":(percent>=.5?"warning":"info");
    impacts.push(impact(severity,"Écart de règlement simulé","Écart attendu/confirmé de "+percent+" % appliqué au périmètre financier simulé."));
  }

  if(scenario==="hyperscale_growth"){
    const clients=Math.max(1,Math.floor(num(params.clients,1000000)));
    const callsPerClient=Math.max(1,Math.floor(num(params.calls_per_client_day,20)));
    const dailyCalls=clients*callsPerClient;
    const perBucket=Math.ceil(dailyCalls/bucketCapacity);
    affected=clients;severity=clients>1000000?"warning":"info";
    impacts.push(impact(severity,"Projection hyperscale",clients+" client(s), "+dailyCalls+" appel(s)/jour, environ "+perBucket+" appel(s) par bucket/jour sur "+bucketCapacity+" buckets."));
  }

  const recommendations=[];
  if(severity==="critical")recommendations.push("Traiter les dépendances bloquantes avant mise en production ou montée en charge.");
  if(scenario==="carrier_outage"&&!routeStandbyReady)recommendations.push("Préparer et tester une route opérateur de secours avec rollback.");
  if(scenario==="traffic_spike"&&estimatedLoad>capacity)recommendations.push("Augmenter la capacité ou répartir la charge avant le pic.");
  if(scenario==="mass_portability")recommendations.push("Conserver des lots bornés et une reprise idempotente par dossier.");
  if(scenario==="regulatory_expiry")recommendations.push("Planifier les revues avant échéance et conserver les preuves append-only.");
  if(scenario==="billing_failure")recommendations.push("Utiliser une file d’impayés et des relances avant toute suspension explicite.");
  if(scenario==="region_failure")recommendations.push("Tester régulièrement le basculement DR sans modifier les données client.");
  if(scenario==="database_failure")recommendations.push("Exécuter un restore drill isolé et documenter RPO/RTO avant production.");
  if(scenario==="worker_backlog")recommendations.push("Valider leases, retries, dead-letter et capacité des workers sous backlog contrôlé.");
  if(scenario==="settlement_mismatch")recommendations.push("Bloquer le reversement concerné jusqu’au rapprochement attendu/confirmé.");
  if(scenario==="hyperscale_growth")recommendations.push("Utiliser cette projection pour dimensionner les tests de charge, pas comme preuve de capacité réelle.");

  return {
    schema_version:"audiotel-digital-twin/2",
    scenario,
    severity,
    affected,
    baseline:{...baseline},
    parameters:{...params},
    projections:{estimated_concurrent:estimatedLoad,destination_capacity:capacity,capacity_headroom:Math.max(0,capacity-estimatedLoad)},
    impacts,
    recommendations,
    dry_run:true,
    mutates_state:false,
    simulated_at:new Date().toISOString()
  };
}

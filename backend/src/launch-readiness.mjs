const STATUS=Object.freeze({READY:"ready",ACTION:"action_required",BLOCKED:"blocked",PENDING:"pending_external"});

function section(key,label,status,detail,blockingFor=[]){
  return Object.freeze({key,label,status,detail,blocking_for:blockingFor});
}

function bool(v){return v===true;}
function number(v){const n=Number(v);return Number.isFinite(n)?n:0;}

export function evaluateLaunchReadiness(input={}){
  const config=input.config||{},system=input.system||{},performance=input.performance||{},platform=input.platform||{},billing=input.billingProvider||{},billingAccount=input.billingAccount||{},carrier=input.carrier||{},withdrawalReady=input.withdrawalReady===true;
  const summary=platform.summary||{},regulatory=platform.regulatory_trust?.summary||{},scale=platform.scale||{},route=carrier.route||system.carrier_route||{};
  const production=config.mode==="production";

  const databaseReady=!production||system.store==="postgres";
  const runtimeReady=number(system.work_queue?.dead_lettered)===0&&number(system.service_operations?.service_incidents_critical)===0&&(
    number(system.resilience?.regions_total)===0||number(system.resilience?.regions_ready)>=number(system.resilience?.regions_total)
  );
  const securityReady=!production||(
    config.authMode==="session"&&String(config.sessionSecret||"").length>=32&&config.protectMachineEndpoints===true
  );
  const emailReady=bool(config.transactionalEmailEnabled)&&/^re_/.test(String(config.resendApiKey||""))&&/^whsec_/.test(String(config.resendWebhookSecret||""));
  const billingReady=billing.connection_state==="connected"&&billing.stripe_live_mode===true&&billingAccount.reachable===true&&billingAccount.charges_enabled===true&&billingAccount.payouts_enabled===true&&billingAccount.details_submitted===true;
  const legalIdentityReady=bool(config.legalOperatorConfigured);
  const b2cLegalReady=bool(config.consumerMediatorConfigured)&&withdrawalReady&&bool(config.b2cCommercialReady);
  const operatorHealth=String(route.active_connection_last_health_status||"").toLowerCase();
  const operatorHealthBad=["down","failed","error","critical","unhealthy"].includes(operatorHealth);
  const operatorReady=Boolean(route.active_carrier||route.active_carrier_id)&&["active","ready"].includes(String(route.active_connection_state||"").toLowerCase())&&!operatorHealthBad;
  const regulatoryReady=number(summary.assignments_total)>0&&number(regulatory.review_blocking)===0&&number(regulatory.numbers_ready)>=number(summary.assignments_total);
  const resilienceReady=performance.preproduction_gate?.ready===true;
  const payoutReady=summary.payment_compliance_active===true||number(summary.assignments_total)===0;

  const sections=[
    section("database","Base de données",databaseReady?STATUS.READY:STATUS.BLOCKED,databaseReady?"Stockage persistant conforme au mode courant.":"La production doit utiliser PostgreSQL.",["b2b","b2c"]),
    section("runtime","Santé opérationnelle",runtimeReady?STATUS.READY:STATUS.BLOCKED,runtimeReady?"Aucun incident critique ni dead-letter bloquant.":"Traiter les incidents critiques, dead letters ou régions indisponibles.",["b2b","b2c"]),
    section("security","Sécurité production",securityReady?STATUS.READY:STATUS.BLOCKED,securityReady?"Authentification et endpoints machine verrouillés.":"Session forte et protection des endpoints machine requises.",["b2b","b2c"]),
    section("email","Emails transactionnels",emailReady?STATUS.READY:STATUS.ACTION,emailReady?"Envoi transactionnel et webhook configurés.":"Configurer et valider Resend avant les parcours commerciaux.",["b2b","b2c"]),
    section("billing","Paiements Stripe",billingReady?STATUS.READY:STATUS.ACTION,billingReady?"Stripe live est joignable, vérifié et autorisé à encaisser/payer.":billingAccount.reachable===true?"Le compte Stripe répond mais ses capacités/KYC ne sont pas entièrement activées ("+number(billingAccount.requirements_due?.length)+" exigence(s) restante(s)).":"Stripe live doit être connecté, joignable et opérationnel avant encaissement.",["b2b","b2c"]),
    section("legal_identity","Identité juridique",legalIdentityReady?STATUS.READY:STATUS.ACTION,legalIdentityReady?"Identité juridique de l’exploitant configurée.":"Compléter l’identité juridique réelle avant ouverture commerciale.",["b2b","b2c"]),
    section("b2c_legal","Protection consommateurs",b2cLegalReady?STATUS.READY:STATUS.ACTION,b2cLegalReady?"Médiation et rétractation en ligne sont opérationnelles.":"Médiateur, identité et/ou prérequis B2C restent à finaliser.",["b2c"]),
    section("operator","Opérateur / routage SVA",operatorReady?STATUS.READY:STATUS.PENDING,operatorReady?"Une connexion opérateur active est disponible et aucun état de santé défavorable n’est signalé.":operatorHealthBad?"La connexion opérateur active signale un état de santé défavorable ("+operatorHealth+").":"Aucun branchement opérateur actif vérifié.",["b2b","b2c"]),
    section("regulatory","Conformité SVA",regulatoryReady?STATUS.READY:STATUS.PENDING,regulatoryReady?"Toutes les affectations actives sont prêtes sans blocage réglementaire.":"Affectations/numéros ou preuves réglementaires restent à finaliser.",["b2b","b2c"]),
    section("resilience","Résilience préproduction",resilienceReady?STATUS.READY:STATUS.ACTION,resilienceReady?"Le gate performance/résilience est démontré par des preuves fraîches.":"Test de charge, sonde synthétique et/ou restore drill à compléter.",["b2b","b2c"]),
    section("payouts","Reversements",payoutReady?STATUS.READY:STATUS.PENDING,payoutReady?"La conformité de reversement est disponible ou aucun flux réel n’est encore actif.":"Le profil de conformité des reversements doit être activé avant paiement client.",["b2b"])
  ];

  const blockersFor=audience=>sections.filter(x=>x.blocking_for.includes(audience)&&x.status!==STATUS.READY);
  const b2bBlockers=blockersFor("b2b"),b2cBlockers=blockersFor("b2c");
  const readyCount=sections.filter(x=>x.status===STATUS.READY).length;
  return Object.freeze({
    schema_version:"pgi-launch-readiness/1",
    generated_at:new Date().toISOString(),
    production_mode:production,
    application_version:String(config.version||"")||null,
    release_id:String(config.releaseId||"")||null,
    score:Math.round(100*readyCount/sections.length),
    ready_for_b2b:b2bBlockers.length===0,
    ready_for_b2c:b2cBlockers.length===0,
    sections,
    blockers:{
      b2b:b2bBlockers.map(x=>x.key),
      b2c:b2cBlockers.map(x=>x.key)
    },
    facts:{
      assignments_total:number(summary.assignments_total),
      numbers_ready:number(regulatory.numbers_ready),
      regulatory_blocking:number(regulatory.review_blocking),
      regions_ready:number(scale.regions_ready||system.resilience?.regions_ready),
      regions_total:number(scale.regions_total||system.resilience?.regions_total),
      stripe_account_reachable:billingAccount.reachable===true,
      stripe_charges_enabled:billingAccount.charges_enabled===true,
      stripe_payouts_enabled:billingAccount.payouts_enabled===true,
      stripe_details_submitted:billingAccount.details_submitted===true,
      stripe_requirements_due:number(billingAccount.requirements_due?.length)
    }
  });
}

export {STATUS as LAUNCH_READINESS_STATUS};

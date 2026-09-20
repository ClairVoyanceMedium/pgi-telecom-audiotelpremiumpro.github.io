const DECISIONS=Object.freeze({ALLOWED:"ALLOWED",BLOCKED:"BLOCKED",ACTION_REQUIRED:"ACTION_REQUIRED"});

function flag(value){
  if(value===true)return true;
  if(value===false)return false;
  return null;
}
function add(list,code,label,kind="blocker"){
  list.push({code,label,kind});
}
function requireTrue(facts,key,code,label,blockers,actions,unknownIsBlocker=false){
  const value=flag(facts[key]);
  if(value===true)return;
  if(value===false)return add(blockers,code,label);
  add(unknownIsBlocker?blockers:actions,code+"_UNKNOWN",label+" — état à confirmer",unknownIsBlocker?"blocker":"action");
}
function actionTrue(facts,key,code,label,actions){
  if(flag(facts[key])!==true)add(actions,code,label,"action");
}

export function evaluateOperationalPolicy(intent,facts={}){
  intent=String(intent||"").trim().toLowerCase();
  const blockers=[],actions=[];
  if(!["activate_number","port_in","payout_customer","carrier_switch","customer_access"].includes(intent)){
    const error=new Error("Unsupported policy intent");error.code="UNSUPPORTED_POLICY_INTENT";throw error;
  }

  if(intent!=="carrier_switch")requireTrue(facts,"tenant_active","TENANT_INACTIVE","Client actif requis",blockers,actions,true);

  if(intent==="activate_number"){
    requireTrue(facts,"assignment_exists","ASSIGNMENT_REQUIRED","Affectation du numéro requise",blockers,actions,true);
    requireTrue(facts,"subscription_active","SUBSCRIPTION_REQUIRED","Abonnement actif requis",blockers,actions,true);
    requireTrue(facts,"payout_terms_ready","PAYOUT_TERMS_REQUIRED","Conditions de reversement PGI requises",blockers,actions,true);
    requireTrue(facts,"kyc_verified","KYC_REQUIRED","KYC vérifié requis",blockers,actions,true);
    requireTrue(facts,"regulatory_ready","REGULATORY_TRUST_REQUIRED","Trust Center réglementaire prêt requis",blockers,actions,true);
    requireTrue(facts,"arcep_2026_ready","ARCEP_2026_REQUIRED","Garde-fous ARCEP 2026 prêts requis",blockers,actions,true);
    requireTrue(facts,"destination_ready","DESTINATION_REQUIRED","Destination téléphonique testée et disponible requise",blockers,actions,true);
    actionTrue(facts,"operator_adapter_connected","OPERATOR_CONNECTION_PENDING","Connexion opérateur réelle à effectuer avant mise en production");
  }

  if(intent==="port_in"){
    requireTrue(facts,"subscription_active","SUBSCRIPTION_REQUIRED","Abonnement actif requis",blockers,actions,true);
    requireTrue(facts,"payout_terms_ready","PAYOUT_TERMS_REQUIRED","Conditions de reversement PGI requises",blockers,actions,true);
    requireTrue(facts,"kyc_verified","KYC_REQUIRED","KYC vérifié requis",blockers,actions,true);
    requireTrue(facts,"portability_dossier_ready","PORTABILITY_DOSSIER_REQUIRED","Dossier de portabilité complet requis",blockers,actions,false);
    actionTrue(facts,"operator_adapter_connected","PORTABILITY_PROVIDER_PENDING","Connexion au fournisseur de portabilité à effectuer");
  }

  if(intent==="payout_customer"){
    requireTrue(facts,"payout_terms_ready","PAYOUT_TERMS_REQUIRED","Conditions de reversement PGI requises",blockers,actions,true);
    requireTrue(facts,"settlement_reconciled","SETTLEMENT_RECONCILIATION_REQUIRED","Rapprochement opérateur requis avant reversement",blockers,actions,false);
    actionTrue(facts,"payment_provider_connected","PAYMENT_PROVIDER_PENDING","Prestataire de paiement réel à connecter");
  }

  if(intent==="carrier_switch"){
    requireTrue(facts,"target_carrier_ready","TARGET_CARRIER_NOT_READY","Connexion opérateur cible prête requise",blockers,actions,true);
    requireTrue(facts,"rollback_ready","ROLLBACK_REQUIRED","Plan de rollback requis",blockers,actions,false);
    actionTrue(facts,"operator_adapter_connected","OPERATOR_CONNECTION_PENDING","Adaptateur opérateur réel à connecter avant activation");
  }

  if(intent==="customer_access"){
    requireTrue(facts,"subscription_active","SUBSCRIPTION_REQUIRED","Abonnement actif requis",blockers,actions,true);
  }

  const decision=blockers.length?DECISIONS.BLOCKED:(actions.length?DECISIONS.ACTION_REQUIRED:DECISIONS.ALLOWED);
  return {
    schema_version:"audiotel-policy/1",
    intent,
    decision,
    blockers,
    required_actions:actions,
    facts:{...facts},
    dry_run:true,
    mutates_state:false,
    evaluated_at:new Date().toISOString()
  };
}

export {DECISIONS};

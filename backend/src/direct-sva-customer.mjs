// Future direct SVA customer space. Authenticated, tenant scoped, no public signup.
// No access to historical Audiotel calls, billing, referrals or third-party payouts.

function fail(status,code){const e=new Error(code);e.status=status;e.code=code;return e;}
function strictPositiveTenant(value){
 if(typeof value!=="number"&&typeof value!=="string")throw fail(403,"DIRECT_SVA_CUSTOMER_CONTEXT_REQUIRED");
 if(typeof value==="string"&&!/^[1-9][0-9]*$/.test(value))throw fail(403,"DIRECT_SVA_CUSTOMER_CONTEXT_REQUIRED");
 const id=Number(value);
 if(!Number.isSafeInteger(id)||id<1)throw fail(403,"DIRECT_SVA_CUSTOMER_CONTEXT_REQUIRED");
 return id;
}
function tenantId(context){return strictPositiveTenant(context?.tenant_id);}
export function assertDirectSvaCustomerEnrollment(enrollment,expectedTenant,commercialEnabled){
 if(!enrollment)throw fail(404,"DIRECT_SVA_CUSTOMER_ACCESS_NOT_ASSIGNED");
 if(strictPositiveTenant(enrollment.tenant_id)!==expectedTenant||
    enrollment.business_unit!=="direct_sva")
  throw fail(403,"DIRECT_SVA_CUSTOMER_TENANT_MISMATCH");
 // Preparation records cannot be published merely by lifting a route guard.
 if(commercialEnabled!==true||enrollment.access_state!=="active"||
    enrollment.dashboard_enabled!==true||enrollment.client_contract_accepted!==true)
  throw fail(403,"DIRECT_SVA_CUSTOMER_NOT_RELEASED");
 return true;
}
function assertRowsBelongToTenant(rows,id,field){
 if(!Array.isArray(rows))throw fail(503,"DIRECT_SVA_CUSTOMER_RESULT_INVALID");
 for(const row of rows){
  if(!row||strictPositiveTenant(row[field])!==id)
   throw fail(503,"DIRECT_SVA_CROSS_TENANT_RESULT_BLOCKED");
 }
}
function pgDate(value){return value instanceof Date?value.toISOString():String(value||"");}

export const DIRECT_SVA_CUSTOMER_FEATURES=Object.freeze([
 Object.freeze({key:"dossier",label:"Mes dossiers de distribution",status:"planned"}),
 Object.freeze({key:"numbers",label:"Mes numeros SVA directs",status:"planned"}),
 Object.freeze({key:"portability",label:"Portabilite directe",status:"planned"}),
 Object.freeze({key:"calls",label:"Activite telephonique directe",status:"planned"}),
 Object.freeze({key:"revenue",label:"Reversements du distributeur",status:"planned"}),
 Object.freeze({key:"billing",label:"Factures et justificatifs",status:"planned"}),
 Object.freeze({key:"support",label:"Demandes et suivi de conformite",status:"planned"})
]);

export async function directSvaCustomerOverview(store,context={}){
 if(!store?.readSql?.unsafe)throw fail(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 const id=tenantId(context);
 const [enrollment]=await store.readSql.unsafe(
  "SELECT tenant_id,business_unit,access_state,dashboard_enabled,client_contract_accepted,created_at"+
  " FROM direct_sva_customer_accounts WHERE tenant_id=$1 AND business_unit='direct_sva'",[id]);
 if(!enrollment)throw fail(404,"DIRECT_SVA_CUSTOMER_ACCESS_NOT_ASSIGNED");
 // Validate the customer contract before attempting any records read.
 if(enrollment.access_state!=="active"||enrollment.dashboard_enabled!==true||
    enrollment.client_contract_accepted!==true)assertDirectSvaCustomerEnrollment(enrollment,id,false);
 const [release]=await store.readSql.unsafe(
  "SELECT commercial_operation_enabled FROM direct_sva_admin_switches WHERE id=1");
 assertDirectSvaCustomerEnrollment(enrollment,id,release?.commercial_operation_enabled===true);
 const [cases,numbers]=await Promise.all([
  store.readSql.unsafe(
   "SELECT tenant_id,public_reference,request_kind,status,initiated_at,last_review_at"+
   " FROM direct_sva_customer_cases WHERE tenant_id=$1 ORDER BY initiated_at DESC,id DESC LIMIT 100",[id]),
  store.readSql.unsafe(
   "SELECT editor_tenant_id,e164,number_status,regulatory_status"+
   " FROM direct_sva_number_inventory WHERE editor_tenant_id=$1 AND number_status NOT IN ('released')"+
   " ORDER BY e164 LIMIT 100",[id])
 ]);
 assertRowsBelongToTenant(cases,id,"tenant_id");
 assertRowsBelongToTenant(numbers,id,"editor_tenant_id");
 return Object.freeze({
  schema_version:"pgi-direct-sva-client/1",
  business_unit:"direct_sva",legal_entity_key:"pgi_primary",
  tenant_scope:"authenticated_customer_only",
  service_active:false,
  number_provisioning_enabled:false,
  client_payouts_enabled:false,
  accounting_status:"not_live",
  notification_status:"planned",
  customer_contract_accepted:enrollment.client_contract_accepted===true,
  account_access:"contract_verified_read_only",
  features:DIRECT_SVA_CUSTOMER_FEATURES,
  cases:cases.map(row=>({reference:row.public_reference,kind:row.request_kind,
   status:row.status,created_at:pgDate(row.initiated_at),last_review_at:pgDate(row.last_review_at)})),
  numbers:numbers.map(row=>({number:row.e164,status:row.number_status,
   compliance_status:row.regulatory_status})),
  source:"direct_sva_only"
 });
}

export const DIRECT_SVA_WORKFLOW_RULES=Object.freeze({
 lead_routing:Object.freeze({requires:["consent","contractual_scope"],side_effect:"hubspot_sync"}),
 compliance_check:Object.freeze({requires:["identity_verified","applicable_sva_rules"],side_effect:"compliance_case"}),
 contract_review:Object.freeze({requires:["signed_terms","operator_eligibility"],side_effect:"contract"}),
 number_assignment:Object.freeze({requires:["arcep_allocation","editor_kyc","signed_contract","route_test"],side_effect:"number_activation"}),
 portability:Object.freeze({requires:["rio_and_mandate","operator_validation","migration_window"],side_effect:"number_porting"}),
 cdr_ingestion:Object.freeze({requires:["carrier_signature","unique_cdr","rating_plan"],side_effect:"usage_ledger"}),
 settlement_reconciliation:Object.freeze({requires:["carrier_statement","bank_confirmation","balanced_amounts"],side_effect:"accounting_draft"}),
 accounting_draft:Object.freeze({requires:["source_evidence","expert_account_mapping"],side_effect:"double_entry"}),
 invoice_review:Object.freeze({requires:["tax_regime","invoice_evidence","accounting_validation"],side_effect:"invoice"}),
 publisher_payout:Object.freeze({requires:["psp_mandate","editor_kyc","collected_funds","approved_statement"],side_effect:"external_payment"}),
 hubspot_sync:Object.freeze({requires:["dedicated_pipeline","record_consent","crm_auth"],side_effect:"crm_write"}),
 analytics_delivery:Object.freeze({requires:["separate_ga4_property","consent","schema_verified"],side_effect:"analytics_event"}),
 support_followup:Object.freeze({requires:["explicit_customer_request","support_policy"],side_effect:"notification"})
});

export function inspectDirectSvaWorkflows(rows=[]){
 if(!Array.isArray(rows))throw fail(400,"DIRECT_SVA_WORKFLOW_ROWS_INVALID");
 const countByWorkflow=new Map();
 for(const row of rows){
  const key=String(row.workflow_key||"");
  if(!Object.hasOwn(DIRECT_SVA_WORKFLOW_RULES,key))throw fail(503,"DIRECT_SVA_UNKNOWN_WORKFLOW");
  const count=Number(row.count);
  if(!Number.isSafeInteger(count)||count<0||countByWorkflow.has(key))throw fail(503,"DIRECT_SVA_WORKFLOW_COUNT_INVALID");
  countByWorkflow.set(key,count);
 }
 return Object.freeze({
  schema_version:"pgi-direct-sva-automation-monitor/1",
  business_unit:"direct_sva",mode:"preparation",
  external_execution_enabled:false,transfers_enabled:false,automatic_number_activation:false,
  jobs:Object.entries(DIRECT_SVA_WORKFLOW_RULES).map(([key,rule])=>({
    workflow:key,state:"pending_authorization",count:countByWorkflow.get(key)||0,
    required_evidence:rule.requires,execution_authorized:false
  })),
  // Zero means no queued source records, not that the workflow has already executed.
  automation_ready:false
 });
}

export async function directSvaWorkflowOverview(store){
 if(!store?.readSql?.unsafe)throw fail(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 const rows=await store.readSql.unsafe(
  "SELECT workflow_key,count(*)::int AS count FROM direct_sva_automation_jobs"+
  " WHERE business_unit='direct_sva' GROUP BY workflow_key ORDER BY workflow_key");
 return inspectDirectSvaWorkflows(rows);
}

import {createHash} from "node:crypto";

// Preparation of a change in upstream service, never a telecom port or a payment.
// Customer identity, contract and line remain in the existing platform tables.
function fail(status,code){const e=new Error(code);e.status=status;e.code=code;return e;}
function positiveId(value,code){
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)throw fail(400,code);
 return n;
}
function adminHash(actor){
 if(actor?.role!=="admin"||typeof actor?.sub!=="string"||!actor.sub.trim())
  throw fail(403,"DIRECT_SVA_TRANSITION_ADMIN_REQUIRED");
 return createHash("sha256").update("pgi-customer-transition:v1:"+actor.sub).digest("hex");
}
function evidence(value){
 const ref=String(value||"").trim();
 if(ref.length<8||ref.length>240)throw fail(400,"DIRECT_SVA_TRANSITION_EVIDENCE_REQUIRED");
 return ref;
}
function db(store){
 if(!store?.sql?.begin||!store?.sql?.unsafe||!store?.readSql?.unsafe)
  throw fail(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 return store;
}
export const TRANSITION_CONTINUITY_GUARDS=Object.freeze([
 "customer_tenant_id_unchanged",
 "customer_login_and_dossier_unchanged",
 "customer_number_e164_unchanged",
 "customer_destination_and_services_unchanged",
 "existing_business_live_reset_at_unchanged",
 "old_and_new_cdr_kept_with_real_host_carrier",
 "no_cdr_double_counting_or_statement_reclassification",
 "source_carrier_liabilities_retained_until_settlement",
 "new_provider_tariffs_verified_before_financial_cutover",
 "customer_terms_and_legally_required_notices_reviewed",
 "real_operator_porting_and_rsva_confirmation_required",
 "real_carrier_and_psp_evidence_required"
]);

export function transitionReadiness(evidenceRecord={}){
 // A checklist is evidence for a later human release, never an execution switch.
 const required=["operator_and_portability_approved","portability_mandate_verified",
  "client_notice_and_contract_reviewed","old_provider_settlement_boundary_verified",
  "new_provider_contract_and_tariffs_verified","inflight_calls_drained",
  "route_and_rsva_verified","cdr_deduplication_verified",
  "business_live_continuity_verified","psp_and_kyc_verified"];
 const met=required.filter(k=>evidenceRecord?.[k]===true);
 return Object.freeze({
  schema_version:"pgi-existing-customer-provider-transition/1",
  planned_only:true,
  evidences_required:required.length,evidences_documented:met.length,
  missing:required.filter(k=>!met.includes(k)),
  customer_identity_and_number_preserved:true,
  commercial_cutover_authorized:false,
  porting_execution_authorized:false,
  payout_execution_authorized:false,
  irreversible_network_step_requires_external_confirmation:true
 });
}

export async function eligibleExistingCustomerNumbers(store,{tenant_id=null}={}){
 db(store);
 const tenant=tenant_id==null||tenant_id===""?null:positiveId(tenant_id,"DIRECT_SVA_TENANT_ID_INVALID");
 const rows=await store.readSql.unsafe(
  "SELECT a.id AS assignment_id,a.tenant_id,a.sva_number_id,n.e164,n.status AS number_status,"+
  " host.carrier_id AS source_host_carrier_id,c.name AS source_host_name,"+
  " CASE WHEN p.id IS NOT NULL THEN true ELSE false END AS has_preparation_plan"+
  " FROM tenant_number_assignments a JOIN sva_numbers n ON n.id=a.sva_number_id"+
  " LEFT JOIN LATERAL ("+
  "  SELECT nca.carrier_id FROM number_carrier_assignments nca"+
  "  WHERE nca.sva_number_id=a.sva_number_id AND nca.assignment_status='active'"+
  "   AND nca.valid_from<=now() AND (nca.valid_to IS NULL OR nca.valid_to>now())"+
  "  ORDER BY nca.valid_from DESC,nca.id DESC LIMIT 1"+
  " ) host ON true LEFT JOIN carriers c ON c.id=host.carrier_id"+
  " LEFT JOIN direct_sva_existing_customer_transition_plans p ON p.assignment_id=a.id"+
  " WHERE a.status='active' AND ($1::bigint IS NULL OR a.tenant_id=$1::bigint)"+
  " ORDER BY a.id DESC LIMIT 100",[tenant]
 );
 return Object.freeze({mode:"internal_preparation_only",count:rows.length,
  truncated_possible:rows.length===100,
  records:rows.map(r=>({assignment_id:Number(r.assignment_id),tenant_id:Number(r.tenant_id),
   sva_number_id:Number(r.sva_number_id),e164:r.e164,
   number_status:r.number_status,source_host_carrier_id:r.source_host_carrier_id==null?null:Number(r.source_host_carrier_id),
   source_host_name:r.source_host_name||null,already_prepared:r.has_preparation_plan===true,
   eligible_to_prepare:r.source_host_carrier_id!=null&&r.number_status==="active"}))});
}

export async function preparedExistingCustomerTransitions(store,{tenant_id=null}={}){
 db(store);
 const tenant=tenant_id==null||tenant_id===""?null:positiveId(tenant_id,"DIRECT_SVA_TENANT_ID_INVALID");
 const rows=await store.readSql.unsafe(
  "SELECT p.id,p.tenant_id,p.assignment_id,p.sva_number_id,p.e164_snapshot,p.source_host_carrier_id,"+
  " p.target_mode,p.target_host_carrier_id,p.planned_cutover_at,p.revision_no,p.state,p.created_at,"+
  " p.routing_authorized,p.money_transfer_authorized,p.client_terms_review_status,p.notice_review_status"+
  " FROM direct_sva_existing_customer_transition_plans p"+
  " WHERE ($1::bigint IS NULL OR p.tenant_id=$1::bigint) ORDER BY p.id DESC LIMIT 100",[tenant]);
 return Object.freeze({business_unit:"direct_sva",mode:"preparation_only",
   route_changes_executed:false,client_changes_executed:false,financial_changes_executed:false,
   count:rows.length,truncated_possible:rows.length===100,
   continuity_guards:TRANSITION_CONTINUITY_GUARDS,
   readiness:transitionReadiness(),
   plans:rows.map(r=>({id:Number(r.id),tenant_id:Number(r.tenant_id),
    assignment_id:Number(r.assignment_id),sva_number_id:Number(r.sva_number_id),
    number:r.e164_snapshot,source_carrier_id:Number(r.source_host_carrier_id),
    target_mode:r.target_mode,revision:Number(r.revision_no),target_carrier_id:r.target_host_carrier_id==null?null:Number(r.target_host_carrier_id),
    planned_cutover_at:r.planned_cutover_at||null,state:r.state,prepared_at:r.created_at,
    commercial_cutover_authorized:false,customer_notice_review_pending:true}))});
}

export async function prepareExistingCustomerTransition(store,actor,input={}){
 db(store);const actor_hash=adminHash(actor);
 const assignmentId=positiveId(input.assignment_id,"DIRECT_SVA_ASSIGNMENT_ID_INVALID");
 const targetMode=String(input.target_mode||"").trim();
 if(!["partner","direct_sva"].includes(targetMode))throw fail(400,"DIRECT_SVA_TARGET_MODE_INVALID");
 const targetCarrierId=targetMode==="partner"
  ?positiveId(input.target_carrier_id,"DIRECT_SVA_TARGET_CARRIER_REQUIRED"):null;
 if(targetMode==="direct_sva"&&input.target_carrier_id!=null)
  throw fail(400,"DIRECT_SVA_DIRECT_TARGET_NOT_AUTHORIZED");
 const ref=evidence(input.evidence_reference);
 let schedule=null;
 if(input.planned_cutover_at!=null&&input.planned_cutover_at!==""){
  const date=new Date(input.planned_cutover_at);
  if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())
   throw fail(400,"DIRECT_SVA_CUTOVER_TIME_MUST_BE_FUTURE");
  schedule=date.toISOString();
 }
 return store.sql.begin(async tx=>{
  const [switches]=await tx.unsafe(
   "SELECT interface_preview_enabled,commercial_operation_enabled FROM direct_sva_admin_switches WHERE id=1 FOR SHARE");
  if(!switches||switches.interface_preview_enabled!==true||switches.commercial_operation_enabled!==false)
   throw fail(409,"DIRECT_SVA_TRANSITION_PREVIEW_DISABLED");
  const [row]=await tx.unsafe(
   "SELECT a.id,a.tenant_id,a.sva_number_id,a.status,n.e164,n.status AS number_status"+
   " FROM tenant_number_assignments a JOIN sva_numbers n ON n.id=a.sva_number_id"+
   " WHERE a.id=$1 FOR UPDATE OF a",[assignmentId]);
  if(!row||row.status!=="active"||row.number_status!=="active")
   throw fail(409,"DIRECT_SVA_SOURCE_ASSIGNMENT_NOT_ACTIVE");
  const hosts=await tx.unsafe(
   "SELECT carrier_id FROM number_carrier_assignments"+
   " WHERE sva_number_id=$1 AND assignment_status='active'"+
   " AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())"+
   " ORDER BY valid_from DESC,id DESC LIMIT 2",[row.sva_number_id]);
  if(hosts.length!==1)throw fail(409,"DIRECT_SVA_SOURCE_HOST_AMBIGUOUS_OR_MISSING");
  const sourceCarrier=Number(hosts[0].carrier_id);
  if(targetMode==="partner"){
   if(targetCarrierId===sourceCarrier)throw fail(409,"DIRECT_SVA_PROVIDER_UNCHANGED");
   const [destination]=await tx.unsafe(
    "SELECT id FROM carriers WHERE id=$1 AND enabled=true AND kind='sva_host'",[targetCarrierId]);
   if(!destination)throw fail(409,"DIRECT_SVA_PARTNER_NOT_READY");
  }
  const [revisionRow]=await tx.unsafe(
   "SELECT coalesce(max(revision_no),0)::int+1 AS next_revision FROM direct_sva_existing_customer_transition_plans WHERE assignment_id=$1",
   [assignmentId]);
  const revision=Number(revisionRow?.next_revision);
  if(!Number.isSafeInteger(revision)||revision<1)throw fail(503,"DIRECT_SVA_TRANSITION_REVISION_INVALID");
  const [plan]=await tx.unsafe(
   "INSERT INTO direct_sva_existing_customer_transition_plans"+
   "(tenant_id,assignment_id,revision_no,sva_number_id,e164_snapshot,source_host_carrier_id,"+
   " target_mode,target_host_carrier_id,planned_cutover_at,actor_hash,evidence_reference)"+
   " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,state,created_at",
   [row.tenant_id,row.id,revision,row.sva_number_id,row.e164,sourceCarrier,
    targetMode,targetCarrierId,schedule,actor_hash,ref]);
  await tx.unsafe(
   "INSERT INTO direct_sva_existing_customer_transition_audit"+
   "(plan_id,event_type,actor_hash,evidence_reference) VALUES($1,'prepared',$2,$3)",
   [plan.id,actor_hash,ref]);
  return Object.freeze({id:Number(plan.id),revision,state:"prepared",tenant_id:Number(row.tenant_id),
   assignment_id:Number(row.id),number:row.e164,source_host_carrier_id:sourceCarrier,
   target_mode:targetMode,planned_cutover_at:schedule,
   customer_identity_preserved:true,existing_audiotel_unchanged:true,
   routing_change_executed:false,portability_executed:false,payout_executed:false,
   customer_communication_status:"pending_legal_review",commercial_cutover_authorized:false});
 });
}

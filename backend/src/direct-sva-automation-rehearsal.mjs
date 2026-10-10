import {createHash} from "node:crypto";
import {DIRECT_SVA_WORKFLOW_RULES} from "./direct-sva-customer.mjs";

// Prepared automation rehearsal engine. No telecom, banking, CRM, email, GA4,
// customer account or statutory journal is ever altered by this module.
const FAILURE_MODES=new Set(["none","timeout","rate_limit","validation_error"]);
const EFFECT_CATEGORIES=Object.freeze({
 lead_routing:"crm",compliance_check:"internal",contract_review:"internal",
 number_assignment:"network",portability:"network",cdr_ingestion:"ingestion",
 settlement_reconciliation:"finance",accounting_draft:"finance",invoice_review:"finance",
 publisher_payout:"payment",hubspot_sync:"crm",analytics_delivery:"analytics",
 support_followup:"email"
});
function failure(status,code){const e=new Error(code);e.status=status;e.code=code;return e;}
function dateOrThrow(asOf){const d=asOf instanceof Date?asOf:new Date(asOf);if(!Number.isFinite(d.getTime()))throw failure(400,"DSVA_SIMULATION_DATE_INVALID");return d;}
function sha(data){return createHash("sha256").update(data).digest("hex");}
function actorDigest(actor){
 if(actor?.role!=="admin"||typeof actor?.sub!=="string"||!actor.sub.trim())
  throw failure(403,"DSVA_SIMULATION_ADMIN_REQUIRED");
 return sha("pgi-direct-sva-rehearsal-v1:"+actor.sub);
}
function assertDb(store){
 if(!store?.sql?.begin||!store?.sql?.unsafe||!store?.readSql?.unsafe)
  throw failure(503,"DSVA_SIMULATION_DATABASE_REQUIRED");
}
export function makeDirectSvaWorkflowSimulation(input={},asOf=new Date()){
 const at=dateOrThrow(asOf);
 if(!input||typeof input!=="object"||Array.isArray(input))throw failure(400,"DSVA_SIMULATION_INPUT_INVALID");
 const allowed=["workflow_key","source_reference","idempotency_key","facts","failure_mode","attempt_number"];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw failure(400,"DSVA_SIMULATION_INPUT_UNEXPECTED");
 const key=String(input.workflow_key||"");
 if(!Object.hasOwn(DIRECT_SVA_WORKFLOW_RULES,key))throw failure(400,"DSVA_SIMULATION_WORKFLOW_UNKNOWN");
 const reference=String(input.source_reference||"").trim();
 const idempotency=String(input.idempotency_key||"").trim();
 if(!/^DSVA-SIM-[A-Za-z0-9-]{8,80}$/.test(reference))throw failure(400,"DSVA_SIMULATION_REFERENCE_INVALID");
 if(!/^[A-Za-z0-9:_-]{16,128}$/.test(idempotency))throw failure(400,"DSVA_SIMULATION_IDEMPOTENCY_REQUIRED");
 const mode=String(input.failure_mode||"none");
 const attempt=input.attempt_number??1;
 if(!FAILURE_MODES.has(mode)||!Number.isSafeInteger(attempt)||attempt<1||attempt>5)
  throw failure(400,"DSVA_SIMULATION_ATTEMPT_INVALID");
 const rules=DIRECT_SVA_WORKFLOW_RULES[key];
 const rawFacts=input.facts??{};
 if(!rawFacts||typeof rawFacts!=="object"||Array.isArray(rawFacts))throw failure(400,"DSVA_SIMULATION_FACTS_INVALID");
 if(Object.keys(rawFacts).some(k=>!rules.requires.includes(k)))throw failure(400,"DSVA_SIMULATION_UNEXPECTED_EVIDENCE");
 const facts={};
 for(const required of rules.requires){
  const v=rawFacts[required];
  if(v!==undefined&&v!==true&&v!==false)throw failure(400,"DSVA_SIMULATION_BOOLEAN_EVIDENCE_REQUIRED");
  facts[required]=v===true;
 }
 const missing=rules.requires.filter(k=>facts[k]!==true);
 let status="ready_for_simulation",retryAt=null;
 if(missing.length>0)status="missing_inputs";
 else if(mode==="validation_error"||((mode==="timeout"||mode==="rate_limit")&&attempt===5)){
  status="manual_review";
 }else if(mode==="timeout"||mode==="rate_limit"){
  status="retry_planned";
  const base=mode==="rate_limit"?120000:60000;
  const delay=Math.min(3600000,base*Math.pow(2,attempt-1));
  const jitter=Number.parseInt(sha(reference+":"+key+":"+attempt).slice(0,5),16)%10000;
  retryAt=new Date(at.getTime()+delay+jitter).toISOString();
 }
 // Fingerprint is stable across retries/replays with the same input.
 const digest=sha(JSON.stringify([key,reference,idempotency,mode,attempt,facts]));
 return Object.freeze({
  business_unit:"direct_sva",simulation_only:true,
  workflow_key:key,source_reference:reference,idempotency_key:idempotency,
  failure_mode:mode,attempt_number:attempt,input_digest:digest,
  result_status:status,missing_checks:Object.freeze(missing),
  checked_count:rules.requires.length,
  required_checks:Object.freeze([...rules.requires]),
  next_simulation_at:retryAt,
  downstream_effect:EFFECT_CATEGORIES[key],
  retry_max_attempts:5,
  external_action_executed:false,customer_record_changed:false,
  source_accounting_modified:false,network_changed:false,
  payout_executed:false,crm_synced:false,analytics_emitted:false,
  review_needed:status==="manual_review",
  simulated_at:at.toISOString(),
  next_step:status==="ready_for_simulation"?"SIMULATED_ONLY":
   status==="missing_inputs"?"REVIEW_MISSING_INPUTS":
   status==="retry_planned"?"RETRY_SUGGESTED_NOT_SCHEDULED":"MANUAL_REVIEW_REQUIRED"
 });
}
function compact(row){
 const raw=row?.safe_plan;
 const plan=typeof raw==="string"?JSON.parse(raw):raw;
 if(!plan||plan.business_unit!=="direct_sva"||plan.external_action_executed!==false)
  throw failure(503,"DSVA_SIMULATION_RESULT_INVALID");
 return Object.freeze({
  id:Number(row.id),
  workflow_key:String(row.workflow_key),
  source_reference:String(row.source_reference),
  result_status:String(row.result_status),
  attempt_number:Number(row.attempt_number),
  missing_checks:Array.isArray(row.missing_checks)?row.missing_checks:[],
  next_simulation_at:row.next_simulation_at??null,
  created_at:row.created_at??null,
  simulation_only:true,external_action_executed:false,
  plan
 });
}
export async function recordDirectSvaWorkflowSimulation(store,actor,input,asOf=new Date()){
 assertDb(store);
 const who=actorDigest(actor);
 const plan=makeDirectSvaWorkflowSimulation(input,asOf);
 return store.sql.begin(async tx=>{
  const [control]=await tx.unsafe(
   "SELECT interface_preview_enabled,commercial_operation_enabled"+
   " FROM direct_sva_admin_switches WHERE id=1 FOR SHARE");
  if(control?.interface_preview_enabled!==true||control?.commercial_operation_enabled!==false)
   throw failure(409,"DSVA_SIMULATION_PREVIEW_DISABLED");
  const [inserted]=await tx.unsafe(
   "INSERT INTO direct_sva_automation_rehearsals"+
   "(workflow_key,source_reference,idempotency_key,input_digest,result_status,"+
   "attempt_number,failure_mode,missing_checks,checked_count,next_simulation_at,safe_plan,actor_hash)"+
   " VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz,$11::jsonb,$12)"+
   " ON CONFLICT(idempotency_key) DO NOTHING"+
   " RETURNING id,workflow_key,source_reference,input_digest,result_status,attempt_number,"+
   "missing_checks,next_simulation_at,safe_plan,created_at",
   [plan.workflow_key,plan.source_reference,plan.idempotency_key,plan.input_digest,
    plan.result_status,plan.attempt_number,plan.failure_mode,JSON.stringify(plan.missing_checks),
    plan.checked_count,plan.next_simulation_at,JSON.stringify(plan),who]
  );
  const rows=inserted?[inserted]:await tx.unsafe(
   "SELECT id,workflow_key,source_reference,input_digest,result_status,attempt_number,"+
   "missing_checks,next_simulation_at,safe_plan,created_at"+
   " FROM direct_sva_automation_rehearsals WHERE idempotency_key=$1",
   [plan.idempotency_key]
  );
  const row=rows[0];
  if(!row)throw failure(503,"DSVA_SIMULATION_REPLAY_NOT_FOUND");
  if(row.input_digest!==plan.input_digest)throw failure(409,"DSVA_SIMULATION_IDEMPOTENCY_COLLISION");
  return Object.freeze({...compact(row),replayed:!inserted});
 });
}
export async function directSvaSimulationDashboard(store){
 assertDb(store);
 const [latest,totals]=await Promise.all([
  store.readSql.unsafe(
   "SELECT id,workflow_key,source_reference,result_status,attempt_number,missing_checks,"+
   "next_simulation_at,safe_plan,created_at"+
   " FROM direct_sva_automation_rehearsals WHERE business_unit='direct_sva'"+
   " ORDER BY id DESC LIMIT 50"
  ),
  store.readSql.unsafe(
   "SELECT workflow_key,result_status,count(*)::int AS count"+
   " FROM direct_sva_automation_rehearsals WHERE business_unit='direct_sva'"+
   " GROUP BY workflow_key,result_status ORDER BY workflow_key,result_status"
  )
 ]);
 return Object.freeze({
  business_unit:"direct_sva",mode:"dry_run_only",
  history_count_limit:50,history_complete:false,
  total_simulation_count:totals.reduce((n,r)=>n+Number(r.count||0),0),
  status_counts:Object.fromEntries(["ready_for_simulation","missing_inputs","retry_planned","manual_review"].map(status=>
   [status,totals.reduce((sum,r)=>sum+(r.result_status===status?Number(r.count||0):0),0)])),
  by_workflow:totals.map(r=>({workflow_key:r.workflow_key,result_status:r.result_status,count:Number(r.count)})),
  recent:latest.map(compact),
  registered_workflows:Object.keys(DIRECT_SVA_WORKFLOW_RULES).length,
  real_scheduler_active:false,external_actions_executed:false,
  production_activation_authorized:false
 });
}

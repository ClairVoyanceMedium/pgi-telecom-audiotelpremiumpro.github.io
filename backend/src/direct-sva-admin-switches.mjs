import {createHash} from "node:crypto";

// Private business-unit switches. A switch is not a licence, carrier contract,
// number assignment, GA4 connection, payment mandate or deployment instruction.
function fail(status,code){
 const error=new Error(code);error.status=status;error.code=code;return error;
}
function db(store){
 if(!store?.sql?.unsafe||!store?.sql?.begin)throw fail(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 return store.sql;
}
function actorHash(actor){
 if(actor?.role!=="admin"||typeof actor?.sub!=="string"||!actor.sub.trim())
  throw fail(403,"DIRECT_SVA_ADMIN_REQUIRED");
 return createHash("sha256").update("pgi-direct-sva-admin-switches:v1:"+actor.sub).digest("hex");
}
function normalizedState(row){
 if(!row)throw fail(503,"DIRECT_SVA_SWITCH_MIGRATION_MISSING");
 return {
  interface_preview_enabled:row.interface_preview_enabled===true,
  commercial_operation_enabled:false,
  commercial_activation_locked:true,
  launch_complete:false,
  preview_scope:"authenticated_admin_only",
  operational_effects:"none",
  current_audiotel_unchanged:true,
  changed_at:row.last_changed_at||null
 };
}

export async function getDirectSvaSwitches(store){
 const sql=db(store);
 const rows=await sql.unsafe(
  "SELECT interface_preview_enabled,commercial_operation_enabled,last_changed_at"+
  " FROM direct_sva_admin_switches WHERE id=1");
 const state=normalizedState(rows[0]);
 // Never trust configuration stored in an unlocked control for commercial launch.
 if(rows[0].commercial_operation_enabled!==false)throw fail(503,"DIRECT_SVA_COMMERCIAL_STATE_INVALID");
 return {...state,readiness:{
  arcep_resources:"not_approved_for_commercial_operation",
  network_interconnection:"not_approved_for_commercial_operation",
  payment_compliance:"not_approved_for_commercial_operation",
  statutory_accounting:"not_approved_for_commercial_operation",
  independent_technical_review:"required",
  owner_launch_authorization:"required"
 }};
}

export async function setDirectSvaPreview(store,actor,input={}){
 const hash=actorHash(actor),sql=db(store);
 if(typeof input.enabled!=="boolean"||typeof input.expected_enabled!=="boolean")
  throw fail(400,"DIRECT_SVA_SWITCH_BOOLEAN_REQUIRED");
 const reference=String(input.evidence_reference||"").trim();
 if(reference.length<8||reference.length>240)throw fail(400,"DIRECT_SVA_SWITCH_EVIDENCE_REQUIRED");
 const result=await sql.begin(async tx=>{
  const rows=await tx.unsafe(
   "SELECT interface_preview_enabled,commercial_operation_enabled,last_changed_at"+
   " FROM direct_sva_admin_switches WHERE id=1 FOR UPDATE");
  if(!rows[0])throw fail(503,"DIRECT_SVA_SWITCH_MIGRATION_MISSING");
  if(rows[0].commercial_operation_enabled!==false)throw fail(503,"DIRECT_SVA_COMMERCIAL_STATE_INVALID");
  const previous=rows[0].interface_preview_enabled===true;
  if(previous!==input.expected_enabled)throw fail(409,"DIRECT_SVA_SWITCH_STATE_CHANGED_REFRESH");
  if(previous!==input.enabled){
   await tx.unsafe(
    "UPDATE direct_sva_admin_switches SET interface_preview_enabled=$1,"+
    " last_changed_at=now(),last_changed_by_hash=$2 WHERE id=1",
    [input.enabled,hash]
   );
  }
  await tx.unsafe(
   "INSERT INTO direct_sva_admin_switch_audit"+
   "(switch_name,previous_value,requested_value,resulting_value,result,actor_hash,evidence_reference)"+
   " VALUES('interface_preview',$1,$2,$3,$4,$5,$6)",
   [previous,input.enabled,input.enabled,previous===input.enabled?"unchanged":"applied",hash,reference]
  );
  return {interface_preview_enabled:input.enabled,
   previous_enabled:previous,changed:previous!==input.enabled,
   commercial_operation_enabled:false,commercial_activation_locked:true,
   existing_audiotel_unchanged:true,side_effects_executed:false,
   activation_authorized:false};
 });
 return Object.freeze(result);
}

export async function setDirectSvaCommercial(store,actor,input={}){
 actorHash(actor);db(store);
 if(typeof input.enabled!=="boolean")throw fail(400,"DIRECT_SVA_SWITCH_BOOLEAN_REQUIRED");
 // The business may not be started from a dashboard while the legal/technical
 // and payment release process, database guardrails and external contracts are pending.
 if(input.enabled===true)throw fail(409,"DIRECT_SVA_COMMERCIAL_APPROVALS_INCOMPLETE");
 const state=await getDirectSvaSwitches(store);
 return {
  commercial_operation_enabled:false,
  commercial_activation_locked:true,
  interface_preview_enabled:state.interface_preview_enabled,
  changed:false,existing_audiotel_unchanged:true,
  side_effects_executed:false
 };
}

// Provider-neutral consolidation contract for a future SVA migration.
// Input must be VERIFIED, tenant-scoped CDR facts; this code never estimates
// missing CDRs, activates provider routes, or combines unconfirmed cash with payouts.
function failure(code){const e=new Error(code);e.code=code;e.status=409;return e;}
function id(value,label){
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw failure("CONTINUITY_INVALID_"+label);return n;
}
function date(value,label){
 const d=new Date(value);if(!value||!Number.isFinite(d.getTime()))throw failure("CONTINUITY_INVALID_"+label);
 return d.getTime();
}
function minor(value,label,optional=false){
 if(optional&&(value===null||value===undefined))return null;
 if(!Number.isSafeInteger(value)||value<0||value>1000000000000)throw failure("CONTINUITY_INVALID_"+label);
 return value;
}
export function consolidateProviderNeutralBusinessLive(cdrRows=[],context={}){
 if(!Array.isArray(cdrRows)||cdrRows.length>20000)throw failure("CONTINUITY_ROWS_INVALID");
 const tenant=id(context.tenant_id,"TENANT"),number=id(context.sva_number_id,"NUMBER");
 const source=id(context.source_host_carrier_id,"SOURCE"),target=id(context.target_host_carrier_id,"TARGET");
 const sourceEpoch=String(context.source_contract_epoch||"").trim();
 const targetEpoch=String(context.target_contract_epoch||"").trim();
 const epochSpecific=source===target||context.require_contract_epoch===true;
 if(epochSpecific&&(!/^[A-Za-z0-9_.:-]{8,120}$/.test(sourceEpoch)||
   !/^[A-Za-z0-9_.:-]{8,120}$/.test(targetEpoch)||sourceEpoch===targetEpoch))
  throw failure("CONTINUITY_DISTINCT_CONTRACT_EPOCHS_REQUIRED");
 if(context.operator_cutover_verified!==true||context.cdr_source_verified!==true)
  throw failure("CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER");
 const cutover=date(context.actual_cutover_at,"CUTOVER");
 const resetAt=date(context.business_live_reset_at,"RESET");
 const seen=new Map();
 const totals={calls:0,billable_seconds:0,expected_client_net_minor:0,
   confirmed_client_net_minor:0,paid_client_net_minor:0,active_calls:0};
 const internal=new Map([["source",{...totals}],["target",{...totals}]]);
 for(const row of cdrRows){
  if(id(row.tenant_id,"ROW_TENANT")!==tenant||id(row.sva_number_id,"ROW_NUMBER")!==number)
   throw failure("CONTINUITY_CROSS_TENANT_OR_NUMBER");
  const started=date(row.started_at,"START");
  const ended=row.ended_at==null?null:date(row.ended_at,"END");
  if(ended!==null&&ended<started)throw failure("CONTINUITY_CDR_END_BEFORE_START");
  if(row.active===true&&ended!==null)throw failure("CONTINUITY_ACTIVE_CALL_HAS_END_TIME");
  // Calls crossing the operator handover cannot be assigned unambiguously to
  // one contract. Require authoritative per-provider segments from the carrier.
  if(started<cutover&&((ended!==null&&ended>cutover)||row.active===true))
   throw failure("CONTINUITY_CALL_SPANS_CUTOVER_NEEDS_SEGMENT");
  if(started<resetAt){
   // A call crossing a reset requires an authoritative prorated call segment,
   // never a zero or a made-up correction to the customer counter.
   if(row.active===true||(row.ended_at&&date(row.ended_at,"END")>resetAt))
    throw failure("CONTINUITY_CALL_SPANS_RESET_NEEDS_SEGMENT");
   continue;
  }
  const carrier=id(row.host_carrier_id,"ROW_HOST");
  const epoch=started<cutover?"source":"target";
  if(epochSpecific&&String(row.contract_epoch_reference||"")!==(epoch==="source"?sourceEpoch:targetEpoch))
   throw failure("CONTINUITY_CDR_CONTRACT_EPOCH_UNVERIFIED");
  if(carrier!==(epoch==="source"?source:target))
   throw failure("CONTINUITY_CDR_WRONG_PROVIDER_EPOCH");
  const key=String(row.canonical_call_key||"").trim();
  if(!/^[a-zA-Z0-9_.:-]{12,120}$/.test(key))throw failure("CONTINUITY_CANONICAL_CDR_KEY_REQUIRED");
  // A repeated canonical key is idempotent only if the entire material CDR
  // identity is identical. Earlier we ignored ended_at and contract_epoch_reference,
  // silently accepting contradictory replays and obscuring settlement audits.
  const fingerprint=JSON.stringify([tenant,number,carrier,epoch,started,ended,
   String(row.contract_epoch_reference??""),row.billable_seconds,
   row.expected_client_net_minor,row.confirmed_client_net_minor,
   row.paid_client_net_minor,row.active===true]);
  if(seen.has(key)){
   if(seen.get(key)!==fingerprint)throw failure("CONTINUITY_CONFLICTING_DUPLICATE_CDR");
   continue; // Idempotent replay, never double count.
  }
  seen.set(key,fingerprint);
  const billable=minor(row.billable_seconds,"SECONDS");
  if(billable>86400)throw failure("CONTINUITY_BILLABLE_SECONDS_RANGE");
  const expected=minor(row.expected_client_net_minor,"EXPECTED");
  const confirmed=minor(row.confirmed_client_net_minor,"CONFIRMED",true);
  const paid=minor(row.paid_client_net_minor,"PAID",true);
  if(paid!==null&&(confirmed===null||paid>confirmed))throw failure("CONTINUITY_PAID_UNCONFIRMED");
  for(const sum of [totals,internal.get(epoch)]){
   sum.calls++;sum.billable_seconds+=billable;sum.expected_client_net_minor+=expected;
   if(confirmed!==null)sum.confirmed_client_net_minor+=confirmed;
   if(paid!==null)sum.paid_client_net_minor+=paid;
   if(row.active===true)sum.active_calls++;
   if(Object.values(sum).some(n=>!Number.isSafeInteger(n)))throw failure("CONTINUITY_TOTAL_OVERFLOW");
  }
 }
 return Object.freeze({
  schema_version:"pgi-provider-neutral-business-live/1",
  source:"verified_number_and_tenant_cdr_only",
  business_live_reset_at:new Date(resetAt).toISOString(),
  actual_cutover_at:new Date(cutover).toISOString(),
  // Safe for a future customer adapter: no carrier IDs, routing secrets or
  // internal migration strategy.
  client_view:Object.freeze({tenant_id:tenant,sva_number_id:number,currency:"EUR",...totals,
   expected_is_estimate:true,confirmed_requires_authoritative_reconciliation:true,paid_requires_payment_proof:true}),
  // Only for private audit and operator reconciliation.
  administrator_view:Object.freeze({
   source_host_carrier_id:source,target_host_carrier_id:target,
   by_carrier:[{carrier_id:source,epoch:"source",contract_epoch_reference:sourceEpoch||null,...internal.get("source")},
    {carrier_id:target,epoch:"target",contract_epoch_reference:targetEpoch||null,...internal.get("target")}],
   deduplicated_cdr:seen.size,cutover_approved_from_this_output:false
  }),
  existing_customer_account_changed:false,
  existing_customer_number_changed:false,
  existing_reset_schedule_changed:false,
  external_network_switch_executed:false
 });
}

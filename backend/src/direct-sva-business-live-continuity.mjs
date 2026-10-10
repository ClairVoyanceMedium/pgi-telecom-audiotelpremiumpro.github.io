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
 if(source===target)throw failure("CONTINUITY_SOURCE_EQUALS_TARGET");
 if(context.operator_cutover_verified!==true||context.cdr_source_verified!==true)
  throw failure("CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER");
 const cutover=date(context.actual_cutover_at,"CUTOVER");
 const resetAt=date(context.business_live_reset_at,"RESET");
 const seen=new Map();
 const totals={calls:0,billable_seconds:0,expected_client_net_minor:0,
   confirmed_client_net_minor:0,paid_client_net_minor:0,active_calls:0};
 const internal=new Map([[source,{...totals}],[target,{...totals}]]);
 for(const row of cdrRows){
  if(id(row.tenant_id,"ROW_TENANT")!==tenant||id(row.sva_number_id,"ROW_NUMBER")!==number)
   throw failure("CONTINUITY_CROSS_TENANT_OR_NUMBER");
  const started=date(row.started_at,"START");
  if(started<resetAt)continue; // Baseline unchanged, never reset because of migration.
  const carrier=id(row.host_carrier_id,"ROW_HOST");
  if(carrier!==(started<cutover?source:target))
   throw failure("CONTINUITY_CDR_WRONG_PROVIDER_EPOCH");
  const key=String(row.canonical_call_key||"").trim();
  if(!/^[a-zA-Z0-9_.:-]{12,120}$/.test(key))throw failure("CONTINUITY_CANONICAL_CDR_KEY_REQUIRED");
  const fingerprint=JSON.stringify([tenant,number,carrier,started,row.billable_seconds,
   row.expected_client_net_minor,row.confirmed_client_net_minor,row.paid_client_net_minor,row.active===true]);
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
  for(const sum of [totals,internal.get(carrier)]){
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
   expected_is_estimate:true,confirmed_is_reconciled:true,paid_is_settled:true}),
  // Only for private audit and operator reconciliation.
  administrator_view:Object.freeze({
   source_host_carrier_id:source,target_host_carrier_id:target,
   by_carrier:[source,target].map(k=>({carrier_id:k,...internal.get(k)})),
   deduplicated_cdr:seen.size,cutover_approved_from_this_output:false
  }),
  existing_customer_account_changed:false,
  existing_customer_number_changed:false,
  existing_reset_schedule_changed:false,
  external_network_switch_executed:false
 });
}

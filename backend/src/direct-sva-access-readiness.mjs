// Read-only boundary diagnostics for the future Distribution customer portal.
// Never reveal tenant/customer identifiers or imply a live end-to-end acceptance.
const REQUIRED_TABLES=Object.freeze([
 "direct_sva_customer_accounts","direct_sva_customer_cases",
 "direct_sva_number_inventory","direct_sva_admin_switches",
 "direct_sva_operator_controls","direct_sva_website_visibility"
]);
// RLS is defense in depth, not a substitute for application tenant checks.
// Audit it explicitly instead of implying that the app checks prove DB isolation.
const TENANT_DATA_TABLES=Object.freeze([
 "direct_sva_customer_accounts","direct_sva_customer_cases",
 "direct_sva_number_inventory","direct_sva_journal_entries","direct_sva_journal_lines"
]);
function fail(code){const e=new Error(code);e.code=code;e.status=503;return e;}
const count=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw fail("DSVA_ACCESS_COUNT_INVALID");return n;};
export function evaluateDirectSvaAccessReadiness(input={}){
 const tables=input.tables||[];
 if(!Array.isArray(tables)||!tables.every(x=>typeof x==="string"))throw fail("DSVA_ACCESS_SCHEMA_INVALID");
 const present=new Set(tables);
 const missing=REQUIRED_TABLES.filter(t=>!present.has(t));
 const accountConstraints=Array.isArray(input.constraints)?input.constraints:[];
 const find=(part)=>accountConstraints.some(x=>String(x.table_name||"").endsWith("direct_sva_customer_accounts")&&
  String(x.definition||"").includes(part));
 const schemaSafe=missing.length===0&&
  find("business_unit = 'direct_sva'")&&find("dashboard_enabled = false")&&
  find("client_contract_accepted = false");
 const protections=Array.isArray(input.rowPolicies)?input.rowPolicies:[];
 const unprotected=TENANT_DATA_TABLES.filter(name=>!protections.some(
  row=>row.table_name===name&&row.rls_enabled===true&&row.rls_forced===true));
 const nativeTenantRlsComplete=unprotected.length===0;
 const customerAccounts=count(input.customerAccounts||0),cases=count(input.cases||0);
 const activeNumbers=count(input.activeNumbers||0);
 const switchState=input.switches||{},operator=input.operator||{},web=input.website||{};
 const preparationLocks=String(operator.operator_mode)==="preparation"&&
  operator.number_activation_enabled===false&&operator.payouts_enabled===false&&
  switchState.commercial_operation_enabled===false&&
  web.public_content_authorized===false;
 const safe=missing.length===0&&schemaSafe&&preparationLocks&&
  activeNumbers===0&&customerAccounts===0&&cases===0;
 return Object.freeze({
  schema_version:"pgi-direct-sva-access-readiness/1",
  business_unit:"direct_sva",source:"read_only_staging_diagnostics",
  schema_complete:missing.length===0,missing_tables:missing,
  protective_constraints_verified:schemaSafe,
  postgres_rls_defense_verified:nativeTenantRlsComplete,
  postgres_rls_unprotected_tables:unprotected,
  prelaunch_locks_verified:preparationLocks,
  preparatory_customer_accounts:customerAccounts,
  preparatory_customer_cases:cases,
  inventory_active_numbers:activeNumbers,
  preparation_controls_safe:safe,
  existing_audiotel_customer_records_queried:false,
  existing_audiotel_billing_queried:false,
  any_customer_record_modified:false,
  customer_portal_public_access_authorized:false,
  customer_portal_released:false,
  live_business_live_verified:false,
  real_customer_end_to_end_verified:false,
  production_ready:false,
  checks:Object.freeze([
   {key:"schema",label:"Tables Distribution séparées",status:missing.length?"missing":"observed"},
   {key:"constraints",label:"Cloisonnement contractuel et accès client",status:schemaSafe?"observed":"unverified"},
   {key:"rls",label:"Isolation native des tables clients et financières (PostgreSQL RLS)",status:nativeTenantRlsComplete?"observed":"not_configured"},
   {key:"prelaunch",label:"Numéros, publication et paiements verrouillés",status:preparationLocks?"observed":"unsafe"},
   {key:"real_client",label:"Accès de clients autorisés",status:"not_tested"},
   {key:"financial",label:"Business Live alimenté par des sources réelles",status:"not_connected"},
   {key:"integrations",label:"Connecteurs opérateurs, HubSpot et PSP",status:"not_connected"}
  ])
 });
}
export async function directSvaAccessReadiness(store){
 const sql=store?.readSql?.unsafe||store?.sql?.unsafe;
 if(!sql)return evaluateDirectSvaAccessReadiness();
 const query=(statement,args=[])=>sql.call(store.readSql?.unsafe?store.readSql:store.sql,statement,args);
 try{
  const tables=await query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",[REQUIRED_TABLES]);
  const present=tables.map(x=>x.table_name);
  if(REQUIRED_TABLES.some(x=>!present.includes(x)))return evaluateDirectSvaAccessReadiness({tables:present});
  const [constraints,accounts,cases,numbers,switches,operator,website,rowPolicies]=await Promise.all([
   query("SELECT conrelid::regclass::text AS table_name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.direct_sva_customer_accounts'::regclass"),
   query("SELECT count(*)::int AS total FROM direct_sva_customer_accounts"),
   query("SELECT count(*)::int AS total FROM direct_sva_customer_cases"),
   query("SELECT count(*)::int AS total FROM direct_sva_number_inventory WHERE number_status='active'"),
   query("SELECT commercial_operation_enabled FROM direct_sva_admin_switches WHERE id=1"),
   query("SELECT operator_mode,number_activation_enabled,payouts_enabled FROM direct_sva_operator_controls WHERE id=1"),
   query("SELECT public_content_authorized FROM direct_sva_website_visibility WHERE id=1"),
   query("SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",[TENANT_DATA_TABLES])
  ]);
  return evaluateDirectSvaAccessReadiness({
   tables:present,constraints,customerAccounts:accounts[0]?.total,cases:cases[0]?.total,
   activeNumbers:numbers[0]?.total,switches:switches[0],operator:operator[0],website:website[0],rowPolicies
  });
 }catch{
  return Object.freeze({...evaluateDirectSvaAccessReadiness(),
    status:"unverified_database_access",preparation_controls_safe:false});
 }
}

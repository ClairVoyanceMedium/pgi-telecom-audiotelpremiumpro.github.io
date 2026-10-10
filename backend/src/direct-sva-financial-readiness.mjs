// Read-only financial pipeline readiness from authoritative database catalog.
// Never infer banking verification from a generated row or from Stripe capability.
const EXPECTED_TABLES=Object.freeze([
 "direct_sva_financial_cycle_previews",
 "direct_sva_financial_publisher_previews",
 "direct_sva_financial_action_previews",
 "direct_sva_financial_audit_previews",
 "direct_sva_bank_event_previews",
 "direct_sva_financial_exception_previews"
]);
const REQUIRED_SOURCE_KEYS=Object.freeze(["network","payment_psp","statutory_accounting"]);
function fail(){const error=new Error("DSVA_FINANCE_DATABASE_REQUIRED");error.code=error.message;error.status=503;throw error;}
function safe(n){const value=Number(n);if(!Number.isSafeInteger(value)||value<0)fail();return value;}
export async function directSvaFinancialReadiness(store){
 if(!store?.readSql?.unsafe)fail();
 const sql=store.readSql;
 const [tables]=await sql.unsafe(
  "SELECT "+EXPECTED_TABLES.map((table,i)=>
   "to_regclass('public."+table+"') IS NOT NULL AS t"+i).join(",")
 );
 const schema=Object.fromEntries(EXPECTED_TABLES.map((name,i)=>[name,tables?.["t"+i]===true]));
 const installed=Object.values(schema).every(Boolean);
 const missing=Object.entries(schema).filter(([,exists])=>!exists).map(([name])=>name);
 if(!installed)return Object.freeze({
  schema_version:"pgi-direct-sva-financial-readiness/1",
  business_unit:"direct_sva",status:"migration_pending",schema,
  missing_tables:missing,finance_previews:null,publishers_prepared:null,
  reported_bank_events:null,exception_previews:null,
  integrations_enabled:false,real_bank_connection_verified:false,
  source_authenticity_verified:false,payout_execution_enabled:false,
  automatic_processing_enabled:false,
  production_ready:false
 });
 const [cycles,publishers,bank,exceptions,control,connectors]=await Promise.all([
  sql.unsafe("SELECT count(*)::int AS n FROM direct_sva_financial_cycle_previews"),
  sql.unsafe("SELECT count(*)::int AS n FROM direct_sva_financial_publisher_previews"),
  sql.unsafe("SELECT count(*)::int AS n FROM direct_sva_bank_event_previews"),
  sql.unsafe("SELECT count(*)::int AS n FROM direct_sva_financial_exception_previews"),
  sql.unsafe("SELECT operator_mode,number_activation_enabled,payouts_enabled FROM direct_sva_operator_controls WHERE id=1"),
  sql.unsafe("SELECT integration_key,activation_status,can_send_data FROM direct_sva_integration_readiness WHERE integration_key IN ('network','payment_psp','statutory_accounting') ORDER BY integration_key")
 ]);
 const configHealthy=control.length===1&&control[0].operator_mode==="preparation"&&
  control[0].number_activation_enabled===false&&control[0].payouts_enabled===false&&
  connectors.length===REQUIRED_SOURCE_KEYS.length&&
  REQUIRED_SOURCE_KEYS.every(key=>connectors.some(c=>c.integration_key===key&&c.activation_status==="disabled"&&c.can_send_data===false));
 if(!configHealthy){
  const e=new Error("DSVA_FINANCE_PRELAUNCH_CONTROL_DRIFT");e.code=e.message;e.status=503;throw e;
 }
 return Object.freeze({
  schema_version:"pgi-direct-sva-financial-readiness/1",
  business_unit:"direct_sva",status:"preparation_locked",schema,missing_tables:[],
  finance_previews:safe(cycles[0]?.n),
  publishers_prepared:safe(publishers[0]?.n),
  reported_bank_events:safe(bank[0]?.n),
  exception_previews:safe(exceptions[0]?.n),
  integration_inventory:Object.freeze(connectors.map(x=>({
   key:x.integration_key,active:false,external_data_transmission:false
  }))),
  integrations_enabled:false,
  real_bank_connection_verified:false,source_authenticity_verified:false,
  payout_execution_enabled:false,automatic_processing_enabled:false,
  production_ready:false,
  business_live_finance_release_authorized:false,
  next_action:"Raccorder les sources officielles et prouver leurs signatures, puis passer par la recette juridique, comptable et PSP indépendante"
 });
}

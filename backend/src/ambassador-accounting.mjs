import {createHash,randomBytes} from "node:crypto";

export const AMBASSADOR_REQUIRED_PAID_INVOICES=3;
export const AMBASSADOR_MIN_PAYOUT_MINOR=2000;
export const AMBASSADOR_CURRENCY="EUR";
export const AMBASSADOR_TERMS_VERSION="2026-10-05-v1";

const PROGRAM_KEY="ambassador_program";
const EMAIL_LIMIT=50;

function problem(status,code){const e=new Error(code);e.status=status;e.code=code;return e;}
function clean(value,max=200){return String(value||"").trim().replace(/\s+/g," ").slice(0,max);}
function email(value){const v=String(value||"").trim().toLowerCase().slice(0,320);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw problem(400,"INVALID_AMBASSADOR_EMAIL");return v;}
function tokenHash(value){return createHash("sha256").update(String(value||"")).digest("hex");}
function accessToken(){return randomBytes(32).toString("base64url");}
function codeFor(seed){return "AMB"+createHash("sha256").update(seed+":"+randomBytes(24).toString("hex")).digest("hex").slice(0,12).toUpperCase();}
function actorId(actor){const n=Number(actor&&actor.id);return Number.isInteger(n)&&n>0?n:null;}
function sqlRead(store){return store.readSql||store.sql;}
function moneyMinor(value){const n=Math.trunc(Number(value)||0);return Number.isFinite(n)?n:0;}

export function ambassadorBaseRewardMinor(sequence){
  const n=Math.max(1,Math.trunc(Number(sequence)||1));
  if(n>=25)return 2000;
  if(n>=10)return 1500;
  if(n>=5)return 1200;
  return 1000;
}
export function ambassadorMilestoneBonusMinor(sequence){
  const n=Math.trunc(Number(sequence)||0);
  if(n===1)return 500;
  if(n===5)return 2000;
  if(n===10)return 5000;
  if(n===25)return 10000;
  return 0;
}
export function ambassadorRewardSchedule(){
  return {currency:AMBASSADOR_CURRENCY,qualification_paid_invoices:AMBASSADOR_REQUIRED_PAID_INVOICES,minimum_payout_minor:AMBASSADOR_MIN_PAYOUT_MINOR,tiers:[{from:1,to:4,reward_minor:1000},{from:5,to:9,reward_minor:1200},{from:10,to:24,reward_minor:1500},{from:25,to:null,reward_minor:2000}],bonuses:[{at:1,bonus_minor:500},{at:5,bonus_minor:2000},{at:10,bonus_minor:5000},{at:25,bonus_minor:10000}]};
}

const schemaStatements=[
  "CREATE TABLE IF NOT EXISTS platform_feature_flags (feature_key text PRIMARY KEY,enabled boolean NOT NULL DEFAULT false,configuration jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now())",
  "INSERT INTO platform_feature_flags(feature_key,enabled,configuration) VALUES('"+PROGRAM_KEY+"',true,'{\"motivation_email_enabled\":true,\"qualification_paid_invoices\":3,\"minimum_payout_minor\":2000,\"currency\":\"EUR\"}'::jsonb) ON CONFLICT(feature_key) DO NOTHING",
  "CREATE TABLE IF NOT EXISTS ambassador_profiles (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,email text NOT NULL,email_normalized text NOT NULL UNIQUE,display_name text NOT NULL,company_name text,country_code char(2) NOT NULL DEFAULT 'FR',status text NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','suspended','closed')),code text NOT NULL UNIQUE,access_token_hash char(64) NOT NULL,terms_version text NOT NULL,terms_accepted_at timestamptz NOT NULL,advertising_disclosure_accepted_at timestamptz NOT NULL,processing_consent_at timestamptz NOT NULL,motivation_email_consent boolean NOT NULL DEFAULT false,payout_compliance_status text NOT NULL DEFAULT 'pending' CHECK(payout_compliance_status IN ('pending','verified','blocked')),last_activity_at timestamptz,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS ambassador_profiles_status_idx ON ambassador_profiles(status,created_at DESC)",
  "CREATE TABLE IF NOT EXISTS ambassador_referrals (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE RESTRICT,referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','qualified','rejected')),qualifying_paid_invoices integer NOT NULL DEFAULT 0 CHECK(qualifying_paid_invoices>=0),sequence_number integer,base_reward_minor bigint NOT NULL DEFAULT 0 CHECK(base_reward_minor>=0),bonus_reward_minor bigint NOT NULL DEFAULT 0 CHECK(bonus_reward_minor>=0),currency char(3) NOT NULL DEFAULT 'EUR',claimed_at timestamptz NOT NULL DEFAULT now(),qualified_at timestamptz,rejected_at timestamptz,rejection_reason text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS ambassador_referrals_ambassador_idx ON ambassador_referrals(ambassador_id,status,claimed_at DESC)",
  "CREATE TABLE IF NOT EXISTS ambassador_rewards (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE RESTRICT,referral_id bigint REFERENCES ambassador_referrals(id) ON DELETE RESTRICT,reward_kind text NOT NULL CHECK(reward_kind IN ('client','milestone')),milestone_number integer,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL DEFAULT 'EUR',status text NOT NULL DEFAULT 'earned' CHECK(status IN ('earned','paid','cancelled')),earned_at timestamptz NOT NULL DEFAULT now(),paid_at timestamptz,paid_reference text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),CHECK(status<>'paid' OR (paid_at IS NOT NULL AND paid_reference IS NOT NULL)))",
  "CREATE UNIQUE INDEX IF NOT EXISTS ambassador_rewards_client_unique ON ambassador_rewards(referral_id) WHERE reward_kind='client'",
  "CREATE UNIQUE INDEX IF NOT EXISTS ambassador_rewards_milestone_unique ON ambassador_rewards(ambassador_id,milestone_number) WHERE reward_kind='milestone'",
  "CREATE INDEX IF NOT EXISTS ambassador_rewards_payable_idx ON ambassador_rewards(ambassador_id,status,earned_at DESC)",
  "CREATE TABLE IF NOT EXISTS ambassador_email_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE CASCADE,email_key text NOT NULL,period_key text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),attempts integer NOT NULL DEFAULT 1,last_error text,sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(ambassador_id,email_key,period_key))",
  "CREATE TABLE IF NOT EXISTS ambassador_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ambassador_id bigint REFERENCES ambassador_profiles(id) ON DELETE SET NULL,staff_user_id bigint,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS business_accounting_settings (id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),currency char(3) NOT NULL DEFAULT 'EUR',vat_mode text NOT NULL DEFAULT 'unconfigured' CHECK(vat_mode IN ('unconfigured','standard','franchise','exempt','other')),vat_rate_bps integer CHECK(vat_rate_bps IS NULL OR vat_rate_bps BETWEEN 0 AND 10000),fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK(fiscal_year_start_month BETWEEN 1 AND 12),updated_by bigint,updated_at timestamptz NOT NULL DEFAULT now())",
  "INSERT INTO business_accounting_settings(id,currency,vat_mode,vat_rate_bps,fiscal_year_start_month) VALUES(1,'EUR','unconfigured',NULL,1) ON CONFLICT(id) DO NOTHING",
  "CREATE TABLE IF NOT EXISTS business_accounting_ledger (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,source_key text NOT NULL UNIQUE,source_type text NOT NULL,source_id text,occurred_at timestamptz NOT NULL,tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,ambassador_id bigint REFERENCES ambassador_profiles(id) ON DELETE SET NULL,basis text NOT NULL CHECK(basis IN ('cash','accrual')),direction text NOT NULL CHECK(direction IN ('in','out')),category text NOT NULL,debit_account_code text NOT NULL,credit_account_code text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL DEFAULT 'EUR',status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','needs_review','reversed')),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
  "CREATE INDEX IF NOT EXISTS business_accounting_ledger_period_idx ON business_accounting_ledger(currency,occurred_at DESC,category)",
  "CREATE OR REPLACE FUNCTION pgi_prevent_business_accounting_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'business accounting ledger is append-only'; END; $$",
  "DROP TRIGGER IF EXISTS business_accounting_ledger_no_mutation ON business_accounting_ledger",
  "CREATE TRIGGER business_accounting_ledger_no_mutation BEFORE UPDATE OR DELETE ON business_accounting_ledger FOR EACH ROW EXECUTE FUNCTION pgi_prevent_business_accounting_ledger_mutation()"
];

export async function ensureAmbassadorAccountingSchema(store){
  if(!store||!store.sql||typeof store.sql.unsafe!=="function")return {ready:false,reason:"persistent_store_required"};
  for(const statement of schemaStatements)await store.sql.unsafe(statement);
  return {ready:true};
}

async function featureState(store){
  try{
    const row=(await sqlRead(store).unsafe("SELECT enabled,configuration FROM platform_feature_flags WHERE feature_key=$1 LIMIT 1",[PROGRAM_KEY]))[0]||null;
    const cfg=row&&row.configuration&&typeof row.configuration==="object"?row.configuration:{};
    return {enabled:row?.enabled===true,motivation_email_enabled:cfg.motivation_email_enabled!==false};
  }catch(error){if(String(error?.code||"")==="42P01")return {enabled:false,motivation_email_enabled:false};throw error;}
}

export async function ambassadorProgramPublicState(store){const state=await featureState(store);return {...state,...ambassadorRewardSchedule()};}

export async function registerAmbassador(store,input={}){
  const state=await featureState(store);if(!state.enabled)throw problem(409,"AMBASSADOR_PROGRAM_DISABLED");
  const name=clean(input.display_name,120),address=email(input.email),company=clean(input.company_name,160)||null,country=clean(input.country_code||"FR",2).toUpperCase();
  if(name.length<2)throw problem(400,"AMBASSADOR_NAME_REQUIRED");
  if(!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
  if(input.processing_consent!==true)throw problem(400,"AMBASSADOR_PROCESSING_CONSENT_REQUIRED");
  if(input.terms_accepted!==true)throw problem(400,"AMBASSADOR_TERMS_REQUIRED");
  if(input.advertising_disclosure_accepted!==true)throw problem(400,"AMBASSADOR_DISCLOSURE_REQUIRED");
  const raw=accessToken(),hash=tokenHash(raw),now=new Date().toISOString();
  const result=await store.sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",["ambassador:"+address]);
    const existing=(await tx.unsafe("SELECT id,status FROM ambassador_profiles WHERE email_normalized=$1 FOR UPDATE",[address]))[0]||null;
    if(existing&&existing.status==="closed")throw problem(409,"AMBASSADOR_ACCOUNT_CLOSED");
    if(existing){
      const row=(await tx.unsafe("UPDATE ambassador_profiles SET access_token_hash=$2,display_name=$3,company_name=$4,motivation_email_consent=$5,last_activity_at=now(),updated_at=now() WHERE id=$1 RETURNING id,public_id::text AS public_id,email,display_name,company_name,country_code,status,code,payout_compliance_status,motivation_email_consent,created_at",[existing.id,hash,name,company,input.motivation_email_consent===true]))[0];
      await tx.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.access.rotated',$2::jsonb)",[row.id,JSON.stringify({source:"public_registration_existing"})]);
      return {...row,created:false};
    }
    const code=codeFor(address);
    const row=(await tx.unsafe("INSERT INTO ambassador_profiles(email,email_normalized,display_name,company_name,country_code,status,code,access_token_hash,terms_version,terms_accepted_at,advertising_disclosure_accepted_at,processing_consent_at,motivation_email_consent,last_activity_at) VALUES($1,$1,$2,$3,$4,'active',$5,$6,$7,$8,$8,$8,$9,$8) RETURNING id,public_id::text AS public_id,email,display_name,company_name,country_code,status,code,payout_compliance_status,motivation_email_consent,created_at",[address,name,company,country,code,hash,AMBASSADOR_TERMS_VERSION,now,input.motivation_email_consent===true]))[0];
    await tx.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.create',$2::jsonb)",[row.id,JSON.stringify({terms_version:AMBASSADOR_TERMS_VERSION,motivation_email_consent:input.motivation_email_consent===true})]);
    return {...row,created:true};
  });
  return {...result,access_token:raw};
}

export async function rotateAmbassadorAccess(store,emailInput){
  const address=email(emailInput),raw=accessToken(),hash=tokenHash(raw);
  const row=(await store.sql.unsafe("UPDATE ambassador_profiles SET access_token_hash=$2,last_activity_at=now(),updated_at=now() WHERE email_normalized=$1 AND status IN ('pending','active') RETURNING id,public_id::text AS public_id,email,display_name,status,code",[address,hash]))[0]||null;
  if(!row)return null;
  await store.sql.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.access.rotated','{\"source\":\"public_access_link\"}'::jsonb)",[row.id]);
  return {...row,access_token:raw};
}

async function authenticatedProfile(store,token){
  const raw=String(token||"").trim();if(raw.length<32||raw.length>180)throw problem(401,"AMBASSADOR_AUTH_REQUIRED");
  const row=(await sqlRead(store).unsafe("SELECT id,public_id::text AS public_id,email,display_name,company_name,country_code,status,code,motivation_email_consent,payout_compliance_status,created_at FROM ambassador_profiles WHERE access_token_hash=$1 LIMIT 1",[tokenHash(raw)]))[0]||null;
  if(!row||!["pending","active"].includes(row.status))throw problem(401,"AMBASSADOR_AUTH_REQUIRED");return row;
}

export async function ambassadorDashboard(store,token,config={}){
  const p=await authenticatedProfile(store,token);
  const [counts,rewards,recent]=await Promise.all([
    sqlRead(store).unsafe("SELECT count(*)::int AS referrals,count(*) FILTER(WHERE status='qualified')::int AS qualified,count(*) FILTER(WHERE status='claimed')::int AS pending FROM ambassador_referrals WHERE ambassador_id=$1",[p.id]),
    sqlRead(store).unsafe("SELECT COALESCE(sum(amount_minor) FILTER(WHERE status='earned'),0)::bigint AS earned_minor,COALESCE(sum(amount_minor) FILTER(WHERE status='paid'),0)::bigint AS paid_minor,COALESCE(sum(amount_minor),0)::bigint AS lifetime_minor FROM ambassador_rewards WHERE ambassador_id=$1",[p.id]),
    sqlRead(store).unsafe("SELECT status,qualifying_paid_invoices,sequence_number,base_reward_minor::bigint AS base_reward_minor,bonus_reward_minor::bigint AS bonus_reward_minor,claimed_at,qualified_at FROM ambassador_referrals WHERE ambassador_id=$1 ORDER BY claimed_at DESC LIMIT 20",[p.id])
  ]);
  const c=counts[0]||{},r=rewards[0]||{},q=Number(c.qualified||0),next=q+1,nextMilestone=[1,5,10,25].find(x=>x>q)||null;
  return {profile:{public_id:p.public_id,display_name:p.display_name,company_name:p.company_name,status:p.status,code:p.code,motivation_email_consent:p.motivation_email_consent,payout_compliance_status:p.payout_compliance_status},referral_link:String(config.publicBaseUrl||"https://audiotel-premium-pro.com").replace(/\/$/,"")+"/demande-ouverture/?ref="+encodeURIComponent(p.code),schedule:ambassadorRewardSchedule(),summary:{referrals:Number(c.referrals||0),qualified:q,pending:Number(c.pending||0),earned_minor:Number(r.earned_minor||0),paid_minor:Number(r.paid_minor||0),lifetime_minor:Number(r.lifetime_minor||0),payable:Number(r.earned_minor||0)>=AMBASSADOR_MIN_PAYOUT_MINOR&&p.payout_compliance_status==="verified"},progress:{next_client_reward_minor:ambassadorBaseRewardMinor(next),next_milestone:nextMilestone,next_milestone_bonus_minor:nextMilestone?ambassadorMilestoneBonusMinor(nextMilestone):0},recent:recent.map(x=>({...x,base_reward_minor:Number(x.base_reward_minor||0),bonus_reward_minor:Number(x.bonus_reward_minor||0)}))};
}

export async function updateAmbassadorPreferences(store,token,input={}){
  const p=await authenticatedProfile(store,token),consent=input.motivation_email_consent===true;
  await store.sql.unsafe("UPDATE ambassador_profiles SET motivation_email_consent=$2,last_activity_at=now(),updated_at=now() WHERE id=$1",[p.id,consent]);
  await store.sql.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.preferences.update',$2::jsonb)",[p.id,JSON.stringify({motivation_email_consent:consent})]);
  return {updated:true,motivation_email_consent:consent};
}

export async function claimAmbassadorReferral(store,tenantId,codeInput,source="public_opening_form"){
  const tenant=Number(tenantId),code=String(codeInput||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!Number.isInteger(tenant)||tenant<=0)throw problem(400,"INVALID_TENANT_ID");
  if(!/^AMB[A-Z0-9]{8,21}$/.test(code))throw problem(404,"AMBASSADOR_CODE_NOT_FOUND");
  const state=await featureState(store);if(!state.enabled)throw problem(409,"AMBASSADOR_PROGRAM_DISABLED");
  return store.sql.begin(async tx=>{
    const ambassador=(await tx.unsafe("SELECT id,email_normalized,status FROM ambassador_profiles WHERE code=$1 LIMIT 1 FOR UPDATE",[code]))[0]||null;
    if(!ambassador||ambassador.status!=="active")throw problem(404,"AMBASSADOR_CODE_NOT_FOUND");
    const target=(await tx.unsafe("SELECT id,status,lower(btrim(COALESCE(billing_email,''))) AS email FROM tenants WHERE id=$1 AND tenant_type<>'internal' LIMIT 1 FOR UPDATE",[tenant]))[0]||null;
    if(!target)throw problem(404,"TENANT_NOT_FOUND");
    if(target.status!=="pending")throw problem(409,"AMBASSADOR_TARGET_NOT_ELIGIBLE");
    if(target.email&&target.email===String(ambassador.email_normalized))throw problem(409,"AMBASSADOR_SELF_CLAIM");
    const clientReferral=(await tx.unsafe("SELECT 1 FROM customer_referrals WHERE referred_tenant_id=$1 LIMIT 1",[tenant])).length>0;
    if(clientReferral)throw problem(409,"REFERRAL_ALREADY_CLAIMED");
    const paid=(await tx.unsafe("SELECT 1 FROM tenant_subscriptions WHERE tenant_id=$1 AND status='active' AND current_period_end>now() LIMIT 1",[tenant])).length>0;
    if(paid)throw problem(409,"AMBASSADOR_TARGET_NOT_ELIGIBLE");
    const existing=(await tx.unsafe("SELECT id,ambassador_id,status FROM ambassador_referrals WHERE referred_tenant_id=$1 LIMIT 1 FOR UPDATE",[tenant]))[0]||null;
    if(existing){if(Number(existing.ambassador_id)!==Number(ambassador.id))throw problem(409,"REFERRAL_ALREADY_CLAIMED");return {accepted:true,replayed:true,status:existing.status,program:"ambassador"};}
    const row=(await tx.unsafe("INSERT INTO ambassador_referrals(ambassador_id,referred_tenant_id,status,currency,metadata) VALUES($1,$2,'claimed','EUR',$3::jsonb) RETURNING id,public_id::text AS public_id,status,claimed_at",[ambassador.id,tenant,JSON.stringify({source:String(source||"unknown").slice(0,80),code})]))[0];
    await tx.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.referral.claim',$2::jsonb)",[ambassador.id,JSON.stringify({referred_tenant_id:tenant,referral_id:Number(row.id),source:String(source||"unknown").slice(0,80)})]);
    return {accepted:true,replayed:false,status:row.status,public_id:row.public_id,program:"ambassador"};
  });
}

export async function qualifyAmbassadorAfterPayment(store,tenantId,subscriptionId){
  const tenant=Number(tenantId),subscription=Number(subscriptionId);if(!Number.isInteger(tenant)||tenant<=0)return {qualified:false,reason:"invalid_tenant"};
  return store.sql.begin(async tx=>{
    const referral=(await tx.unsafe("SELECT r.id,r.ambassador_id,r.status,r.qualifying_paid_invoices,a.email,a.display_name,a.status AS ambassador_status FROM ambassador_referrals r JOIN ambassador_profiles a ON a.id=r.ambassador_id WHERE r.referred_tenant_id=$1 LIMIT 1 FOR UPDATE",[tenant]))[0]||null;
    if(!referral||referral.status!=="claimed"||referral.ambassador_status!=="active")return {qualified:false,reason:"no_claim"};
    const paidRow=(await tx.unsafe("SELECT count(DISTINCT COALESCE(normalized_details->>'provider_invoice_reference',provider_event_id))::int AS paid_count FROM subscription_billing_events WHERE tenant_id=$1 AND event_type='invoice.paid' AND COALESCE((normalized_details->>'provider_invoice_amount_paid_minor') ~ '^[0-9]+$',false) AND (normalized_details->>'provider_invoice_amount_paid_minor')::bigint>0",[tenant]))[0]||{paid_count:0};
    const paidCount=Number(paidRow.paid_count||0);await tx.unsafe("UPDATE ambassador_referrals SET qualifying_paid_invoices=$2,updated_at=now() WHERE id=$1",[referral.id,paidCount]);
    if(paidCount<AMBASSADOR_REQUIRED_PAID_INVOICES)return {qualified:false,reason:"awaiting_payments",paid_invoices:paidCount,required:AMBASSADOR_REQUIRED_PAID_INVOICES};
    const active=(await tx.unsafe("SELECT 1 FROM tenant_subscriptions WHERE tenant_id=$1 AND status='active' AND current_period_end>now() LIMIT 1",[tenant])).length>0;
    if(!active)return {qualified:false,reason:"subscription_not_active",paid_invoices:paidCount};
    await tx.unsafe("SELECT id FROM ambassador_profiles WHERE id=$1 FOR UPDATE",[referral.ambassador_id]);
    const seqRow=(await tx.unsafe("SELECT count(*)::int AS n FROM ambassador_referrals WHERE ambassador_id=$1 AND status='qualified'",[referral.ambassador_id]))[0]||{n:0};
    const sequence=Number(seqRow.n||0)+1,base=ambassadorBaseRewardMinor(sequence),bonus=ambassadorMilestoneBonusMinor(sequence),now=new Date().toISOString();
    await tx.unsafe("UPDATE ambassador_referrals SET status='qualified',sequence_number=$2,base_reward_minor=$3,bonus_reward_minor=$4,qualified_at=$5::timestamptz,qualifying_paid_invoices=$6,updated_at=now(),metadata=metadata||$7::jsonb WHERE id=$1",[referral.id,sequence,base,bonus,now,paidCount,JSON.stringify({qualification:"three_paid_monthly_invoices",subscription_id:subscription||null})]);
    await tx.unsafe("INSERT INTO ambassador_rewards(ambassador_id,referral_id,reward_kind,amount_minor,currency,status,earned_at,metadata) VALUES($1,$2,'client',$3,'EUR','earned',$4::timestamptz,$5::jsonb) ON CONFLICT(referral_id) WHERE reward_kind='client' DO NOTHING",[referral.ambassador_id,referral.id,base,now,JSON.stringify({sequence_number:sequence})]);
    if(bonus>0)await tx.unsafe("INSERT INTO ambassador_rewards(ambassador_id,referral_id,reward_kind,milestone_number,amount_minor,currency,status,earned_at,metadata) VALUES($1,$2,'milestone',$3,$4,'EUR','earned',$5::timestamptz,$6::jsonb) ON CONFLICT(ambassador_id,milestone_number) WHERE reward_kind='milestone' DO NOTHING",[referral.ambassador_id,referral.id,sequence,bonus,now,JSON.stringify({sequence_number:sequence})]);
    await tx.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,action,details) VALUES($1,'ambassador.referral.qualified',$2::jsonb)",[referral.ambassador_id,JSON.stringify({referral_id:Number(referral.id),referred_tenant_id:tenant,sequence_number:sequence,base_reward_minor:base,bonus_reward_minor:bonus,paid_invoices:paidCount})]);
    return {qualified:true,ambassador_id:Number(referral.ambassador_id),email:referral.email,display_name:referral.display_name,sequence_number:sequence,base_reward_minor:base,bonus_reward_minor:bonus,total_reward_minor:base+bonus,currency:"EUR"};
  });
}

export async function ambassadorAdminState(store){
  const state=await ambassadorProgramPublicState(store),read=sqlRead(store);
  const [summaryRows,profiles]=await Promise.all([
    read.unsafe("SELECT (SELECT count(*) FROM ambassador_profiles)::int AS profiles_total,(SELECT count(*) FROM ambassador_profiles WHERE status='active')::int AS profiles_active,(SELECT count(*) FROM ambassador_referrals)::int AS referrals_total,(SELECT count(*) FROM ambassador_referrals WHERE status='qualified')::int AS referrals_qualified,(SELECT COALESCE(sum(amount_minor) FILTER(WHERE status='earned'),0) FROM ambassador_rewards)::bigint AS payable_minor,(SELECT COALESCE(sum(amount_minor) FILTER(WHERE status='paid'),0) FROM ambassador_rewards)::bigint AS paid_minor"),
    read.unsafe("SELECT a.id,a.public_id::text AS public_id,a.display_name,a.email,a.company_name,a.status,a.code,a.payout_compliance_status,a.motivation_email_consent,a.created_at,count(r.id)::int AS referrals,count(r.id) FILTER(WHERE r.status='qualified')::int AS qualified,COALESCE((SELECT sum(w.amount_minor) FROM ambassador_rewards w WHERE w.ambassador_id=a.id AND w.status='earned'),0)::bigint AS earned_minor,COALESCE((SELECT sum(w.amount_minor) FROM ambassador_rewards w WHERE w.ambassador_id=a.id AND w.status='paid'),0)::bigint AS paid_minor FROM ambassador_profiles a LEFT JOIN ambassador_referrals r ON r.ambassador_id=a.id GROUP BY a.id ORDER BY qualified DESC,a.created_at DESC LIMIT 100")
  ]);
  return {...state,summary:{...(summaryRows[0]||{}),payable_minor:Number(summaryRows[0]?.payable_minor||0),paid_minor:Number(summaryRows[0]?.paid_minor||0)},profiles:profiles.map(x=>({...x,earned_minor:Number(x.earned_minor||0),paid_minor:Number(x.paid_minor||0)}))};
}

export async function updateAmbassadorProgram(store,input={},actor={}){
  const enabled=input.enabled===true,motivation=input.motivation_email_enabled!==false,current=await featureState(store);
  const config={motivation_email_enabled:motivation,qualification_paid_invoices:AMBASSADOR_REQUIRED_PAID_INVOICES,minimum_payout_minor:AMBASSADOR_MIN_PAYOUT_MINOR,currency:"EUR"};
  await store.sql.unsafe("UPDATE platform_feature_flags SET enabled=$2,configuration=$3::jsonb,updated_at=now() WHERE feature_key=$1",[PROGRAM_KEY,enabled,JSON.stringify(config)]);
  await store.sql.unsafe("INSERT INTO ambassador_audit_log(staff_user_id,action,details) VALUES($1,'ambassador.program.update',$2::jsonb)",[actorId(actor),JSON.stringify({before:current,after:{enabled,motivation_email_enabled:motivation},fixed_schedule:ambassadorRewardSchedule()})]);
  return ambassadorAdminState(store);
}

export async function updateAmbassadorProfile(store,idInput,input={},actor={}){
  const id=Number(idInput);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_AMBASSADOR");
  const status=String(input.status||"").trim(),compliance=String(input.payout_compliance_status||"").trim();
  if(status&&!["pending","active","suspended","closed"].includes(status))throw problem(400,"INVALID_AMBASSADOR_STATUS");
  if(compliance&&!["pending","verified","blocked"].includes(compliance))throw problem(400,"INVALID_AMBASSADOR_COMPLIANCE");
  const row=(await store.sql.unsafe("UPDATE ambassador_profiles SET status=COALESCE(NULLIF($2,''),status),payout_compliance_status=COALESCE(NULLIF($3,''),payout_compliance_status),updated_at=now() WHERE id=$1 RETURNING id,public_id::text AS public_id,display_name,email,status,payout_compliance_status",[id,status,compliance]))[0]||null;
  if(!row)throw problem(404,"AMBASSADOR_NOT_FOUND");
  await store.sql.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,staff_user_id,action,details) VALUES($1,$2,'ambassador.admin.update',$3::jsonb)",[id,actorId(actor),JSON.stringify({status:status||null,payout_compliance_status:compliance||null})]);return row;
}

export async function settleAmbassadorPayout(store,idInput,referenceInput,actor={}){
  const id=Number(idInput),reference=clean(referenceInput,180);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_AMBASSADOR");if(reference.length<3)throw problem(400,"AMBASSADOR_PAYMENT_REFERENCE_REQUIRED");
  return store.sql.begin(async tx=>{
    const p=(await tx.unsafe("SELECT id,display_name,email,status,payout_compliance_status FROM ambassador_profiles WHERE id=$1 FOR UPDATE",[id]))[0]||null;if(!p)throw problem(404,"AMBASSADOR_NOT_FOUND");
    if(p.status!=="active")throw problem(409,"AMBASSADOR_NOT_ACTIVE");if(p.payout_compliance_status!=="verified")throw problem(409,"AMBASSADOR_COMPLIANCE_REQUIRED");
    const sum=(await tx.unsafe("SELECT COALESCE(sum(amount_minor),0)::bigint AS amount_minor,count(*)::int AS reward_count FROM ambassador_rewards WHERE ambassador_id=$1 AND status='earned'",[id]))[0]||{};
    const amount=Number(sum.amount_minor||0);if(amount<AMBASSADOR_MIN_PAYOUT_MINOR)throw problem(409,"AMBASSADOR_PAYOUT_THRESHOLD_NOT_REACHED");
    const paidAt=new Date().toISOString();await tx.unsafe("UPDATE ambassador_rewards SET status='paid',paid_at=$2::timestamptz,paid_reference=$3 WHERE ambassador_id=$1 AND status='earned'",[id,paidAt,reference]);
    await tx.unsafe("INSERT INTO ambassador_audit_log(ambassador_id,staff_user_id,action,details) VALUES($1,$2,'ambassador.payout.recorded',$3::jsonb)",[id,actorId(actor),JSON.stringify({amount_minor:amount,currency:"EUR",paid_reference:reference,reward_count:Number(sum.reward_count||0)})]);
    return {ambassador_id:id,display_name:p.display_name,email:p.email,amount_minor:amount,currency:"EUR",reward_count:Number(sum.reward_count||0),paid_at:paidAt,paid_reference:reference};
  });
}

export async function recordAccountingRefund(store,refund={}){
  const amount=moneyMinor(refund.amount_minor);if(amount<=0)return {recorded:false};
  const key="stripe_refund:"+String(refund.refund_id||refund.provider_event_id||"").slice(0,180);if(key==="stripe_refund:")return {recorded:false};
  const row=await store.sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) VALUES($1,'stripe_subscription_refund',$2,$3::timestamptz,'cash','out','subscription_refund','706100','511500',$4,$5,'posted',$6::jsonb) ON CONFLICT(source_key) DO NOTHING RETURNING id",[key,String(refund.refund_id||""),refund.event_time||new Date().toISOString(),amount,String(refund.currency||"EUR").toUpperCase(),JSON.stringify({transaction_id:refund.transaction_id||null})]);
  return {recorded:row.length>0};
}

export async function syncAccountingLedger(store){
  const sql=store.sql,results=[];
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,tenant_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'stripe_invoice:'||COALESCE(NULLIF(normalized_details->>'provider_invoice_reference',''),id::text),'stripe_subscription_invoice',COALESCE(normalized_details->>'provider_invoice_reference',id::text),event_time,tenant_id,'cash','in','subscription','511500','706100',(normalized_details->>'provider_invoice_amount_paid_minor')::bigint,upper(COALESCE(NULLIF(normalized_details->>'provider_invoice_currency',''),'EUR')),'posted',jsonb_build_object('event_type',event_type,'provider_event_id',provider_event_id) FROM subscription_billing_events WHERE event_type='invoice.paid' AND COALESCE((normalized_details->>'provider_invoice_amount_paid_minor') ~ '^[0-9]+$',false) AND (normalized_details->>'provider_invoice_amount_paid_minor')::bigint>0 ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,tenant_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'priority_portability:'||p.id::text,'priority_portability',p.id::text,(p.metadata->'priority_service'->>'paid_at')::timestamptz,p.tenant_id,'cash','in','priority_portability','511500','706200',(p.metadata->'priority_service'->>'amount_minor')::bigint,upper(COALESCE(NULLIF(p.metadata->'priority_service'->>'currency',''),'EUR')),'posted',jsonb_build_object('request_id',p.id) FROM tenant_portability_requests p WHERE p.metadata->'priority_service'->>'status'='paid' AND COALESCE((p.metadata->'priority_service'->>'amount_minor') ~ '^[0-9]+$',false) AND NULLIF(p.metadata->'priority_service'->>'paid_at','') IS NOT NULL ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,tenant_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'card_fee:'||r.id::text,'card_payment_fee',r.id::text,COALESCE(r.paid_at,r.updated_at),r.tenant_id,'cash','in','card_payment_fee','511500','706300',r.application_fee_minor,r.currency,'posted',jsonb_build_object('gross_amount_minor',r.amount_minor,'application_fee_bps',r.application_fee_bps,'provider_payment_intent_reference',r.provider_payment_intent_reference) FROM tenant_card_payment_requests r WHERE r.status IN ('paid','refunded','disputed') AND r.paid_at IS NOT NULL AND r.application_fee_minor>0 ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,tenant_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'customer_referral_earned:'||w.id::text,'customer_referral_reward',w.id::text,w.earned_at,w.tenant_id,'accrual','out','customer_referral_reward','623800','467100',w.amount_minor,w.currency,'posted',jsonb_build_object('referral_id',w.referral_id) FROM customer_referral_rewards w WHERE w.status IN ('earned','paid') ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,tenant_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'customer_referral_paid:'||w.id::text,'customer_referral_payout',w.id::text,w.paid_at,w.tenant_id,'cash','out','customer_referral_payout','467100','512000',w.amount_minor,w.currency,'posted',jsonb_build_object('paid_reference',w.paid_reference) FROM customer_referral_rewards w WHERE w.status='paid' AND w.paid_at IS NOT NULL ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,ambassador_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'ambassador_earned:'||w.id::text,'ambassador_reward',w.id::text,w.earned_at,w.ambassador_id,'accrual','out','ambassador_reward','622200','467200',w.amount_minor,w.currency,'posted',jsonb_build_object('reward_kind',w.reward_kind,'milestone_number',w.milestone_number,'referral_id',w.referral_id) FROM ambassador_rewards w WHERE w.status IN ('earned','paid') ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  results.push(await sql.unsafe("INSERT INTO business_accounting_ledger(source_key,source_type,source_id,occurred_at,ambassador_id,basis,direction,category,debit_account_code,credit_account_code,amount_minor,currency,status,metadata) SELECT 'ambassador_paid:'||w.id::text,'ambassador_payout',w.id::text,w.paid_at,w.ambassador_id,'cash','out','ambassador_payout','467200','512000',w.amount_minor,w.currency,'posted',jsonb_build_object('paid_reference',w.paid_reference) FROM ambassador_rewards w WHERE w.status='paid' AND w.paid_at IS NOT NULL ON CONFLICT(source_key) DO NOTHING RETURNING id"));
  return {inserted:results.reduce((n,x)=>n+x.length,0)};
}

function monthBounds(month){const value=String(month||"").trim();if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw problem(400,"INVALID_ACCOUNTING_MONTH");const start=value+"-01T00:00:00+00:00",d=new Date(start),end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString();return {month:value,from:new Date(start).toISOString(),to:end};}
export function accountingAccountMap(){return [{code:"706100",label:"Abonnements Audiotel Premium Pro",nature:"produit",validation:"à valider avec le professionnel comptable"},{code:"706200",label:"Portabilité prioritaire",nature:"produit",validation:"à valider avec le professionnel comptable"},{code:"706300",label:"Commission de service paiement CB",nature:"produit",validation:"à valider avec le professionnel comptable"},{code:"706400",label:"Marge commerciale SVA PGI",nature:"produit",validation:"à valider avec le professionnel comptable"},{code:"622200",label:"Commissions Ambassadeurs",nature:"charge",validation:"à valider avec le professionnel comptable"},{code:"623800",label:"Récompenses de parrainage clients",nature:"charge",validation:"à valider avec le professionnel comptable"},{code:"467100",label:"Récompenses clients à payer",nature:"tiers",validation:"sous-compte interne proposé"},{code:"467200",label:"Commissions Ambassadeurs à payer",nature:"tiers",validation:"sous-compte interne proposé"},{code:"511500",label:"Encaissements PSP à rapprocher",nature:"trésorerie transitoire",validation:"sous-compte interne proposé"},{code:"512000",label:"Banque",nature:"trésorerie",validation:"à rapprocher du compte bancaire réel"},{code:"445710",label:"TVA collectée",nature:"taxe",validation:"inactive tant que le régime TVA n’est pas configuré"}];}
export async function accountingSettings(store){const row=(await sqlRead(store).unsafe("SELECT id,currency,vat_mode,vat_rate_bps,fiscal_year_start_month,updated_at FROM business_accounting_settings WHERE id=1 LIMIT 1"))[0];return {...row,account_map:accountingAccountMap(),statutory_ready:Boolean(row&&row.vat_mode!=="unconfigured")};}
export async function updateAccountingSettings(store,input={},actor={}){
  const vatMode=String(input.vat_mode||"").trim(),rate=input.vat_rate_bps==null||input.vat_rate_bps===""?null:Math.trunc(Number(input.vat_rate_bps)),month=Math.trunc(Number(input.fiscal_year_start_month||1));
  if(!["unconfigured","standard","franchise","exempt","other"].includes(vatMode))throw problem(400,"INVALID_VAT_MODE");if(rate!=null&&(!Number.isInteger(rate)||rate<0||rate>10000))throw problem(400,"INVALID_VAT_RATE");if(!Number.isInteger(month)||month<1||month>12)throw problem(400,"INVALID_FISCAL_YEAR_START");
  await store.sql.unsafe("UPDATE business_accounting_settings SET vat_mode=$1,vat_rate_bps=$2,fiscal_year_start_month=$3,updated_by=$4,updated_at=now() WHERE id=1",[vatMode,rate,month,actorId(actor)]);return accountingSettings(store);
}

export async function accountingOverview(store,config={},params={}){
  await syncAccountingLedger(store);const now=new Date(),month=String(params.month||"").trim()||String(now.getUTCFullYear())+"-"+String(now.getUTCMonth()+1).padStart(2,"0"),b=monthBounds(month),read=sqlRead(store),currency=String(params.currency||"EUR").toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw problem(400,"INVALID_CURRENCY");
  const paidRatio="CASE WHEN cs.confirmed_amount_ht>0 THEN LEAST(1::numeric,GREATEST(0::numeric,cs.paid_amount_ht/cs.confirmed_amount_ht)) WHEN cs.status='paid' THEN 1::numeric ELSE 0::numeric END";
  const [ledgerRows,svaRows,callRows,acquisitionRows,cardRows,settings]=await Promise.all([
    read.unsafe("SELECT category,basis,direction,COALESCE(sum(amount_minor),0)::bigint AS amount_minor,count(*)::int AS entries FROM business_accounting_ledger WHERE currency=$1 AND occurred_at>=$2::timestamptz AND occurred_at<$3::timestamptz GROUP BY category,basis,direction ORDER BY category",[currency,b.from,b.to]),
    read.unsafe("SELECT COALESCE(sum(d.upstream_payout_ht),0)::float8 AS upstream_payout_ht,COALESCE(sum(d.platform_fee_ht),0)::float8 AS pgi_margin_booked_ht,COALESCE(sum(d.platform_fee_ht*("+paidRatio+")),0)::float8 AS pgi_margin_collected_ht,COALESCE(sum(d.net_payout_ht),0)::float8 AS client_net_payout_ht,COALESCE(sum(d.unallocated_amount_ht),0)::float8 AS unallocated_amount_ht,COALESCE(sum(CASE WHEN d.status='paid' THEN d.net_payout_ht ELSE 0 END),0)::float8 AS client_net_paid_ht FROM tenant_revenue_distributions d JOIN carrier_settlements cs ON cs.id=d.upstream_settlement_id WHERE d.currency=$1 AND d.period_end>=$2::date AND d.period_end<$3::date",[currency,b.from.slice(0,10),b.to.slice(0,10)]),
    read.unsafe("SELECT count(*)::int AS calls_total,count(*) FILTER(WHERE call_status='connected')::int AS calls_connected,COALESCE(sum(billable_seconds),0)::bigint AS billable_seconds,COALESCE(sum(payout_eligible_seconds),0)::bigint AS payout_eligible_seconds,COALESCE(sum(retail_service_amount_ttc),0)::float8 AS generated_service_amount_ttc,COALESCE(sum(expected_payout_ht),0)::float8 AS expected_upstream_payout_ht,COALESCE(sum(confirmed_payout_ht),0)::float8 AS confirmed_upstream_payout_ht,COALESCE(sum(paid_payout_ht),0)::float8 AS paid_upstream_payout_ht FROM call_facts WHERE currency=$1 AND started_at>=$2::timestamptz AND started_at<$3::timestamptz",[currency,b.from,b.to]),
    read.unsafe("SELECT (SELECT count(*) FROM tenants WHERE tenant_type<>'internal' AND created_at>=$1::timestamptz AND created_at<$2::timestamptz)::int AS new_customers,(SELECT count(*) FROM customer_referrals WHERE claimed_at>=$1::timestamptz AND claimed_at<$2::timestamptz)::int AS client_referrals_claimed,(SELECT count(*) FROM customer_referrals WHERE rewarded_at>=$1::timestamptz AND rewarded_at<$2::timestamptz)::int AS client_referrals_rewarded,(SELECT count(*) FROM ambassador_referrals WHERE claimed_at>=$1::timestamptz AND claimed_at<$2::timestamptz)::int AS ambassador_referrals_claimed,(SELECT count(*) FROM ambassador_referrals WHERE qualified_at>=$1::timestamptz AND qualified_at<$2::timestamptz)::int AS ambassador_referrals_qualified",[b.from,b.to]),
    read.unsafe("SELECT count(*) FILTER(WHERE status IN ('paid','refunded','disputed'))::int AS paid_requests,COALESCE(sum(amount_minor) FILTER(WHERE status IN ('paid','refunded','disputed')),0)::bigint AS gross_volume_minor,COALESCE(sum(application_fee_minor) FILTER(WHERE status IN ('paid','refunded','disputed')),0)::bigint AS pgi_fee_minor,count(*) FILTER(WHERE status='refunded')::int AS refunded_requests,count(*) FILTER(WHERE status='disputed')::int AS disputed_requests FROM tenant_card_payment_requests WHERE currency=$1 AND paid_at>=$2::timestamptz AND paid_at<$3::timestamptz",[currency,b.from,b.to]),
    accountingSettings(store)
  ]);
  const ledger=ledgerRows.map(x=>({...x,amount_minor:Number(x.amount_minor||0)})),cashIn=ledger.filter(x=>x.basis==="cash"&&x.direction==="in").reduce((n,x)=>n+x.amount_minor,0),cashOut=ledger.filter(x=>x.basis==="cash"&&x.direction==="out").reduce((n,x)=>n+x.amount_minor,0),accrualExpense=ledger.filter(x=>x.basis==="accrual"&&x.direction==="out").reduce((n,x)=>n+x.amount_minor,0);
  let operational=null;try{operational=typeof store.summary==="function"?await store.summary(b.from,new Date(new Date(b.to).getTime()-1).toISOString(),null):null;}catch{}
  return {schema_version:"audiotel-accounting-pilotage/1",month,currency,range:{from:b.from,to:b.to},accounting_scope:"pilotage interne auditable",statutory_books:false,statutory_ready:Boolean(settings.statutory_ready&&config.legalOperatorConfigured),warning:settings.vat_mode==="unconfigured"?"Régime de TVA non configuré. Les montants TTC ne sont pas convertis automatiquement en HT ou TVA.":null,cash:{cash_in_minor:cashIn,cash_out_minor:cashOut,net_cash_minor:cashIn-cashOut},accrual:{commercial_acquisition_expense_minor:accrualExpense},ledger_breakdown:ledger,sva:svaRows[0]||{},calls:callRows[0]||{},acquisition:acquisitionRows[0]||{},card_payments:{...(cardRows[0]||{}),gross_volume_minor:Number(cardRows[0]?.gross_volume_minor||0),pgi_fee_minor:Number(cardRows[0]?.pgi_fee_minor||0)},operational_estimate:operational,settings,principles:["Les encaissements Stripe sont issus des événements payés réellement reçus.","La portabilité prioritaire utilise uniquement les paiements 9,90 EUR confirmés.","Le paiement CB comptabilise comme produit PGI uniquement la commission de service, jamais le volume brut du client.","Le SVA sépare reversement opérateur, marge PGI, net client et état de règlement.","Les estimations Business Live et appels en cours restent séparées des écritures comptables."]};
}

export async function accountingLedger(store,params={}){
  await syncAccountingLedger(store);const limit=Math.max(1,Math.min(500,Math.trunc(Number(params.limit)||200))),currency=String(params.currency||"EUR").toUpperCase(),month=String(params.month||"").trim(),values=[currency],where=["currency=$1"];
  if(month){const b=monthBounds(month);values.push(b.from,b.to);where.push("occurred_at>=$2::timestamptz AND occurred_at<$3::timestamptz");}
  values.push(limit);const n=values.length;
  const rows=await sqlRead(store).unsafe("SELECT id,public_id::text AS public_id,source_key,source_type,source_id,occurred_at,basis,direction,category,debit_account_code,credit_account_code,amount_minor::bigint AS amount_minor,currency,status,metadata,created_at FROM business_accounting_ledger WHERE "+where.join(" AND ")+" ORDER BY occurred_at DESC,id DESC LIMIT $"+n,values);
  return {data:rows.map(x=>({...x,amount_minor:Number(x.amount_minor||0)})),currency,month:month||null};
}

async function emailCandidateClaim(store,ambassadorId,key,period){
  const rows=await store.sql.unsafe("INSERT INTO ambassador_email_log(ambassador_id,email_key,period_key,status,attempts) VALUES($1,$2,$3,'pending',1) ON CONFLICT(ambassador_id,email_key,period_key) DO UPDATE SET status='pending',attempts=ambassador_email_log.attempts+1,updated_at=now() WHERE ambassador_email_log.status='failed' AND ambassador_email_log.attempts<3 RETURNING id,attempts",[ambassadorId,key,period]);return rows[0]||null;
}
async function markEmail(store,id,ok,error){await store.sql.unsafe("UPDATE ambassador_email_log SET status=$2,last_error=$3,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,updated_at=now() WHERE id=$1",[id,ok?"sent":"failed",ok?null:String(error||"AMBASSADOR_EMAIL_FAILED").slice(0,240)]);}
export async function runAmbassadorEmailCadence({store,config,sendTransactionalEmail}){
  const state=await featureState(store);if(!state.enabled||!state.motivation_email_enabled||!config.transactionalEmailEnabled)return {enabled:false,scanned:0,sent:0,failed:0};
  const profiles=await sqlRead(store).unsafe("SELECT a.id,a.email,a.display_name,a.created_at,count(r.id)::int AS referrals,count(r.id) FILTER(WHERE r.status='qualified')::int AS qualified,COALESCE((SELECT sum(w.amount_minor) FROM ambassador_rewards w WHERE w.ambassador_id=a.id AND w.status='earned'),0)::bigint AS earned_minor,COALESCE((SELECT sum(w.amount_minor) FROM ambassador_rewards w WHERE w.ambassador_id=a.id AND w.status='paid'),0)::bigint AS paid_minor FROM ambassador_profiles a LEFT JOIN ambassador_referrals r ON r.ambassador_id=a.id WHERE a.status='active' AND a.motivation_email_consent=true GROUP BY a.id ORDER BY a.id LIMIT $1",[EMAIL_LIMIT]);
  const now=new Date(),isMonday=now.getUTCDay()===1,isMonthStart=now.getUTCDate()===1,weekKey=now.getUTCFullYear()+"-W"+String(Math.ceil((((now-new Date(Date.UTC(now.getUTCFullYear(),0,1)))/86400000)+new Date(Date.UTC(now.getUTCFullYear(),0,1)).getUTCDay()+1)/7)).padStart(2,"0"),monthKey=now.toISOString().slice(0,7);
  let sent=0,failed=0;
  for(const p of profiles){
    const candidates=[],ageDays=(Date.now()-Date.parse(p.created_at))/86400000;
    if(Number(p.referrals||0)===0&&ageDays>=3)candidates.push({key:"day3",period:"once",template:"ambassador_nudge"});
    if(isMonday)candidates.push({key:"weekly",period:weekKey,template:"ambassador_weekly_summary"});
    if(isMonthStart)candidates.push({key:"monthly",period:monthKey,template:"ambassador_monthly_summary"});
    for(const c of candidates){
      const claim=await emailCandidateClaim(store,p.id,c.key,c.period);if(!claim)continue;
      try{await sendTransactionalEmail(config,{to:p.email,name:p.display_name,senderRole:"notifications",templateKey:c.template,data:{referrals:Number(p.referrals||0),qualified:Number(p.qualified||0),earned_minor:Number(p.earned_minor||0),paid_minor:Number(p.paid_minor||0),currency:"EUR",action_url:String(config.publicBaseUrl||"")+"/ambassadeur-audiotel/"},idempotencyKey:"ambassador/"+p.id+"/"+c.key+"/"+c.period,internalEventId:"ambassador/"+p.id+"/"+c.key+"/"+c.period});await markEmail(store,claim.id,true);sent++;}catch(error){await markEmail(store,claim.id,false,error?.code||error?.message);failed++;}
    }
  }
  return {enabled:true,scanned:profiles.length,sent,failed};
}

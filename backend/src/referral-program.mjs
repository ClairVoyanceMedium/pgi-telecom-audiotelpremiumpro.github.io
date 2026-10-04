import {randomBytes} from "node:crypto";

const memory=new WeakMap();
const PROGRAM_DEFAULT=Object.freeze({
  singleton_key:"default",enabled:false,reward_amount_minor:null,currency:"EUR",
  reward_label:"Crédit parrainage",terms_version:"2026-10-04-v1",updated_by:null,updated_at:null
});

function fail(status,code){
  const error=new Error(code);error.status=status;error.code=code;return error;
}
function actorKey(actor){return String(actor?.sub||actor?.id||actor?.name||"system").slice(0,160);}
function normalizeCode(value){
  const code=String(value||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  return /^[A-Z0-9]{8,20}$/.test(code)?code:"";
}
function sqlFor(store){return store?.sql&&typeof store.sql.unsafe==="function"?store.sql:null;}
function readSqlFor(store){return store?.readSql&&typeof store.readSql.unsafe==="function"?store.readSql:sqlFor(store);}
function schemaMissing(error){return String(error?.code||"")==="42P01";}
function memoryState(store){
  if(!memory.has(store))memory.set(store,{program:{...PROGRAM_DEFAULT},codes:new Map(),referrals:[],rewards:[]});
  return memory.get(store);
}
async function programRow(store){
  const sql=sqlFor(store);
  if(!sql)return {...memoryState(store).program};
  try{
    const rows=await sql.unsafe(
      "SELECT singleton_key,enabled,reward_amount_minor,currency,reward_label,terms_version,updated_by,updated_at"+
      " FROM platform_referral_program WHERE singleton_key='default'"
    );
    return rows[0]?{...rows[0],enabled:Boolean(rows[0].enabled),reward_amount_minor:rows[0].reward_amount_minor==null?null:Number(rows[0].reward_amount_minor)}:{...PROGRAM_DEFAULT};
  }catch(error){
    if(schemaMissing(error))return {...PROGRAM_DEFAULT};
    throw error;
  }
}
async function audit(store,action,entityType,entityId,actor,details={}){
  const sql=sqlFor(store);if(!sql)return;
  try{
    await sql.unsafe(
      "INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES($1,$2,$3,$4::jsonb)",
      [String(action),String(entityType||""),entityId==null?null:String(entityId),JSON.stringify({...details,actor:actorKey(actor)})]
    );
  }catch(error){if(!schemaMissing(error))throw error;}
}
function safeProgram(row){
  return {
    enabled:Boolean(row?.enabled),
    reward_amount_minor:row?.reward_amount_minor==null?null:Number(row.reward_amount_minor),
    currency:String(row?.currency||"EUR"),
    reward_label:String(row?.reward_label||"Crédit parrainage"),
    terms_version:String(row?.terms_version||"2026-10-04-v1"),
    updated_at:row?.updated_at||null
  };
}
function sharePath(code){return code?"/demande-ouverture/?parrain="+encodeURIComponent(code):null;}

export async function referralProgramOverview(store){
  const program=await programRow(store);
  const sql=readSqlFor(store);
  if(!sql){
    const s=memoryState(store);
    return {program:safeProgram(program),stats:{captured:s.referrals.filter(x=>x.status==="captured").length,qualified:s.referrals.filter(x=>x.status==="qualified").length,rewards_earned:s.rewards.filter(x=>x.status==="earned").length,rewards_settled:s.rewards.filter(x=>x.status==="settled").length,reward_amount_minor:s.rewards.reduce((a,x)=>a+Number(x.amount_minor||0),0)}};
  }
  try{
    const rows=await sql.unsafe(
      "SELECT"+
      " (SELECT count(*)::bigint FROM tenant_referrals WHERE status='captured') AS captured,"+
      " (SELECT count(*)::bigint FROM tenant_referrals WHERE status='qualified') AS qualified,"+
      " (SELECT count(*)::bigint FROM tenant_referral_rewards WHERE status='earned') AS rewards_earned,"+
      " (SELECT count(*)::bigint FROM tenant_referral_rewards WHERE status='settled') AS rewards_settled,"+
      " (SELECT COALESCE(sum(amount_minor),0)::bigint FROM tenant_referral_rewards WHERE status IN ('earned','settled')) AS reward_amount_minor"
    );
    const x=rows[0]||{};
    return {program:safeProgram(program),stats:{captured:Number(x.captured||0),qualified:Number(x.qualified||0),rewards_earned:Number(x.rewards_earned||0),rewards_settled:Number(x.rewards_settled||0),reward_amount_minor:Number(x.reward_amount_minor||0)}};
  }catch(error){
    if(schemaMissing(error))return {program:safeProgram(PROGRAM_DEFAULT),stats:{captured:0,qualified:0,rewards_earned:0,rewards_settled:0,reward_amount_minor:0},schema_ready:false};
    throw error;
  }
}

export async function updateReferralProgram(store,body={},actor={}){
  const enabled=body.enabled===true;
  const currency=String(body.currency||"EUR").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw fail(400,"REFERRAL_CURRENCY_INVALID");
  const amount=body.reward_amount_minor==null?null:Number(body.reward_amount_minor);
  if(amount!=null&&(!Number.isInteger(amount)||amount<=0||amount>100000000))throw fail(400,"REFERRAL_REWARD_INVALID");
  if(enabled&&(!amount||amount<=0))throw fail(400,"REFERRAL_REWARD_REQUIRED");
  const rewardLabel=String(body.reward_label||"Crédit parrainage").trim().slice(0,120)||"Crédit parrainage";
  const termsVersion=String(body.terms_version||"2026-10-04-v1").trim().slice(0,80)||"2026-10-04-v1";
  const sql=sqlFor(store);
  if(!sql){
    const s=memoryState(store),before={...s.program};
    s.program={singleton_key:"default",enabled,reward_amount_minor:amount,currency,reward_label:rewardLabel,terms_version:termsVersion,updated_by:actorKey(actor),updated_at:new Date().toISOString()};
    return {program:safeProgram(s.program),previous:safeProgram(before)};
  }
  try{
    const before=await programRow(store);
    const rows=await sql.unsafe(
      "INSERT INTO platform_referral_program(singleton_key,enabled,reward_amount_minor,currency,reward_label,terms_version,updated_by,updated_at)"+
      " VALUES('default',$1,$2,$3,$4,$5,$6,now())"+
      " ON CONFLICT(singleton_key) DO UPDATE SET enabled=EXCLUDED.enabled,reward_amount_minor=EXCLUDED.reward_amount_minor,currency=EXCLUDED.currency,reward_label=EXCLUDED.reward_label,terms_version=EXCLUDED.terms_version,updated_by=EXCLUDED.updated_by,updated_at=now()"+
      " RETURNING singleton_key,enabled,reward_amount_minor,currency,reward_label,terms_version,updated_by,updated_at",
      [enabled,amount,currency,rewardLabel,termsVersion,actorKey(actor)]
    );
    const after=rows[0]||PROGRAM_DEFAULT;
    await audit(store,"referral.program.update","platform_referral_program","default",actor,{previous:safeProgram(before),next:safeProgram(after)});
    return {program:safeProgram(after),previous:safeProgram(before)};
  }catch(error){
    if(schemaMissing(error))throw fail(503,"REFERRAL_SCHEMA_UNAVAILABLE");
    throw error;
  }
}

function randomCode(){return "APP"+randomBytes(5).toString("hex").toUpperCase();}

export async function ensureReferralCode(store,tenantId,actor={}){
  tenantId=Number(tenantId);
  if(!Number.isInteger(tenantId)||tenantId<=0)throw fail(400,"REFERRAL_TENANT_INVALID");
  const program=await programRow(store);
  if(!program.enabled||!Number(program.reward_amount_minor))throw fail(409,"REFERRAL_PROGRAM_DISABLED");
  const sql=sqlFor(store);
  if(!sql){
    const s=memoryState(store);
    let row=s.codes.get(tenantId);
    if(!row){row={id:s.codes.size+1,tenant_id:tenantId,code:randomCode(),active:true,created_at:new Date().toISOString()};s.codes.set(tenantId,row);}
    row.active=true;return {code:row.code,share_path:sharePath(row.code)};
  }
  try{
    const existing=await sql.unsafe("SELECT id,code,active,created_at FROM tenant_referral_codes WHERE tenant_id=$1 LIMIT 1",[tenantId]);
    if(existing[0]){
      if(existing[0].active!==true)await sql.unsafe("UPDATE tenant_referral_codes SET active=true,updated_at=now() WHERE id=$1",[existing[0].id]);
      return {code:String(existing[0].code),share_path:sharePath(String(existing[0].code))};
    }
    let inserted=null;
    for(let attempt=0;attempt<6&&!inserted;attempt++){
      const code=randomCode();
      try{
        const rows=await sql.unsafe("INSERT INTO tenant_referral_codes(tenant_id,code) VALUES($1,$2) RETURNING id,code,created_at",[tenantId,code]);
        inserted=rows[0]||null;
      }catch(error){if(String(error?.code)!=="23505")throw error;}
    }
    if(!inserted)throw fail(503,"REFERRAL_CODE_GENERATION_FAILED");
    await audit(store,"referral.code.create","tenant_referral_codes",inserted.id,actor,{tenant_id:tenantId});
    return {code:String(inserted.code),share_path:sharePath(String(inserted.code))};
  }catch(error){
    if(schemaMissing(error))throw fail(503,"REFERRAL_SCHEMA_UNAVAILABLE");
    throw error;
  }
}

export async function captureReferralAttribution(store,rawCode,referredTenantPublicId,{source="public_opening"}={}){
  const code=normalizeCode(rawCode);
  if(!code)return {accepted:false,reason:"invalid_code"};
  const program=await programRow(store);
  if(!program.enabled||!Number(program.reward_amount_minor))return {accepted:false,reason:"program_disabled"};
  const sql=sqlFor(store);
  if(!sql)return {accepted:false,reason:"persistent_store_required"};
  try{
    const rows=await sql.unsafe(
      "SELECT c.id AS code_id,c.tenant_id AS sponsor_tenant_id,t.id AS referred_tenant_id"+
      " FROM tenant_referral_codes c"+
      " JOIN tenants t ON t.public_id::text=$2"+
      " WHERE c.code=$1 AND c.active=true LIMIT 1",
      [code,String(referredTenantPublicId||"").trim()]
    );
    const x=rows[0];
    if(!x)return {accepted:false,reason:"code_not_found"};
    if(Number(x.sponsor_tenant_id)===Number(x.referred_tenant_id))return {accepted:false,reason:"self_referral"};
    const inserted=await sql.unsafe(
      "INSERT INTO tenant_referrals(sponsor_tenant_id,referred_tenant_id,referral_code_id,source,reward_amount_minor,currency,reward_label,terms_version)"+
      " VALUES($1,$2,$3,$4,$5,$6,$7,$8)"+
      " ON CONFLICT(referred_tenant_id) DO NOTHING"+
      " RETURNING id,public_id,status,captured_at",
      [Number(x.sponsor_tenant_id),Number(x.referred_tenant_id),Number(x.code_id),String(source||"public_opening").slice(0,80),Number(program.reward_amount_minor),String(program.currency),String(program.reward_label),String(program.terms_version)]
    );
    if(!inserted[0]){
      const prior=await sql.unsafe("SELECT sponsor_tenant_id,status FROM tenant_referrals WHERE referred_tenant_id=$1 LIMIT 1",[Number(x.referred_tenant_id)]);
      return {accepted:Number(prior[0]?.sponsor_tenant_id)===Number(x.sponsor_tenant_id),reason:"already_attributed",status:prior[0]?.status||null};
    }
    await audit(store,"referral.capture","tenant_referrals",inserted[0].id,null,{sponsor_tenant_id:Number(x.sponsor_tenant_id),referred_tenant_id:Number(x.referred_tenant_id),source:String(source||"public_opening").slice(0,80),terms_version:String(program.terms_version)});
    return {accepted:true,status:"captured",captured_at:inserted[0].captured_at};
  }catch(error){
    if(schemaMissing(error))return {accepted:false,reason:"schema_unavailable"};
    throw error;
  }
}

export async function qualifyReferralForTenant(store,tenantPublicId,{actor={},trigger="service_activation"}={}){
  const sql=sqlFor(store);if(!sql)return {qualified:false,reason:"persistent_store_required"};
  try{
    const targets=await sql.unsafe(
      "SELECT t.id,t.status,EXISTS(SELECT 1 FROM tenant_number_assignments a WHERE a.tenant_id=t.id AND a.status='active') AS service_active"+
      " FROM tenants t WHERE t.public_id::text=$1 LIMIT 1",
      [String(tenantPublicId||"").trim()]
    );
    const target=targets[0];
    if(!target)return {qualified:false,reason:"tenant_not_found"};
    if(String(target.status)!=="active"||target.service_active!==true)return {qualified:false,reason:"service_not_effectively_active"};
    const refs=await sql.unsafe(
      "SELECT id,sponsor_tenant_id,referred_tenant_id,reward_amount_minor,currency,reward_label,status"+
      " FROM tenant_referrals WHERE referred_tenant_id=$1 LIMIT 1",
      [Number(target.id)]
    );
    const ref=refs[0];
    if(!ref)return {qualified:false,reason:"no_referral"};
    if(String(ref.status)==="qualified"){
      const reward=await sql.unsafe("SELECT public_id,status,amount_minor,currency,earned_at FROM tenant_referral_rewards WHERE referral_id=$1 LIMIT 1",[Number(ref.id)]);
      return {qualified:true,replayed:true,reward:reward[0]||null};
    }
    if(String(ref.status)!=="captured")return {qualified:false,reason:"referral_not_eligible",status:String(ref.status)};
    const result=await sql.begin(async tx=>{
      const locked=await tx.unsafe(
        "SELECT id,sponsor_tenant_id,referred_tenant_id,reward_amount_minor,currency,reward_label,status FROM tenant_referrals WHERE id=$1 FOR UPDATE",
        [Number(ref.id)]
      );
      const current=locked[0];
      if(!current||String(current.status)!=="captured")return {replayed:true};
      await tx.unsafe(
        "UPDATE tenant_referrals SET status='qualified',qualified_at=now(),qualification_reason=$2,updated_at=now() WHERE id=$1",
        [Number(current.id),String(trigger||"service_activation").slice(0,120)]
      );
      const rewards=await tx.unsafe(
        "INSERT INTO tenant_referral_rewards(referral_id,sponsor_tenant_id,referred_tenant_id,amount_minor,currency,reward_label)"+
        " VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(referral_id) DO UPDATE SET referral_id=EXCLUDED.referral_id"+
        " RETURNING public_id,status,amount_minor,currency,reward_label,earned_at",
        [Number(current.id),Number(current.sponsor_tenant_id),Number(current.referred_tenant_id),Number(current.reward_amount_minor),String(current.currency),String(current.reward_label)]
      );
      return {replayed:false,reward:rewards[0]||null};
    });
    await audit(store,"referral.qualified","tenant_referrals",ref.id,actor,{referred_tenant_id:Number(target.id),trigger:String(trigger||"service_activation"),reward_amount_minor:Number(ref.reward_amount_minor),currency:String(ref.currency)});
    return {qualified:true,...result};
  }catch(error){
    if(schemaMissing(error))return {qualified:false,reason:"schema_unavailable"};
    throw error;
  }
}

export async function customerReferralOverview(store,tenantId){
  tenantId=Number(tenantId);
  const program=await programRow(store);
  const sql=readSqlFor(store);
  const base={program:safeProgram(program),can_share:Boolean(program.enabled&&Number(program.reward_amount_minor)>0),code:null,share_path:null,stats:{captured:0,qualified:0,rewards_earned:0,rewards_settled:0,reward_amount_minor:0},history:[]};
  if(!sql){
    const s=memoryState(store),code=s.codes.get(tenantId);
    if(base.can_share&&code?.active){base.code=code.code;base.share_path=sharePath(code.code);}
    return base;
  }
  try{
    const [codes,stats,history]=await Promise.all([
      sql.unsafe("SELECT code,active FROM tenant_referral_codes WHERE tenant_id=$1 LIMIT 1",[tenantId]),
      sql.unsafe(
        "SELECT"+
        " count(*) FILTER (WHERE r.status='captured')::bigint AS captured,"+
        " count(*) FILTER (WHERE r.status='qualified')::bigint AS qualified,"+
        " count(w.id) FILTER (WHERE w.status='earned')::bigint AS rewards_earned,"+
        " count(w.id) FILTER (WHERE w.status='settled')::bigint AS rewards_settled,"+
        " COALESCE(sum(w.amount_minor) FILTER (WHERE w.status IN ('earned','settled')),0)::bigint AS reward_amount_minor"+
        " FROM tenant_referrals r LEFT JOIN tenant_referral_rewards w ON w.referral_id=r.id WHERE r.sponsor_tenant_id=$1",
        [tenantId]
      ),
      sql.unsafe(
        "SELECT r.status,r.captured_at,r.qualified_at,w.status AS reward_status,w.amount_minor,w.currency,w.earned_at,w.settled_at"+
        " FROM tenant_referrals r LEFT JOIN tenant_referral_rewards w ON w.referral_id=r.id"+
        " WHERE r.sponsor_tenant_id=$1 ORDER BY r.captured_at DESC LIMIT 20",
        [tenantId]
      )
    ]);
    const s=stats[0]||{};
    base.stats={captured:Number(s.captured||0),qualified:Number(s.qualified||0),rewards_earned:Number(s.rewards_earned||0),rewards_settled:Number(s.rewards_settled||0),reward_amount_minor:Number(s.reward_amount_minor||0)};
    base.history=history.map(x=>({status:String(x.status),captured_at:x.captured_at,qualified_at:x.qualified_at||null,reward_status:x.reward_status||null,amount_minor:x.amount_minor==null?null:Number(x.amount_minor),currency:x.currency||null,earned_at:x.earned_at||null,settled_at:x.settled_at||null}));
    if(base.can_share&&codes[0]?.active===true){base.code=String(codes[0].code);base.share_path=sharePath(base.code);}
    return base;
  }catch(error){
    if(schemaMissing(error))return {...base,program:safeProgram(PROGRAM_DEFAULT),can_share:false,schema_ready:false};
    throw error;
  }
}

const DEFAULT_TIMEZONE="Europe/Paris";
const UNITS=new Set(["day","week","month"]);

function fail(status,code){
  const error=new Error(code);
  error.status=status;
  error.code=code;
  error.expose=true;
  throw error;
}

function validTimezone(value){
  try{
    new Intl.DateTimeFormat("fr-FR",{timeZone:value}).format(new Date());
    return true;
  }catch{return false;}
}

export function normalizeBusinessLiveResetSchedule(input={}){
  const enabled=input.enabled===true;
  const intervalUnit=String(input.interval_unit||"day").trim().toLowerCase();
  const intervalValue=Number(input.interval_value==null?1:input.interval_value);
  const timezone=String(input.timezone||DEFAULT_TIMEZONE).trim()||DEFAULT_TIMEZONE;
  const anchorRaw=input.anchor_at==null||input.anchor_at===""?null:String(input.anchor_at);
  const anchor=anchorRaw==null?null:new Date(anchorRaw);

  if(!UNITS.has(intervalUnit))fail(400,"BUSINESS_LIVE_SCHEDULE_INTERVAL_UNIT_INVALID");
  if(!Number.isInteger(intervalValue)||intervalValue<1||intervalValue>3650)fail(400,"BUSINESS_LIVE_SCHEDULE_INTERVAL_VALUE_INVALID");
  if(!validTimezone(timezone))fail(400,"BUSINESS_LIVE_SCHEDULE_TIMEZONE_INVALID");
  if(enabled&&(!anchor||!Number.isFinite(anchor.getTime())))fail(400,"BUSINESS_LIVE_SCHEDULE_ANCHOR_REQUIRED");
  if(anchor&&(!Number.isFinite(anchor.getTime())||Math.abs(anchor.getTime()-Date.now())>1000*60*60*24*365*50))fail(400,"BUSINESS_LIVE_SCHEDULE_ANCHOR_INVALID");

  return {
    enabled,
    interval_unit:intervalUnit,
    interval_value:intervalValue,
    timezone,
    anchor_at:anchor?anchor.toISOString():null
  };
}

function keyFor(scope,tenantId){
  if(scope==="platform")return "platform";
  const id=Number(tenantId);
  if(scope!=="tenant"||!Number.isInteger(id)||id<=0)fail(400,"INVALID_TENANT_CONTEXT");
  return "tenant:"+id;
}

function defaultSchedule(scope,tenantId){
  return {
    schedule_key:keyFor(scope,tenantId),
    scope,
    tenant_id:scope==="tenant"?Number(tenantId):null,
    enabled:false,
    interval_unit:"day",
    interval_value:1,
    timezone:DEFAULT_TIMEZONE,
    anchor_at:null,
    next_occurrence:null,
    next_run_at:null,
    last_run_at:null,
    last_error:null,
    execution_window_minutes:5
  };
}

function memorySchedules(store){
  if(!store.__businessLiveResetSchedules){
    Object.defineProperty(store,"__businessLiveResetSchedules",{value:new Map(),enumerable:false});
  }
  return store.__businessLiveResetSchedules;
}

function addUtcInterval(anchor,unit,value,occurrence){
  const d=new Date(anchor);
  if(unit==="day")d.setUTCDate(d.getUTCDate()+value*occurrence);
  else if(unit==="week")d.setUTCDate(d.getUTCDate()+value*7*occurrence);
  else d.setUTCMonth(d.getUTCMonth()+value*occurrence);
  return d;
}

function nextMemoryRun(schedule,after=Date.now()){
  if(!schedule.enabled||!schedule.anchor_at)return {occurrence:null,run_at:null};
  for(let i=0;i<=100000;i++){
    const candidate=addUtcInterval(schedule.anchor_at,schedule.interval_unit,schedule.interval_value,i);
    if(candidate.getTime()>after)return {occurrence:i,run_at:candidate.toISOString()};
  }
  fail(500,"BUSINESS_LIVE_SCHEDULE_SEARCH_LIMIT");
}

function publicRow(row,scope,tenantId){
  if(!row)return defaultSchedule(scope,tenantId);
  return {
    schedule_key:String(row.schedule_key),
    scope:String(row.scope),
    tenant_id:row.tenant_id==null?null:Number(row.tenant_id),
    enabled:row.enabled===true,
    interval_unit:String(row.interval_unit||"day"),
    interval_value:Number(row.interval_value||1),
    timezone:String(row.timezone||DEFAULT_TIMEZONE),
    anchor_at:row.anchor_at?new Date(row.anchor_at).toISOString():null,
    next_occurrence:row.next_occurrence==null?null:Number(row.next_occurrence),
    next_run_at:row.next_run_at?new Date(row.next_run_at).toISOString():null,
    last_run_at:row.last_run_at?new Date(row.last_run_at).toISOString():null,
    last_error:row.last_error||null,
    execution_window_minutes:5
  };
}

export async function getBusinessLiveResetSchedule(store,{scope,tenantId=null}){
  const scheduleKey=keyFor(scope,tenantId);
  if(store?.sql?.unsafe){
    const rows=await store.sql.unsafe(
      "SELECT schedule_key,scope,tenant_id,enabled,interval_unit,interval_value,timezone,anchor_at,next_occurrence,next_run_at,last_run_at,last_error"+
      " FROM business_live_reset_schedules WHERE schedule_key=$1 LIMIT 1",
      [scheduleKey]
    );
    return publicRow(rows[0],scope,tenantId);
  }
  return publicRow(memorySchedules(store).get(scheduleKey),scope,tenantId);
}

export async function saveBusinessLiveResetSchedule(store,{scope,tenantId=null,payload={},actor=null,customerPrincipalId=null}){
  const scheduleKey=keyFor(scope,tenantId);
  const normalized=normalizeBusinessLiveResetSchedule(payload);
  const staffUserId=Number(actor?.sub);
  const userId=Number.isInteger(staffUserId)&&staffUserId>0?staffUserId:null;
  const principal=customerPrincipalId?String(customerPrincipalId):null;

  if(scope==="tenant"&&!principal)fail(400,"BUSINESS_LIVE_SCHEDULE_CUSTOMER_PRINCIPAL_REQUIRED");

  if(store?.sql?.unsafe){
    let next={occurrence:null,run_at:null};
    if(normalized.enabled){
      const rows=await store.sql.unsafe(
        "SELECT occurrence,run_at FROM pgi_business_live_next_run($1::timestamptz,$2,$3,$4,now())",
        [normalized.anchor_at,normalized.timezone,normalized.interval_unit,normalized.interval_value]
      );
      if(!rows[0])fail(500,"BUSINESS_LIVE_SCHEDULE_NEXT_RUN_UNAVAILABLE");
      next=rows[0];
    }
    const rows=await store.sql.unsafe(
      "INSERT INTO business_live_reset_schedules(schedule_key,scope,tenant_id,enabled,interval_unit,interval_value,timezone,anchor_at,next_occurrence,next_run_at,updated_by_user_id,updated_by_customer_principal_id,lease_until,last_error,updated_at)"+
      " VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10::timestamptz,$11,$12::uuid,NULL,NULL,now())"+
      " ON CONFLICT(schedule_key) DO UPDATE SET enabled=EXCLUDED.enabled,interval_unit=EXCLUDED.interval_unit,interval_value=EXCLUDED.interval_value,timezone=EXCLUDED.timezone,anchor_at=EXCLUDED.anchor_at,next_occurrence=EXCLUDED.next_occurrence,next_run_at=EXCLUDED.next_run_at,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_by_customer_principal_id=EXCLUDED.updated_by_customer_principal_id,lease_until=NULL,last_error=NULL,updated_at=now()"+
      " RETURNING schedule_key,scope,tenant_id,enabled,interval_unit,interval_value,timezone,anchor_at,next_occurrence,next_run_at,last_run_at,last_error",
      [scheduleKey,scope,scope==="tenant"?Number(tenantId):null,normalized.enabled,normalized.interval_unit,normalized.interval_value,normalized.timezone,normalized.anchor_at,next.occurrence,next.run_at,userId,principal]
    );
    return publicRow(rows[0],scope,tenantId);
  }

  const row={
    ...defaultSchedule(scope,tenantId),
    ...normalized,
    next_occurrence:null,
    next_run_at:null,
    updated_by_user_id:userId,
    updated_by_customer_principal_id:principal
  };
  if(row.enabled){
    const next=nextMemoryRun(row);
    row.next_occurrence=next.occurrence;
    row.next_run_at=next.run_at;
  }
  memorySchedules(store).set(scheduleKey,row);
  return publicRow(row,scope,tenantId);
}

async function advanceSqlSchedule(store,row){
  const nextRows=await store.sql.unsafe(
    "SELECT occurrence,run_at FROM pgi_business_live_next_run($1::timestamptz,$2,$3,$4,now())",
    [row.anchor_at,row.timezone,row.interval_unit,row.interval_value]
  );
  const next=nextRows[0]||{occurrence:null,run_at:null};
  await store.sql.unsafe(
    "UPDATE business_live_reset_schedules SET next_occurrence=$2,next_run_at=$3::timestamptz,last_run_at=now(),lease_until=NULL,last_error=NULL,updated_at=now() WHERE schedule_key=$1",
    [row.schedule_key,next.occurrence,next.run_at]
  );
}

export async function runDueBusinessLiveResetSchedules(store,{limit=100}={}){
  const safeLimit=Math.max(1,Math.min(500,Number(limit)||100));
  const summary={claimed:0,reset:0,failed:0};

  if(store?.sql?.unsafe){
    const rows=await store.sql.unsafe(
      "WITH due AS ("+
      " SELECT schedule_key FROM business_live_reset_schedules"+
      " WHERE enabled=true AND next_run_at IS NOT NULL AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())"+
      " ORDER BY next_run_at,schedule_key FOR UPDATE SKIP LOCKED LIMIT $1"+
      ")"+
      " UPDATE business_live_reset_schedules s SET lease_until=now()+interval '10 minutes',updated_at=now()"+
      " FROM due WHERE s.schedule_key=due.schedule_key"+
      " RETURNING s.schedule_key,s.scope,s.tenant_id,s.interval_unit,s.interval_value,s.timezone,s.anchor_at,s.next_occurrence,s.next_run_at,s.updated_by_user_id,s.updated_by_customer_principal_id",
      [safeLimit]
    );
    summary.claimed=rows.length;

    for(const row of rows){
      try{
        if(row.scope==="platform"){
          await store.createPlatformJackpotReset({sub:row.updated_by_user_id||null});
        }else{
          if(!row.updated_by_customer_principal_id)fail(500,"BUSINESS_LIVE_SCHEDULE_CUSTOMER_PRINCIPAL_MISSING");
          await store.createCustomerJackpotReset(Number(row.tenant_id),String(row.updated_by_customer_principal_id));
        }
        await advanceSqlSchedule(store,row);
        summary.reset++;
      }catch(error){
        summary.failed++;
        await store.sql.unsafe(
          "UPDATE business_live_reset_schedules SET lease_until=NULL,last_error=$2,updated_at=now() WHERE schedule_key=$1",
          [row.schedule_key,String(error?.code||error?.message||"scheduled reset failed").slice(0,500)]
        );
      }
    }
    return summary;
  }

  const schedules=memorySchedules(store);
  const due=[...schedules.values()]
    .filter(x=>x.enabled&&x.next_run_at&&Date.parse(x.next_run_at)<=Date.now())
    .sort((a,b)=>Date.parse(a.next_run_at)-Date.parse(b.next_run_at))
    .slice(0,safeLimit);
  summary.claimed=due.length;
  for(const row of due){
    try{
      if(row.scope==="platform")await store.createPlatformJackpotReset({sub:row.updated_by_user_id||null});
      else await store.createCustomerJackpotReset(row.tenant_id,row.updated_by_customer_principal_id||null);
      row.last_run_at=new Date().toISOString();
      const next=nextMemoryRun(row,Date.now());
      row.next_occurrence=next.occurrence;
      row.next_run_at=next.run_at;
      row.last_error=null;
      summary.reset++;
    }catch(error){
      row.last_error=String(error?.code||error?.message||"scheduled reset failed").slice(0,500);
      summary.failed++;
    }
  }
  return summary;
}

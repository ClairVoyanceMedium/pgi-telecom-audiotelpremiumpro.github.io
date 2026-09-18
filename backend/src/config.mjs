export function loadConfig(env=process.env){
  const mode=(env.PGI_BACKEND_MODE||"simulator").toLowerCase();
  if(!["simulator","production"].includes(mode))throw new Error("PGI_BACKEND_MODE must be simulator or production");

  const authMode=(env.PGI_AUTH_MODE||(mode==="production"?"session":"disabled")).toLowerCase();
  if(!["disabled","session"].includes(authMode))throw new Error("PGI_AUTH_MODE must be disabled or session");

  const host=env.PGI_BACKEND_HOST||(mode==="production"?"127.0.0.1":"127.0.0.1");
  const port=integer(env.PGI_BACKEND_PORT,8080,1,65535,"PGI_BACKEND_PORT");
  const sessionSecret=env.PGI_SESSION_SECRET||"";
  const adminPasswordHash=env.PGI_ADMIN_PASSWORD_HASH||"";
  const ingestToken=env.PGI_INGEST_TOKEN||"";
  const telephonyUser=env.PGI_TELEPHONY_USER||"";
  const telephonyPassword=env.PGI_TELEPHONY_PASSWORD||"";
  const callerHashKey=env.PGI_CALLER_HASH_KEY||"";
  const databaseUrl=env.PGI_DATABASE_URL||buildDatabaseUrl(env);
  const databaseSsl=(env.PGI_DATABASE_SSL||"disable").toLowerCase();
  const releaseId=env.PGI_RELEASE_ID||"";
  if(!["disable","require"].includes(databaseSsl))throw new Error("PGI_DATABASE_SSL must be disable or require");

  if(mode==="production"){
    if(authMode!=="session")throw new Error("production requires session authentication");
    if(sessionSecret.length<32)throw new Error("production requires PGI_SESSION_SECRET >= 32 characters");
    if(!adminPasswordHash)throw new Error("production requires PGI_ADMIN_PASSWORD_HASH");
    if(ingestToken.length<24)throw new Error("production requires PGI_INGEST_TOKEN >= 24 characters");
    if(telephonyUser.length<3||telephonyPassword.length<24)throw new Error("production requires PGI_TELEPHONY_USER and PGI_TELEPHONY_PASSWORD >= 24 characters");
    if(callerHashKey.length<32)throw new Error("production requires PGI_CALLER_HASH_KEY >= 32 characters");
    if(!databaseUrl)throw new Error("production requires PGI_DATABASE_URL or POSTGRES_* variables");
    if(!/^[0-9a-f]{40}$/.test(releaseId))throw new Error("production requires PGI_RELEASE_ID as a 40-character Git SHA");
  }

  return Object.freeze({
    mode,authMode,host,port,releaseId,
    sessionSecret,adminPasswordHash,ingestToken,telephonyUser,telephonyPassword,callerHashKey,databaseUrl,databaseSsl,
    adminUsername:env.PGI_ADMIN_USERNAME||"admin",
    sessionTtlSeconds:integer(env.PGI_SESSION_TTL_SECONDS,3600,300,86400,"PGI_SESSION_TTL_SECONDS"),
    bodyLimitBytes:integer(env.PGI_BODY_LIMIT_BYTES,262144,4096,10485760,"PGI_BODY_LIMIT_BYTES"),
    rateLimitPerMinute:integer(env.PGI_RATE_LIMIT_PER_MINUTE,240,10,10000,"PGI_RATE_LIMIT_PER_MINUTE"),
    authMaxFailures:integer(env.PGI_AUTH_MAX_FAILURES,8,3,100,"PGI_AUTH_MAX_FAILURES"),
    authFailureWindowSeconds:integer(env.PGI_AUTH_FAILURE_WINDOW_SECONDS,900,60,86400,"PGI_AUTH_FAILURE_WINDOW_SECONDS"),
    outboxWorkerStaleSeconds:integer(env.PGI_OUTBOX_WORKER_STALE_SECONDS,15,5,3600,"PGI_OUTBOX_WORKER_STALE_SECONDS"),
    alertsWorkerStaleSeconds:integer(env.PGI_ALERTS_WORKER_STALE_SECONDS,120,30,3600,"PGI_ALERTS_WORKER_STALE_SECONDS"),
    shutdownGraceMs:integer(env.PGI_SHUTDOWN_GRACE_MS,10000,1000,60000,"PGI_SHUTDOWN_GRACE_MS"),
    maxEventSubscribers:integer(env.PGI_MAX_EVENT_SUBSCRIBERS,32,1,1000,"PGI_MAX_EVENT_SUBSCRIBERS"),
    databasePoolMax:integer(env.PGI_DATABASE_POOL_MAX,10,1,100,"PGI_DATABASE_POOL_MAX"),
    requireCarrierContract:booleanValue(env.PGI_REQUIRE_CARRIER_CONTRACT,false,"PGI_REQUIRE_CARRIER_CONTRACT"),
    serviceRateTtcPerMin:number(env.PGI_SERVICE_RATE_TTC_PER_MIN,0.80,0,100,"PGI_SERVICE_RATE_TTC_PER_MIN"),
    payoutRateHtPerMin:number(env.PGI_PAYOUT_RATE_HT_PER_MIN,0.46,0,100,"PGI_PAYOUT_RATE_HT_PER_MIN"),
    expertCostHtPerMin:number(env.PGI_EXPERT_COST_HT_PER_MIN,0.18,0,100,"PGI_EXPERT_COST_HT_PER_MIN"),
    technicalCostHtPerCall:number(env.PGI_TECHNICAL_COST_HT_PER_CALL,0,0,100,"PGI_TECHNICAL_COST_HT_PER_CALL"),
    reconciliationToleranceHt:number(env.PGI_RECONCILIATION_TOLERANCE_HT,0.01,0,100,"PGI_RECONCILIATION_TOLERANCE_HT"),
    version:env.PGI_VERSION||"1.9.0"
  });
}

function integer(value,fallback,min,max,name){
  const n=value==null||value===""?fallback:Number(value);
  if(!Number.isInteger(n)||n<min||n>max)throw new Error(name+" invalid");
  return n;
}
function booleanValue(value,fallback,name){
  if(value==null||value==="")return fallback;
  const normalized=String(value).trim().toLowerCase();
  if(["1","true","yes","on"].includes(normalized))return true;
  if(["0","false","no","off"].includes(normalized))return false;
  throw new Error(name+" invalid");
}
function number(value,fallback,min,max,name){
  const n=value==null||value===""?fallback:Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error(name+" invalid");
  return n;
}

function buildDatabaseUrl(env){
  if(!env.POSTGRES_PASSWORD)return "";
  const user=encodeURIComponent(env.POSTGRES_USER||"pgi_telecom");
  const pass=encodeURIComponent(env.POSTGRES_PASSWORD);
  const host=env.POSTGRES_HOST||"127.0.0.1";
  const port=env.POSTGRES_PORT||"5432";
  const db=encodeURIComponent(env.POSTGRES_DB||"pgi_telecom");
  return "postgresql://"+user+":"+pass+"@"+host+":"+port+"/"+db;
}

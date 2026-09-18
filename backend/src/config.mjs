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

  if(mode==="production"){
    if(authMode!=="session")throw new Error("production requires session authentication");
    if(sessionSecret.length<32)throw new Error("production requires PGI_SESSION_SECRET >= 32 characters");
    if(!adminPasswordHash)throw new Error("production requires PGI_ADMIN_PASSWORD_HASH");
    if(ingestToken.length<24)throw new Error("production requires PGI_INGEST_TOKEN >= 24 characters");
  }

  return Object.freeze({
    mode,authMode,host,port,
    sessionSecret,adminPasswordHash,ingestToken,
    adminUsername:env.PGI_ADMIN_USERNAME||"admin",
    sessionTtlSeconds:integer(env.PGI_SESSION_TTL_SECONDS,3600,300,86400,"PGI_SESSION_TTL_SECONDS"),
    bodyLimitBytes:integer(env.PGI_BODY_LIMIT_BYTES,262144,4096,10485760,"PGI_BODY_LIMIT_BYTES"),
    rateLimitPerMinute:integer(env.PGI_RATE_LIMIT_PER_MINUTE,240,10,10000,"PGI_RATE_LIMIT_PER_MINUTE"),
    serviceRateTtcPerMin:number(env.PGI_SERVICE_RATE_TTC_PER_MIN,0.80,0,100,"PGI_SERVICE_RATE_TTC_PER_MIN"),
    payoutRateHtPerMin:number(env.PGI_PAYOUT_RATE_HT_PER_MIN,0.46,0,100,"PGI_PAYOUT_RATE_HT_PER_MIN"),
    expertCostHtPerMin:number(env.PGI_EXPERT_COST_HT_PER_MIN,0.18,0,100,"PGI_EXPERT_COST_HT_PER_MIN"),
    reconciliationToleranceHt:number(env.PGI_RECONCILIATION_TOLERANCE_HT,0.01,0,100,"PGI_RECONCILIATION_TOLERANCE_HT"),
    version:env.PGI_VERSION||"1.3.0"
  });
}

function integer(value,fallback,min,max,name){
  const n=value==null||value===""?fallback:Number(value);
  if(!Number.isInteger(n)||n<min||n>max)throw new Error(name+" invalid");
  return n;
}
function number(value,fallback,min,max,name){
  const n=value==null||value===""?fallback:Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error(name+" invalid");
  return n;
}

export function loadConfig(env=process.env){
  const mode=(env.PGI_BACKEND_MODE||"simulator").toLowerCase();
  if(!["simulator","production"].includes(mode))throw new Error("PGI_BACKEND_MODE must be simulator or production");

  const authMode=(env.PGI_AUTH_MODE||(mode==="production"?"session":"disabled")).toLowerCase();
  if(!["disabled","session"].includes(authMode))throw new Error("PGI_AUTH_MODE must be disabled or session");

  const host=env.PGI_BACKEND_HOST||(mode==="production"?"127.0.0.1":"127.0.0.1");
  const port=integer(env.PGI_BACKEND_PORT||env.PORT,8080,1,65535,"PGI_BACKEND_PORT");
  const sessionSecret=env.PGI_SESSION_SECRET||"";
  const adminPasswordHash=env.PGI_ADMIN_PASSWORD_HASH||"";
  const ingestToken=env.PGI_INGEST_TOKEN||"";
  const externalBillingEnabled=booleanValue(env.PGI_EXTERNAL_BILLING_ENABLED,false,"PGI_EXTERNAL_BILLING_ENABLED");
  const billingIngestToken=env.PGI_BILLING_INGEST_TOKEN||"";
  const stripeSecretKey=String(env.PGI_STRIPE_SECRET_KEY||env.STRIPE_SECRET_KEY||"").trim();
  const stripeWebhookSecret=String(env.PGI_STRIPE_WEBHOOK_SECRET||"").trim();
  const stripeApiVersion=String(env.PGI_STRIPE_API_VERSION||"2026-08-26.dahlia").trim();
  const stripePortalConfigurationId=String(env.PGI_STRIPE_PORTAL_CONFIGURATION_ID||"").trim();
  const stripePriceLookupKey=String(env.PGI_STRIPE_PRICE_LOOKUP_KEY||"pgi_audiotel_premium_pro_monthly_eur").trim();
  const stripeLiveMode=booleanValue(env.PGI_STRIPE_LIVE_MODE,false,"PGI_STRIPE_LIVE_MODE");
  const publicBaseUrl=String(env.PGI_PUBLIC_BASE_URL||(env.VERCEL_PROJECT_PRODUCTION_URL?"https://"+env.VERCEL_PROJECT_PRODUCTION_URL:"")).trim().replace(/\/$/,"");
  const telephonyUser=env.PGI_TELEPHONY_USER||"";
  const telephonyPassword=env.PGI_TELEPHONY_PASSWORD||"";
  const callerHashKey=env.PGI_CALLER_HASH_KEY||"";
  const portabilitySecretKey=env.PGI_PORTABILITY_SECRET_KEY||"";
  const databaseUrl=env.PGI_DATABASE_URL||env.DATABASE_URL||buildDatabaseUrl(env);
  const databaseReadUrl=env.PGI_DATABASE_READ_URL||"";
  const databaseSsl=(env.PGI_DATABASE_SSL||"disable").toLowerCase();
  const releaseId=env.PGI_RELEASE_ID||env.RAILWAY_GIT_COMMIT_SHA||env.VERCEL_GIT_COMMIT_SHA||"";
  const staticDir=String(env.PGI_STATIC_DIR||"").trim();
  const trustProxy=booleanValue(
    env.PGI_TRUST_PROXY,
    env.VERCEL==="1"||Boolean(env.RAILWAY_ENVIRONMENT||env.RAILWAY_PROJECT_ID),
    "PGI_TRUST_PROXY"
  );
  const protectMachineEndpoints=booleanValue(
    env.PGI_PROTECT_MACHINE_ENDPOINTS,
    env.VERCEL==="1",
    "PGI_PROTECT_MACHINE_ENDPOINTS"
  );
  const googleClientId=String(env.PGI_GOOGLE_CLIENT_ID||"").trim();
  const webauthnRpId=String(env.PGI_WEBAUTHN_RP_ID||"").trim().toLowerCase();
  const webauthnOrigin=String(env.PGI_WEBAUTHN_ORIGIN||"").trim();
  if((webauthnRpId&&!webauthnOrigin)||(!webauthnRpId&&webauthnOrigin))throw new Error("PGI_WEBAUTHN_RP_ID and PGI_WEBAUTHN_ORIGIN must be configured together");
  if(webauthnOrigin){
    let parsed;try{parsed=new URL(webauthnOrigin);}catch{throw new Error("PGI_WEBAUTHN_ORIGIN invalid");}
    if(parsed.protocol!=="https:"||parsed.origin!==webauthnOrigin||parsed.username||parsed.password)throw new Error("PGI_WEBAUTHN_ORIGIN must be an exact HTTPS origin");
    if(parsed.hostname!==webauthnRpId&&!parsed.hostname.endsWith("."+webauthnRpId))throw new Error("PGI_WEBAUTHN_RP_ID must match the origin host or a parent domain");
  }
  if(!["disable","require"].includes(databaseSsl))throw new Error("PGI_DATABASE_SSL must be disable or require");
  if(publicBaseUrl){
    let parsed;try{parsed=new URL(publicBaseUrl);}catch{throw new Error("PGI_PUBLIC_BASE_URL invalid");}
    if(parsed.protocol!=="https:"||parsed.origin!==publicBaseUrl||parsed.username||parsed.password)throw new Error("PGI_PUBLIC_BASE_URL must be an exact HTTPS origin");
  }
  if(stripeSecretKey&&!/^sk_(test|live)_[A-Za-z0-9]+$/.test(stripeSecretKey))throw new Error("PGI_STRIPE_SECRET_KEY must be a Stripe secret key");
  if(stripeWebhookSecret&&!/^whsec_[A-Za-z0-9]+$/.test(stripeWebhookSecret))throw new Error("PGI_STRIPE_WEBHOOK_SECRET invalid");
  if(stripePortalConfigurationId&&!/^bpc_[A-Za-z0-9]+$/.test(stripePortalConfigurationId))throw new Error("PGI_STRIPE_PORTAL_CONFIGURATION_ID invalid");
  if(!/^[A-Za-z0-9_\-]{3,200}$/.test(stripePriceLookupKey))throw new Error("PGI_STRIPE_PRICE_LOOKUP_KEY invalid");
  if(stripeSecretKey&&stripeLiveMode!==stripeSecretKey.startsWith("sk_live_"))throw new Error("PGI_STRIPE_LIVE_MODE must match the Stripe secret key mode");

  if(mode==="production"){
    if(authMode!=="session")throw new Error("production requires session authentication");
    if(sessionSecret.length<32)throw new Error("production requires PGI_SESSION_SECRET >= 32 characters");
    if(!adminPasswordHash)throw new Error("production requires PGI_ADMIN_PASSWORD_HASH");
    if(ingestToken.length<24)throw new Error("production requires PGI_INGEST_TOKEN >= 24 characters");
    if(externalBillingEnabled&&billingIngestToken.length<24)throw new Error("external billing requires PGI_BILLING_INGEST_TOKEN >= 24 characters");
    if(telephonyUser.length<3||telephonyPassword.length<24)throw new Error("production requires PGI_TELEPHONY_USER and PGI_TELEPHONY_PASSWORD >= 24 characters");
    if(callerHashKey.length<32)throw new Error("production requires PGI_CALLER_HASH_KEY >= 32 characters");
    if(portabilitySecretKey.length<32)throw new Error("production requires PGI_PORTABILITY_SECRET_KEY >= 32 characters");
    if(!databaseUrl)throw new Error("production requires PGI_DATABASE_URL or POSTGRES_* variables");
    if(!/^[0-9a-f]{40}$/.test(releaseId))throw new Error("production requires PGI_RELEASE_ID as a 40-character Git SHA");
  }

  return Object.freeze({
    mode,authMode,host,port,releaseId,staticDir,trustProxy,protectMachineEndpoints,googleClientId,webauthnRpId,webauthnOrigin,
    sessionSecret,adminPasswordHash,ingestToken,billingIngestToken,externalBillingEnabled,stripeSecretKey,stripeWebhookSecret,stripeApiVersion,stripePortalConfigurationId,stripePriceLookupKey,stripeLiveMode,publicBaseUrl,telephonyUser,telephonyPassword,callerHashKey,portabilitySecretKey,databaseUrl,databaseReadUrl,databaseSsl,
    adminUsername:env.PGI_ADMIN_USERNAME||"admin",
    sessionTtlSeconds:integer(env.PGI_SESSION_TTL_SECONDS,3600,300,86400,"PGI_SESSION_TTL_SECONDS"),
    bodyLimitBytes:integer(env.PGI_BODY_LIMIT_BYTES,262144,4096,10485760,"PGI_BODY_LIMIT_BYTES"),
    rateLimitPerMinute:integer(env.PGI_RATE_LIMIT_PER_MINUTE,240,10,10000,"PGI_RATE_LIMIT_PER_MINUTE"),
    heavyReadRateLimitPerMinute:integer(env.PGI_HEAVY_READ_RATE_LIMIT_PER_MINUTE,60,5,5000,"PGI_HEAVY_READ_RATE_LIMIT_PER_MINUTE"),
    writeRateLimitPerMinute:integer(env.PGI_WRITE_RATE_LIMIT_PER_MINUTE,120,5,5000,"PGI_WRITE_RATE_LIMIT_PER_MINUTE"),
    stripeWebhookToleranceSeconds:integer(env.PGI_STRIPE_WEBHOOK_TOLERANCE_SECONDS,300,60,900,"PGI_STRIPE_WEBHOOK_TOLERANCE_SECONDS"),
    authMaxFailures:integer(env.PGI_AUTH_MAX_FAILURES,8,3,100,"PGI_AUTH_MAX_FAILURES"),
    authFailureWindowSeconds:integer(env.PGI_AUTH_FAILURE_WINDOW_SECONDS,900,60,86400,"PGI_AUTH_FAILURE_WINDOW_SECONDS"),
    outboxWorkerStaleSeconds:integer(env.PGI_OUTBOX_WORKER_STALE_SECONDS,15,5,3600,"PGI_OUTBOX_WORKER_STALE_SECONDS"),
    alertsWorkerStaleSeconds:integer(env.PGI_ALERTS_WORKER_STALE_SECONDS,120,30,3600,"PGI_ALERTS_WORKER_STALE_SECONDS"),
    shutdownGraceMs:integer(env.PGI_SHUTDOWN_GRACE_MS,10000,1000,60000,"PGI_SHUTDOWN_GRACE_MS"),
    maxEventSubscribers:integer(env.PGI_MAX_EVENT_SUBSCRIBERS,32,1,1000,"PGI_MAX_EVENT_SUBSCRIBERS"),
    databasePoolMax:integer(env.PGI_DATABASE_POOL_MAX,10,1,500,"PGI_DATABASE_POOL_MAX"),
    databaseReadPoolMax:integer(env.PGI_DATABASE_READ_POOL_MAX,20,1,1000,"PGI_DATABASE_READ_POOL_MAX"),
    processRole:enumValue(env.PGI_PROCESS_ROLE||"all",["all","api","worker"],"PGI_PROCESS_ROLE"),
    workerLeaseSeconds:integer(env.PGI_WORKER_LEASE_SECONDS,45,10,300,"PGI_WORKER_LEASE_SECONDS"),
    workQueueBatchSize:integer(env.PGI_WORK_QUEUE_BATCH_SIZE,25,1,100,"PGI_WORK_QUEUE_BATCH_SIZE"),
    workQueueLeaseSeconds:integer(env.PGI_WORK_QUEUE_LEASE_SECONDS,60,15,900,"PGI_WORK_QUEUE_LEASE_SECONDS"),
    workQueueRetryBaseSeconds:integer(env.PGI_WORK_QUEUE_RETRY_BASE_SECONDS,15,1,3600,"PGI_WORK_QUEUE_RETRY_BASE_SECONDS"),
    workQueuePollMs:integer(env.PGI_WORK_QUEUE_POLL_MS,1000,100,60000,"PGI_WORK_QUEUE_POLL_MS"),
    requireCarrierContract:booleanValue(env.PGI_REQUIRE_CARRIER_CONTRACT,mode==="production","PGI_REQUIRE_CARRIER_CONTRACT"),
    serviceRateTtcPerMin:number(env.PGI_SERVICE_RATE_TTC_PER_MIN,0.80,0,100,"PGI_SERVICE_RATE_TTC_PER_MIN"),
    payoutRateHtPerMin:number(env.PGI_PAYOUT_RATE_HT_PER_MIN,mode==="production"?0:0.46,0,100,"PGI_PAYOUT_RATE_HT_PER_MIN"),
    expertCostHtPerMin:number(env.PGI_EXPERT_COST_HT_PER_MIN,0.18,0,100,"PGI_EXPERT_COST_HT_PER_MIN"),
    technicalCostHtPerCall:number(env.PGI_TECHNICAL_COST_HT_PER_CALL,0,0,100,"PGI_TECHNICAL_COST_HT_PER_CALL"),
    reconciliationToleranceHt:number(env.PGI_RECONCILIATION_TOLERANCE_HT,0.01,0,100,"PGI_RECONCILIATION_TOLERANCE_HT"),
    version:env.PGI_VERSION||"1.30.3"
  });
}

function integer(value,fallback,min,max,name){
  const n=value==null||value===""?fallback:Number(value);
  if(!Number.isInteger(n)||n<min||n>max)throw new Error(name+" invalid");
  return n;
}
function enumValue(value,allowed,name){
  const normalized=String(value||"").trim().toLowerCase();
  if(!allowed.includes(normalized))throw new Error(name+" invalid");
  return normalized;
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

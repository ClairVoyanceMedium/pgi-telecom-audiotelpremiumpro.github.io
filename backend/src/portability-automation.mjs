import {decryptPortabilityCredential} from "./portability-identity.mjs";

const FINAL_STATUSES=new Set(["ported","rejected"]);
const ACTIVE_CONNECTION_STATES=new Set(["ready","active"]);

export function createPortabilityQueueHandlers({store,config,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!store?.sql||typeof fetchImpl!=="function")return {};
  return {
    portability:(item,ctx)=>processPortabilityWork(item,{...ctx,store,config,env,fetchImpl})
  };
}

export async function processPortabilityWork(item,{store,config,env=process.env,fetchImpl=globalThis.fetch}){
  const requestId=Number(item?.payload?.request_id);
  if(!Number.isInteger(requestId)||requestId<=0)throw codedError("PORTABILITY_WORK_INVALID_REQUEST");
  const requestedAction=String(item?.payload?.action||"").trim().toLowerCase();

  if(requestedAction==="cancel")return processCancellation(requestId,{store,config,env,fetchImpl});

  const task=await loadTask(store,requestId,config);
  if(!task)return;
  if(FINAL_STATUSES.has(task.status)||task.automation_state==="completed")return;

  if(task.status==="cancelled"){
    await markAutomation(store,requestId,{state:"cancelled",nextSeconds:86400,error:null});
    return;
  }

  const readiness=validateAutomationReadiness(task,config);
  if(!readiness.ok){
    await markAutomation(store,requestId,{state:"action_required",nextSeconds:readiness.retrySeconds,error:readiness.code});
    return;
  }

  const action=chooseAction(task);
  if(action==="complete"){
    await markAutomation(store,requestId,{state:"completing",nextSeconds:300,error:null});
    await store.completePortabilityRequest(requestId,{operator_portability_reference:task.operator_portability_reference},{});
    await markAutomation(store,requestId,{state:"completed",nextSeconds:86400,error:null,operatorStatus:"completed"});
    return;
  }

  const request=buildOperatorRequest(task,action);
  const endpoint=resolveEndpoint(task,action);
  if(!endpoint){
    await markAutomation(store,requestId,{state:"action_required",nextSeconds:900,error:"PORTABILITY_OPERATOR_ENDPOINT_MISSING_"+action.toUpperCase()});
    return;
  }

  const state=action==="eligibility"?"checking":action==="submit"?"submitting":task.status==="scheduled"?"scheduled":"operator_pending";
  await markAutomation(store,requestId,{state,nextSeconds:300,error:null,incrementAttempts:true});

  let response;
  try{
    response=await callOperator({task,action,request,endpoint,env,fetchImpl});
  }catch(error){
    if(error?.actionRequired){
      await markAutomation(store,requestId,{state:"action_required",nextSeconds:900,error:error.code||error.message});
      return;
    }
    await markAutomation(store,requestId,{state:"failed",nextSeconds:300,error:error?.code||error?.message||"PORTABILITY_OPERATOR_CALL_FAILED"});
    throw error;
  }

  await recordOperatorEvent(store,task,action,response);
  if(action==="eligibility")return applyEligibility(store,task,response.body);
  if(action==="submit")return applySubmission(store,task,response.body);
  return applyStatus(store,task,response.body);
}

async function loadTask(store,requestId,config){
  const rows=await store.sql.unsafe(
    "SELECT p.*,t.status AS tenant_status,m.id AS market_id,m.status AS market_status,"+
    " r.active_carrier_id,c.name AS carrier_name,"+
    " api.id AS api_connection_id,api.state AS api_connection_state,api.auth_mode AS api_auth_mode,"+
    " api.secret_ref AS api_secret_ref,api.settings AS api_settings,"+
    " ca.adapter_key,ca.adapter_version,ca.capabilities AS adapter_capabilities,"+
    " EXISTS(SELECT 1 FROM carrier_contracts ct WHERE ct.carrier_id=r.active_carrier_id AND ct.sva_number_id IS NULL"+
    "   AND ct.valid_from<=COALESCE(p.desired_port_date,now()::date)"+
    "   AND (ct.valid_to IS NULL OR ct.valid_to>=COALESCE(p.desired_port_date,now()::date))) AS carrier_contract_ready,"+
    " EXISTS(SELECT 1 FROM tenant_kyc_profiles k WHERE k.tenant_id=p.tenant_id AND k.status='verified') AS kyc_ready,"+
    " CASE WHEN m.id IS NULL THEN false ELSE pgi_tenant_has_premium_call_access(p.tenant_id,m.id,now()) END AS access_ready,"+
    " CASE WHEN m.id IS NULL THEN false ELSE pgi_tenant_has_payout_terms(p.tenant_id,m.id,NULL,now()) END AS payout_ready"+
    " FROM tenant_portability_requests p"+
    " JOIN tenants t ON t.id=p.tenant_id"+
    " LEFT JOIN operating_markets m ON m.country_code=p.country_code"+
    " LEFT JOIN logical_carrier_routes r ON r.route_key='sva-primary'"+
    " LEFT JOIN carriers c ON c.id=r.active_carrier_id AND c.kind='sva_host' AND c.enabled"+
    " LEFT JOIN LATERAL ("+
    "   SELECT cc.id,cc.state,cc.auth_mode,cc.secret_ref,cc.settings"+
    "   FROM carrier_connections cc"+
    "   WHERE cc.carrier_id=r.active_carrier_id AND cc.purpose='api' AND cc.state IN ('ready','active')"+
    "   ORDER BY (cc.state='active') DESC,cc.id ASC LIMIT 1"+
    " ) api ON true"+
    " LEFT JOIN LATERAL ("+
    "   SELECT a.adapter_key,a.adapter_version,a.capabilities"+
    "   FROM carrier_adapters a"+
    "   WHERE a.carrier_id=r.active_carrier_id AND a.enabled"+
    "   ORDER BY a.id DESC LIMIT 1"+
    " ) ca ON true"+
    " WHERE p.id=$1 LIMIT 1",
    [requestId]
  );
  const task=rows[0]||null;
  if(!task)return null;

  let rio=null;
  if(task.country_code==="FR"&&task.rio_ciphertext){
    const secret=String(config?.portabilitySecretKey||config?.callerHashKey||config?.sessionSecret||"");
    rio=decryptPortabilityCredential(task.rio_ciphertext,secret);
  }
  return {...task,rio};
}

function validateAutomationReadiness(task,config){
  if(task.tenant_status==="closed")return fail("PORTABILITY_TENANT_CLOSED",3600);
  if(!task.market_id||task.market_status!=="active")return fail("PORTABILITY_MARKET_NOT_ACTIVE",3600);
  if(!task.active_carrier_id)return fail("PORTABILITY_OPERATOR_NOT_SELECTED",900);
  if(!task.api_connection_id||!ACTIVE_CONNECTION_STATES.has(String(task.api_connection_state||"")))return fail("PORTABILITY_OPERATOR_API_NOT_READY",900);
  if(!task.adapter_key)return fail("PORTABILITY_OPERATOR_ADAPTER_NOT_READY",900);
  if(config?.requireCarrierContract&&!task.carrier_contract_ready)return fail("PORTABILITY_CARRIER_CONTRACT_REQUIRED",1800);
  if(task.country_code==="FR"&&task.rio_validation_status!=="verified")return fail("PORTABILITY_RIO_VERIFICATION_REQUIRED",3600);
  if(task.source_contract_liability_acknowledged!==true)return fail("PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED",3600);
  if(!task.authorization_confirmed||!task.number_owner_confirmed)return fail("PORTABILITY_AUTHORIZATION_REQUIRED",3600);
  if(!task.kyc_ready)return fail("PORTABILITY_KYC_REQUIRED",1800);
  if(!task.access_ready)return fail("SVA_SUBSCRIPTION_REQUIRED",1800);
  if(!task.payout_ready)return fail("PORTABILITY_PAYOUT_TERMS_REQUIRED",1800);
  return {ok:true};
}

function chooseAction(task){
  const operatorStatus=String(task.operator_status||"").toLowerCase();
  if(task.status==="scheduled"&&["completed","ported","activated"].includes(operatorStatus))return "complete";
  if(task.status==="scheduled"||task.status==="operator_pending")return "status";
  if(task.ownership_status!=="verified"||task.tariff_verification_status!=="verified")return "eligibility";
  if(!task.operator_portability_reference)return "submit";
  return "status";
}

function buildOperatorRequest(task,action){
  const payload={
    pgi_request_id:Number(task.id),
    action,
    number:task.requested_e164,
    country_code:task.country_code,
    service_family:task.service_family,
    rio:task.country_code==="FR"?task.rio:null,
    current_operator_name:task.current_operator_name||null,
    current_operator_reference:task.current_operator_reference||null,
    account_holder_name:task.account_holder_name||null,
    desired_port_date:task.desired_port_date||null,
    tariff_code:task.tariff_code||null,
    service_rate_ttc_per_min:task.service_rate_ttc_per_min==null?null:Number(task.service_rate_ttc_per_min),
    currency:task.currency||null,
    operator_reference:task.operator_portability_reference||null,
    authorization_confirmed:true,
    number_owner_confirmed:true
  };
  return payload;
}

function resolveEndpoint(task,action){
  const settings=objectValue(task.api_settings);
  const keys={
    eligibility:["portability_eligibility_url","portability_check_url"],
    submit:["portability_submit_url"],
    status:["portability_status_url","portability_status_url_template"],
    cancel:["portability_cancel_url","portability_cancel_url_template"]
  }[action]||[];
  let url="";
  for(const key of keys){if(settings[key]){url=String(settings[key]);break;}}
  if(!url)return null;
  const ref=encodeURIComponent(String(task.operator_portability_reference||""));
  const number=encodeURIComponent(String(task.requested_e164||""));
  return url.replaceAll("{reference}",ref).replaceAll("{number}",number);
}

async function callOperator({task,action,request,endpoint,env,fetchImpl}){
  const settings=objectValue(task.api_settings);
  const secretRef=String(task.api_secret_ref||"").trim();
  const secret=secretRef?String(env?.[secretRef]||""):"";
  const authMode=String(task.api_auth_mode||"none").toLowerCase();
  const headers={"Accept":"application/json","Content-Type":"application/json","User-Agent":"PGI-Telecom-Portability/1"};
  if(authMode==="bearer"){
    if(!secret)throw codedError("PORTABILITY_OPERATOR_SECRET_MISSING",true);
    headers.Authorization="Bearer "+secret;
  }else if(authMode==="basic"){
    if(!secret||!secret.includes(":"))throw codedError("PORTABILITY_OPERATOR_SECRET_MISSING",true);
    headers.Authorization="Basic "+Buffer.from(secret).toString("base64");
  }else if(authMode==="header"){
    if(!secret)throw codedError("PORTABILITY_OPERATOR_SECRET_MISSING",true);
    headers[String(settings.auth_header_name||"X-API-Key")]=secret;
  }
  const timeoutMs=clamp(Number(settings.portability_timeout_ms)||10000,2000,30000);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  timer.unref?.();
  try{
    const method=action==="status"?"GET":"POST";
    const response=await fetchImpl(endpoint,{
      method,headers,signal:controller.signal,
      body:method==="GET"?undefined:JSON.stringify(request)
    });
    const contentType=String(response.headers?.get?.("content-type")||"").toLowerCase();
    let body={};
    if(contentType.includes("application/json"))body=await response.json();
    else{
      const raw=String(await response.text()).slice(0,4000);
      body=raw?{message:raw}:{};
    }
    if(!response.ok){
      const error=codedError("PORTABILITY_OPERATOR_HTTP_"+response.status);
      error.status=response.status;
      throw error;
    }
    return {status:Number(response.status)||200,body:objectValue(body)};
  }catch(error){
    if(error?.name==="AbortError")throw codedError("PORTABILITY_OPERATOR_TIMEOUT");
    throw error;
  }finally{clearTimeout(timer);}
}

async function applyEligibility(store,task,body){
  const state=normalizeOperatorState(body);
  if(state==="rejected"){
    await rejectRequest(store,task,body);
    return;
  }
  if(body.documents_required===true||state==="action_required"){
    await markAutomation(store,task.id,{state:"action_required",nextSeconds:1800,error:safeReason(body)||"PORTABILITY_OPERATOR_DOCUMENTS_REQUIRED",operatorStatus:state});
    return;
  }
  const ownershipVerified=body.ownership_verified===true||["scheduled","completed","ported","activated"].includes(state);
  const tariffCode=textValue(body.tariff_code)||task.tariff_code||null;
  const rate=finiteNumber(body.service_rate_ttc_per_min);
  const effectiveRate=rate==null?(task.service_rate_ttc_per_min==null?null:Number(task.service_rate_ttc_per_min)):rate;
  const tariffVerified=body.tariff_verified===true&&Boolean(tariffCode)&&effectiveRate!=null;

  await store.sql.unsafe(
    "UPDATE tenant_portability_requests SET status='eligibility_check',"+
    " ownership_status=CASE WHEN $2 THEN 'verified' ELSE ownership_status END,"+
    " tariff_code=COALESCE($3,tariff_code),service_rate_ttc_per_min=COALESCE($4,service_rate_ttc_per_min),"+
    " currency=COALESCE($5,currency),"+
    " tariff_verification_status=CASE WHEN $6 THEN 'verified' ELSE tariff_verification_status END,"+
    " tariff_verified_at=CASE WHEN $6 THEN COALESCE(tariff_verified_at,now()) ELSE tariff_verified_at END,"+
    " operator_status=$7,automation_state='queued',automation_last_error=NULL,automation_last_sync_at=now(),automation_next_at=now(),updated_at=now()"+
    " WHERE id=$1",
    [Number(task.id),ownershipVerified,tariffCode,effectiveRate,textValue(body.currency),tariffVerified,state||"eligibility_checked"]
  );
  await auditAutomation(store,task,"portability.automation.eligibility",{ownership_verified:ownershipVerified,tariff_verified:tariffVerified,operator_status:state||null});
}

async function applySubmission(store,task,body){
  const state=normalizeOperatorState(body);
  if(state==="rejected")return rejectRequest(store,task,body);
  if(body.documents_required===true||state==="action_required"){
    await markAutomation(store,task.id,{state:"action_required",nextSeconds:1800,error:safeReason(body)||"PORTABILITY_OPERATOR_ACTION_REQUIRED",operatorStatus:state});
    return;
  }
  const operatorRef=textValue(body.portability_reference)||textValue(body.operator_reference)||textValue(body.id);
  if(!operatorRef){
    await markAutomation(store,task.id,{state:"action_required",nextSeconds:900,error:"PORTABILITY_OPERATOR_REFERENCE_MISSING",operatorStatus:state});
    return;
  }
  const scheduledAt=parseDateTime(body.scheduled_at||body.port_date||body.activation_at);
  const canSchedule=Boolean(scheduledAt)&&task.ownership_status==="verified"&&task.tariff_verification_status==="verified";
  const nextStatus=canSchedule?"scheduled":"operator_pending";
  await store.sql.unsafe(
    "UPDATE tenant_portability_requests SET status=$2,operator_portability_reference=$3,target_carrier_id=$4,target_api_connection_id=$5,"+
    " scheduled_at=CASE WHEN $2='scheduled' THEN $6::timestamptz ELSE scheduled_at END,"+
    " operator_status=$7,automation_state=CASE WHEN $2='scheduled' THEN 'scheduled' ELSE 'operator_pending' END,"+
    " automation_last_error=NULL,automation_last_sync_at=now(),automation_next_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1",
    [Number(task.id),nextStatus,operatorRef,Number(task.active_carrier_id),Number(task.api_connection_id),scheduledAt,state||"submitted"]
  );
  await auditAutomation(store,task,"portability.automation.submitted",{operator_reference:operatorRef,operator_status:state||null,scheduled_at:scheduledAt});
  if(["completed","ported","activated"].includes(state)&&canSchedule){
    await store.completePortabilityRequest(task.id,{operator_portability_reference:operatorRef},{});
    await markAutomation(store,task.id,{state:"completed",nextSeconds:86400,error:null,operatorStatus:"completed"});
  }
}

async function applyStatus(store,task,body){
  const state=normalizeOperatorState(body);
  if(state==="rejected")return rejectRequest(store,task,body);
  if(body.documents_required===true||state==="action_required"){
    await markAutomation(store,task.id,{state:"action_required",nextSeconds:1800,error:safeReason(body)||"PORTABILITY_OPERATOR_ACTION_REQUIRED",operatorStatus:state});
    return;
  }
  const operatorRef=textValue(body.portability_reference)||textValue(body.operator_reference)||task.operator_portability_reference;
  const scheduledAt=parseDateTime(body.scheduled_at||body.port_date||body.activation_at)||task.scheduled_at||null;
  const completed=["completed","ported","activated"].includes(state);
  const canSchedule=Boolean(operatorRef&&scheduledAt&&task.ownership_status==="verified"&&task.tariff_verification_status==="verified");
  const nextStatus=canSchedule?"scheduled":task.status==="operator_pending"?"operator_pending":"eligibility_check";

  await store.sql.unsafe(
    "UPDATE tenant_portability_requests SET status=$2,operator_portability_reference=COALESCE($3,operator_portability_reference),"+
    " scheduled_at=CASE WHEN $2='scheduled' THEN COALESCE($4::timestamptz,scheduled_at) ELSE scheduled_at END,"+
    " operator_status=$5,automation_state=CASE WHEN $2='scheduled' THEN 'scheduled' ELSE 'operator_pending' END,"+
    " automation_last_error=NULL,automation_last_sync_at=now(),automation_next_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1",
    [Number(task.id),nextStatus,operatorRef,scheduledAt,state||"pending"]
  );
  await auditAutomation(store,task,"portability.automation.status",{operator_reference:operatorRef||null,operator_status:state||null,scheduled_at:scheduledAt});
  if(completed&&canSchedule){
    await store.completePortabilityRequest(task.id,{operator_portability_reference:operatorRef},{});
    await markAutomation(store,task.id,{state:"completed",nextSeconds:86400,error:null,operatorStatus:"completed"});
  }
}

async function processCancellation(requestId,{store,config,env,fetchImpl}){
  const task=await loadTask(store,requestId,config);
  if(!task||task.status!=="cancelled"||!task.operator_portability_reference){
    if(task)await markAutomation(store,requestId,{state:"cancelled",nextSeconds:86400,error:null});
    return;
  }
  const readiness=validateOperatorConnectivity(task,config);
  if(!readiness.ok){
    await markAutomation(store,requestId,{state:"action_required",nextSeconds:900,error:readiness.code});
    return;
  }
  const endpoint=resolveEndpoint(task,"cancel");
  if(!endpoint){
    await markAutomation(store,requestId,{state:"action_required",nextSeconds:900,error:"PORTABILITY_OPERATOR_ENDPOINT_MISSING_CANCEL"});
    return;
  }
  await markAutomation(store,requestId,{state:"cancelling",nextSeconds:300,error:null,incrementAttempts:true});
  const response=await callOperator({task,action:"cancel",request:buildOperatorRequest(task,"cancel"),endpoint,env,fetchImpl});
  await recordOperatorEvent(store,task,"cancel",response);
  await markAutomation(store,requestId,{state:"cancelled",nextSeconds:86400,error:null,operatorStatus:normalizeOperatorState(response.body)||"cancelled"});
  await auditAutomation(store,task,"portability.automation.cancelled",{operator_reference:task.operator_portability_reference});
}

function validateOperatorConnectivity(task,config){
  if(!task.active_carrier_id)return fail("PORTABILITY_OPERATOR_NOT_SELECTED",900);
  if(!task.api_connection_id||!ACTIVE_CONNECTION_STATES.has(String(task.api_connection_state||"")))return fail("PORTABILITY_OPERATOR_API_NOT_READY",900);
  if(!task.adapter_key)return fail("PORTABILITY_OPERATOR_ADAPTER_NOT_READY",900);
  if(config?.requireCarrierContract&&!task.carrier_contract_ready)return fail("PORTABILITY_CARRIER_CONTRACT_REQUIRED",1800);
  return {ok:true};
}

async function rejectRequest(store,task,body){
  const reason=safeReason(body)||"Refus opérateur";
  await store.sql.unsafe(
    "UPDATE tenant_portability_requests SET status='rejected',rejection_reason=$2,operator_status='rejected',"+
    " automation_state='action_required',automation_last_error=$2,automation_last_sync_at=now(),automation_next_at=now()+interval '1 day',updated_at=now() WHERE id=$1",
    [Number(task.id),reason]
  );
  await auditAutomation(store,task,"portability.automation.rejected",{reason});
}

async function markAutomation(store,requestId,{state,nextSeconds=300,error=null,operatorStatus=null,incrementAttempts=false}){
  await store.sql.unsafe(
    "UPDATE tenant_portability_requests SET automation_state=$2,automation_next_at=now()+make_interval(secs=>$3),"+
    " automation_last_error=$4,automation_last_sync_at=now(),operator_status=COALESCE($5,operator_status),"+
    " automation_attempts=automation_attempts+CASE WHEN $6 THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1",
    [Number(requestId),state,Math.max(30,Math.min(86400,Number(nextSeconds)||300)),error?String(error).slice(0,500):null,operatorStatus,incrementAttempts]
  );
}

async function recordOperatorEvent(store,task,action,response){
  const sanitized=sanitizePayload(response?.body);
  const providerEventId=textValue(response?.body?.event_id)||textValue(response?.body?.provider_event_id);
  const operatorRef=textValue(response?.body?.portability_reference)||textValue(response?.body?.operator_reference)||task.operator_portability_reference||null;
  await store.sql.unsafe(
    "INSERT INTO portability_operator_events(portability_request_id,tenant_id,carrier_id,carrier_connection_id,direction,event_type,provider_event_id,operator_reference,http_status,sanitized_payload)"+
    " VALUES($1,$2,$3,$4,'inbound',$5,$6,$7,$8,$9::jsonb)"+
    " ON CONFLICT(carrier_id,provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING",
    [Number(task.id),Number(task.tenant_id),Number(task.active_carrier_id)||null,Number(task.api_connection_id)||null,"portability."+action,providerEventId,operatorRef,response?.status||null,JSON.stringify(sanitized)]
  );
}

async function auditAutomation(store,task,action,details){
  await store.sql.unsafe(
    "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,$2,'tenant_portability_request',$3,$4::jsonb)",
    [Number(task.tenant_id),action,String(task.id),JSON.stringify(details||{})]
  );
  store.eventBus?.publish?.("portability.automation",{tenant_id:Number(task.tenant_id),request_id:Number(task.id),action});
}

function normalizeOperatorState(body){
  return String(body?.status||body?.portability_status||body?.state||"").trim().toLowerCase().replace(/[- ]+/g,"_");
}
function safeReason(body){
  return textValue(body?.reason)||textValue(body?.message)||textValue(body?.error);
}
function sanitizePayload(value,depth=0){
  if(depth>5)return "[truncated]";
  if(Array.isArray(value))return value.slice(0,50).map(v=>sanitizePayload(v,depth+1));
  if(!value||typeof value!=="object")return typeof value==="string"?value.slice(0,2000):value;
  const out={};
  for(const [key,val] of Object.entries(value).slice(0,100)){
    if(/rio|secret|token|password|authorization|credential|api[_-]?key/i.test(key)){out[key]="[redacted]";continue;}
    out[key]=sanitizePayload(val,depth+1);
  }
  return out;
}
function objectValue(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function textValue(v){const s=String(v??"").trim();return s?s.slice(0,500):null;}
function finiteNumber(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=10000?n:null;}
function parseDateTime(v){if(!v)return null;const ms=Date.parse(v);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function fail(code,retrySeconds){return {ok:false,code,retrySeconds};}
function codedError(code,actionRequired=false){const e=new Error(code);e.code=code;e.actionRequired=actionRequired;return e;}

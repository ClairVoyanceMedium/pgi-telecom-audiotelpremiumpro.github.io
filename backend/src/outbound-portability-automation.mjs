const ACTIVE_CONNECTION_STATES=new Set(["ready","active"]);
const OUTBOUND_ACTIONS=new Set(["request_outbound_rio","submit_port_out","request_port_out_report","request_port_out_cancel","request_port_out_return_back"]);

export function createOutboundPortabilityQueueHandlers({store,config,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!store?.sql||typeof fetchImpl!=="function")return {};
  return {portability_outbound:(item,ctx)=>processOutboundPortabilityWork(item,{...ctx,store,config,env,fetchImpl})};
}

export async function processOutboundPortabilityWork(item,{store,config,env=process.env,fetchImpl=globalThis.fetch}){
  const actionPublicId=String(item?.payload?.action_public_id||"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(actionPublicId))throw coded("OUTBOUND_PORTABILITY_WORK_INVALID_ACTION");

  const lines=await loadActionLines(store,actionPublicId);
  if(!lines.length)return;
  const actionType=String(lines[0].action_type||"");
  if(!OUTBOUND_ACTIONS.has(actionType))return;
  if(lines[0].action_status!=="queued")return;
  const actionPayload=obj(lines[0].payload);
  if(lines.length>1&&!Number(actionPayload.exit_line_id)){
    await markActionWaiting(store,lines[0],{code:"OUTBOUND_PORTABILITY_LINE_SCOPE_REQUIRED",line_count:lines.length});
    return;
  }

  const confirmations=[];
  for(const line of lines){
    const ready=readiness(line,config);
    if(!ready.ok){
      await markActionWaiting(store,line.action_id,{code:ready.code,line_id:line.exit_line_id});
      return;
    }
    const result=await callCarrierForLine(line,{config,env,fetchImpl});
    await persistSanitizedExchange(store,line,result);
    const normalized=normalizeResult(line,result.body);

    if(normalized.pending){
      if(normalized.provider_reference){
        await store.sql.unsafe(
          "UPDATE tenant_exit_lines SET operator_reference=COALESCE($2,operator_reference) WHERE id=$1",
          [line.exit_line_id,normalized.provider_reference]
        );
      }
      await markActionWaiting(store,line,{code:"PROVIDER_PENDING",line_id:line.exit_line_id,provider_reference:normalized.provider_reference||null,state:normalized.state||null});
      continue;
    }

    confirmations.push({line,normalized});
  }

  if(confirmations.length!==lines.length)return;

  for(const {line,normalized} of confirmations){
    const payload={
      outcome:normalized.outcome,
      provider_reference:normalized.provider_reference||null,
      scheduled_at:normalized.scheduled_at||null,
      delivery_channel:normalized.delivery_channel||undefined,
      delivery_reference:normalized.delivery_reference||undefined,
      rio_last4:normalized.rio_last4||undefined
    };
    await store.completeRelationExternalAction(line.action_public_id,payload,{});
  }
}

async function loadActionLines(store,publicId){
  return store.sql.unsafe(
    "SELECT a.id AS action_id,a.public_id::text AS action_public_id,a.action_type,a.status AS action_status,a.payload,"+
    " c.id AS case_id,c.public_id::text AS case_public_id,c.tenant_id,t.public_id::text AS tenant_public_id,"+
    " e.id AS exit_request_id,e.public_id::text AS exit_public_id,e.requested_effective_date,e.target_operator_name,e.status AS exit_status,"+
    " l.id AS exit_line_id,l.e164_snapshot,l.status AS line_status,l.operator_reference,l.rio_status,l.portability_eligibility_status,l.portability_service_level,l.recovery_option,"+
    " na.regulatory_assignor_carrier_id,cr.name AS carrier_name,"+
    " api.id AS api_connection_id,api.state AS api_connection_state,api.auth_mode AS api_auth_mode,api.secret_ref AS api_secret_ref,api.settings AS api_settings"+
    " FROM tenant_relation_actions a"+
    " JOIN tenant_relation_cases c ON c.id=a.case_id"+
    " JOIN tenants t ON t.id=c.tenant_id"+
    " JOIN tenant_exit_requests e ON e.case_id=c.id"+
    " JOIN tenant_exit_lines l ON l.exit_request_id=e.id"+
    " JOIN tenant_number_assignments na ON na.id=l.assignment_id AND na.tenant_id=c.tenant_id"+
    " LEFT JOIN carriers cr ON cr.id=na.regulatory_assignor_carrier_id AND cr.enabled"+
    " LEFT JOIN LATERAL ("+
    "   SELECT cc.id,cc.state,cc.auth_mode,cc.secret_ref,cc.settings FROM carrier_connections cc"+
    "   WHERE cc.carrier_id=na.regulatory_assignor_carrier_id AND cc.purpose='api' AND cc.state IN ('ready','active')"+
    "   ORDER BY (cc.state='active') DESC,cc.id ASC LIMIT 1"+
    " ) api ON true"+
    " WHERE a.public_id=$1::uuid AND a.execution_mode='external_confirmation' AND a.status='queued'"+
    " AND l.requested_action='port_out'"+
    " AND ((a.payload->>'exit_line_id') IS NULL OR l.id=(a.payload->>'exit_line_id')::bigint)"+
    " ORDER BY l.id",
    [publicId]
  );
}

function readiness(line,config){
  if(line.portability_eligibility_status!=="eligible")return fail("OUTBOUND_PORTABILITY_ELIGIBILITY_REQUIRED");
  if(!line.regulatory_assignor_carrier_id)return fail("OUTBOUND_PORTABILITY_ASSIGNOR_CARRIER_REQUIRED");
  if(!line.api_connection_id||!ACTIVE_CONNECTION_STATES.has(String(line.api_connection_state||"")))return fail("OUTBOUND_PORTABILITY_OPERATOR_API_NOT_READY");
  if(line.action_type==="submit_port_out"&&!["available","delivered","not_required"].includes(String(line.rio_status||"")))return fail("OUTBOUND_PORTABILITY_RIO_REQUIRED");
  const settings=obj(line.api_settings);
  const endpoint=resolveEndpoint(line,settings);
  if(!endpoint)return fail("OUTBOUND_PORTABILITY_OPERATOR_ENDPOINT_MISSING");
  try{
    const u=new URL(endpoint);
    if(config?.mode==="production"&&u.protocol!=="https:")return fail("OUTBOUND_PORTABILITY_OPERATOR_HTTPS_REQUIRED");
  }catch{return fail("OUTBOUND_PORTABILITY_OPERATOR_ENDPOINT_INVALID");}
  return {ok:true};
}

async function callCarrierForLine(line,{config,env,fetchImpl}){
  const settings=obj(line.api_settings);
  const endpoint=resolveEndpoint(line,settings);
  const url=new URL(endpoint);
  const secretRef=String(line.api_secret_ref||"").trim();
  const secret=secretRef?String(env?.[secretRef]||""):"";
  const authMode=String(line.api_auth_mode||"none").toLowerCase();
  const headers={"Accept":"application/json","Content-Type":"application/json","User-Agent":"AudiotelPremiumPro-PortOut/1","Idempotency-Key":line.action_public_id+":"+line.exit_line_id};
  if(authMode==="bearer"){
    if(!secret)throw coded("OUTBOUND_PORTABILITY_OPERATOR_SECRET_MISSING");
    headers.Authorization="Bearer "+secret;
  }else if(authMode==="basic"){
    if(!secret||!secret.includes(":"))throw coded("OUTBOUND_PORTABILITY_OPERATOR_SECRET_MISSING");
    headers.Authorization="Basic "+Buffer.from(secret).toString("base64");
  }else if(authMode==="header"){
    if(!secret)throw coded("OUTBOUND_PORTABILITY_OPERATOR_SECRET_MISSING");
    headers[String(settings.auth_header_name||"X-API-Key")]=secret;
  }
  const statusMode=Boolean(line.operator_reference&&statusEndpoint(line,settings));
  const finalUrl=statusMode?new URL(statusEndpoint(line,settings)):url;
  const timeoutMs=clamp(Number(settings.portability_timeout_ms)||10000,2000,30000);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  const body=buildRequest(line);
  try{
    const response=await fetchImpl(finalUrl,{
      method:statusMode?"GET":"POST",headers,signal:controller.signal,
      body:statusMode?undefined:JSON.stringify(body)
    });
    const type=String(response.headers?.get?.("content-type")||"").toLowerCase();
    const responseBody=type.includes("application/json")?obj(await response.json()):{message:String(await response.text()).slice(0,2000)};
    if(!response.ok)throw coded("OUTBOUND_PORTABILITY_OPERATOR_HTTP_"+response.status);
    return {http_status:Number(response.status)||200,body:responseBody,sanitized:sanitize(responseBody)};
  }catch(error){
    if(error?.name==="AbortError")throw coded("OUTBOUND_PORTABILITY_OPERATOR_TIMEOUT");
    throw error;
  }finally{clearTimeout(timer);}
}

function buildRequest(line){
  const base={
    pgi_action_id:line.action_public_id,
    pgi_case_id:line.case_public_id,
    pgi_exit_id:line.exit_public_id,
    pgi_line_id:Number(line.exit_line_id),
    number:line.e164_snapshot,
    requested_effective_date:line.requested_effective_date||null,
    target_operator_name:line.target_operator_name||null,
    service_level:line.portability_service_level||"standard"
  };
  if(line.action_type==="request_outbound_rio")return {...base,action:"request_rio",delivery_mode:"provider_direct",delivery_target:"registered_customer_contact"};
  if(line.action_type==="submit_port_out")return {...base,action:"submit_port_out",rio_status:line.rio_status};
  if(line.action_type==="request_port_out_report")return {...base,action:"report_port_out",operator_reference:line.operator_reference||null};
  if(line.action_type==="request_port_out_cancel")return {...base,action:"cancel_port_out",operator_reference:line.operator_reference||null};
  if(line.action_type==="request_port_out_return_back")return {...base,action:"return_back",operator_reference:line.operator_reference||null};
  return base;
}

function resolveEndpoint(line,settings){
  const k={
    request_outbound_rio:["portability_outbound_rio_request_url","outbound_rio_request_url"],
    submit_port_out:["portability_outbound_submit_url","outbound_portability_submit_url"],
    request_port_out_report:["portability_outbound_report_url","outbound_portability_report_url"],
    request_port_out_cancel:["portability_outbound_cancel_url","outbound_portability_cancel_url"],
    request_port_out_return_back:["portability_outbound_return_back_url","outbound_portability_return_back_url"]
  }[line.action_type]||[];
  let value="";
  for(const key of k){if(settings[key]){value=String(settings[key]);break;}}
  return replaceTemplate(value,line);
}

function statusEndpoint(line,settings){
  const keys=line.action_type==="request_outbound_rio"
    ?["portability_outbound_rio_status_url","outbound_rio_status_url"]
    :["portability_outbound_status_url","outbound_portability_status_url"];
  let value="";
  for(const key of keys){if(settings[key]){value=String(settings[key]);break;}}
  return replaceTemplate(value,line);
}

function replaceTemplate(value,line){
  return String(value||"")
    .replaceAll("{number}",encodeURIComponent(String(line.e164_snapshot||"")))
    .replaceAll("{reference}",encodeURIComponent(String(line.operator_reference||"")))
    .replaceAll("{line_id}",encodeURIComponent(String(line.exit_line_id||"")));
}

function normalizeResult(line,body){
  const state=String(body.state||body.status||body.portability_status||body.rio_status||"").trim().toLowerCase();
  const providerReference=text(body.provider_reference)||text(body.operator_reference)||text(body.portability_reference)||text(body.id)||line.operator_reference||null;
  const scheduledAt=text(body.scheduled_at)||text(body.port_date)||text(body.activation_at)||null;

  if(line.action_type==="request_outbound_rio"){
    const delivered=state==="delivered"||String(body.delivery_status||"").toLowerCase()==="delivered";
    const available=state==="available";
    const rejected=["rejected","failed","error"].includes(state);
    const rawRio=text(body.rio);
    if(rawRio&&!delivered&&!available)throw coded("OUTBOUND_PORTABILITY_RIO_DIRECT_DELIVERY_REQUIRED");
    const last4=text(body.rio_last4)||(rawRio?rawRio.slice(-4):null);
    if(rejected)return {pending:false,outcome:"failed",state,provider_reference:providerReference,rio_last4:last4};
    if(delivered||available)return {pending:false,outcome:delivered?"delivered":"available",state,provider_reference:providerReference,rio_last4:last4,delivery_channel:text(body.delivery_channel)||"provider_direct",delivery_reference:text(body.delivery_reference)||providerReference};
    return {pending:true,state:state||"pending",provider_reference:providerReference};
  }

  if(["rejected","failed","error"].includes(state))return {pending:false,outcome:"failed",state,provider_reference:providerReference};
  if(["completed","ported","activated","success"].includes(state))return {pending:false,outcome:"completed",state,provider_reference:providerReference,scheduled_at:scheduledAt};
  if(state==="scheduled")return {pending:false,outcome:"scheduled",state,provider_reference:providerReference,scheduled_at:scheduledAt};
  if(["accepted","pending","processing","requested","queued",""].includes(state))return {pending:true,state:state||"pending",provider_reference:providerReference};
  return {pending:true,state,provider_reference:providerReference};
}

async function persistSanitizedExchange(store,line,result){
  await store.sql.unsafe(
    "UPDATE tenant_relation_actions SET result=result||$2::jsonb WHERE id=$1",
    [line.action_id,JSON.stringify({last_operator_http_status:result.http_status,last_operator_payload:result.sanitized,last_operator_sync_at:new Date().toISOString()})]
  );
}

async function markActionWaiting(store,line,details){
  await store.sql.unsafe(
    "UPDATE tenant_relation_actions SET result=result||$2::jsonb WHERE id=$1 AND status='queued'",
    [line.action_id,JSON.stringify({provider_confirmation_required:true,...sanitize(details),last_checked_at:new Date().toISOString()})]
  );
}

function sanitize(value,depth=0){
  if(depth>4)return null;
  if(value==null||typeof value==="boolean"||typeof value==="number")return value;
  if(typeof value==="string")return value.slice(0,1000);
  if(Array.isArray(value))return value.slice(0,50).map(v=>sanitize(v,depth+1));
  if(typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value).slice(0,80)){
      if(/(?:^|_)(?:rio|password|secret|token|authorization|cookie|card|pan|cvv|cvc)(?:$|_)/i.test(k))continue;
      out[k]=sanitize(v,depth+1);
    }
    return out;
  }
  return null;
}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function text(v){const s=String(v??"").trim();return s?s.slice(0,255):null;}
function fail(code){return {ok:false,code};}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function coded(code){const e=new Error(code);e.code=code;return e;}

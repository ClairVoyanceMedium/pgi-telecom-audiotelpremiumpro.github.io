import {randomBytes} from "node:crypto";

export const PORTABILITY_PRIORITY_PRICE_MINOR=990;
export const PORTABILITY_PRIORITY_CURRENCY="EUR";
export const PORTABILITY_PRIORITY_WORK_QUEUE_PRIORITY=15;

function failure(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;e.expose=status<500;return e;
}
function hasSql(store){return Boolean(store?.sql&&typeof store.sql.unsafe==="function");}
function actorLabel(actor){return String(actor?.sub||actor?.username||actor?.id||"system").slice(0,200);}
function validReferralCode(value){
  const code=String(value||"").trim().toUpperCase();
  return /^APP-[A-F0-9]{12}$/.test(code)?code:null;
}
async function settings(store,tx=null){
  if(!hasSql(store))return {enabled:false,benefit_label:"Avantage sur l’abonnement après activation effective du filleul"};
  const sql=tx||store.sql;
  const rows=await sql.unsafe("SELECT referral_enabled,referral_benefit_label,updated_at FROM platform_growth_settings WHERE settings_key='referral' LIMIT 1");
  const row=rows[0]||{};
  return {enabled:row.referral_enabled===true,benefit_label:String(row.referral_benefit_label||"Avantage sur l’abonnement après activation effective du filleul"),updated_at:row.updated_at||null};
}
export async function referralProgramState(store){
  return settings(store);
}
export async function setReferralProgramState(store,input={},actor={}){
  if(!hasSql(store))throw failure(503,"REFERRAL_STORE_UNAVAILABLE");
  if(typeof input.enabled!=="boolean")throw failure(400,"INVALID_REFERRAL_STATE");
  const rows=await store.sql.unsafe(
    "UPDATE platform_growth_settings SET referral_enabled=$1,updated_by=$2,updated_at=now() WHERE settings_key='referral' RETURNING referral_enabled,referral_benefit_label,updated_at",
    [input.enabled,actorLabel(actor)]
  );
  const row=rows[0];if(!row)throw failure(500,"REFERRAL_SETTINGS_MISSING");
  return {enabled:row.referral_enabled===true,benefit_label:row.referral_benefit_label,updated_at:row.updated_at};
}
async function ensureReferralCode(store,tenantId){
  for(let attempt=0;attempt<5;attempt++){
    const existing=(await store.sql.unsafe("SELECT code FROM tenant_referral_codes WHERE tenant_id=$1 LIMIT 1",[Number(tenantId)]))[0];
    if(existing?.code)return String(existing.code);
    const code="APP-"+randomBytes(6).toString("hex").toUpperCase();
    try{
      const rows=await store.sql.unsafe(
        "INSERT INTO tenant_referral_codes(tenant_id,code) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET code=tenant_referral_codes.code RETURNING code",
        [Number(tenantId),code]
      );
      if(rows[0]?.code)return String(rows[0].code);
    }catch(error){if(String(error?.code||"")!=="23505")throw error;}
  }
  throw failure(503,"REFERRAL_CODE_UNAVAILABLE");
}
export async function customerReferralSummary(store,{tenantId,publicBaseUrl}={}){
  const state=await settings(store);
  if(!hasSql(store))return {...state,code:null,share_url:null,pending:0,qualified:0,total:0};
  const id=Number(tenantId);
  if(!Number.isInteger(id)||id<=0)throw failure(400,"INVALID_TENANT_CONTEXT");
  const counts=(await store.sql.unsafe(
    "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='qualified')::int AS qualified FROM tenant_referrals WHERE referrer_tenant_id=$1",
    [id]
  ))[0]||{};
  if(!state.enabled)return {...state,code:null,share_url:null,total:Number(counts.total||0),pending:Number(counts.pending||0),qualified:Number(counts.qualified||0)};
  const code=await ensureReferralCode(store,id),base=String(publicBaseUrl||"").replace(/\/$/,"");
  return {...state,code,share_url:base?base+"/demande-ouverture/?ref="+encodeURIComponent(code):null,total:Number(counts.total||0),pending:Number(counts.pending||0),qualified:Number(counts.qualified||0)};
}
export async function captureReferral(store,{referredTenantPublicId,referralCode}={}){
  const code=validReferralCode(referralCode);
  if(!code||!hasSql(store))return {captured:false,reason:"unavailable"};
  const state=await settings(store);
  if(!state.enabled)return {captured:false,reason:"disabled"};
  return store.sql.begin(async tx=>{
    const referred=(await tx.unsafe("SELECT id,status,tenant_type FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[String(referredTenantPublicId||"")]))[0];
    if(!referred||referred.tenant_type==="internal")return {captured:false,reason:"invalid_referred"};
    const referrer=(await tx.unsafe(
      "SELECT c.tenant_id,t.status,t.tenant_type FROM tenant_referral_codes c JOIN tenants t ON t.id=c.tenant_id WHERE c.code=$1 LIMIT 1",
      [code]
    ))[0];
    if(!referrer||referrer.tenant_type==="internal"||referrer.status==="closed"||Number(referrer.tenant_id)===Number(referred.id))return {captured:false,reason:"invalid_code"};
    const rows=await tx.unsafe(
      "INSERT INTO tenant_referrals(referrer_tenant_id,referred_tenant_id,referral_code,status,benefit_label) VALUES($1,$2,$3,'pending',$4) ON CONFLICT(referred_tenant_id) DO NOTHING RETURNING public_id::text AS public_id",
      [Number(referrer.tenant_id),Number(referred.id),code,state.benefit_label]
    );
    if(!rows.length)return {captured:false,reason:"already_attributed"};
    await tx.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'referral.captured','tenant_referral',$2,$3::jsonb)",
      [Number(referrer.tenant_id),String(rows[0].public_id),JSON.stringify({referred_tenant_id:Number(referred.id),benefit_label:state.benefit_label})]
    );
    return {captured:true,public_id:rows[0].public_id};
  });
}
export async function qualifyReferralForTenant(store,tenantPublicId){
  if(!hasSql(store))return {qualified:false,reason:"store_unavailable"};
  return store.sql.begin(async tx=>{
    const tenant=(await tx.unsafe("SELECT id,status,tenant_type FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[String(tenantPublicId||"")]))[0];
    if(!tenant||tenant.tenant_type==="internal"||tenant.status!=="active")return {qualified:false,reason:"tenant_not_active"};
    const rows=await tx.unsafe(
      "UPDATE tenant_referrals SET status='qualified',qualified_at=COALESCE(qualified_at,now()),updated_at=now() WHERE referred_tenant_id=$1 AND status='pending' RETURNING id,public_id::text AS public_id,referrer_tenant_id,benefit_label",
      [Number(tenant.id)]
    );
    const row=rows[0];if(!row)return {qualified:false,reason:"no_pending_referral"};
    await tx.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'referral.qualified','tenant_referral',$2,$3::jsonb)",
      [Number(row.referrer_tenant_id),String(row.public_id),JSON.stringify({referred_tenant_id:Number(tenant.id),benefit_label:row.benefit_label})]
    );
    await tx.unsafe(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'referral.qualified','tenant_referral',$2,$3::jsonb)",
      [Number(row.referrer_tenant_id),String(row.id),JSON.stringify({referral_public_id:row.public_id,benefit_label:row.benefit_label})]
    );
    return {qualified:true,public_id:row.public_id,benefit_label:row.benefit_label};
  });
}
export async function createPortabilityPriorityOrder(store,{tenantId,requestId,customerPrincipalId}={}){
  if(!hasSql(store))throw failure(503,"PORTABILITY_PRIORITY_UNAVAILABLE");
  const tenant=Number(tenantId),request=Number(requestId);
  if(!Number.isInteger(tenant)||tenant<=0||!Number.isInteger(request)||request<=0)throw failure(400,"INVALID_PORTABILITY_REQUEST");
  return store.sql.begin(async tx=>{
    const portability=(await tx.unsafe(
      "SELECT id,status,processing_class FROM tenant_portability_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [request,tenant]
    ))[0];
    if(!portability)throw failure(404,"PORTABILITY_REQUEST_NOT_FOUND");
    if(["ported","rejected","cancelled"].includes(String(portability.status)))throw failure(409,"PORTABILITY_PRIORITY_NOT_AVAILABLE");
    if(portability.processing_class==="priority")return {already_active:true,request_id:request,amount_minor:PORTABILITY_PRIORITY_PRICE_MINOR,currency:PORTABILITY_PRIORITY_CURRENCY,status:"paid"};
    const rows=await tx.unsafe(
      "INSERT INTO portability_priority_orders(tenant_id,portability_request_id,amount_minor,currency,created_by_customer_principal_id) VALUES($1,$2,$3,$4,$5::uuid) ON CONFLICT(portability_request_id) DO UPDATE SET updated_at=now() RETURNING public_id::text AS public_id,status,amount_minor,currency,provider_checkout_session_reference",
      [tenant,request,PORTABILITY_PRIORITY_PRICE_MINOR,PORTABILITY_PRIORITY_CURRENCY,customerPrincipalId||null]
    );
    return {...rows[0],request_id:request,already_active:false};
  });
}
export async function attachPortabilityPriorityCheckout(store,{orderPublicId,checkoutSessionReference,paymentIntentReference=null}={}){
  if(!hasSql(store))throw failure(503,"PORTABILITY_PRIORITY_UNAVAILABLE");
  const rows=await store.sql.unsafe(
    "UPDATE portability_priority_orders SET provider_checkout_session_reference=$2,provider_payment_intent_reference=COALESCE($3,provider_payment_intent_reference),status=CASE WHEN status='paid' THEN status ELSE 'open' END,updated_at=now() WHERE public_id=$1::uuid RETURNING public_id::text AS public_id,status,amount_minor,currency",
    [String(orderPublicId||""),String(checkoutSessionReference||""),paymentIntentReference?String(paymentIntentReference):null]
  );
  if(!rows.length)throw failure(404,"PORTABILITY_PRIORITY_ORDER_NOT_FOUND");
  return rows[0];
}
export async function applyPortabilityPriorityPayment(store,event={}){
  if(!hasSql(store))throw failure(503,"PORTABILITY_PRIORITY_UNAVAILABLE");
  if(Number(event.amount_minor)!==PORTABILITY_PRIORITY_PRICE_MINOR||String(event.currency||"").toUpperCase()!==PORTABILITY_PRIORITY_CURRENCY)throw failure(409,"PORTABILITY_PRIORITY_AMOUNT_MISMATCH");
  return store.sql.begin(async tx=>{
    const receipt=await tx.unsafe(
      "INSERT INTO portability_priority_provider_events(provider,provider_event_id,event_type,order_public_id) VALUES('stripe',$1,$2,$3::uuid) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id",
      [String(event.provider_event_id||""),String(event.event_type||""),String(event.order_public_id||"")]
    );
    if(!receipt.length)return {duplicate:true,updated:false};
    const order=(await tx.unsafe(
      "SELECT id,public_id::text AS public_id,tenant_id,portability_request_id,status FROM portability_priority_orders WHERE public_id=$1::uuid FOR UPDATE",
      [String(event.order_public_id||"")]
    ))[0];
    if(!order)throw failure(404,"PORTABILITY_PRIORITY_ORDER_NOT_FOUND");
    await tx.unsafe(
      "UPDATE portability_priority_orders SET status='paid',provider_checkout_session_reference=COALESCE($2,provider_checkout_session_reference),provider_payment_intent_reference=COALESCE($3,provider_payment_intent_reference),paid_at=COALESCE(paid_at,$4::timestamptz,now()),updated_at=now() WHERE id=$1",
      [Number(order.id),event.checkout_session_reference||null,event.payment_intent_reference||null,event.paid_at||null]
    );
    await tx.unsafe(
      "UPDATE tenant_portability_requests SET processing_class='priority',priority_paid_at=COALESCE(priority_paid_at,$2::timestamptz,now()),automation_next_at=LEAST(automation_next_at,now()),updated_at=now() WHERE id=$1 AND tenant_id=$3",
      [Number(order.portability_request_id),event.paid_at||null,Number(order.tenant_id)]
    );
    await tx.unsafe(
      "UPDATE work_queue SET priority=LEAST(priority,$3),available_at=LEAST(available_at,now()) WHERE queue_name='portability' AND tenant_id=$1 AND dedupe_key=$2 AND completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL",
      [Number(order.tenant_id),"portability:"+Number(order.portability_request_id)+":auto",PORTABILITY_PRIORITY_WORK_QUEUE_PRIORITY]
    );
    await tx.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'portability.priority.paid','tenant_portability_request',$2,$3::jsonb)",
      [Number(order.tenant_id),String(order.portability_request_id),JSON.stringify({amount_minor:PORTABILITY_PRIORITY_PRICE_MINOR,currency:PORTABILITY_PRIORITY_CURRENCY,operator_sla_guaranteed:false})]
    );
    await tx.unsafe(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'portability.priority.activated','tenant_portability_request',$2,$3::jsonb)",
      [Number(order.tenant_id),String(order.portability_request_id),JSON.stringify({amount_minor:PORTABILITY_PRIORITY_PRICE_MINOR,currency:PORTABILITY_PRIORITY_CURRENCY,processing_priority:PORTABILITY_PRIORITY_WORK_QUEUE_PRIORITY,operator_sla_guaranteed:false})]
    );
    return {duplicate:false,updated:true,request_id:Number(order.portability_request_id),tenant_id:Number(order.tenant_id)};
  });
}

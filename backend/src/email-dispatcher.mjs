import {emailHash,normalizeEmail,sendTransactionalEmail} from "./resend-email.mjs";

const OUTBOX_TYPES=[
  "customer.self_registered","tenant.status","subscription.changed","subscription.cancellation.requested",
  "portability.requested","service.incident.created","service.incident.note","service.incident.changed",
  "tenant.revenue_distribution.updated"
];
const TERMINAL_SEND_STATES=new Set(["accepted","sent","delivered","delayed","clicked","bounced","complained","suppressed"]);
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function drainConsumerWithdrawalAcknowledgements({store,config,limit=25}={}){
  if(!config?.transactionalEmailEnabled||!store?.sql)return {enabled:Boolean(config?.transactionalEmailEnabled),processed:0,accepted:0,failed:0};
  const take=Math.max(1,Math.min(50,Number(limit)||25));
  const claimed=await store.sql.begin(async tx=>{
    const rows=await tx.unsafe(
      "SELECT id,public_id::text AS public_id,first_name,last_name,acknowledgement_email,contract_reference,statement,received_at,acknowledgement_attempts"+
      " FROM consumer_withdrawal_requests WHERE acknowledgement_state IN ('pending','failed','sending') AND next_acknowledgement_attempt_at<=now() AND acknowledgement_attempts<8"+
      " ORDER BY received_at,id LIMIT $1 FOR UPDATE SKIP LOCKED",[take]
    );
    for(const row of rows){
      await tx.unsafe("UPDATE consumer_withdrawal_requests SET acknowledgement_state='sending',acknowledgement_attempts=acknowledgement_attempts+1,next_acknowledgement_attempt_at=now()+interval '5 minutes' WHERE id=$1",[row.id]);
      row.acknowledgement_attempts=Number(row.acknowledgement_attempts||0)+1;
    }
    return rows;
  });
  const result={enabled:true,processed:0,accepted:0,failed:0};
  for(const row of claimed){
    const idem="consumer-withdrawal/"+row.public_id+"/ack";
    try{
      const sent=await sendTransactionalEmail(config,{
        to:row.acknowledgement_email,name:[row.first_name,row.last_name].filter(Boolean).join(" "),senderRole:"support",
        templateKey:"consumer_withdrawal_ack",idempotencyKey:idem,internalEventId:idem,
        data:{name:[row.first_name,row.last_name].filter(Boolean).join(" "),reference:row.public_id,contract_reference:row.contract_reference,statement:row.statement,received_at:new Date(row.received_at).toISOString(),locale:"fr-FR"}
      });
      await store.sql.unsafe("UPDATE consumer_withdrawal_requests SET acknowledgement_state='accepted',acknowledgement_provider_message_id=$2,acknowledgement_last_error=NULL,acknowledgement_sent_at=COALESCE(acknowledgement_sent_at,now()) WHERE id=$1",[row.id,sent.message_id]);
      if(validEmail(config.internalNotificationEmail)){
        try{await sendTransactionalEmail(config,{to:config.internalNotificationEmail,senderRole:"support",templateKey:"consumer_withdrawal_internal",idempotencyKey:"consumer-withdrawal/"+row.public_id+"/internal",internalEventId:"consumer-withdrawal/"+row.public_id+"/internal",data:{reference:row.public_id,contract_reference:row.contract_reference,received_at:new Date(row.received_at).toISOString(),locale:"fr-FR"}});}catch{}
      }
      result.accepted++;
    }catch(error){
      const delay=Math.min(3600,Math.max(60,30*Math.pow(2,Math.max(0,row.acknowledgement_attempts-1))));
      await store.sql.unsafe("UPDATE consumer_withdrawal_requests SET acknowledgement_state='failed',acknowledgement_last_error=$2,next_acknowledgement_attempt_at=now()+($3::text||' seconds')::interval WHERE id=$1",[row.id,String(error?.code||"EMAIL_DELIVERY_FAILED").slice(0,240),String(delay)]);
      result.failed++;
    }
    result.processed++;
  }
  return result;
}

export async function drainTransactionalEmails({store,config,limit=50}={}){
  if(!config?.transactionalEmailEnabled)return {enabled:false,processed:0,accepted:0,suppressed:0,failed:0};
  if(!store?.sql)return {enabled:true,processed:0,accepted:0,suppressed:0,failed:0};
  const take=Math.max(1,Math.min(100,Number(limit)||50));
  const events=await store.sql.unsafe(
    "SELECT o.id,o.tenant_id,o.event_type,o.aggregate_type,o.aggregate_id,o.payload,o.created_at,"+
    " t.public_id::text AS tenant_public_id,t.display_name AS tenant_name,t.billing_email,t.country_code,"+
    " owner.id::text AS owner_principal_id,owner.email AS owner_email,owner.display_name AS owner_name,owner.email_verified AS owner_email_verified,owner.preferred_locale AS owner_preferred_locale"+
    " FROM outbox_events o JOIN tenants t ON t.id=o.tenant_id"+
    " LEFT JOIN LATERAL ("+
    "   SELECT cp.id,cp.email,cp.display_name,cp.email_verified,cp.preferred_locale FROM customer_tenant_memberships m"+
    "   JOIN customer_principals cp ON cp.id=m.customer_principal_id"+
    "   WHERE m.tenant_id=o.tenant_id AND m.status='active' AND cp.status='active'"+
    "   ORDER BY (m.role='owner') DESC,m.created_at ASC LIMIT 1"+
    " ) owner ON true"+
    " WHERE o.event_type=ANY($1::text[]) AND o.created_at>=now()-interval '30 days'"+
    " AND NOT EXISTS(SELECT 1 FROM transactional_email_event_receipts r WHERE r.outbox_event_id=o.id)"+
    " ORDER BY o.id ASC LIMIT $2",
    [OUTBOX_TYPES,take]
  );
  const result={enabled:true,processed:0,accepted:0,suppressed:0,failed:0};
  for(const event of events){
    const messages=await messagesForEvent(store,config,event);
    if(!messages.length){
      await markEventReceipt(store,event.id,"ignored",null);
      result.processed++;continue;
    }
    let allComplete=true;
    for(const message of messages){
      const sent=await dispatchMessage(store,config,event,message);
      if(sent.state==="accepted"||sent.state==="existing")result.accepted++;
      else if(sent.state==="suppressed")result.suppressed++;
      else{result.failed++;allComplete=false;}
    }
    if(allComplete)await markEventReceipt(store,event.id,"processed",null);
    result.processed++;
  }
  return result;
}

export async function drainDunningTransactionalEmails({store,config,limit=50}={}){
  if(!config?.transactionalEmailEnabled||!store?.sql)return {enabled:Boolean(config?.transactionalEmailEnabled),processed:0,accepted:0,suppressed:0,failed:0};
  const take=Math.max(1,Math.min(100,Number(limit)||50));
  const rows=await store.sql.unsafe(
    "SELECT s.id AS subscription_id,s.tenant_id,s.recovery_stage,s.dunning_started_at,s.dunning_grace_until,s.dunning_deadline_at,"+
    " t.public_id::text AS tenant_public_id,t.display_name AS tenant_name,t.billing_email,"+
    " owner.id::text AS owner_principal_id,owner.email AS owner_email,owner.display_name AS owner_name,owner.preferred_locale AS owner_preferred_locale"+
    " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id JOIN tenants t ON t.id=s.tenant_id"+
    " LEFT JOIN LATERAL (SELECT cp.id,cp.email,cp.display_name,cp.preferred_locale FROM customer_tenant_memberships m JOIN customer_principals cp ON cp.id=m.customer_principal_id"+
    " WHERE m.tenant_id=s.tenant_id AND m.status='active' AND cp.status='active' ORDER BY (m.role='owner') DESC,m.created_at ASC LIMIT 1) owner ON true"+
    " WHERE p.plan_key='external-sva-access' AND t.tenant_type<>'internal' AND t.status<>'closed'"+
    " AND s.recovery_stage IN ('retrying','suspended') AND s.dunning_started_at IS NOT NULL"+
    " ORDER BY COALESCE(s.dunning_deadline_at,s.dunning_started_at),s.id LIMIT $1",
    [take]
  );
  const result={enabled:true,processed:0,accepted:0,suppressed:0,failed:0};
  for(const row of rows){
    const to=validEmail(row.billing_email)?row.billing_email:row.owner_email;
    if(!validEmail(to))continue;
    const stamp=new Date(row.dunning_started_at).getTime();
    const templateKey=row.recovery_stage==="suspended"?"subscription_suspended":"payment_reminder";
    const idem="dunning/"+row.subscription_id+"/"+stamp+"/"+row.recovery_stage;
    const event={id:null,tenant_id:row.tenant_id,event_type:"subscription.dunning",aggregate_type:"tenant_subscription",aggregate_id:String(row.subscription_id),payload:{},tenant_name:row.tenant_name,owner_name:row.owner_name,owner_principal_id:row.owner_principal_id,owner_preferred_locale:row.owner_preferred_locale};
    const message={scope:"customer",to,name:row.owner_name||row.tenant_name,templateKey,senderRole:"billing",idempotencyKey:idem,internalEventId:idem,data:{name:row.owner_name||row.tenant_name,locale:row.owner_preferred_locale}};
    const sent=await dispatchMessage(store,config,event,message);
    result.processed++;
    if(sent.state==="accepted"||sent.state==="existing")result.accepted++;
    else if(sent.state==="suppressed")result.suppressed++;
    else result.failed++;
  }
  return result;
}

export async function applyResendWebhookEvent(store,verified){
  if(!store?.sql)throw failure(503,"EMAIL_DELIVERY_STORE_UNAVAILABLE");
  const event=verified?.event||{},type=String(event.type||""),data=event.data||{};
  const svixId=String(verified?.svixId||""),emailId=String(data.email_id||data.id||"");
  const occurredAt=event.created_at&&Number.isFinite(Date.parse(event.created_at))?new Date(event.created_at).toISOString():new Date().toISOString();
  const rawTo=Array.isArray(data.to)?data.to[0]:data.to;
  const recipient=validEmail(rawTo)?normalizeEmail(rawTo):null;
  const bounceType=String(data?.bounce?.type||data?.bounce_type||"").trim().toLowerCase();
  return store.sql.begin(async tx=>{
    const inserted=await tx.unsafe(
      "INSERT INTO transactional_email_webhook_events(svix_id,event_type,provider_email_id,payload_sha256,occurred_at) VALUES($1,$2,$3,$4,$5::timestamptz)"+
      " ON CONFLICT(svix_id) DO NOTHING RETURNING svix_id",
      [svixId,type,emailId,String(verified.payloadSha256||""),occurredAt]
    );
    if(!inserted.length)return {duplicate:true};
    const state=webhookState(type);
    const timestampColumn=webhookTimestampColumn(type);
    if(timestampColumn){
      const allowed=new Set(["sent_at","delivered_at","delayed_at","clicked_at","bounced_at","complained_at","failed_at","suppressed_at"]);
      if(!allowed.has(timestampColumn))throw failure(500,"EMAIL_WEBHOOK_STATE_INVALID");
      await tx.unsafe(
        "UPDATE transactional_email_deliveries SET state=$2,"+timestampColumn+"=COALESCE("+timestampColumn+",$3::timestamptz),updated_at=now() WHERE provider_email_id=$1",
        [emailId,state,occurredAt]
      );
    }
    const permanentBounce=type==="email.bounced"&&bounceType==="permanent";
    if(recipient&&(permanentBounce||type==="email.complained"||type==="email.suppressed")){
      const reason=permanentBounce?"hard_bounce":type==="email.complained"?"complaint":"provider_suppressed";
      await tx.unsafe(
        "INSERT INTO transactional_email_suppressions(recipient_hash,reason,source_provider_email_id,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz)"+
        " ON CONFLICT(recipient_hash) DO UPDATE SET reason=EXCLUDED.reason,source_provider_email_id=EXCLUDED.source_provider_email_id,last_seen_at=EXCLUDED.last_seen_at",
        [emailHash(recipient),reason,emailId,occurredAt]
      );
    }
    await tx.unsafe("UPDATE transactional_email_webhook_events SET processed_at=now() WHERE svix_id=$1",[svixId]);
    return {duplicate:false,email_id:emailId,event_type:type,state,suppressed:Boolean(recipient&&(permanentBounce||type==="email.complained"||type==="email.suppressed"))};
  });
}

async function messagesForEvent(store,config,event){
  const p=event.payload||{};
  const customerEmail=validEmail(event.billing_email)?event.billing_email:validEmail(event.owner_email)?event.owner_email:validEmail(p.email)?p.email:null;
  const customerName=event.owner_name||event.tenant_name||"";
  const internal=validEmail(config.internalNotificationEmail)?config.internalNotificationEmail:null;
  const base={name:customerName,tenant_name:event.tenant_name,country_code:event.country_code,locale:event.owner_preferred_locale||p.preferred_locale||null};
  if(event.event_type==="customer.self_registered"){
    const email=validEmail(p.email)?p.email:customerEmail;
    return [
      email&&msg("customer",email,customerName,"registration_received","notifications",event,{...base,name:customerName}),
      internal&&msg("internal",internal,"","registration_internal","notifications",event,{...base,account_type:p.account_type,service_intent:p.service_intent})
    ].filter(Boolean);
  }
  if(event.event_type==="tenant.status"){
    if(!customerEmail)return [];
    if(p.status==="active")return [msg("customer",customerEmail,customerName,"account_activated","notifications",event,base)];
    if(p.status==="suspended")return [msg("customer",customerEmail,customerName,"account_suspended","notifications",event,base)];
    return [];
  }
  if(event.event_type==="subscription.changed"){
    if(!customerEmail)return [];
    const type=String(p.event_type||"");
    if(type==="customer.subscription.created")return [msg("customer",customerEmail,customerName,"subscription_created","billing",event,base)];
    if(type==="invoice.payment_failed")return [msg("customer",customerEmail,customerName,"payment_failed","billing",event,base)];
    if(type==="invoice.payment_action_required")return [msg("customer",customerEmail,customerName,"payment_action_required","billing",event,base)];
    if(type==="invoice.paid"){
      const recovered=await invoiceWasPreviouslyFailed(store,event.aggregate_id,p.provider_invoice_reference);
      return [msg("customer",customerEmail,customerName,recovered?"payment_recovered":"payment_succeeded","billing",event,{...base,invoice_url:p.provider_invoice_url||null,invoice_pdf_url:p.provider_invoice_pdf_url||null})];
    }
    if(type==="customer.subscription.deleted"||p.status==="cancelled"||p.status==="ended")return [msg("customer",customerEmail,customerName,"subscription_cancelled","billing",event,base)];
    if(p.status==="suspended")return [msg("customer",customerEmail,customerName,"subscription_suspended","billing",event,base)];
    return [];
  }
  if(event.event_type==="subscription.cancellation.requested"){
    if(!customerEmail)return [];
    return [msg("customer",customerEmail,customerName,"subscription_cancellation_received","billing",event,{...base,request_reference:p.request_public_id||null,requested_effective_at:p.requested_effective_at||null})];
  }
  if(event.event_type==="portability.requested"){
    return [
      customerEmail&&msg("customer",customerEmail,customerName,"portability_received","support",event,base),
      internal&&msg("internal",internal,"","portability_internal","support",event,base)
    ].filter(Boolean);
  }
  if(event.event_type==="service.incident.created"){
    const source=String(p.source||"");
    if(source==="customer")return [
      customerEmail&&msg("customer",customerEmail,customerName,"support_received","support",event,{...base,severity:p.severity}),
      internal&&msg("internal",internal,"","support_internal","support",event,{...base,severity:p.severity})
    ].filter(Boolean);
    if(customerEmail)return [msg("customer",customerEmail,customerName,"support_opened","support",event,base)];
    return [];
  }
  if(event.event_type==="service.incident.note"){
    const source=String(p.source||"");
    if(source==="staff"&&p.customer_visible!==false&&customerEmail)return [msg("customer",customerEmail,customerName,"support_response","support",event,base)];
    if(source==="customer"&&internal)return [msg("internal",internal,"","support_customer_reply","support",event,base)];
    return [];
  }
  if(event.event_type==="service.incident.changed"){
    if(customerEmail&&["resolved","closed"].includes(String(p.status||"")))return [msg("customer",customerEmail,customerName,"support_resolved","support",event,base)];
  }
  if(event.event_type==="tenant.revenue_distribution.updated"){
    if(customerEmail&&String(p.status||"")==="payable")return [msg("customer",customerEmail,customerName,"payout_available","billing",event,{...base,currency:p.currency||null})];
  }
  return [];
}

function msg(scope,to,name,templateKey,senderRole,event,data){
  const suffix=scope+"/"+templateKey;
  const idempotencyKey="outbox/"+event.id+"/"+suffix;
  return {scope,to,name,templateKey,senderRole,idempotencyKey,internalEventId:idempotencyKey,data};
}

async function dispatchMessage(store,config,event,message){
  const recipient=normalizeEmail(message.to),hash=emailHash(recipient);
  const suppressed=await store.sql.unsafe("SELECT reason FROM transactional_email_suppressions WHERE recipient_hash=$1 LIMIT 1",[hash]);
  const principalId=message.scope==="customer"&&event.owner_principal_id?event.owner_principal_id:null;
  const outboxId=event.id==null?null:Number(event.id);
  const existing=await store.sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",[message.idempotencyKey]);
    const prior=await tx.unsafe("SELECT id,state,provider_email_id FROM transactional_email_deliveries WHERE idempotency_key=$1 LIMIT 1",[message.idempotencyKey]);
    if(prior[0]&&TERMINAL_SEND_STATES.has(String(prior[0].state)))return prior[0];
    const state=suppressed.length?"suppressed":"pending";
    const rows=await tx.unsafe(
      "INSERT INTO transactional_email_deliveries(tenant_id,customer_principal_id,outbox_event_id,idempotency_key,template_key,sender_role,recipient_hash,event_type,aggregate_type,aggregate_id,state,metadata)"+
      " VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)"+
      " ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=now(),state=CASE WHEN transactional_email_deliveries.state='failed' THEN EXCLUDED.state ELSE transactional_email_deliveries.state END"+
      " RETURNING id,state,provider_email_id",
      [event.tenant_id||null,principalId,outboxId,message.idempotencyKey,message.templateKey,message.senderRole,hash,event.event_type,event.aggregate_type,event.aggregate_id,state,JSON.stringify({scope:message.scope})]
    );
    return rows[0];
  });
  if(TERMINAL_SEND_STATES.has(String(existing.state))){
    return {state:existing.state==="suppressed"?"suppressed":"existing",delivery_id:Number(existing.id)};
  }
  if(suppressed.length){
    await store.sql.unsafe("UPDATE transactional_email_deliveries SET state='suppressed',suppressed_at=COALESCE(suppressed_at,now()),updated_at=now() WHERE id=$1",[existing.id]);
    return {state:"suppressed",delivery_id:Number(existing.id)};
  }
  try{
    const sent=await sendTransactionalEmail(config,message);
    await store.sql.unsafe(
      "UPDATE transactional_email_deliveries SET state='accepted',provider_email_id=$2,accepted_at=COALESCE(accepted_at,now()),last_error_code=NULL,updated_at=now() WHERE id=$1",
      [existing.id,sent.message_id]
    );
    return {state:"accepted",delivery_id:Number(existing.id),message_id:sent.message_id};
  }catch(error){
    await store.sql.unsafe(
      "UPDATE transactional_email_deliveries SET state='failed',last_error_code=$2,failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=$1",
      [existing.id,String(error?.code||"RESEND_SEND_FAILED").slice(0,120)]
    );
    return {state:"failed",delivery_id:Number(existing.id),code:String(error?.code||"RESEND_SEND_FAILED")};
  }
}

async function invoiceWasPreviouslyFailed(store,subscriptionId,invoiceReference){
  const id=Number(subscriptionId);
  if(!Number.isInteger(id)||id<=0||!invoiceReference)return false;
  const rows=await store.sql.unsafe(
    "SELECT 1 FROM subscription_billing_events WHERE subscription_id=$1 AND event_type IN ('invoice.payment_failed','invoice.payment_action_required')"+
    " AND normalized_details->>'provider_invoice_reference'=$2 LIMIT 1",
    [id,String(invoiceReference)]
  );
  return rows.length>0;
}
async function markEventReceipt(store,outboxId,disposition,errorCode){
  await store.sql.unsafe(
    "INSERT INTO transactional_email_event_receipts(outbox_event_id,disposition,error_code,processed_at) VALUES($1,$2,$3,now())"+
    " ON CONFLICT(outbox_event_id) DO UPDATE SET disposition=EXCLUDED.disposition,error_code=EXCLUDED.error_code,processed_at=now()",
    [Number(outboxId),String(disposition),errorCode||null]
  );
}
function webhookState(type){
  return ({
    "email.sent":"sent","email.delivered":"delivered","email.delivery_delayed":"delayed","email.bounced":"bounced",
    "email.complained":"complained","email.failed":"failed","email.suppressed":"suppressed","email.clicked":"clicked","email.received":"received"
  })[type]||"accepted";
}
function webhookTimestampColumn(type){
  return ({
    "email.sent":"sent_at","email.delivered":"delivered_at","email.delivery_delayed":"delayed_at","email.bounced":"bounced_at",
    "email.complained":"complained_at","email.failed":"failed_at","email.suppressed":"suppressed_at","email.clicked":"clicked_at"
  })[type]||null;
}
function validEmail(value){return EMAIL_RE.test(String(value||"").trim())&&String(value||"").trim().length<=320;}
function failure(status,code){const e=new Error(code);e.status=status;e.code=code;e.expose=true;return e;}

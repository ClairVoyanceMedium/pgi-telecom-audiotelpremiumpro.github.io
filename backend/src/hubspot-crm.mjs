const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hubspotCrmEnabled(config={}){
  return Boolean(config.hubspotCrmEnabled&&String(config.hubspotPrivateAppToken||"").trim().length>=20);
}

export async function drainHubSpotCrm({store,config,limit=50}={}){
  if(!hubspotCrmEnabled(config)||!store?.sql)return {enabled:false,processed:0,synced:0,failed:0};
  const take=Math.max(1,Math.min(100,Number(limit)||50));
  const rows=await store.sql.unsafe(
    "SELECT o.id,o.tenant_id,o.event_type,o.aggregate_type,o.aggregate_id,o.payload,o.created_at,"+
    " t.public_id::text AS tenant_public_id,t.display_name AS tenant_name,t.billing_email,t.country_code,t.status AS tenant_status,"+
    " k.entity_type,k.registration_number,"+
    " owner.id::text AS owner_principal_id,owner.email AS owner_email,owner.display_name AS owner_name,owner.metadata AS owner_metadata,"+
    " l.contact_id,l.deal_id,l.pipeline_id,l.last_stage "+
    " FROM outbox_events o JOIN tenants t ON t.id=o.tenant_id "+
    " LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id "+
    " LEFT JOIN crm_external_links l ON l.tenant_id=t.id "+
    " LEFT JOIN LATERAL ("+
    "   SELECT cp.id,cp.email,cp.display_name,cp.metadata FROM customer_tenant_memberships m "+
    "   JOIN customer_principals cp ON cp.id=m.customer_principal_id "+
    "   WHERE m.tenant_id=o.tenant_id AND m.status='active' AND cp.status IN ('active','pending') "+
    "   ORDER BY (m.role='owner') DESC,m.created_at ASC LIMIT 1"+
    " ) owner ON true "+
    " WHERE o.event_type=ANY($1::text[]) "+
    " AND NOT EXISTS(SELECT 1 FROM crm_sync_receipts r WHERE r.outbox_event_id=o.id AND r.state='synced') "+
    " ORDER BY o.id ASC LIMIT $2",
    [["customer.self_registered","tenant.status","subscription.changed","portability.requested"],take]
  );
  const result={enabled:true,processed:0,synced:0,failed:0};
  for(const row of rows){
    result.processed++;
    try{
      await syncRow(store,config,row);
      await receipt(store,row.id,"synced",null);
      result.synced++;
    }catch(error){
      await receipt(store,row.id,"failed",safeCode(error));
      await store.sql.unsafe(
        "INSERT INTO crm_external_links(tenant_id,provider,last_error_code,updated_at) VALUES($1,'hubspot',$2,now()) "+
        "ON CONFLICT(tenant_id) DO UPDATE SET last_error_code=EXCLUDED.last_error_code,updated_at=now()",
        [row.tenant_id,safeCode(error)]
      );
      result.failed++;
    }
  }
  return result;
}

async function syncRow(store,config,row){
  const payload=row.payload||{};
  const email=String(row.owner_email||row.billing_email||payload.email||"").trim().toLowerCase();
  if(!EMAIL_RE.test(email))throw failure("HUBSPOT_EMAIL_REQUIRED");
  const metadata=row.owner_metadata||{};
  const firstName=clean(metadata.first_name||payload.first_name,80);
  const lastName=clean(metadata.last_name||payload.last_name,80);
  const phone=clean(metadata.phone||payload.phone,40);
  const company=clean(payload.company_name||row.tenant_name,200);
  let contactId=String(row.contact_id||"");
  if(!contactId){
    contactId=await upsertContact(config,{
      email,firstName,lastName,phone,company,
      lifecycleStage:"lead",leadStatus:"NEW"
    });
  }else{
    await updateContact(config,contactId,{email,firstName,lastName,phone,company});
  }

  let dealId=String(row.deal_id||"");
  let pipelineId=String(row.pipeline_id||config.hubspotPipelineId||"default");
  if(!dealId){
    dealId=await createDeal(config,{
      name:(company||row.tenant_name||email)+" — Audiotel / SVA",
      pipelineId,
      stageId:config.hubspotStageNew||"appointmentscheduled",
      contactId
    });
  }

  const desired=stageForEvent(config,row.event_type,payload,row.tenant_status);
  if(desired.stageId){
    await updateDeal(config,dealId,{
      stageId:desired.stageId,
      amount:desired.customer?String(config.subscriptionPriceMonthlyEur||3):null
    });
  }
  if(desired.lifecycleStage||desired.leadStatus){
    await updateContact(config,contactId,{
      lifecycleStage:desired.lifecycleStage||null,
      leadStatus:desired.leadStatus||null
    });
  }

  await store.sql.unsafe(
    "INSERT INTO crm_external_links(tenant_id,provider,contact_id,deal_id,pipeline_id,last_stage,last_synced_at,last_error_code,updated_at) "+
    "VALUES($1,'hubspot',$2,$3,$4,$5,now(),NULL,now()) "+
    "ON CONFLICT(tenant_id) DO UPDATE SET contact_id=EXCLUDED.contact_id,deal_id=EXCLUDED.deal_id,pipeline_id=EXCLUDED.pipeline_id,last_stage=EXCLUDED.last_stage,last_synced_at=now(),last_error_code=NULL,updated_at=now()",
    [row.tenant_id,contactId,dealId,pipelineId,desired.label]
  );
}

function stageForEvent(config,eventType,payload,tenantStatus){
  if(eventType==="customer.self_registered")return {stageId:config.hubspotStageNew||"appointmentscheduled",label:"new_request",lifecycleStage:"lead",leadStatus:"NEW"};
  if(eventType==="portability.requested")return {stageId:config.hubspotStageQualified||"qualifiedtobuy",label:"qualified",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
  if(eventType==="tenant.status"){
    const status=String(payload.status||tenantStatus||"");
    if(status==="active")return {stageId:config.hubspotStageQualified||"qualifiedtobuy",label:"validated",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
    if(["closed","rejected"].includes(status))return {stageId:config.hubspotStageLost||"closedlost",label:"lost",leadStatus:"UNQUALIFIED"};
  }
  if(eventType==="subscription.changed"){
    const providerEvent=String(payload.event_type||"");
    const status=String(payload.status||"");
    if(providerEvent==="invoice.paid"||status==="active")return {stageId:config.hubspotStageActive||"closedwon",label:"customer_active",lifecycleStage:"customer",leadStatus:"OPEN_DEAL",customer:true};
    if(providerEvent==="customer.subscription.deleted"||["cancelled","ended"].includes(status))return {stageId:config.hubspotStageLost||"closedlost",label:"subscription_ended",lifecycleStage:"customer"};
    if(providerEvent==="invoice.payment_failed"||providerEvent==="invoice.payment_action_required"||status==="past_due")return {stageId:config.hubspotStageReady||"contractsent",label:"payment_attention",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
    if(providerEvent==="customer.subscription.created")return {stageId:config.hubspotStageReady||"contractsent",label:"subscription_created",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
  }
  return {stageId:null,label:"observed",lifecycleStage:null,leadStatus:null};
}

async function upsertContact(config,input){
  const found=await hs(config,"/crm/v3/objects/contacts/search",{
    method:"POST",
    body:{filterGroups:[{filters:[{propertyName:"email",operator:"EQ",value:input.email}]}],properties:["email"],limit:1}
  });
  const existing=found?.results?.[0];
  const props=contactProperties(input);
  if(existing?.id){
    await hs(config,"/crm/v3/objects/contacts/"+encodeURIComponent(existing.id),{method:"PATCH",body:{properties:props}});
    return String(existing.id);
  }
  const created=await hs(config,"/crm/v3/objects/contacts",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_CONTACT_CREATE_FAILED");
  return String(created.id);
}

async function updateContact(config,id,input){
  const props=contactProperties(input);
  if(!Object.keys(props).length)return;
  await hs(config,"/crm/v3/objects/contacts/"+encodeURIComponent(id),{method:"PATCH",body:{properties:props}});
}

function contactProperties(input={}){
  const props={};
  if(EMAIL_RE.test(String(input.email||"")))props.email=String(input.email).trim().toLowerCase();
  if(input.firstName)props.firstname=clean(input.firstName,80);
  if(input.lastName)props.lastname=clean(input.lastName,80);
  if(input.phone)props.phone=clean(input.phone,40);
  if(input.company)props.company=clean(input.company,200);
  if(input.lifecycleStage)props.lifecyclestage=String(input.lifecycleStage);
  if(input.leadStatus)props.hs_lead_status=String(input.leadStatus);
  return props;
}

async function createDeal(config,{name,pipelineId,stageId,contactId}){
  const created=await hs(config,"/crm/v3/objects/deals",{
    method:"POST",
    body:{properties:{dealname:clean(name,240),pipeline:String(pipelineId||"default"),dealstage:String(stageId||"appointmentscheduled"),dealtype:"newbusiness"}}
  });
  if(!created?.id)throw failure("HUBSPOT_DEAL_CREATE_FAILED");
  const dealId=String(created.id);
  if(contactId){
    await hs(config,"/crm/v4/objects/deal/"+encodeURIComponent(dealId)+"/associations/default/contact/"+encodeURIComponent(contactId),{method:"PUT",body:null});
  }
  return dealId;
}

async function updateDeal(config,id,{stageId,amount}={}){
  const props={};
  if(stageId)props.dealstage=String(stageId);
  if(amount!=null)props.amount=String(amount);
  if(!Object.keys(props).length)return;
  await hs(config,"/crm/v3/objects/deals/"+encodeURIComponent(id),{method:"PATCH",body:{properties:props}});
}

async function hs(config,path,{method="GET",body=null}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(config.hubspotTimeoutMs||8000));
  try{
    const response=await fetch("https://api.hubapi.com"+path,{
      method,
      headers:{
        authorization:"Bearer "+String(config.hubspotPrivateAppToken||"").trim(),
        accept:"application/json",
        ...(body==null?{}:{"content-type":"application/json"})
      },
      body:body==null?undefined:JSON.stringify(body),
      signal:controller.signal
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const e=failure("HUBSPOT_HTTP_"+response.status);
      e.provider_code=clean(payload?.category||payload?.status||payload?.message,120);
      throw e;
    }
    return payload;
  }catch(error){
    if(error?.name==="AbortError")throw failure("HUBSPOT_TIMEOUT");
    throw error;
  }finally{clearTimeout(timeout);}
}

async function receipt(store,outboxId,state,errorCode){
  await store.sql.unsafe(
    "INSERT INTO crm_sync_receipts(outbox_event_id,provider,state,attempts,last_error_code,processed_at,updated_at) "+
    "VALUES($1,'hubspot',$2,1,$3,CASE WHEN $2='synced' THEN now() ELSE NULL END,now()) "+
    "ON CONFLICT(outbox_event_id) DO UPDATE SET state=EXCLUDED.state,attempts=crm_sync_receipts.attempts+1,last_error_code=EXCLUDED.last_error_code,processed_at=CASE WHEN EXCLUDED.state='synced' THEN now() ELSE crm_sync_receipts.processed_at END,updated_at=now()",
    [Number(outboxId),state,errorCode||null]
  );
}

function clean(value,max=200){return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);}
function safeCode(error){return clean(error?.code||error?.message||"HUBSPOT_SYNC_FAILED",120).replace(/[^A-Za-z0-9_.:-]/g,"_");}
function failure(code){const e=new Error(code);e.code=code;return e;}

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
    " l.contact_id,l.company_id,l.deal_id,l.pipeline_id,l.last_stage,"+
    " i.id AS incident_id,i.public_id::text AS incident_public_id,i.title AS incident_title,i.description AS incident_description,i.status AS incident_status,i.severity AS incident_severity,i.category AS incident_category,"+
    " il.ticket_id,il.last_status AS ticket_last_status,il.last_priority AS ticket_last_priority,"+
    " r.state AS receipt_state,r.external_object_type,r.external_object_id "+
    " FROM outbox_events o JOIN tenants t ON t.id=o.tenant_id "+
    " LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id "+
    " LEFT JOIN crm_external_links l ON l.tenant_id=t.id "+
    " LEFT JOIN tenant_service_incidents i ON o.aggregate_type='tenant_service_incident' AND i.id::text=o.aggregate_id "+
    " LEFT JOIN crm_incident_links il ON il.incident_id=i.id "+
    " LEFT JOIN crm_sync_receipts r ON r.outbox_event_id=o.id "+
    " LEFT JOIN LATERAL ("+
    "   SELECT cp.id,cp.email,cp.display_name,cp.metadata FROM customer_tenant_memberships m "+
    "   JOIN customer_principals cp ON cp.id=m.customer_principal_id "+
    "   WHERE m.tenant_id=o.tenant_id AND m.status='active' AND cp.status IN ('active','pending') "+
    "   ORDER BY (m.role='owner') DESC,m.created_at ASC LIMIT 1"+
    " ) owner ON true "+
    " WHERE o.event_type=ANY($1::text[]) "+
    " AND COALESCE(r.state,'pending')<>'synced' "+
    " ORDER BY o.id ASC LIMIT $2",
    [["customer.self_registered","tenant.status","subscription.changed","portability.requested","service.incident.created","service.incident.note","service.incident.changed","service.incident.resolved"],take]
  );
  const result={enabled:true,processed:0,synced:0,failed:0};
  for(const row of rows){
    result.processed++;
    try{
      await receipt(store,row.id,"pending",null,row.external_object_type,row.external_object_id);
      const outcome=String(row.event_type||"").startsWith("service.incident.")
        ?await syncSupportRow(store,config,row)
        :await syncRow(store,config,row);
      await receipt(store,row.id,"synced",null,outcome.externalObjectType,outcome.externalObjectId);
      result.synced++;
    }catch(error){
      await receipt(store,row.id,"failed",safeCode(error),row.external_object_type,row.external_object_id);
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
  const acquisition=payload.acquisition&&typeof payload.acquisition==="object"?payload.acquisition:{};
  const firstName=clean(metadata.first_name||payload.first_name,80);
  const lastName=clean(metadata.last_name||payload.last_name,80);
  const phone=clean(metadata.phone||payload.phone,40);
  const companyName=clean(payload.company_name||row.tenant_name,200);
  const ownerId=String(config.hubspotOwnerId||"").trim();
  const source=hubspotSource(acquisition);

  let contactId=String(row.contact_id||"");
  if(!contactId){
    contactId=await upsertContact(config,{email,firstName,lastName,phone,company:companyName,lifecycleStage:"lead",leadStatus:"NEW",ownerId,source});
    await persistLink(store,row.tenant_id,{contactId});
  }else{
    await updateContact(config,contactId,{email,firstName,lastName,phone,company:companyName,ownerId});
  }

  const business=String(payload.account_type||metadata.account_type||"").toLowerCase()==="business"||String(row.entity_type||"")==="company";
  let companyId=String(row.company_id||"");
  if(config.hubspotCompanySyncEnabled&&business){
    if(!companyId){
      companyId=await createCompany(config,{name:companyName||row.tenant_name,country:row.country_code,phone,ownerId});
      await persistLink(store,row.tenant_id,{contactId,companyId});
    }
    await associate(config,"contact",contactId,"company",companyId);
  }

  let dealId=String(row.deal_id||"");
  const pipelineId=String(row.pipeline_id||config.hubspotPipelineId||"default");
  if(!dealId){
    dealId=await createDeal(config,{
      name:(companyName||row.tenant_name||email)+" — Audiotel / SVA",
      pipelineId,
      stageId:config.hubspotStageNew||"appointmentscheduled",
      ownerId
    });
    await associate(config,"deal",dealId,"contact",contactId);
    if(companyId)await associate(config,"deal",dealId,"company",companyId);
    await persistLink(store,row.tenant_id,{contactId,companyId,dealId,pipelineId});
  }else{
    await associate(config,"deal",dealId,"contact",contactId);
    if(companyId)await associate(config,"deal",dealId,"company",companyId);
  }

  const desired=stageForEvent(config,row.event_type,payload,row.tenant_status);
  if(desired.stageId){
    await updateDeal(config,dealId,{
      stageId:desired.stageId,
      amount:config.hubspotDealAmountEnabled&&desired.customer?String(config.subscriptionPriceMonthlyEur||3):null
    });
  }
  if(desired.lifecycleStage||desired.leadStatus){
    await updateContact(config,contactId,{
      lifecycleStage:desired.lifecycleStage||null,
      leadStatus:desired.leadStatus||null,
      ownerId
    });
  }

  let externalObjectType=String(row.external_object_type||"")||null;
  let externalObjectId=String(row.external_object_id||"")||null;
  const task=taskForEvent(config,row,payload,acquisition);
  if(config.hubspotTaskSyncEnabled&&task&&!externalObjectId){
    externalObjectId=await createTask(config,{...task,ownerId});
    externalObjectType="task";
    await associate(config,"task",externalObjectId,"contact",contactId);
    await associate(config,"task",externalObjectId,"deal",dealId);
    if(companyId)await associate(config,"task",externalObjectId,"company",companyId);
    await receipt(store,row.id,"pending",null,externalObjectType,externalObjectId);
  }

  await store.sql.unsafe(
    "INSERT INTO crm_external_links(tenant_id,provider,contact_id,company_id,deal_id,pipeline_id,last_stage,last_synced_at,last_error_code,updated_at) "+
    "VALUES($1,'hubspot',$2,$3,$4,$5,$6,now(),NULL,now()) "+
    "ON CONFLICT(tenant_id) DO UPDATE SET contact_id=COALESCE(EXCLUDED.contact_id,crm_external_links.contact_id),company_id=COALESCE(EXCLUDED.company_id,crm_external_links.company_id),deal_id=COALESCE(EXCLUDED.deal_id,crm_external_links.deal_id),pipeline_id=COALESCE(EXCLUDED.pipeline_id,crm_external_links.pipeline_id),last_stage=EXCLUDED.last_stage,last_synced_at=now(),last_error_code=NULL,updated_at=now()",
    [row.tenant_id,contactId,companyId||null,dealId,pipelineId,desired.label]
  );
  return {externalObjectType,externalObjectId};
}

async function syncSupportRow(store,config,row){
  if(!row.incident_id)throw failure("HUBSPOT_INCIDENT_NOT_FOUND");
  const payload=row.payload||{};
  const ownerId=String(config.hubspotOwnerId||"").trim();
  const status=String(payload.status||row.incident_status||"open").toLowerCase();
  const severity=String(payload.severity||row.incident_severity||"normal").toLowerCase();

  let ticketId=String(row.ticket_id||"");
  if(!ticketId){
    ticketId=await createTicket(config,{
      subject:clean(row.incident_title||("Incident "+(row.incident_public_id||row.aggregate_id)),240),
      content:clean(row.incident_description||("Dossier PGI "+(row.incident_public_id||row.aggregate_id)),5000),
      status,
      severity,
      ownerId
    });
    await persistIncidentLink(store,row,{ticketId,status,severity});
    if(row.contact_id)await associate(config,"ticket",ticketId,"contact",String(row.contact_id));
    if(row.company_id)await associate(config,"ticket",ticketId,"company",String(row.company_id));
    if(row.deal_id)await associate(config,"ticket",ticketId,"deal",String(row.deal_id));
  }else{
    await updateTicket(config,ticketId,{status,severity});
  }

  if(row.event_type==="service.incident.note"&&!row.external_object_id){
    const noteId=Number(payload.note_id||0);
    if(Number.isInteger(noteId)&&noteId>0){
      const notes=await store.sql.unsafe(
        "SELECT body,author_type,customer_visible,created_at FROM tenant_service_incident_notes WHERE id=$1 AND incident_id=$2 LIMIT 1",
        [noteId,Number(row.incident_id)]
      );
      const note=notes[0];
      if(note){
        const prefix=note.customer_visible===false?"[Note interne PGI] ":"";
        const externalNoteId=await createNote(config,{
          body:prefix+clean(note.body,4800),
          occurredAt:note.created_at,
          ownerId
        });
        await associate(config,"note",externalNoteId,"ticket",ticketId);
        if(row.contact_id)await associate(config,"note",externalNoteId,"contact",String(row.contact_id));
        await persistIncidentLink(store,row,{ticketId,status,severity});
        return {externalObjectType:"note",externalObjectId:externalNoteId};
      }
    }
  }

  await persistIncidentLink(store,row,{ticketId,status,severity});
  return {externalObjectType:"ticket",externalObjectId:ticketId};
}

async function createTicket(config,{subject,content,status,severity,ownerId}){
  const props={
    subject:clean(subject,240),
    content:clean(content,5000),
    hs_pipeline:"0",
    hs_pipeline_stage:ticketStage(status),
    hs_ticket_priority:ticketPriority(severity)
  };
  if(ownerId)props.hubspot_owner_id=String(ownerId);
  const created=await hs(config,"/crm/v3/objects/tickets",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_TICKET_CREATE_FAILED");
  return String(created.id);
}

async function updateTicket(config,id,{status,severity}={}){
  const props={};
  if(status)props.hs_pipeline_stage=ticketStage(status);
  if(severity)props.hs_ticket_priority=ticketPriority(severity);
  if(!Object.keys(props).length)return;
  await hs(config,"/crm/v3/objects/tickets/"+encodeURIComponent(id),{method:"PATCH",body:{properties:props}});
}

async function createNote(config,{body,occurredAt,ownerId}){
  const at=Date.parse(String(occurredAt||""));
  const props={
    hs_note_body:clean(body,5000),
    hs_timestamp:String(Number.isFinite(at)?at:Date.now())
  };
  if(ownerId)props.hubspot_owner_id=String(ownerId);
  const created=await hs(config,"/crm/v3/objects/notes",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_NOTE_CREATE_FAILED");
  return String(created.id);
}

async function persistIncidentLink(store,row,{ticketId,status,severity}){
  await store.sql.unsafe(
    "INSERT INTO crm_incident_links(incident_id,tenant_id,provider,ticket_id,contact_id,company_id,deal_id,last_status,last_priority,last_synced_at,last_error_code,updated_at) "+
    "VALUES($1,$2,'hubspot',$3,$4,$5,$6,$7,$8,now(),NULL,now()) "+
    "ON CONFLICT(incident_id) DO UPDATE SET ticket_id=EXCLUDED.ticket_id,contact_id=COALESCE(EXCLUDED.contact_id,crm_incident_links.contact_id),company_id=COALESCE(EXCLUDED.company_id,crm_incident_links.company_id),deal_id=COALESCE(EXCLUDED.deal_id,crm_incident_links.deal_id),last_status=EXCLUDED.last_status,last_priority=EXCLUDED.last_priority,last_synced_at=now(),last_error_code=NULL,updated_at=now()",
    [Number(row.incident_id),Number(row.tenant_id),String(ticketId),row.contact_id||null,row.company_id||null,row.deal_id||null,clean(status,40),ticketPriority(severity)]
  );
}

function ticketStage(status){
  const s=String(status||"").toLowerCase();
  if(["resolved","closed"].includes(s))return "4";
  if(s==="waiting_customer")return "2";
  if(["investigating","monitoring","active"].includes(s))return "3";
  return "1";
}

function ticketPriority(severity){
  const s=String(severity||"").toLowerCase();
  if(s==="critical")return "URGENT";
  if(s==="high")return "HIGH";
  if(s==="low")return "LOW";
  return "MEDIUM";
}

function stageForEvent(config,eventType,payload,tenantStatus){
  if(eventType==="customer.self_registered")return {stageId:config.hubspotStageNew||"appointmentscheduled",label:"new_request",lifecycleStage:"lead",leadStatus:"NEW"};
  if(eventType==="portability.requested")return {stageId:config.hubspotStageQualified||"qualifiedtobuy",label:"qualified",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
  if(eventType==="tenant.status"){
    const status=String(payload.status||tenantStatus||"");
    if(status==="active")return {stageId:config.hubspotStageQualified||"qualifiedtobuy",label:"validated",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
    if(status==="suspended")return {stageId:config.hubspotStageReady||"contractsent",label:"account_attention",lifecycleStage:"opportunity",leadStatus:"IN_PROGRESS"};
    if(["closed","rejected"].includes(status))return {stageId:config.hubspotStageLost||"closedlost",label:"lost",leadStatus:"UNQUALIFIED"};
  }
  if(eventType==="subscription.changed"){
    const providerEvent=String(payload.event_type||"");
    const status=String(payload.status||"");
    if(providerEvent==="invoice.paid"||status==="active")return {stageId:config.hubspotStageActive||"closedwon",label:"customer_active",lifecycleStage:"customer",leadStatus:"OPEN_DEAL",customer:true};
    if(providerEvent==="customer.subscription.deleted"||["cancelled","ended"].includes(status))return {stageId:config.hubspotStageLost||"closedlost",label:"subscription_ended",lifecycleStage:"customer"};
    if(providerEvent==="invoice.payment_failed"||providerEvent==="invoice.payment_action_required"||status==="past_due")return {stageId:config.hubspotStageReady||"contractsent",label:"payment_attention",lifecycleStage:"opportunity",leadStatus:"IN_PROGRESS"};
    if(providerEvent==="customer.subscription.created")return {stageId:config.hubspotStageReady||"contractsent",label:"subscription_created",lifecycleStage:"opportunity",leadStatus:"OPEN_DEAL"};
  }
  return {stageId:null,label:"observed",lifecycleStage:null,leadStatus:null};
}

function taskForEvent(config,row,payload,acquisition){
  const createdAt=Date.parse(row.created_at)||Date.now();
  const serviceIntent=labelServiceIntent(payload.service_intent);
  const sourceLabel=clean([acquisition.utm_source,acquisition.utm_medium].filter(Boolean).join(" / "),120);
  const campaign=clean(acquisition.utm_campaign,120);
  const common=[
    "Compte : "+clean(row.tenant_name,180),
    "Pays : "+clean(row.country_code,8),
    payload.account_type?"Profil : "+clean(payload.account_type,40):"",
    serviceIntent?"Besoin : "+serviceIntent:"",
    sourceLabel?"Source : "+sourceLabel:"",
    campaign?"Campagne : "+campaign:""
  ].filter(Boolean).join("\n");
  if(row.event_type==="customer.self_registered")return {
    subject:"Qualifier la nouvelle demande Audiotel",
    body:common||"Nouvelle demande Audiotel Premium Pro.",
    priority:"HIGH",dueAt:new Date(createdAt+24*3600000).toISOString()
  };
  if(row.event_type==="portability.requested")return {
    subject:"Suivre la demande de portabilité",
    body:common||"Nouvelle demande de portabilité.",
    priority:"HIGH",dueAt:new Date(createdAt+4*3600000).toISOString()
  };
  if(row.event_type==="tenant.status"&&String(payload.status||row.tenant_status)==="suspended")return {
    subject:"Examiner le compte suspendu",
    body:common||"Compte client suspendu.",
    priority:"HIGH",dueAt:new Date(createdAt+2*3600000).toISOString()
  };
  if(row.event_type==="subscription.changed"){
    const type=String(payload.event_type||""),status=String(payload.status||"");
    if(type==="invoice.payment_failed"||type==="invoice.payment_action_required"||status==="past_due")return {
      subject:"Traiter le paiement à régulariser",
      body:common||"Paiement d'abonnement à régulariser.",
      priority:"HIGH",dueAt:new Date(createdAt+2*3600000).toISOString()
    };
    if(type==="customer.subscription.created")return {
      subject:"Vérifier l'activation du nouvel abonnement",
      body:common||"Nouvel abonnement enregistré.",
      priority:"MEDIUM",dueAt:new Date(createdAt+24*3600000).toISOString()
    };
    if(type==="customer.subscription.deleted"||["cancelled","ended"].includes(status))return {
      subject:"Examiner la fin d'abonnement",
      body:common||"Fin d'abonnement enregistrée.",
      priority:"MEDIUM",dueAt:new Date(createdAt+24*3600000).toISOString()
    };
  }
  return null;
}

function hubspotSource(acquisition={}){
  const medium=String(acquisition.utm_medium||"").toLowerCase();
  const source=String(acquisition.utm_source||"").toLowerCase();
  const ref=String(acquisition.referrer_host||"").toLowerCase();
  if(/chatgpt|perplexity|gemini|claude|copilot/.test(ref+" "+source))return "AI_REFERRALS";
  if(/cpc|ppc|paidsearch|paid_search/.test(medium))return "PAID_SEARCH";
  if(/paid_social|paidsocial/.test(medium))return "PAID_SOCIAL";
  if(/social/.test(medium)||/facebook|instagram|linkedin|tiktok|reddit|x\.com|twitter/.test(source))return "SOCIAL_MEDIA";
  if(/email|newsletter/.test(medium))return "EMAIL_MARKETING";
  if(/organic/.test(medium))return "ORGANIC_SEARCH";
  if(/referral/.test(medium)||ref)return "REFERRALS";
  if(source||medium)return "OTHER_CAMPAIGNS";
  return "DIRECT_TRAFFIC";
}

async function upsertContact(config,input){
  const found=await hs(config,"/crm/v3/objects/contacts/search",{
    method:"POST",
    body:{filterGroups:[{filters:[{propertyName:"email",operator:"EQ",value:input.email}]}],properties:["email"],limit:1}
  });
  const existing=found?.results?.[0];
  if(existing?.id){
    await updateContact(config,String(existing.id),{...input,source:null});
    return String(existing.id);
  }
  const created=await hs(config,"/crm/v3/objects/contacts",{method:"POST",body:{properties:contactProperties(input)}});
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
  if(input.ownerId)props.hubspot_owner_id=String(input.ownerId);
  if(input.source)props.hs_analytics_source=String(input.source);
  return props;
}

async function createCompany(config,{name,country,phone,ownerId}){
  const props={name:clean(name,200)};
  if(country)props.country=clean(country,80);
  if(phone)props.phone=clean(phone,40);
  if(ownerId)props.hubspot_owner_id=String(ownerId);
  const created=await hs(config,"/crm/v3/objects/companies",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_COMPANY_CREATE_FAILED");
  return String(created.id);
}

async function createDeal(config,{name,pipelineId,stageId,ownerId}){
  const props={dealname:clean(name,240),pipeline:String(pipelineId||"default"),dealstage:String(stageId||"appointmentscheduled")};
  if(ownerId)props.hubspot_owner_id=String(ownerId);
  const created=await hs(config,"/crm/v3/objects/deals",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_DEAL_CREATE_FAILED");
  return String(created.id);
}

async function updateDeal(config,id,{stageId,amount}={}){
  const props={};
  if(stageId)props.dealstage=String(stageId);
  if(amount!=null)props.amount=String(amount);
  if(!Object.keys(props).length)return;
  await hs(config,"/crm/v3/objects/deals/"+encodeURIComponent(id),{method:"PATCH",body:{properties:props}});
}

async function createTask(config,{subject,body,priority,dueAt,ownerId}){
  const due=Date.parse(dueAt);
  const props={
    hs_task_subject:clean(subject,240),
    hs_task_body:clean(body,5000),
    hs_task_status:"NOT_STARTED",
    hs_task_priority:["NONE","LOW","MEDIUM","HIGH"].includes(String(priority))?String(priority):"MEDIUM",
    hs_timestamp:String(Number.isFinite(due)?due:Date.now()+24*3600000)
  };
  if(ownerId)props.hubspot_owner_id=String(ownerId);
  const created=await hs(config,"/crm/v3/objects/tasks",{method:"POST",body:{properties:props}});
  if(!created?.id)throw failure("HUBSPOT_TASK_CREATE_FAILED");
  return String(created.id);
}

async function associate(config,fromType,fromId,toType,toId){
  if(!fromId||!toId)return;
  await hs(config,"/crm/v4/objects/"+encodeURIComponent(fromType)+"/"+encodeURIComponent(fromId)+"/associations/default/"+encodeURIComponent(toType)+"/"+encodeURIComponent(toId),{method:"PUT",body:null});
}

async function persistLink(store,tenantId,{contactId=null,companyId=null,dealId=null,pipelineId=null}={}){
  await store.sql.unsafe(
    "INSERT INTO crm_external_links(tenant_id,provider,contact_id,company_id,deal_id,pipeline_id,updated_at) VALUES($1,'hubspot',$2,$3,$4,$5,now()) "+
    "ON CONFLICT(tenant_id) DO UPDATE SET contact_id=COALESCE(EXCLUDED.contact_id,crm_external_links.contact_id),company_id=COALESCE(EXCLUDED.company_id,crm_external_links.company_id),deal_id=COALESCE(EXCLUDED.deal_id,crm_external_links.deal_id),pipeline_id=COALESCE(EXCLUDED.pipeline_id,crm_external_links.pipeline_id),updated_at=now()",
    [Number(tenantId),contactId||null,companyId||null,dealId||null,pipelineId||null]
  );
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
    const payload=response.status===204?{}:await response.json().catch(()=>({}));
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

async function receipt(store,outboxId,state,errorCode,externalObjectType=null,externalObjectId=null){
  await store.sql.unsafe(
    "INSERT INTO crm_sync_receipts(outbox_event_id,provider,state,attempts,last_error_code,external_object_type,external_object_id,processed_at,updated_at) "+
    "VALUES($1,'hubspot',$2,1,$3,$4,$5,CASE WHEN $2='synced' THEN now() ELSE NULL END,now()) "+
    "ON CONFLICT(outbox_event_id) DO UPDATE SET state=EXCLUDED.state,attempts=crm_sync_receipts.attempts+1,last_error_code=EXCLUDED.last_error_code,external_object_type=COALESCE(EXCLUDED.external_object_type,crm_sync_receipts.external_object_type),external_object_id=COALESCE(EXCLUDED.external_object_id,crm_sync_receipts.external_object_id),processed_at=CASE WHEN EXCLUDED.state='synced' THEN now() ELSE crm_sync_receipts.processed_at END,updated_at=now()",
    [Number(outboxId),state,errorCode||null,externalObjectType||null,externalObjectId||null]
  );
}

function labelServiceIntent(value){
  return ({new_number:"Nouveau numéro",portability:"Portabilité",advice:"Orientation"})[String(value||"")]||clean(value,80);
}
function clean(value,max=200){return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);}
function safeCode(error){return clean(error?.code||error?.message||"HUBSPOT_SYNC_FAILED",120).replace(/[^A-Za-z0-9_.:-]/g,"_");}
function failure(code){const e=new Error(code);e.code=code;return e;}

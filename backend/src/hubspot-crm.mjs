const HUBSPOT_PORTAL_ID="149417663";
const HUBSPOT_FORM_ID="436e33ad-e5e7-4e7c-b024-f211293ad9bd";
const HUBSPOT_OWNER_ID="99851906";
const HUBSPOT_FORM_ENDPOINT="https://api.hsforms.com/submissions/v3/integration/submit/"+HUBSPOT_PORTAL_ID+"/"+HUBSPOT_FORM_ID;
const HUBSPOT_API_BASE="https://api.hubapi.com";
const HUBSPOT_PIPELINE_ID="default";
const HUBSPOT_STAGE_BY_STATUS=Object.freeze({
  "Nouveau prospect":"appointmentscheduled",
  "Qualification":"qualifiedtobuy",
  "Informations envoyées":"presentationscheduled",
  "Rendez-vous / échange":"decisionmakerboughtin",
  "Dossier en préparation":"contractsent",
  "En attente d’ouverture":"6144336106",
  "Client actif":"closedwon",
  "Perdu / non abouti":"closedlost"
});
const HUBSPOT_STATUS_ORDER=Object.freeze(Object.keys(HUBSPOT_STAGE_BY_STATUS));
const PROCESSING_NOTICE="J’accepte que PGI Telecom – Audiotel Premium Pro stocke et traite les informations transmises afin de répondre à ma demande et préparer, le cas échéant, l’ouverture de mon service.";

const INTENT_LABELS=Object.freeze({
  new_number:{hubspot:"Nouveau numéro",label:"Nouveau numéro Audiotel"},
  portability:{hubspot:"Portabilité d’un numéro existant",label:"Portabilité d’un numéro existant"},
  advice:{hubspot:"Informations commerciales",label:"Informations et conseil"}
});

function clean(value,max=255){
  return String(value==null?"":value).trim().slice(0,max);
}
function email(value){
  const normalized=clean(value,254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw problem("HUBSPOT_EMAIL_INVALID");
  return normalized;
}
function field(fields,name,value){
  const v=clean(value,1000);
  if(v)fields.push({objectTypeId:"0-1",name,value:v});
}

export function buildHubSpotLeadSubmission(input={},options={}){
  const consent=input.processing_consent===true||input.privacy_notice_acknowledged===true;
  if(!consent)throw problem("HUBSPOT_PROCESSING_CONSENT_REQUIRED");

  const accountType=String(input.account_type||"").toLowerCase();
  if(!["individual","business"].includes(accountType))throw problem("HUBSPOT_ACCOUNT_TYPE_INVALID");
  const intentKey=String(input.service_intent||"advice").toLowerCase();
  const intent=INTENT_LABELS[intentKey]||INTENT_LABELS.advice;
  const firstName=clean(input.first_name,80),lastName=clean(input.last_name,80);
  if(!firstName||!lastName)throw problem("HUBSPOT_NAME_REQUIRED");

  const fields=[];
  field(fields,"email",email(input.email));
  field(fields,"firstname",firstName);
  field(fields,"lastname",lastName);
  field(fields,"phone",clean(input.phone,80));
  if(accountType==="business")field(fields,"company",clean(input.company_name,160));
  field(fields,"type_de_client",accountType==="business"?"Professionnel":"Particulier");
  field(fields,"type_de_demande",intent.hubspot);
  field(fields,"besoin__projet_audiotel",intent.label);
  field(fields,"lifecyclestage","lead");
  if(options.enrich!==false){
    field(fields,"statut_commercial_pgi","Nouveau prospect");
    field(fields,"hubspot_owner_id",HUBSPOT_OWNER_ID);
  }

  const pageUri=clean(options.pageUri||input.page_uri,500)||"https://audiotel-premium-pro.com/demande-ouverture/";
  const pageName=clean(options.pageName||input.page_name,180)||"Demande d’ouverture Audiotel Premium Pro";
  const context={pageUri,pageName};
  const hutk=clean(options.hutk||input.hutk,96);
  if(hutk)context.hutk=hutk;
  return {
    submittedAt:Date.now(),
    fields,
    context,
    legalConsentOptions:{consent:{consentToProcess:true,text:PROCESSING_NOTICE}}
  };
}

export async function submitHubSpotLead(input={},options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=="function")throw problem("HUBSPOT_FETCH_UNAVAILABLE");
  let payload=buildHubSpotLeadSubmission(input,options);
  const fallbackPayload=options.enrich===false?null:buildHubSpotLeadSubmission(input,{...options,enrich:false});
  const timeoutMs=Math.max(750,Math.min(5000,Number(options.timeoutMs)||2500));
  const attempts=Math.max(fallbackPayload?2:1,Math.min(2,Number(options.attempts)||2));
  let lastError=null,enrichmentFallbackUsed=false;

  for(let attempt=1;attempt<=attempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(HUBSPOT_FORM_ENDPOINT,{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify(payload),
        signal:controller.signal
      });
      const responseText=await response.text().catch(()=>"");
      if(response.ok)return {ok:true,status:response.status,enriched:!enrichmentFallbackUsed};
      const optionalFieldRejected=response.status===400&&fallbackPayload&&!enrichmentFallbackUsed&&responseText.includes("FIELD_NOT_IN_FORM_DEFINITION")&&(responseText.includes("statut_commercial_pgi")||responseText.includes("hubspot_owner_id"));
      if(optionalFieldRejected){payload=fallbackPayload;enrichmentFallbackUsed=true;lastError=null;continue;}
      const error=problem("HUBSPOT_SUBMISSION_REJECTED");
      error.status=response.status;
      error.detail=responseText.slice(0,600);
      lastError=error;
      if(!(response.status===429||response.status>=500)||attempt===attempts)throw error;
    }catch(error){
      lastError=error;
      const retryable=error?.name==="AbortError"||error?.code==="HUBSPOT_SUBMISSION_REJECTED"&&(error.status===429||error.status>=500);
      if(!retryable||attempt===attempts)throw normalizeError(error);
    }finally{
      clearTimeout(timer);
    }
    await new Promise(resolve=>setTimeout(resolve,150*attempt));
  }
  throw normalizeError(lastError||problem("HUBSPOT_SUBMISSION_FAILED"));
}

export async function syncHubSpotCommercialLead(input={},options={}){
  const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
  if(!token)return {enabled:false,synced:false,contactId:null,dealId:null,dealCreated:false};
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=="function")throw problem("HUBSPOT_FETCH_UNAVAILABLE");
  const payload=buildHubSpotLeadSubmission(input,{...options,enrich:true});
  const baseProps=Object.fromEntries(payload.fields.map(x=>[x.name,x.value]));
  const contactEmail=baseProps.email;
  const requestedStatus=HUBSPOT_STAGE_BY_STATUS[options.commercialStatus]?options.commercialStatus:"Nouveau prospect";
  let contact=await findPrivateContact(contactEmail,{token,fetchImpl});
  if(contact){
    const current=contact.properties||{};
    const effectiveStatus=advanceCommercialStatus(current.statut_commercial_pgi,requestedStatus);
    const update={
      firstname:baseProps.firstname,
      lastname:baseProps.lastname,
      phone:baseProps.phone,
      company:baseProps.company,
      type_de_client:baseProps.type_de_client,
      type_de_demande:baseProps.type_de_demande,
      besoin__projet_audiotel:baseProps.besoin__projet_audiotel
    };
    if(!current.hubspot_owner_id)update.hubspot_owner_id=HUBSPOT_OWNER_ID;
    if(!current.lifecyclestage)update.lifecyclestage="lead";
    if(effectiveStatus&&effectiveStatus!==current.statut_commercial_pgi)update.statut_commercial_pgi=effectiveStatus;
    contact=await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contact.id),{
      token,fetchImpl,method:"PATCH",body:{properties:compactProperties(update)}
    });
  }else{
    const createProps=compactProperties({...baseProps,statut_commercial_pgi:requestedStatus,hubspot_owner_id:HUBSPOT_OWNER_ID,lifecyclestage:"lead"});
    try{
      contact=await hubSpotPrivateRequest("/crm/v3/objects/contacts",{
        token,fetchImpl,method:"POST",body:{properties:createProps}
      });
    }catch(error){
      if(error?.status!==409)throw error;
      contact=await findPrivateContact(contactEmail,{token,fetchImpl});
      if(!contact)throw error;
    }
  }
  const effectiveStatus=advanceCommercialStatus(contact?.properties?.statut_commercial_pgi,requestedStatus)||requestedStatus;
  const deal=await ensureCommercialDeal(contact,input,{token,fetchImpl,status:effectiveStatus});
  return {enabled:true,synced:true,contactId:String(contact.id),dealId:deal?.id?String(deal.id):null,dealCreated:Boolean(deal?.created)};
}

async function findPrivateContact(contactEmail,{token,fetchImpl}){
  const result=await hubSpotPrivateRequest("/crm/v3/objects/contacts/search",{
    token,fetchImpl,method:"POST",body:{
      filterGroups:[{filters:[{propertyName:"email",operator:"EQ",value:contactEmail}]}],
      properties:["email","firstname","lastname","phone","company","type_de_client","type_de_demande","besoin__projet_audiotel","statut_commercial_pgi","lifecyclestage","hubspot_owner_id"],
      limit:1
    }
  });
  return result?.results?.[0]||null;
}

async function ensureCommercialDeal(contact,input,{token,fetchImpl,status}){
  const intentKey=String(input.service_intent||"advice").toLowerCase();
  if(!["new_number","portability","advice"].includes(intentKey))return null;
  if(["Client actif","Perdu / non abouti"].includes(status))return null;
  const detail=await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contact.id)+"?associations=deals&properties=email",{
    token,fetchImpl,method:"GET"
  });
  const dealIds=(detail?.associations?.deals?.results||[]).map(x=>String(x.id)).slice(0,20);
  let openDeal=null;
  for(const id of dealIds){
    const candidate=await hubSpotPrivateRequest("/crm/v3/objects/deals/"+encodeURIComponent(id)+"?properties=pipeline,dealstage,dealname,hubspot_owner_id,deal_currency_code",{
      token,fetchImpl,method:"GET"
    });
    const p=candidate?.properties||{};
    if(p.pipeline===HUBSPOT_PIPELINE_ID&&!["closedwon","closedlost"].includes(p.dealstage)){openDeal=candidate;break;}
  }
  const targetStage=HUBSPOT_STAGE_BY_STATUS[status]||HUBSPOT_STAGE_BY_STATUS["Nouveau prospect"];
  if(openDeal){
    const current=openDeal.properties||{};
    const changes={};
    if(current.dealstage!==targetStage)changes.dealstage=targetStage;
    if(!current.hubspot_owner_id)changes.hubspot_owner_id=HUBSPOT_OWNER_ID;
    if(!current.deal_currency_code)changes.deal_currency_code="EUR";
    if(Object.keys(changes).length){
      openDeal=await hubSpotPrivateRequest("/crm/v3/objects/deals/"+encodeURIComponent(openDeal.id),{
        token,fetchImpl,method:"PATCH",body:{properties:changes}
      });
    }
    return {...openDeal,created:false};
  }
  const associationTypeId=await defaultDealContactAssociationType({token,fetchImpl});
  const label=INTENT_LABELS[intentKey]||INTENT_LABELS.advice;
  const name=clean(input.company_name,120)||[clean(input.first_name,60),clean(input.last_name,60)].filter(Boolean).join(" ")||"Prospect Audiotel";
  const created=await hubSpotPrivateRequest("/crm/v3/objects/deals",{
    token,fetchImpl,method:"POST",body:{
      properties:{
        dealname:clean(name+" — "+label.label,200),
        pipeline:HUBSPOT_PIPELINE_ID,
        dealstage:targetStage,
        hubspot_owner_id:HUBSPOT_OWNER_ID,
        deal_currency_code:"EUR"
      },
      associations:[{to:{id:String(contact.id)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]
    }
  });
  return {...created,created:true};
}

async function defaultDealContactAssociationType({token,fetchImpl}){
  try{
    const labels=await hubSpotPrivateRequest("/crm/v4/associations/deals/contacts/labels",{token,fetchImpl,method:"GET"});
    const match=(labels?.results||[]).find(x=>x.category==="HUBSPOT_DEFINED"&&(x.label==null||x.label===""));
    const id=Number(match?.typeId);
    if(Number.isInteger(id)&&id>0)return id;
  }catch(_error){}
  return 3;
}

async function hubSpotPrivateRequest(path,{token,fetchImpl,method="GET",body=null,timeoutMs=3500}){
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(750,Math.min(6000,Number(timeoutMs)||3500)));
    try{
      const response=await fetchImpl(HUBSPOT_API_BASE+path,{
        method,
        headers:{Authorization:"Bearer "+token,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
        signal:controller.signal
      });
      const text=await response.text().catch(()=>"");
      let data={};try{data=text?JSON.parse(text):{};}catch{data={raw:text.slice(0,600)};}
      if(response.ok)return data;
      const error=problem("HUBSPOT_PRIVATE_API_REJECTED");error.status=response.status;error.detail=text.slice(0,600);lastError=error;
      if(!(response.status===429||response.status>=500)||attempt===2)throw error;
    }catch(error){
      lastError=error;
      const retryable=error?.name==="AbortError"||error?.code==="HUBSPOT_PRIVATE_API_REJECTED"&&(error.status===429||error.status>=500);
      if(!retryable||attempt===2)throw normalizeError(error);
    }finally{clearTimeout(timer);}
    await new Promise(resolve=>setTimeout(resolve,150*attempt));
  }
  throw normalizeError(lastError||problem("HUBSPOT_PRIVATE_API_FAILED"));
}

function advanceCommercialStatus(current,target){
  const currentIndex=HUBSPOT_STATUS_ORDER.indexOf(String(current||""));
  const targetIndex=HUBSPOT_STATUS_ORDER.indexOf(String(target||""));
  if(targetIndex<0)return currentIndex>=0?HUBSPOT_STATUS_ORDER[currentIndex]:"";
  if(currentIndex<0)return HUBSPOT_STATUS_ORDER[targetIndex];
  if(["Client actif","Perdu / non abouti"].includes(HUBSPOT_STATUS_ORDER[currentIndex]))return HUBSPOT_STATUS_ORDER[currentIndex];
  return HUBSPOT_STATUS_ORDER[Math.max(currentIndex,targetIndex)];
}

function compactProperties(input={}){
  return Object.fromEntries(Object.entries(input).filter(([,value])=>String(value==null?"":value).trim()!==""));
}

export const HUBSPOT_LEAD_FORM=Object.freeze({portalId:HUBSPOT_PORTAL_ID,formId:HUBSPOT_FORM_ID,ownerId:HUBSPOT_OWNER_ID,pipelineId:HUBSPOT_PIPELINE_ID});

function normalizeError(error){
  if(error?.code)return error;
  const e=problem(error?.name==="AbortError"?"HUBSPOT_SUBMISSION_TIMEOUT":"HUBSPOT_SUBMISSION_FAILED");
  e.cause=error;
  return e;
}
function problem(code){
  const error=new Error(code);
  error.code=code;
  return error;
}

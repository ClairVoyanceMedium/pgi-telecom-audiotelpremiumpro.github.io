const HUBSPOT_PORTAL_ID="149417663";
const HUBSPOT_FORM_ID="436e33ad-e5e7-4e7c-b024-f211293ad9bd";
const HUBSPOT_OWNER_ID="99851906";
const HUBSPOT_FORM_ENDPOINT="https://api.hsforms.com/submissions/v3/integration/submit/"+HUBSPOT_PORTAL_ID+"/"+HUBSPOT_FORM_ID;
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

export const HUBSPOT_LEAD_FORM=Object.freeze({portalId:HUBSPOT_PORTAL_ID,formId:HUBSPOT_FORM_ID});

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

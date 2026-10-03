const HUBSPOT_PORTAL_ID="149417663";
const HUBSPOT_FORM_ID="436e33ad-e5e7-4e7c-b024-f211293ad9bd";
const HUBSPOT_OWNER_ID="99851906";
const HUBSPOT_FORM_ENDPOINT="https://api.hsforms.com/submissions/v3/integration/submit/"+HUBSPOT_PORTAL_ID+"/"+HUBSPOT_FORM_ID;
const HUBSPOT_API_BASE="https://api.hubapi.com";
const HUBSPOT_PIPELINE_ID="default";
const HUBSPOT_MARKETING_SUBSCRIPTION_ID=3728444113;
const MARKETING_CONSENT_VERSION="2026-10-01-v1";
const MARKETING_CONSENT_TEXT="J’accepte de recevoir par e-mail les actualités, offres et informations commerciales d’Audiotel Premium Pro. Je peux me désinscrire à tout moment.";
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

const HUBSPOT_CARD_PAYMENT_PROPERTIES=Object.freeze([
  {name:"pgi_paiement_cb_active",label:"Paiement CB activé",type:"enumeration",fieldType:"select",description:"Indique si le service Paiement CB Stripe Connect est actif pour ce client.",options:[{label:"Oui",value:"true",displayOrder:0,hidden:false},{label:"Non",value:"false",displayOrder:1,hidden:false}]},
  {name:"pgi_stripe_connect_status",label:"Statut Stripe Connect",type:"enumeration",fieldType:"select",description:"État opérationnel du compte Stripe Connect lié au service Paiement CB.",options:["pending","onboarding","restricted","active","disabled"].map((value,displayOrder)=>({label:({pending:"En attente",onboarding:"Activation en cours",restricted:"Restreint",active:"Actif",disabled:"Désactivé"})[value],value,displayOrder,hidden:false}))},
  {name:"pgi_commission_cb_pourcent",label:"Commission PGI Telecom CB (%)",type:"number",fieldType:"number",description:"Taux de commission de plateforme PGI Telecom appliqué aux paiements CB."},
  {name:"pgi_stripe_connect_account_ref",label:"Référence Stripe Connect",type:"string",fieldType:"text",description:"Identifiant technique du compte Stripe Connect associé au client."},
  {name:"pgi_paiements_cb_payes",label:"Paiements CB payés",type:"number",fieldType:"number",description:"Nombre de paiements CB confirmés comme payés."},
  {name:"pgi_volume_cb_eur",label:"Volume CB encaissé (EUR)",type:"number",fieldType:"number",description:"Volume cumulé des paiements CB payés, exprimé en euros."},
  {name:"pgi_commission_cb_cumulee_eur",label:"Commission PGI Telecom CB cumulée (EUR)",type:"number",fieldType:"number",description:"Commission PGI Telecom cumulée sur les paiements CB payés, exprimée en euros."}
]);
let hubSpotCardPaymentSchemaPromise=null;

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


export async function ensureHubSpotCardPaymentSchema(options={}){
  if(options.force!==true&&hubSpotCardPaymentSchemaPromise)return hubSpotCardPaymentSchemaPromise;
  const run=async()=>{
    const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
    if(!token)return {enabled:false,ready:false,created:0,existing:0,errors:["hubspot_not_configured"]};
    const fetchImpl=options.fetchImpl||globalThis.fetch;
    const targets=[["contacts","contactinformation"],["deals","dealinformation"]];
    let created=0,existing=0;const errors=[];
    for(const [objectType,groupName] of targets){
      for(const definition of HUBSPOT_CARD_PAYMENT_PROPERTIES){
        try{
          await hubSpotPrivateRequest("/crm/v3/properties/"+objectType+"/"+encodeURIComponent(definition.name),{token,fetchImpl,method:"GET",timeoutMs:4500});
          existing++;
          continue;
        }catch(error){
          if(Number(error?.status)!==404){errors.push(objectType+":"+definition.name+":status="+String(error?.status||"na")+":"+clean(error?.detail||error?.code||"read_failed",180));continue;}
        }
        try{
          await hubSpotPrivateRequest("/crm/v3/properties/"+objectType,{
            token,fetchImpl,method:"POST",timeoutMs:4500,
            body:{groupName,name:definition.name,label:definition.label,type:definition.type,fieldType:definition.fieldType,description:definition.description,options:definition.options||[]}
          });
          created++;
        }catch(error){
          if(Number(error?.status)===409)existing++;
          else errors.push(objectType+":"+definition.name+":status="+String(error?.status||"na")+":"+clean(error?.detail||error?.code||"create_failed",180));
        }
      }
    }
    const result={enabled:true,ready:errors.length===0,created,existing,errors};
    if(result.ready)console.info(JSON.stringify({event:"hubspot_card_payment_schema",ready:true,created,existing}));
    else console.warn(JSON.stringify({event:"hubspot_card_payment_schema",ready:false,created,existing,errors}));
    return result;
  };
  const promise=run();
  if(options.force!==true)hubSpotCardPaymentSchemaPromise=promise;
  return promise;
}

export async function syncHubSpotCardPaymentState(store,tenantId,input={},options={}){
  const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
  if(!token)return {enabled:false,synced:false,skipped:true,reason:"hubspot_not_configured"};
  const numericTenantId=Number(tenantId);
  if(!Number.isInteger(numericTenantId)||numericTenantId<=0)return {enabled:true,synced:false,skipped:true,reason:"invalid_tenant_id"};
  if(!store||typeof store.tenantPublicIdByInternalId!=="function"||typeof store.customerCardPaymentOverview!=="function"||typeof store.tenantControlDetail!=="function"){
    return {enabled:true,synced:false,skipped:true,reason:"card_payment_crm_context_unavailable"};
  }
  const tenantPublicId=await store.tenantPublicIdByInternalId(numericTenantId);
  if(!tenantPublicId)return {enabled:true,synced:false,skipped:true,reason:"tenant_not_found"};
  const detail=await store.tenantControlDetail(tenantPublicId);
  const users=Array.isArray(detail?.users)?detail.users:[];
  const owner=users.find(x=>x.role==="owner"&&x.membership_status==="active")||users.find(x=>x.role==="owner")||users[0]||null;
  const ownerEmail=clean(owner?.email,254);
  if(!ownerEmail)return {enabled:true,synced:false,skipped:true,reason:"tenant_owner_email_unavailable"};
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const schema=await ensureHubSpotCardPaymentSchema({token,fetchImpl});
  const {contact}=await ensureSupportContact(email(ownerEmail),{token,fetchImpl});
  const overview=await store.customerCardPaymentOverview(numericTenantId);
  const account=input.account||overview.account||null;
  if(!account)return {enabled:true,synced:false,skipped:true,reason:"card_payment_account_unavailable",schema};
  const active=account.status==="active"&&account.charges_enabled===true;
  const feePercent=(Number(account.application_fee_bps||490)/100).toFixed(2);
  const summary=overview.summary||{};
  const props={
    pgi_paiement_cb_active:active?"true":"false",
    pgi_stripe_connect_status:clean(account.status||"pending",40),
    pgi_commission_cb_pourcent:feePercent,
    pgi_stripe_connect_account_ref:clean(account.provider_account_reference,120),
    pgi_paiements_cb_payes:String(Number(summary.payments_paid||0)),
    pgi_volume_cb_eur:(Number(summary.volume_paid_minor||0)/100).toFixed(2),
    pgi_commission_cb_cumulee_eur:(Number(summary.pgi_fee_paid_minor||0)/100).toFixed(2)
  };
  let contactPropertiesSynced=false,dealPropertiesSynced=false,noteRecorded=false;
  if(schema.ready){
    await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contact.id),{token,fetchImpl,method:"PATCH",body:{properties:props}});
    contactPropertiesSynced=true;
    const dealId=await preferredContactDealId(contact.id,{token,fetchImpl});
    if(dealId){
      await hubSpotPrivateRequest("/crm/v3/objects/deals/"+encodeURIComponent(dealId),{token,fetchImpl,method:"PATCH",body:{properties:props}});
      dealPropertiesSynced=true;
    }
  }
  if(options.recordNote===true||!schema.ready){
    try{
      noteRecorded=await createCardPaymentCrmNote(contact,tenantPublicId,props,{token,fetchImpl,eventType:options.eventType||input.event_type||input.status||"sync",schemaReady:schema.ready});
    }catch(_error){}
  }
  return {enabled:true,synced:contactPropertiesSynced||noteRecorded,tenantPublicId,contactId:String(contact.id),contactPropertiesSynced,dealPropertiesSynced,noteRecorded,schema};
}

async function createCardPaymentCrmNote(contact,tenantPublicId,props,{token,fetchImpl,eventType,schemaReady}){
  const contactType=await noteContactAssociationType({token,fetchImpl});
  const dealId=await preferredContactDealId(contact.id,{token,fetchImpl});
  const dealType=dealId?await noteDealAssociationType({token,fetchImpl}):null;
  const body=[
    "<strong>Paiement CB — synchronisation Stripe Connect</strong>",
    "<br><strong>Événement :</strong> "+escapeHubSpotHtml(clean(eventType,120)),
    "<br><strong>Tenant :</strong> "+escapeHubSpotHtml(clean(tenantPublicId,80)),
    "<br><strong>Statut :</strong> "+escapeHubSpotHtml(props.pgi_stripe_connect_status),
    "<br><strong>Service actif :</strong> "+(props.pgi_paiement_cb_active==="true"?"Oui":"Non"),
    "<br><strong>Commission PGI Telecom :</strong> "+escapeHubSpotHtml(props.pgi_commission_cb_pourcent)+" %",
    "<br><strong>Paiements payés :</strong> "+escapeHubSpotHtml(props.pgi_paiements_cb_payes),
    "<br><strong>Volume CB :</strong> "+escapeHubSpotHtml(props.pgi_volume_cb_eur)+" €",
    "<br><strong>Commission cumulée :</strong> "+escapeHubSpotHtml(props.pgi_commission_cb_cumulee_eur)+" €",
    "<br><strong>Propriétés CRM dédiées :</strong> "+(schemaReady?"synchronisées":"indisponibles — note de secours enregistrée")
  ].join("");
  const associations=[{to:{id:String(contact.id)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:contactType}]}];
  if(dealId&&dealType)associations.push({to:{id:String(dealId)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:dealType}]});
  await hubSpotPrivateRequest("/crm/v3/objects/notes",{token,fetchImpl,method:"POST",body:{properties:{hs_timestamp:new Date().toISOString(),hs_note_body:body,hubspot_owner_id:HUBSPOT_OWNER_ID},associations}});
  return true;
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
  let effectiveStatus=requestedStatus;
  if(contact){
    const current=contact.properties||{};
    effectiveStatus=advanceCommercialStatus(current.statut_commercial_pgi,requestedStatus);
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
    const lifecycle=commercialLifecycle(effectiveStatus,current.lifecyclestage);
    if(lifecycle&&lifecycle!==current.lifecyclestage)update.lifecyclestage=lifecycle;
    if(effectiveStatus&&effectiveStatus!==current.statut_commercial_pgi)update.statut_commercial_pgi=effectiveStatus;
    contact=await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contact.id),{
      token,fetchImpl,method:"PATCH",body:{properties:compactProperties(update)}
    });
  }else{
    const createProps=compactProperties({...baseProps,statut_commercial_pgi:requestedStatus,hubspot_owner_id:HUBSPOT_OWNER_ID,lifecyclestage:commercialLifecycle(requestedStatus,"")||"lead"});
    try{
      contact=await hubSpotPrivateRequest("/crm/v3/objects/contacts",{
        token,fetchImpl,method:"POST",body:{properties:createProps}
      });
    }catch(error){
      if(error?.status!==409)throw error;
      contact=await findPrivateContact(contactEmail,{token,fetchImpl});
      if(!contact)throw error;
      effectiveStatus=advanceCommercialStatus(contact.properties?.statut_commercial_pgi,requestedStatus)||requestedStatus;
    }
  }
  const deal=await ensureCommercialDeal(contact,input,{token,fetchImpl,status:effectiveStatus});
  const marketing=await applyHubSpotMarketingConsent(contact,input,{token,fetchImpl,source:clean(input.source,80)||"public_opening_form"});
  return {enabled:true,synced:true,contactId:String(contact.id),dealId:deal?.id?String(deal.id):null,dealCreated:Boolean(deal?.created),...marketing};
}



export async function syncHubSpotSupportMessage(input={},options={}){
  const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
  if(!token)return {enabled:false,synced:false,contactId:null,ticketId:null,contactCreated:false};
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const contactEmail=email(input.email),message=clean(input.message,4000);
  if(message.length<2)throw problem("HUBSPOT_CONTACT_MESSAGE_INVALID");
  const {contact,created:contactCreated}=await ensureSupportContact(contactEmail,{token,fetchImpl});
  const pagePath=clean(input.pagePath||input.page_path||"/",500)||"/",pageTitle=clean(input.pageTitle||input.page_title||"",180),pageContext=supportPageContext(pagePath);
  const ticketSubject=clean("Contact site — "+pageContext,180);
  const ticketContent=["Message reçu depuis la bulle de contact du site Audiotel Premium Pro.","","Page : "+(pageTitle||pageContext),"Catégorie : "+pageContext,"Chemin : "+pagePath,"","Message :",message].join("\n");
  const support=await ensureSupportTicket(contact,{subject:ticketSubject,content:ticketContent,sourceType:"FORM",category:"GENERAL_INQUIRY",priority:"MEDIUM"},{token,fetchImpl});
  const marketing=await applyHubSpotMarketingConsent(contact,input,{token,fetchImpl,source:clean(input.source,80)||"floating_email_widget"});
  return {enabled:true,synced:true,contactId:String(contact.id),ticketId:support.ticketId,contactCreated,ticketCreated:support.created,noteId:support.noteId||null,...marketing};
}


export async function syncHubSpotCommercialTenant(store,tenantPublicId,commercialStatus,options={}){
  if(!store||typeof store.tenantControlDetail!=="function")return {enabled:false,synced:false,skipped:true,reason:"tenant_lookup_unavailable"};
  const detail=await store.tenantControlDetail(String(tenantPublicId||"").trim());
  const users=Array.isArray(detail?.users)?detail.users:[];
  const owner=users.find(x=>x.role==="owner"&&x.membership_status==="active")||users.find(x=>x.role==="owner")||users[0]||null;
  const firstName=clean(owner?.first_name,80),lastName=clean(owner?.last_name,80),contactEmail=clean(owner?.email,254);
  if(!firstName||!lastName||!contactEmail)return {enabled:true,synced:false,skipped:true,reason:"tenant_owner_identity_incomplete"};
  const accountType=String(owner?.account_type||"").trim().toLowerCase()==="business"?"business":"individual";
  const rawIntent=String(owner?.service_intent||"").trim().toLowerCase();
  const serviceIntent=["new_number","portability","advice"].includes(rawIntent)?rawIntent:"advice";
  const input={
    dossier_ref:clean(detail?.tenant?.dossier_ref,40),
    account_type:accountType,
    first_name:firstName,
    last_name:lastName,
    company_name:accountType==="business"?clean(detail?.tenant?.legal_name||detail?.tenant?.display_name,160):"",
    email:contactEmail,
    phone:clean(owner?.phone,80),
    service_intent:serviceIntent,
    processing_consent:true
  };
  return syncHubSpotCommercialLead(input,{...options,commercialStatus});
}



export async function syncHubSpotInboundEmail(store,tenantPublicId,inbound={},options={}){
  const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
  if(!token)return {enabled:false,synced:false,skipped:true,reason:"hubspot_not_configured"};
  if(!store||typeof store.tenantControlDetail!=="function")return {enabled:true,synced:false,skipped:true,reason:"tenant_lookup_unavailable"};
  const fetchImpl=options.fetchImpl||globalThis.fetch,detail=await store.tenantControlDetail(String(tenantPublicId||"").trim());
  const users=Array.isArray(detail?.users)?detail.users:[],owner=users.find(x=>x.role==="owner"&&x.membership_status==="active")||users.find(x=>x.role==="owner")||users[0]||null;
  const ownerEmail=clean(owner?.email,254);let contactEmail=clean(inbound.sender_email,320);
  try{contactEmail=email(contactEmail||ownerEmail);}catch(_error){contactEmail=ownerEmail?email(ownerEmail):"";}
  if(!contactEmail)return {enabled:true,synced:false,skipped:true,reason:"hubspot_contact_email_unavailable"};
  const {contact,created:contactCreated}=await ensureSupportContact(contactEmail,{token,fetchImpl});
  const dossierRef=clean(detail?.tenant?.dossier_ref,40),sender=clean(inbound.sender_email,320)||contactEmail,rawSubject=clean(inbound.subject,300)||"Sans objet",subject=supportSubjectFromInbound(rawSubject),body=clean(inbound.text,4000),routing=options.routing||{};
  const attachmentNames=(Array.isArray(inbound.attachments)?inbound.attachments:[]).map(x=>clean(x,180)).filter(Boolean).slice(0,20);
  const content=["Email entrant de support rattaché automatiquement.",dossierRef?"Référence dossier existante : "+dossierRef:"","Expéditeur : "+sender,"Objet reçu : "+rawSubject,"Méthode de rattachement : "+(clean(routing.resolution_method,80)||"identité vérifiée"),attachmentNames.length?"Pièces jointes : "+attachmentNames.join(", "):"","",body||"(contenu vide)"].filter(Boolean).join("\n");
  const support=await ensureSupportTicket(contact,{subject,content,sourceType:"EMAIL",category:"GENERAL_INQUIRY",priority:"MEDIUM"},{token,fetchImpl});
  return {enabled:true,synced:true,contactId:String(contact.id),contactCreated,ticketId:support.ticketId,ticketCreated:support.created,noteId:support.noteId||null,dossierRef};
}

export async function syncHubSpotCustomerIncident(store,incidentPublicId,event={},options={}){
  const token=clean(options.token||process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN||process.env.HUBSPOT_PRIVATE_APP_TOKEN,800);
  if(!token)return {enabled:false,synced:false,skipped:true,reason:"hubspot_not_configured"};
  if(!store||typeof store.serviceIncidentSupportContext!=="function")return {enabled:true,synced:false,skipped:true,reason:"support_context_unavailable"};
  const fetchImpl=options.fetchImpl||globalThis.fetch,context=await store.serviceIncidentSupportContext(incidentPublicId);
  if(!context?.customer_email)return {enabled:true,synced:false,skipped:true,reason:"customer_email_unavailable"};
  const {contact,created:contactCreated}=await ensureSupportContact(email(context.customer_email),{token,fetchImpl});
  const subject=clean("[Ticket "+String(context.public_id)+"] "+String(context.title||"Support"),180);
  const content=[event.authorType==="staff"?"Réponse Audiotel Premium Pro sur le ticket client.":"Message client depuis l’espace client.",context.dossier_ref?"Dossier commercial existant : "+context.dossier_ref:"","Ticket : "+context.public_id,"Catégorie : "+context.category,"Impact : "+context.severity,"",clean(event.message,5000)||clean(context.description,5000)].filter(Boolean).join("\n");
  const support=await ensureSupportTicket(contact,{subject,content,sourceType:event.authorType==="staff"?"EMAIL":"FORM",category:"GENERAL_INQUIRY",priority:hubSpotTicketPriority(context.severity)},{token,fetchImpl});
  return {enabled:true,synced:true,contactId:String(contact.id),contactCreated,ticketId:support.ticketId,ticketCreated:support.created,noteId:support.noteId||null};
}


async function ensureSupportContact(contactEmail,{token,fetchImpl}){
  let contact=await findPrivateContact(contactEmail,{token,fetchImpl}),created=false;
  if(contact)return {contact,created};
  try{contact=await hubSpotPrivateRequest("/crm/v3/objects/contacts",{token,fetchImpl,method:"POST",body:{properties:{email:contactEmail,hubspot_owner_id:HUBSPOT_OWNER_ID}}});created=true;}
  catch(error){if(error?.status!==409)throw error;contact=await findPrivateContact(contactEmail,{token,fetchImpl});if(!contact)throw error;}
  return {contact,created};
}
async function ensureSupportTicket(contact,input,{token,fetchImpl}){
  const subject=clean(input.subject,180)||"Support Audiotel Premium Pro";
  const detail=await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contact.id)+"?associations=tickets&properties=email",{token,fetchImpl,method:"GET"});
  const ids=(detail?.associations?.tickets?.results||[]).map(x=>String(x.id)).slice(0,40);
  let existing=null;
  for(const id of ids){
    try{
      const ticket=await hubSpotPrivateRequest("/crm/v3/objects/tickets/"+encodeURIComponent(id)+"?properties=subject,hs_pipeline,hs_pipeline_stage,hubspot_owner_id",{token,fetchImpl,method:"GET"}),p=ticket?.properties||{};
      if(p.hs_pipeline==="0"&&String(p.hs_pipeline_stage)!=="4"&&clean(p.subject,180)===subject){existing=ticket;break;}
    }catch(_error){}
  }
  if(existing){const noteId=await createSupportNote(contact.id,existing.id,input.content,{token,fetchImpl});return {ticketId:String(existing.id),created:false,noteId};}
  const associationTypeId=await ticketContactAssociationType({token,fetchImpl});
  const ticket=await hubSpotPrivateRequest("/crm/v3/objects/tickets",{token,fetchImpl,method:"POST",body:{properties:{subject,content:clean(input.content,8000),hs_pipeline:"0",hs_pipeline_stage:"1",hs_ticket_priority:clean(input.priority,20)||"MEDIUM",source_type:clean(input.sourceType,30)||"FORM",hs_ticket_category:clean(input.category,50)||"GENERAL_INQUIRY",hubspot_owner_id:HUBSPOT_OWNER_ID},associations:[{to:{id:String(contact.id)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]}});
  return {ticketId:String(ticket.id),created:true,noteId:null};
}
async function createSupportNote(contactId,ticketId,content,{token,fetchImpl}){
  const contactType=await noteContactAssociationType({token,fetchImpl}),ticketType=await noteTicketAssociationType({token,fetchImpl});
  const note=await hubSpotPrivateRequest("/crm/v3/objects/notes",{token,fetchImpl,method:"POST",body:{properties:{hs_timestamp:new Date().toISOString(),hs_note_body:escapeHubSpotHtml(clean(content,8000)).replace(/\n/g,"<br>"),hubspot_owner_id:HUBSPOT_OWNER_ID},associations:[{to:{id:String(contactId)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:contactType}]},{to:{id:String(ticketId)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:ticketType}]}]}});
  return note?.id?String(note.id):null;
}
async function noteTicketAssociationType({token,fetchImpl}){
  const labels=await hubSpotPrivateRequest("/crm/v4/associations/notes/tickets/labels",{token,fetchImpl,method:"GET"}),match=(labels?.results||[]).find(x=>x.category==="HUBSPOT_DEFINED"&&(x.label==null||x.label==="")),id=Number(match?.typeId);
  if(!Number.isInteger(id)||id<=0)throw problem("HUBSPOT_NOTE_TICKET_ASSOCIATION_UNAVAILABLE");return id;
}
function supportSubjectFromInbound(value){
  const cleanSubject=clean(String(value||"").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i,""),170)||"Sans objet";
  if(/^\[Ticket [0-9a-f-]{36}\]/i.test(cleanSubject))return cleanSubject;
  return clean("Email — "+cleanSubject,180);
}
function hubSpotTicketPriority(severity){return ({critical:"URGENT",high:"HIGH",normal:"MEDIUM",low:"LOW"})[String(severity||"normal")]||"MEDIUM";}

async function applyHubSpotMarketingConsent(contact,input={},options={}){
  if(input.marketing_consent!==true)return {marketingConsentRequested:false,marketingSubscriptionSynced:false,marketingConsentRecorded:false};
  const token=options.token,fetchImpl=options.fetchImpl||globalThis.fetch;
  const contactEmail=email(input.email);
  const consentAt=new Date().toISOString();
  const version=clean(input.marketing_consent_version,80)||MARKETING_CONSENT_VERSION;
  const source=clean(options.source||input.source,80)||"unknown";
  const explanation="Consentement explicite recueilli sur Audiotel Premium Pro ; source="+source+" ; version="+version+" ; date="+consentAt+".";
  let marketingSubscriptionSynced=false,marketingConsentRecorded=false,marketingSubscriptionError=null;
  try{
    await hubSpotPrivateRequest("/communication-preferences/v4/statuses/"+encodeURIComponent(contactEmail),{
      token,fetchImpl,method:"POST",
      body:{subscriptionId:HUBSPOT_MARKETING_SUBSCRIPTION_ID,statusState:"SUBSCRIBED",legalBasis:"CONSENT_WITH_NOTICE",legalBasisExplanation:explanation,channel:"EMAIL"}
    });
    marketingSubscriptionSynced=true;
  }catch(error){marketingSubscriptionError=clean(error?.code||"HUBSPOT_MARKETING_SUBSCRIPTION_FAILED",120);}
  try{
    const associationTypeId=await noteContactAssociationType({token,fetchImpl});
    const noteBody=[
      "<strong>Consentement marketing e-mail explicite</strong>",
      "<br><br><strong>Texte accepté :</strong> "+escapeHubSpotHtml(MARKETING_CONSENT_TEXT),
      "<br><strong>Version :</strong> "+escapeHubSpotHtml(version),
      "<br><strong>Source :</strong> "+escapeHubSpotHtml(source),
      "<br><strong>Date UTC :</strong> "+escapeHubSpotHtml(consentAt),
      "<br><strong>Type d’abonnement HubSpot :</strong> Marketing Information ("+HUBSPOT_MARKETING_SUBSCRIPTION_ID+")",
      "<br><strong>Synchronisation préférences HubSpot :</strong> "+(marketingSubscriptionSynced?"réussie":"non confirmée")
    ].join("");
    await hubSpotPrivateRequest("/crm/v3/objects/notes",{
      token,fetchImpl,method:"POST",
      body:{properties:{hs_timestamp:consentAt,hs_note_body:noteBody,hubspot_owner_id:HUBSPOT_OWNER_ID},associations:[{to:{id:String(contact.id)},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]}
    });
    marketingConsentRecorded=true;
  }catch(_error){}
  return {marketingConsentRequested:true,marketingSubscriptionSynced,marketingConsentRecorded,marketingConsentVersion:version,marketingConsentAt:consentAt,marketingSubscriptionError};
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
  const terminal=["Client actif","Perdu / non abouti"].includes(status);
  const label=INTENT_LABELS[intentKey]||INTENT_LABELS.advice;
  const name=clean(input.company_name,120)||[clean(input.first_name,60),clean(input.last_name,60)].filter(Boolean).join(" ")||"Prospect Audiotel";
  const dossierRef=/^APP-\d{4}-[0-9A-Z]{5,18}$/i.test(clean(input.dossier_ref,40))?clean(input.dossier_ref,40).toUpperCase():"";
  const dealName=clean([name,dossierRef,label.label].filter(Boolean).join(" — "),200);
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
    if(dossierRef&&String(current.dealname||"").indexOf(dossierRef)<0)changes.dealname=dealName;
    if(!current.hubspot_owner_id)changes.hubspot_owner_id=HUBSPOT_OWNER_ID;
    if(!current.deal_currency_code)changes.deal_currency_code="EUR";
    if(Object.keys(changes).length){
      openDeal=await hubSpotPrivateRequest("/crm/v3/objects/deals/"+encodeURIComponent(openDeal.id),{
        token,fetchImpl,method:"PATCH",body:{properties:changes}
      });
    }
    return {...openDeal,created:false};
  }
  if(terminal)return null;
  const associationTypeId=await defaultDealContactAssociationType({token,fetchImpl});
  const created=await hubSpotPrivateRequest("/crm/v3/objects/deals",{
    token,fetchImpl,method:"POST",body:{
      properties:{
        dealname:dealName,
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

async function ticketContactAssociationType({token,fetchImpl}){
  const labels=await hubSpotPrivateRequest("/crm/v4/associations/tickets/contacts/labels",{token,fetchImpl,method:"GET"});
  const match=(labels?.results||[]).find(x=>x.category==="HUBSPOT_DEFINED"&&(x.label==null||x.label===""));
  const id=Number(match?.typeId);
  if(!Number.isInteger(id)||id<=0)throw problem("HUBSPOT_TICKET_CONTACT_ASSOCIATION_UNAVAILABLE");
  return id;
}

async function noteContactAssociationType({token,fetchImpl}){
  const labels=await hubSpotPrivateRequest("/crm/v4/associations/notes/contacts/labels",{token,fetchImpl,method:"GET"});
  const match=(labels?.results||[]).find(x=>x.category==="HUBSPOT_DEFINED"&&(x.label==null||x.label===""));
  const id=Number(match?.typeId);
  if(!Number.isInteger(id)||id<=0)throw problem("HUBSPOT_NOTE_CONTACT_ASSOCIATION_UNAVAILABLE");
  return id;
}


async function preferredContactDealId(contactId,{token,fetchImpl}){
  const detail=await hubSpotPrivateRequest("/crm/v3/objects/contacts/"+encodeURIComponent(contactId)+"?associations=deals&properties=email",{token,fetchImpl,method:"GET"});
  const ids=(detail?.associations?.deals?.results||[]).map(x=>String(x.id)).slice(0,20);
  let fallback=ids[0]||null;
  for(const id of ids){
    try{
      const deal=await hubSpotPrivateRequest("/crm/v3/objects/deals/"+encodeURIComponent(id)+"?properties=pipeline,dealstage",{token,fetchImpl,method:"GET"});
      if(deal?.properties?.pipeline===HUBSPOT_PIPELINE_ID&&!["closedwon","closedlost"].includes(deal?.properties?.dealstage))return id;
    }catch(_error){}
  }
  return fallback;
}
async function noteDealAssociationType({token,fetchImpl}){
  try{
    const labels=await hubSpotPrivateRequest("/crm/v4/associations/notes/deals/labels",{token,fetchImpl,method:"GET"});
    const match=(labels?.results||[]).find(x=>x.category==="HUBSPOT_DEFINED"&&(x.label==null||x.label===""));
    const id=Number(match?.typeId);
    return Number.isInteger(id)&&id>0?id:null;
  }catch(_error){return null;}
}

function supportPageContext(pathname){
  const p=String(pathname||"/").toLowerCase();
  if(p==="/")return "Accueil";
  if(/tarif|comparateur/.test(p))return "Tarifs et comparaison";
  if(/portabilite/.test(p))return "Portabilité";
  if(/reversement/.test(p))return "Reversements";
  if(/guide|numero-sva|numero-surtaxe/.test(p))return "Guide et information SVA";
  if(/audiotel-(voyance|coaching|professionnels|independants)/.test(p))return "Page métier";
  if(/demande-ouverture/.test(p))return "Demande d’ouverture";
  if(/conditions|confidentialite|mentions-legales|retractation|resilier|cookies/.test(p))return "Juridique et confidentialité";
  return "Autre page publique";
}

function escapeHubSpotHtml(value){
  return String(value==null?"":value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
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

function commercialLifecycle(status,current){
  const existing=String(current||"").trim();
  const lower=new Set(["","subscriber","lead","marketingqualifiedlead","salesqualifiedlead"]);
  if(status==="Client actif"){
    if(lower.has(existing)||existing==="opportunity")return "customer";
    return existing||"customer";
  }
  if(status==="En attente d’ouverture"){
    if(lower.has(existing))return "opportunity";
    return existing||"opportunity";
  }
  return existing||"lead";
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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildHubSpotLeadSubmission,submitHubSpotLead,syncHubSpotCommercialLead,syncHubSpotCommercialTenant,syncHubSpotSupportMessage,HUBSPOT_LEAD_FORM} from "../backend/src/hubspot-crm.mjs";

const sample={
  account_type:"business",
  first_name:"Camille",
  last_name:"Martin",
  company_name:"Cabinet Exemple",
  email:"camille@example.test",
  phone:"+33600000000",
  service_intent:"portability",
  processing_consent:true
};

test("HubSpot lead payload maps the public funnel to existing CRM properties",()=>{
  const payload=buildHubSpotLeadSubmission(sample,{pageUri:"https://audiotel-premium-pro.com/demande-ouverture/",pageName:"Demande",hutk:"tracking-token-123"});
  const fields=Object.fromEntries(payload.fields.map(x=>[x.name,x.value]));
  assert.equal(HUBSPOT_LEAD_FORM.portalId,"149417663");
  assert.equal(HUBSPOT_LEAD_FORM.formId,"436e33ad-e5e7-4e7c-b024-f211293ad9bd");
  assert.equal(fields.email,"camille@example.test");
  assert.equal(fields.firstname,"Camille");
  assert.equal(fields.lastname,"Martin");
  assert.equal(fields.company,"Cabinet Exemple");
  assert.equal(fields.type_de_client,"Professionnel");
  assert.equal(fields.type_de_demande,"Portabilité d’un numéro existant");
  assert.equal(fields.besoin__projet_audiotel,"Portabilité d’un numéro existant");
  assert.equal(fields.lifecyclestage,"lead");
  assert.equal(fields.statut_commercial_pgi,"Nouveau prospect");
  assert.equal(fields.hubspot_owner_id,"99851906");
  assert.equal(payload.legalConsentOptions.consent.consentToProcess,true);
  assert.match(payload.context.pageUri,/demande-ouverture/);
  assert.equal(payload.context.hutk,"tracking-token-123");
});

test("HubSpot lead payload refuses processing without an explicit privacy acknowledgement",()=>{
  assert.throws(()=>buildHubSpotLeadSubmission({...sample,processing_consent:false}),error=>error?.code==="HUBSPOT_PROCESSING_CONSENT_REQUIRED");
});

test("HubSpot submission uses the public forms endpoint without exposing a private token",async()=>{
  let request=null;
  const fetchImpl=async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,text:async()=>""};
  };
  const result=await submitHubSpotLead(sample,{fetchImpl,attempts:1,timeoutMs:1000});
  assert.equal(result.ok,true);
  assert.match(request.url,/api\.hsforms\.com\/submissions\/v3\/integration\/submit\/149417663\/436e33ad-e5e7-4e7c-b024-f211293ad9bd$/);
  assert.equal(request.options.method,"POST");
  assert.equal("Authorization" in request.options.headers,false);
});

test("HubSpot enrichment falls back safely when optional CRM fields are not part of the form definition",async()=>{
  const bodies=[];
  const fetchImpl=async(_url,options)=>{
    bodies.push(JSON.parse(options.body));
    if(bodies.length===1){
      return {ok:false,status:400,text:async()=>JSON.stringify({errors:[{errorType:"FIELD_NOT_IN_FORM_DEFINITION",name:"statut_commercial_pgi"}]})};
    }
    return {ok:true,status:200,text:async()=>""};
  };
  const result=await submitHubSpotLead(sample,{fetchImpl,attempts:1,timeoutMs:1000});
  assert.equal(result.ok,true);
  assert.equal(result.enriched,false);
  assert.equal(bodies.length,2);
  const first=Object.fromEntries(bodies[0].fields.map(x=>[x.name,x.value]));
  const second=Object.fromEntries(bodies[1].fields.map(x=>[x.name,x.value]));
  assert.equal(first.statut_commercial_pgi,"Nouveau prospect");
  assert.equal(first.hubspot_owner_id,"99851906");
  assert.equal(second.statut_commercial_pgi,undefined);
  assert.equal(second.hubspot_owner_id,undefined);
  assert.equal(second.lifecyclestage,"lead");
});

test("public forms and secure registration are wired to the same CRM capture",()=>{
  const site=fs.readFileSync("site/site.js","utf8");
  const home=fs.readFileSync("site/index.html","utf8");
  const order=fs.readFileSync("site/seo/demande-ouverture.html","utf8");
  const server=fs.readFileSync("backend/server.mjs","utf8");
  assert.match(site,/\/api\/v1\/public\/hubspot\/lead/);
  assert.match(site,/keepalive:true/);
  assert.match(home,/id="order-processing-consent"/);
  assert.match(order,/id="order-processing-consent"/);
  assert.match(home,/CRM HubSpot/);
  assert.match(order,/CRM HubSpot/);
  assert.match(server,/pathname==="\/api\/v1\/public\/hubspot\/lead"/);
  assert.match(server,/submitHubSpotLead\(\.\.\.body|submitHubSpotLead\(body/);
  assert.match(server,/customer_registration/);
  assert.match(server,/hubspotutk/);
});


test("private HubSpot CRM sync creates one commercial deal and advances a registered account deterministically",async()=>{
  const requests=[];
  const response=(status,payload)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload||{})});
  const fetchImpl=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    requests.push({url,method:options.method||"GET",body});
    if(url.endsWith("/crm/v3/objects/contacts/search"))return response(200,{results:[{id:"123",properties:{email:"camille@example.test",statut_commercial_pgi:"Nouveau prospect",lifecyclestage:"lead",hubspot_owner_id:""}}]});
    if(url.endsWith("/crm/v3/objects/contacts/123")&&options.method==="PATCH")return response(200,{id:"123",properties:{email:"camille@example.test",statut_commercial_pgi:"Dossier en préparation",lifecyclestage:"lead",hubspot_owner_id:"99851906"}});
    if(url.includes("/crm/v3/objects/contacts/123?associations=deals"))return response(200,{id:"123",associations:{deals:{results:[]}}});
    if(url.endsWith("/crm/v4/associations/deals/contacts/labels"))return response(200,{results:[{category:"HUBSPOT_DEFINED",typeId:3,label:null}]});
    if(url.endsWith("/crm/v3/objects/deals")&&options.method==="POST")return response(201,{id:"789",properties:body.properties});
    throw new Error("Unexpected HubSpot request "+url+" "+options.method);
  };
  const result=await syncHubSpotCommercialLead(sample,{token:"pat-test-"+"x".repeat(40),fetchImpl,commercialStatus:"Dossier en préparation"});
  assert.equal(result.synced,true);
  assert.equal(result.contactId,"123");
  assert.equal(result.dealId,"789");
  assert.equal(result.dealCreated,true);
  const contactPatch=requests.find(x=>x.url.endsWith("/contacts/123")&&x.method==="PATCH");
  assert.equal(contactPatch.body.properties.statut_commercial_pgi,"Dossier en préparation");
  assert.equal(contactPatch.body.properties.hubspot_owner_id,"99851906");
  const dealCreate=requests.find(x=>x.url.endsWith("/objects/deals")&&x.method==="POST");
  assert.equal(dealCreate.body.properties.pipeline,"default");
  assert.equal(dealCreate.body.properties.dealstage,"contractsent");
  assert.equal(dealCreate.body.properties.deal_currency_code,"EUR");
  assert.equal(dealCreate.body.associations[0].to.id,"123");
});

test("private HubSpot CRM sync never downgrades an advanced commercial status",async()=>{
  const requests=[];
  const response=(status,payload)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload||{})});
  const fetchImpl=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    requests.push({url,method:options.method||"GET",body});
    if(url.endsWith("/crm/v3/objects/contacts/search"))return response(200,{results:[{id:"124",properties:{email:"camille@example.test",statut_commercial_pgi:"En attente d’ouverture",lifecyclestage:"opportunity",hubspot_owner_id:"99851906"}}]});
    if(url.endsWith("/crm/v3/objects/contacts/124")&&options.method==="PATCH")return response(200,{id:"124",properties:{email:"camille@example.test",statut_commercial_pgi:"En attente d’ouverture",lifecyclestage:"opportunity",hubspot_owner_id:"99851906"}});
    if(url.includes("/crm/v3/objects/contacts/124?associations=deals"))return response(200,{id:"124",associations:{deals:{results:[{id:"900"}]}}});
    if(url.includes("/crm/v3/objects/deals/900?"))return response(200,{id:"900",properties:{pipeline:"default",dealstage:"6144336106",hubspot_owner_id:"99851906",deal_currency_code:"EUR"}});
    throw new Error("Unexpected HubSpot request "+url+" "+options.method);
  };
  const result=await syncHubSpotCommercialLead(sample,{token:"pat-test-"+"y".repeat(40),fetchImpl,commercialStatus:"Dossier en préparation"});
  assert.equal(result.dealCreated,false);
  const contactPatch=requests.find(x=>x.url.endsWith("/contacts/124")&&x.method==="PATCH");
  assert.equal(contactPatch.body.properties.statut_commercial_pgi,undefined);
  assert.equal(contactPatch.body.properties.lifecyclestage,undefined);
});

test("server orchestrates CRM sync and confirmation without creating HubSpot tasks",()=>{
  const server=fs.readFileSync("backend/server.mjs","utf8");
  assert.match(server,/syncHubSpotCommercialLead/);
  assert.match(server,/commercialStatus:"Nouveau prospect"/);
  assert.match(server,/commercialStatus:"Dossier en préparation"/);
  assert.match(server,/templateKey:"lead_received"/);
  assert.doesNotMatch(server,/hs_task_subject|objects\/tasks/);
});


test("tenant lifecycle sync advances CRM and closes the open deal when service becomes active",async()=>{
  const requests=[];
  const response=(status,payload)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload||{})});
  const fetchImpl=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    requests.push({url,method:options.method||"GET",body});
    if(url.endsWith("/crm/v3/objects/contacts/search"))return response(200,{results:[{id:"125",properties:{email:"camille@example.test",statut_commercial_pgi:"En attente d’ouverture",lifecyclestage:"opportunity",hubspot_owner_id:"99851906"}}]});
    if(url.endsWith("/crm/v3/objects/contacts/125")&&options.method==="PATCH")return response(200,{id:"125",properties:{...body.properties,email:"camille@example.test"}});
    if(url.includes("/crm/v3/objects/contacts/125?associations=deals"))return response(200,{id:"125",associations:{deals:{results:[{id:"901"}]}}});
    if(url.includes("/crm/v3/objects/deals/901?"))return response(200,{id:"901",properties:{pipeline:"default",dealstage:"6144336106",hubspot_owner_id:"99851906",deal_currency_code:"EUR"}});
    if(url.endsWith("/crm/v3/objects/deals/901")&&options.method==="PATCH")return response(200,{id:"901",properties:body.properties});
    throw new Error("Unexpected HubSpot request "+url+" "+options.method);
  };
  const store={tenantControlDetail:async()=>({
    tenant:{legal_name:"Cabinet Exemple",display_name:"Cabinet Exemple"},
    users:[{role:"owner",membership_status:"active",first_name:"Camille",last_name:"Martin",email:"camille@example.test",phone:"+33600000000",account_type:"business",service_intent:"portability"}]
  })};
  const result=await syncHubSpotCommercialTenant(store,"11111111-1111-4111-8111-111111111111","Client actif",{token:"pat-test-"+"z".repeat(40),fetchImpl});
  assert.equal(result.synced,true);
  const contactPatch=requests.find(x=>x.url.endsWith("/contacts/125")&&x.method==="PATCH");
  assert.equal(contactPatch.body.properties.statut_commercial_pgi,"Client actif");
  assert.equal(contactPatch.body.properties.lifecyclestage,"customer");
  const dealPatch=requests.find(x=>x.url.endsWith("/objects/deals/901")&&x.method==="PATCH");
  assert.equal(dealPatch.body.properties.dealstage,"closedwon");
});

test("server maps only objective lifecycle events to HubSpot",()=>{
  const server=fs.readFileSync("backend/server.mjs","utf8");
  for(const marker of ["billing_active","tenant_active","assignment_active","portability_complete","customer_exit"])assert.match(server,new RegExp(marker));
  assert.match(server,/En attente d’ouverture/);
  assert.match(server,/Client actif/);
  assert.match(server,/Perdu \/ non abouti/);
});


test("support contact sync deduplicates by email, creates a CRM contact and logs the site message without a deal",async()=>{
  const requests=[];
  const response=(status,payload)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload||{})});
  const fetchImpl=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    requests.push({url,method:options.method||"GET",body});
    if(url.endsWith("/crm/v3/objects/contacts/search"))return response(200,{results:[]});
    if(url.endsWith("/crm/v3/objects/contacts")&&options.method==="POST")return response(201,{id:"501",properties:body.properties});
    if(url.endsWith("/crm/v4/associations/notes/contacts/labels"))return response(200,{results:[{category:"HUBSPOT_DEFINED",typeId:202,label:null}]});
    if(url.endsWith("/crm/v3/objects/notes")&&options.method==="POST")return response(201,{id:"601",properties:body.properties});
    throw new Error("Unexpected HubSpot request "+url+" "+options.method);
  };
  const result=await syncHubSpotSupportMessage({
    email:"Visiteur@Example.test",
    message:"Bonjour, j’ai une question <script>alert(1)</script>",
    pagePath:"/tarif-numero-sva/",
    pageTitle:"Tarif numéro SVA"
  },{token:"pat-test-"+"s".repeat(40),fetchImpl});
  assert.equal(result.synced,true);
  assert.equal(result.contactId,"501");
  assert.equal(result.noteId,"601");
  assert.equal(result.contactCreated,true);
  const created=requests.find(x=>x.url.endsWith("/objects/contacts")&&x.method==="POST");
  assert.equal(created.body.properties.email,"visiteur@example.test");
  assert.equal(created.body.properties.type_de_demande,"Autre");
  const note=requests.find(x=>x.url.endsWith("/objects/notes")&&x.method==="POST");
  assert.match(note.body.properties.hs_note_body,/tarif-numero-sva/);
  assert.match(note.body.properties.hs_note_body,/&lt;script&gt;/);
  assert.equal(note.body.associations[0].to.id,"501");
  assert.equal(requests.some(x=>x.url.includes("/objects/deals")),false);
});

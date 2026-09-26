import test from "node:test";
import assert from "node:assert/strict";
import {drainHubSpotCrm} from "../backend/src/hubspot-crm.mjs";

function config(overrides={}){
  return {
    hubspotCrmEnabled:true,
    hubspotPrivateAppToken:"pat-eu1-test-token-abcdefghijklmnopqrstuvwxyz",
    hubspotTimeoutMs:5000,
    hubspotOwnerId:"99851906",
    hubspotCompanySyncEnabled:true,
    hubspotTaskSyncEnabled:true,
    hubspotDealAmountEnabled:false,
    hubspotPipelineId:"default",
    hubspotStageNew:"appointmentscheduled",
    hubspotStageQualified:"qualifiedtobuy",
    hubspotStageReady:"contractsent",
    hubspotStageActive:"closedwon",
    hubspotStageLost:"closedlost",
    subscriptionPriceMonthlyEur:3,
    ...overrides
  };
}

function fakeSql(rows){
  const calls=[];
  return {
    calls,
    async unsafe(query,args=[]){
      calls.push({query,args});
      if(query.startsWith("SELECT o.id"))return rows;
      if(query.includes("tenant_service_incident_notes"))return [];
      return [];
    }
  };
}

function jsonResponse(status,payload={}){
  return new Response(status===204?null:JSON.stringify(payload),{
    status,
    headers:status===204?{}:{"content-type":"application/json"}
  });
}

test("HubSpot registration sync creates one professional CRM chain without unsafe USD amount",async()=>{
  const sql=fakeSql([{
    id:10,tenant_id:42,event_type:"customer.self_registered",aggregate_type:"tenant",aggregate_id:"42",
    payload:{
      email:"client@example.test",account_type:"business",company_name:"Cabinet Exemple",service_intent:"new_number",
      acquisition:{utm_source:"google",utm_medium:"organic",utm_campaign:"brand"}
    },
    created_at:"2026-09-26T12:00:00Z",
    tenant_public_id:"11111111-1111-4111-8111-111111111111",tenant_name:"Cabinet Exemple",billing_email:"client@example.test",
    country_code:"FR",tenant_status:"pending",entity_type:"company",registration_number:null,
    owner_principal_id:"22222222-2222-4222-8222-222222222222",owner_email:"client@example.test",owner_name:"Camille Martin",
    owner_metadata:{first_name:"Camille",last_name:"Martin",phone:"+33600000000",account_type:"business"},
    contact_id:null,company_id:null,deal_id:null,pipeline_id:null,last_stage:null,
    incident_id:null,ticket_id:null,receipt_state:null,external_object_type:null,external_object_id:null
  }]);
  const requests=[];
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const method=String(options.method||"GET"),body=options.body?JSON.parse(options.body):null;
    requests.push({url:String(url),method,body});
    if(String(url).endsWith("/crm/v3/objects/contacts/search"))return jsonResponse(200,{results:[]});
    if(String(url).endsWith("/crm/v3/objects/contacts")&&method==="POST")return jsonResponse(201,{id:"101"});
    if(String(url).endsWith("/crm/v3/objects/companies")&&method==="POST")return jsonResponse(201,{id:"201"});
    if(String(url).endsWith("/crm/v3/objects/deals")&&method==="POST")return jsonResponse(201,{id:"301"});
    if(String(url).endsWith("/crm/v3/objects/tasks")&&method==="POST")return jsonResponse(201,{id:"401"});
    if(method==="PATCH"||method==="PUT")return jsonResponse(200,{});
    throw new Error("Unexpected HubSpot request "+method+" "+url);
  };
  try{
    const result=await drainHubSpotCrm({store:{sql},config:config(),limit:10});
    assert.equal(result.synced,1);
    assert.equal(result.failed,0);
    const createdContact=requests.find(x=>x.url.endsWith("/crm/v3/objects/contacts")&&x.method==="POST");
    assert.equal(createdContact.body.properties.email,"client@example.test");
    assert.equal(createdContact.body.properties.hubspot_owner_id,"99851906");
    assert.equal(createdContact.body.properties.hs_analytics_source,"ORGANIC_SEARCH");

    const createdCompany=requests.find(x=>x.url.endsWith("/crm/v3/objects/companies")&&x.method==="POST");
    assert.equal(createdCompany.body.properties.name,"Cabinet Exemple");

    const dealCreate=requests.find(x=>x.url.endsWith("/crm/v3/objects/deals")&&x.method==="POST");
    assert.equal(dealCreate.body.properties.pipeline,"default");
    assert.equal(dealCreate.body.properties.dealstage,"appointmentscheduled");
    assert.equal("amount" in dealCreate.body.properties,false);

    const dealPatch=requests.find(x=>/\/crm\/v3\/objects\/deals\/301$/.test(x.url)&&x.method==="PATCH");
    assert.equal(dealPatch.body.properties.dealstage,"appointmentscheduled");
    assert.equal("amount" in dealPatch.body.properties,false);

    const task=requests.find(x=>x.url.endsWith("/crm/v3/objects/tasks")&&x.method==="POST");
    assert.equal(task.body.properties.hs_task_priority,"HIGH");
    assert.match(task.body.properties.hs_task_body,/Source : google \/ organic/);
    assert.match(task.body.properties.hs_task_body,/Campagne : brand/);

    const associations=requests.filter(x=>x.method==="PUT").map(x=>x.url);
    assert.ok(associations.some(x=>x.includes("/contact/101/associations/default/company/201")));
    assert.ok(associations.some(x=>x.includes("/deal/301/associations/default/contact/101")));
    assert.ok(associations.some(x=>x.includes("/task/401/associations/default/deal/301")));
  }finally{
    globalThis.fetch=previous;
  }
});

test("HubSpot support sync creates one ticket and mirrors notes instead of duplicate tickets",async()=>{
  const base={
    tenant_id:42,aggregate_type:"tenant_service_incident",aggregate_id:"77",created_at:"2026-09-26T13:00:00Z",
    tenant_name:"Cabinet Exemple",billing_email:"client@example.test",country_code:"FR",tenant_status:"active",
    owner_email:"client@example.test",owner_name:"Camille Martin",owner_metadata:{},
    contact_id:"101",company_id:"201",deal_id:"301",pipeline_id:"default",last_stage:"customer_active",
    incident_id:77,incident_public_id:"33333333-3333-4333-8333-333333333333",
    incident_title:"Routage indisponible",incident_description:"Le routage principal ne répond plus.",
    incident_status:"investigating",incident_severity:"critical",incident_category:"routing"
  };
  const rows=[
    {...base,id:20,event_type:"service.incident.created",payload:{source:"customer",category:"routing",severity:"critical"},ticket_id:null,external_object_type:null,external_object_id:null},
    {...base,id:21,event_type:"service.incident.note",payload:{source:"customer",note_id:9001},ticket_id:"501",external_object_type:null,external_object_id:null}
  ];
  const sql=fakeSql(rows);
  const originalUnsafe=sql.unsafe.bind(sql);
  sql.unsafe=async(query,args=[])=>{
    if(query.includes("tenant_service_incident_notes"))return [{body:"Le problème persiste.",author_type:"customer",customer_visible:true,created_at:"2026-09-26T13:05:00Z"}];
    return originalUnsafe(query,args);
  };
  const requests=[];
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const method=String(options.method||"GET"),body=options.body?JSON.parse(options.body):null;
    requests.push({url:String(url),method,body});
    if(String(url).endsWith("/crm/v3/objects/tickets")&&method==="POST")return jsonResponse(201,{id:"501"});
    if(String(url).endsWith("/crm/v3/objects/notes")&&method==="POST")return jsonResponse(201,{id:"601"});
    if(method==="PATCH"||method==="PUT")return jsonResponse(200,{});
    throw new Error("Unexpected HubSpot request "+method+" "+url);
  };
  try{
    const result=await drainHubSpotCrm({store:{sql},config:config(),limit:10});
    assert.equal(result.synced,2);
    assert.equal(requests.filter(x=>x.url.endsWith("/crm/v3/objects/tickets")&&x.method==="POST").length,1);
    const ticket=requests.find(x=>x.url.endsWith("/crm/v3/objects/tickets")&&x.method==="POST");
    assert.equal(ticket.body.properties.hs_pipeline,"0");
    assert.equal(ticket.body.properties.hs_pipeline_stage,"3");
    assert.equal(ticket.body.properties.hs_ticket_priority,"URGENT");
    const note=requests.find(x=>x.url.endsWith("/crm/v3/objects/notes")&&x.method==="POST");
    assert.equal(note.body.properties.hs_note_body,"Le problème persiste.");
    assert.ok(requests.some(x=>x.method==="PUT"&&x.url.includes("/note/601/associations/default/ticket/501")));
  }finally{
    globalThis.fetch=previous;
  }
});

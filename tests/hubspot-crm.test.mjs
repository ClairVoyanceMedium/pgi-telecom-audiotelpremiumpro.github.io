import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildHubSpotLeadSubmission,submitHubSpotLead,HUBSPOT_LEAD_FORM} from "../backend/src/hubspot-crm.mjs";

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

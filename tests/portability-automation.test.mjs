import test from "node:test";
import assert from "node:assert/strict";
import {encryptPortabilityCredential} from "../backend/src/portability-identity.mjs";
import {processPortabilityWork} from "../backend/src/portability-automation.mjs";

test("automatic portability sends RIO only to operator and never persists it in automation logs",async()=>{
  const secret="0123456789abcdef0123456789abcdef";
  const rio="01AABC1235CI";
  const task={
    id:42,tenant_id:7,status:"submitted",automation_state:"queued",
    tenant_status:"active",market_id:1,market_status:"active",
    active_carrier_id:3,carrier_name:"Carrier Test",
    api_connection_id:9,api_connection_state:"active",api_auth_mode:"none",api_secret_ref:null,
    api_settings:{
      portability_submit_url:"https://operator.example.test/portability",
      portability_status_url:"https://operator.example.test/portability/{reference}"
    },
    adapter_key:"generic-portability",adapter_version:"1",adapter_capabilities:{portability:true},
    carrier_contract_ready:true,kyc_ready:true,access_ready:true,payout_ready:true,
    country_code:"FR",requested_e164:"+33890123456",display_number:"0890123456",service_family:"premium_rate",
    rio_ciphertext:encryptPortabilityCredential(rio,secret),rio_validation_status:"verified",
    source_contract_liability_acknowledged:true,authorization_confirmed:true,number_owner_confirmed:true,
    ownership_status:"verified",tariff_verification_status:"verified",tariff_code:"SVA-TEST",
    service_rate_ttc_per_min:0.80,currency:"EUR",current_operator_name:"Donneur",
    current_operator_reference:"OLD-1",account_holder_name:"Entreprise Test",desired_port_date:"2026-09-25",
    operator_portability_reference:null,operator_status:null,scheduled_at:null
  };

  const calls=[];
  const store={
    eventBus:{publish(){}},
    sql:{unsafe:async(sql,params=[])=>{
      calls.push({sql,params});
      if(sql.startsWith("SELECT p.*,t.status AS tenant_status"))return [task];
      return [];
    }},
    async completePortabilityRequest(){throw new Error("completion should not run for scheduled response");}
  };

  let sent=null;
  const fetchImpl=async(url,options)=>{
    sent={url,options};
    return {
      ok:true,status:200,
      headers:{get:()=> "application/json"},
      json:async()=>({
        status:"scheduled",
        portability_reference:"OP-123",
        scheduled_at:"2026-09-25T10:00:00Z"
      })
    };
  };

  await processPortabilityWork(
    {payload:{request_id:42,action:"auto"}},
    {store,config:{mode:"production",requireCarrierContract:true,portabilitySecretKey:secret},env:{},fetchImpl}
  );

  assert.equal(sent.url,"https://operator.example.test/portability");
  assert.equal(JSON.parse(sent.options.body).rio,rio);
  assert.equal(calls.some(x=>JSON.stringify(x.params).includes(rio)),false);
  assert.equal(calls.some(x=>x.sql.includes("portability_operator_events")&&JSON.stringify(x.params).includes("[redacted]")),true);
  assert.equal(calls.some(x=>x.sql.includes("UPDATE tenant_portability_requests SET status=$2")&&x.params[1]==="scheduled"),true);
});

test("automatic portability fails closed when operator API is unavailable",async()=>{
  const secret="0123456789abcdef0123456789abcdef";
  const task={
    id:8,tenant_id:2,status:"submitted",automation_state:"queued",
    tenant_status:"active",market_id:1,market_status:"active",
    active_carrier_id:3,api_connection_id:null,api_connection_state:null,
    adapter_key:null,carrier_contract_ready:true,kyc_ready:true,access_ready:true,payout_ready:true,
    country_code:"FR",requested_e164:"+33890123456",
    rio_ciphertext:encryptPortabilityCredential("01AABC1235CI",secret),rio_validation_status:"verified",
    source_contract_liability_acknowledged:true,authorization_confirmed:true,number_owner_confirmed:true,
    ownership_status:"verified",tariff_verification_status:"verified",tariff_code:"SVA-TEST",
    service_rate_ttc_per_min:0.8,currency:"EUR",api_settings:{}
  };
  const calls=[];
  const store={
    eventBus:{publish(){}},
    sql:{unsafe:async(sql,params=[])=>{
      calls.push({sql,params});
      if(sql.startsWith("SELECT p.*,t.status AS tenant_status"))return [task];
      return [];
    }}
  };
  let fetched=false;
  await processPortabilityWork(
    {payload:{request_id:8}},
    {store,config:{mode:"production",requireCarrierContract:true,portabilitySecretKey:secret},env:{},fetchImpl:async()=>{fetched=true;throw new Error("unexpected");}}
  );
  assert.equal(fetched,false);
  assert.equal(calls.some(x=>x.sql.includes("automation_state=$2")&&x.params[1]==="action_required"&&x.params[3]==="PORTABILITY_OPERATOR_API_NOT_READY"),true);
});

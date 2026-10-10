import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createHmac} from "node:crypto";
import {verifyResendWebhook} from "../backend/src/resend-webhook.mjs";
import {applyResendWebhookEvent,acknowledgeResendInboundForward} from "../backend/src/email-dispatcher.mjs";

function reqFor(event,secret,timestamp=Math.floor(Date.now()/1000),id="msg_test_webhook_123"){
  const raw=Buffer.from(JSON.stringify(event));
  const key=Buffer.from(secret.slice(6),"base64");
  const sig=createHmac("sha256",key).update(Buffer.concat([Buffer.from(id+"."+timestamp+"."),raw])).digest("base64");
  return {headers:{"svix-id":id,"svix-timestamp":String(timestamp),"svix-signature":"v1,"+sig},async *[Symbol.asyncIterator](){yield raw;}};
}

test("Resend webhook verifies Svix signature before trusting JSON",async()=>{
  const secret="whsec_"+Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const event={type:"email.delivered",created_at:new Date().toISOString(),data:{email_id:"email_test_12345",to:["client@example.com"]}};
  const verified=await verifyResendWebhook(reqFor(event,secret),{resendWebhookSecret:secret,resendWebhookToleranceSeconds:300,bodyLimitBytes:262144});
  assert.equal(verified.event.type,"email.delivered");
  assert.match(verified.payloadSha256,/^[a-f0-9]{64}$/);
});

test("Resend webhook rejects bad and expired signatures",async()=>{
  const secret="whsec_"+Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const event={type:"email.sent",data:{email_id:"email_test_12345"}};
  const bad=reqFor(event,secret);
  bad.headers["svix-signature"]="v1,"+Buffer.from("bad").toString("base64");
  await assert.rejects(()=>verifyResendWebhook(bad,{resendWebhookSecret:secret,resendWebhookToleranceSeconds:300}),e=>e.code==="RESEND_SIGNATURE_INVALID");
  await assert.rejects(()=>verifyResendWebhook(reqFor(event,secret,Math.floor(Date.now()/1000)-1000),{resendWebhookSecret:secret,resendWebhookToleranceSeconds:300}),e=>e.code==="RESEND_SIGNATURE_EXPIRED");
});


test("webhook delivery ledger types every dynamic Postgres parameter explicitly",()=>{
  const dispatcher=fs.readFileSync("backend/src/email-dispatcher.mjs","utf8");
  assert.match(dispatcher,/VALUES\(\$1::text,\$2::text,\$3::text,\$4::char\(64\),\$5::timestamptz\)/);
  assert.match(dispatcher,/state=\$2::text/);
  assert.match(dispatcher,/provider_email_id=\$1::text/);
  assert.match(dispatcher,/jsonb_build_object\('provider_message_id',\$2::text\)/);
  assert.match(dispatcher,/VALUES\(\$1::char\(64\),\$2::text,\$3::text,\$4::timestamptz,\$4::timestamptz\)/);
  assert.match(dispatcher,/svix_id=\$1::text/);
});

test("email.received is recorded without inventing an outbound delivery state",async()=>{
  const queries=[];
  const tx={unsafe:async(query,args)=>{
    queries.push({query,args});
    if(query.startsWith("INSERT INTO transactional_email_webhook_events"))return [{svix_id:"msg_received_1"}];
    return [];
  }};
  const store={sql:{begin:async fn=>fn(tx)}};
  const verified={
    svixId:"msg_received_1",
    payloadSha256:"a".repeat(64),
    event:{type:"email.received",created_at:new Date().toISOString(),data:{email_id:"email_inbound_1",to:["support@example.com"]}}
  };
  const result=await applyResendWebhookEvent(store,verified);
  assert.equal(result.state,null);
  assert.equal(queries.some(x=>x.query.includes("UPDATE transactional_email_deliveries SET state=")),false);
  assert.equal(queries.some(x=>x.query.includes("UPDATE transactional_email_webhook_events SET processed_at=now()")),false);
});

test("inbound webhook remains retryable until Gmail forward was explicitly acknowledged",async()=>{
 const seen=[];
 let inserted=true;
 const store={sql:{
  begin:async cb=>cb({unsafe:async(query,values)=>{
    seen.push(query);
    if(query.startsWith("INSERT INTO transactional_email_webhook_events")){
      if(inserted){inserted=false;return [{svix_id:"msg_retry_123"}];}
      return [];
    }
    if(query.includes("SELECT event_type,provider_email_id,payload_sha256,processed_at"))
      return [{event_type:"email.received",provider_email_id:"email_inbound_123",payload_sha256:"a".repeat(64),processed_at:null}];
    return [];
  }}),
  unsafe:async(query,args)=>{
    seen.push(query);
    return query.startsWith("UPDATE transactional_email_webhook_events SET processed_at=COALESCE")
      ?[{svix_id:args[0],processed_at:new Date()}]:[];
  }
 }};
 const verified={svixId:"msg_retry_123",payloadSha256:"a".repeat(64),
  event:{type:"email.received",data:{email_id:"email_inbound_123"}}};
 const first=await applyResendWebhookEvent(store,verified);
 assert.equal(first.duplicate,false);
 const replay=await applyResendWebhookEvent(store,verified);
 assert.equal(replay.resumed,true);
 assert.equal(replay.duplicate,false);
 const ack=await acknowledgeResendInboundForward(store,verified);
 assert.equal(ack.acknowledged,true);
 assert.ok(seen.some(x=>x.includes("processed_at=COALESCE(processed_at,now())")));
});
test("inbound replay refuses altered signed payloads instead of trusting an old receipt",async()=>{
 const store={sql:{begin:async fn=>fn({unsafe:async query=>
  query.startsWith("INSERT INTO transactional_email_webhook_events")?[]:
  [{event_type:"email.received",provider_email_id:"email_inbound_123",payload_sha256:"b".repeat(64),processed_at:null}]
 })}};
 await assert.rejects(
  ()=>applyResendWebhookEvent(store,{svixId:"msg_retry_123",payloadSha256:"a".repeat(64),event:{type:"email.received",data:{email_id:"email_inbound_123"}}}),
  {code:"RESEND_WEBHOOK_RECEIPT_CONFLICT"});
});

import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyResendWebhook} from "../backend/src/resend-webhook.mjs";

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

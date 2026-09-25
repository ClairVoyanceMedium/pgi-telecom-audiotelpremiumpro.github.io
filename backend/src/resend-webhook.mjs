import {createHash,createHmac,timingSafeEqual} from "node:crypto";

const ALLOWED=new Set([
  "email.sent","email.delivered","email.delivery_delayed","email.bounced",
  "email.complained","email.failed","email.suppressed","email.clicked"
]);

export async function verifyResendWebhook(req,config){
  const secret=String(config?.resendWebhookSecret||"").trim();
  if(!secret)throw failure(404,"RESEND_WEBHOOK_DISABLED");
  const raw=await readRaw(req,Number(config?.bodyLimitBytes||262144));
  const id=String(req.headers?.["svix-id"]||"").trim();
  const timestampRaw=String(req.headers?.["svix-timestamp"]||"").trim();
  const signatureHeader=String(req.headers?.["svix-signature"]||"").trim();
  const timestamp=Number(timestampRaw);
  if(!/^[A-Za-z0-9_-]{6,200}$/.test(id)||!Number.isInteger(timestamp)||!signatureHeader)throw failure(400,"RESEND_SIGNATURE_INVALID");
  const tolerance=Number(config?.resendWebhookToleranceSeconds||300);
  const now=Math.floor(Date.now()/1000);
  if(Math.abs(now-timestamp)>tolerance)throw failure(400,"RESEND_SIGNATURE_EXPIRED");
  const encoded=secret.startsWith("whsec_")?secret.slice(6):secret;
  let key;try{key=Buffer.from(encoded,"base64");}catch{throw failure(500,"RESEND_WEBHOOK_SECRET_INVALID");}
  if(!key.length)throw failure(500,"RESEND_WEBHOOK_SECRET_INVALID");
  const signed=Buffer.concat([Buffer.from(id+"."+timestampRaw+"."),raw]);
  const expected=createHmac("sha256",key).update(signed).digest("base64");
  const valid=signatureHeader.split(/\s+/).some(part=>{
    const m=/^v1,([^\s]+)$/.exec(part);if(!m)return false;
    const a=Buffer.from(expected),b=Buffer.from(m[1]);
    return a.length===b.length&&timingSafeEqual(a,b);
  });
  if(!valid)throw failure(400,"RESEND_SIGNATURE_INVALID");
  let event;try{event=JSON.parse(raw.toString("utf8"));}catch{throw failure(400,"INVALID_JSON");}
  if(!event||typeof event!=="object"||!ALLOWED.has(String(event.type||"")))throw failure(400,"RESEND_EVENT_INVALID");
  const emailId=String(event?.data?.email_id||event?.data?.id||"");
  if(!/^[A-Za-z0-9_-]{6,200}$/.test(emailId))throw failure(400,"RESEND_EMAIL_ID_INVALID");
  return {
    event,
    svixId:id,
    payloadSha256:createHash("sha256").update(raw).digest("hex"),
    receivedAt:new Date().toISOString()
  };
}

function readRaw(req,limit){
  return new Promise(async(resolve,reject)=>{
    const chunks=[];let total=0;
    try{
      for await(const chunk of req){
        const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        total+=b.length;if(total>limit)throw failure(413,"PAYLOAD_TOO_LARGE");
        chunks.push(b);
      }
      resolve(Buffer.concat(chunks));
    }catch(error){reject(error);}
  });
}
function failure(status,code){const e=new Error(code);e.status=status;e.code=code;e.expose=true;return e;}

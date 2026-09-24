import {createHash,createHmac,randomBytes,randomInt} from "node:crypto";

export function createEmailVerificationChallenge(config,existingToken=null,nowMs=Date.now()){
  const token=existingToken||randomBytes(32).toString("base64url");
  const code=String(randomInt(0,1000000)).padStart(6,"0");
  const ttlMs=Number(config.emailVerificationTtlMinutes||10)*60000;
  const resendMs=Number(config.emailVerificationResendSeconds||60)*1000;
  return {
    token,
    code,
    record:{
      required:true,
      token_hash:verificationTokenHash(token),
      code_hash:emailVerificationCodeHash(config,token,code),
      expires_at:new Date(nowMs+ttlMs).toISOString(),
      resend_after:new Date(nowMs+resendMs).toISOString(),
      attempts:0,
      sent_at:new Date(nowMs).toISOString()
    }
  };
}

export function verificationTokenHash(token){
  return createHash("sha256").update(String(token||"")).digest("hex");
}

export function emailVerificationCodeHash(config,token,code){
  const pepper=String(config.emailVerificationPepper||"");
  if(pepper.length<32)throw new Error("EMAIL_VERIFICATION_PEPPER_NOT_CONFIGURED");
  return createHmac("sha256",pepper).update(String(token||"")+":"+String(code||"")).digest("hex");
}

export async function sendResendVerificationCode(config,{email,name,code,idempotencyKey}){
  if(!config.emailVerificationEnabled)throw providerError("EMAIL_VERIFICATION_DISABLED");
  if(!config.resendApiKey)throw providerError("RESEND_NOT_CONFIGURED");
  const fromEmail=String(config.transactionalFromEmail||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail))throw providerError("RESEND_SENDER_NOT_CONFIGURED");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  const body={
    from:(config.transactionalFromName||"PGI Telecom")+" <"+fromEmail+">",
    to:[String(email)],
    subject:"Votre code de vérification PGI Telecom",
    text:"Votre code de vérification PGI Telecom est "+code+". Il expire dans "+config.emailVerificationTtlMinutes+" minutes. Si vous n’avez pas demandé ce code, ignorez cet e-mail.",
    html:'<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;background:#f6f3ef;color:#221914;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e1d8cf;border-radius:14px;padding:28px"><h1 style="font-size:22px;margin:0 0 12px">Vérification de votre adresse e-mail</h1><p>Utilisez ce code pour terminer la création de votre espace Audiotel Premium Pro :</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:24px 0">'+code+'</p><p>Ce code expire dans '+config.emailVerificationTtlMinutes+' minutes.</p><p style="font-size:13px;color:#6f6259">Si vous n’avez pas demandé ce code, vous pouvez ignorer cet e-mail.</p></div></body></html>'
  };
  const headers={
    "accept":"application/json",
    "authorization":"Bearer "+config.resendApiKey,
    "content-type":"application/json"
  };
  if(idempotencyKey)headers["idempotency-key"]=String(idempotencyKey).slice(0,256);
  try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers,body:JSON.stringify(body),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw providerError("RESEND_SEND_FAILED",response.status,payload);
    return {message_id:payload.id||null};
  }catch(error){
    if(error?.code)throw error;
    throw providerError(error?.name==="AbortError"?"RESEND_TIMEOUT":"RESEND_SEND_FAILED");
  }finally{clearTimeout(timeout);}
}

function providerError(code,status=503,providerPayload=null){
  const e=new Error(code);e.code=code;e.status=status;e.provider_payload=providerPayload;return e;
}

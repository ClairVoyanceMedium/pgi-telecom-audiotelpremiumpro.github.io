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
export function verificationTokenHash(token){return createHash("sha256").update(String(token||"")).digest("hex");}
export function emailVerificationCodeHash(config,token,code){
  const pepper=String(config.emailVerificationPepper||"");
  if(pepper.length<32)throw new Error("EMAIL_VERIFICATION_PEPPER_NOT_CONFIGURED");
  return createHmac("sha256",pepper).update(String(token||"")+":"+String(code||"")).digest("hex");
}
export async function sendBrevoVerificationCode(config,{email,name,code}){
  if(!config.emailVerificationEnabled)throw providerError("EMAIL_VERIFICATION_DISABLED");
  if(!config.brevoApiKey)throw providerError("BREVO_NOT_CONFIGURED");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  const body={
    sender:{email:config.transactionalFromEmail,name:config.transactionalFromName||"PGI Telecom"},
    to:[{email:String(email),name:String(name||email)}],
    replyTo:{email:config.transactionalFromEmail,name:config.transactionalFromName||"PGI Telecom"},
    subject:"Votre code de vérification PGI Telecom",
    textContent:"Votre code de vérification PGI Telecom est "+code+". Il expire dans "+config.emailVerificationTtlMinutes+" minutes. Si vous n’avez pas demandé ce code, ignorez cet e-mail.",
    htmlContent:'<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;background:#f6f3ef;color:#221914;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e1d8cf;border-radius:14px;padding:28px"><h1 style="font-size:22px;margin:0 0 12px">Vérification de votre adresse e-mail</h1><p>Utilisez ce code pour terminer la création de votre espace Audiotel Premium Pro :</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:24px 0">'+code+'</p><p>Ce code expire dans '+config.emailVerificationTtlMinutes+' minutes.</p><p style="font-size:13px;color:#6f6259">Si vous n’avez pas demandé ce code, vous pouvez ignorer cet e-mail.</p></div></body></html>',
    tags:["account-email-verification"],contactPixelTrackingConsent:false
  };
  if(config.brevoSandbox)body.headers={"X-Sib-Sandbox":"drop"};
  try{
    const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"accept":"application/json","api-key":config.brevoApiKey,"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok)throw providerError("BREVO_SEND_FAILED",response.status);
    const payload=await response.json().catch(()=>({}));
    return {message_id:payload.messageId||null,sandbox:Boolean(config.brevoSandbox)};
  }catch(error){
    if(error?.code)throw error;
    throw providerError(error?.name==="AbortError"?"BREVO_TIMEOUT":"BREVO_SEND_FAILED");
  }finally{clearTimeout(timeout);}
}
function providerError(code,status=503){const e=new Error(code);e.code=code;e.status=status;return e;}

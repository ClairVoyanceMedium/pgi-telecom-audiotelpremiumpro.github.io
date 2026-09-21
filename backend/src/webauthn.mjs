import{createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual,verify as verifySignature}from"node:crypto";
const b=v=>Buffer.from(String(v||""),"base64url"),e=v=>Buffer.from(v).toString("base64url");
function problem(code,status=400){const x=new Error(code);x.code=code;x.status=status;return x}
function mac(secret,payload){return createHmac("sha256",secret).update(payload).digest("base64url")}
export function webauthnConfigured(config){return Boolean(config.webauthnRpId&&config.webauthnOrigin&&config.sessionSecret)}
export function issueWebAuthnState(config,purpose,subject){
  if(!webauthnConfigured(config))throw problem("WEBAUTHN_NOT_CONFIGURED",503);
  const challenge=e(randomBytes(32)),payload=e(Buffer.from(JSON.stringify({c:challenge,p:purpose,s:String(subject),exp:Date.now()+300000})));
  return{challenge,state:payload+"."+mac(config.sessionSecret,payload)}
}
export function verifyWebAuthnState(config,state,purpose,subject){
  const[payload,sig]=String(state||"").split(".");if(!payload||!sig)throw problem("WEBAUTHN_STATE_INVALID",400);
  const expected=Buffer.from(mac(config.sessionSecret,payload));const actual=Buffer.from(sig);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw problem("WEBAUTHN_STATE_INVALID",400);
  let x;try{x=JSON.parse(b(payload).toString("utf8"))}catch{throw problem("WEBAUTHN_STATE_INVALID",400)}
  if(x.p!==purpose||String(x.s)!==String(subject)||!x.exp||Date.now()>x.exp)throw problem("WEBAUTHN_STATE_INVALID",400);
  return x
}
function clientData(raw,expectedChallenge,origin,type){
  let json,buf;try{buf=b(raw);json=JSON.parse(buf.toString("utf8"))}catch{throw problem("WEBAUTHN_CLIENT_DATA_INVALID",400)}
  if(json.type!==type||json.challenge!==expectedChallenge||json.origin!==origin)throw problem("WEBAUTHN_CLIENT_DATA_INVALID",400);
  return{json,buf}
}
function authData(raw,rpId){
  const buf=b(raw);if(buf.length<37)throw problem("WEBAUTHN_AUTH_DATA_INVALID",400);
  const expected=createHash("sha256").update(rpId).digest();
  if(!timingSafeEqual(buf.subarray(0,32),expected))throw problem("WEBAUTHN_RP_ID_MISMATCH",400);
  const flags=buf[32];if((flags&1)!==1||(flags&4)!==4)throw problem("WEBAUTHN_USER_VERIFICATION_REQUIRED",400);
  return{buf,signCount:buf.readUInt32BE(33)}
}
export function validateWebAuthnRegistration(config,input,stateInfo){
  clientData(input.client_data_json,stateInfo.c,config.webauthnOrigin,"webauthn.create");
  const ad=authData(input.authenticator_data,config.webauthnRpId);
  const credentialId=String(input.credential_id||""),spki=String(input.public_key_spki||"");
  if(credentialId.length<16||credentialId.length>2048||spki.length<40||spki.length>8192)throw problem("WEBAUTHN_CREDENTIAL_INVALID",400);
  let key;try{key=createPublicKey({key:b(spki),format:"der",type:"spki"})}catch{throw problem("WEBAUTHN_PUBLIC_KEY_INVALID",400)}
  if(key.asymmetricKeyType!=="ec"||key.asymmetricKeyDetails?.namedCurve!=="prime256v1")throw problem("WEBAUTHN_ALGORITHM_UNSUPPORTED",400);
  return{credential_id:credentialId,public_key_spki:spki,sign_count:ad.signCount,transports:Array.isArray(input.transports)?input.transports.slice(0,8):[],label:String(input.label||"Passkey").slice(0,120)}
}
export function verifyWebAuthnAssertion(config,input,stateInfo,credential){
  const cd=clientData(input.client_data_json,stateInfo.c,config.webauthnOrigin,"webauthn.get");
  const ad=authData(input.authenticator_data,config.webauthnRpId);
  if(String(input.credential_id)!==String(credential.credential_id))throw problem("WEBAUTHN_CREDENTIAL_MISMATCH",400);
  const signed=Buffer.concat([ad.buf,createHash("sha256").update(cd.buf).digest()]);
  let key;try{key=createPublicKey({key:b(credential.public_key_spki),format:"der",type:"spki"})}catch{throw problem("WEBAUTHN_PUBLIC_KEY_INVALID",400)}
  if(!verifySignature("sha256",signed,key,b(input.signature)))throw problem("WEBAUTHN_SIGNATURE_INVALID",401);
  const old=Number(credential.sign_count||0),next=Number(ad.signCount||0);if(old>0&&next>0&&next<=old)throw problem("WEBAUTHN_COUNTER_REPLAY",401);
  return{verified:true,sign_count:next}
}
export function publicPasskeyOptions(config,subject,name,credentials,purpose){
  const s=issueWebAuthnState(config,purpose,subject),list=(credentials||[]).filter(x=>x.enabled!==false).map(x=>({type:"public-key",id:x.credential_id,transports:Array.isArray(x.transports)?x.transports:[]}));
  if(purpose==="register")return{state:s.state,publicKey:{challenge:s.challenge,rp:{id:config.webauthnRpId,name:"Audiotel Premium Pro"},user:{id:e(createHash("sha256").update(String(subject)).digest()),name:String(name||subject),displayName:String(name||subject)},pubKeyCredParams:[{type:"public-key",alg:-7}],timeout:60000,attestation:"none",authenticatorSelection:{residentKey:"preferred",userVerification:"required"},excludeCredentials:list}};
  return{state:s.state,publicKey:{challenge:s.challenge,rpId:config.webauthnRpId,timeout:60000,userVerification:"required",allowCredentials:list}}
}

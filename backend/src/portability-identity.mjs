import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";

const RIO_ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+";

export function normalizeFrenchSvaRio(value,e164){
  const rio=String(value||"").toUpperCase().replace(/\s+/g,"");
  if(!/^[0-9]{2}A[A-Z0-9]{6}[A-Z0-9+]{3}$/.test(rio))throw portabilityIdentityError("INVALID_PORTABILITY_RIO");
  const national=frNationalNumber(e164);
  const expected=rioChecksum(rio.slice(0,9),national);
  if(rio.slice(9)!==expected)throw portabilityIdentityError("INVALID_PORTABILITY_RIO");
  return rio;
}

export function rioFingerprint(rio,e164,secret){
  const key=requireSecret(secret);
  return createHmac("sha256",key).update(String(e164||"")+"|"+String(rio||"")).digest("hex");
}

export function encryptPortabilityCredential(value,secret){
  const key=createHash("sha256").update(requireSecret(secret)).digest();
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]),iv,tag,encrypted]);
}

export function decryptPortabilityCredential(payload,secret){
  const buf=Buffer.isBuffer(payload)?payload:Buffer.from(payload||[]);
  if(buf.length<30||buf[0]!==1)throw portabilityIdentityError("INVALID_PORTABILITY_CREDENTIAL");
  const key=createHash("sha256").update(requireSecret(secret)).digest();
  const iv=buf.subarray(1,13),tag=buf.subarray(13,29),encrypted=buf.subarray(29);
  const decipher=createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString("utf8");
}

export function rioChecksum(prefix,nationalNumber){
  let a=0,b=0,c=0;
  const source=String(prefix||"")+String(nationalNumber||"");
  for(const ch of source){
    const pos=RIO_ALPHABET.indexOf(ch);
    if(pos<0)throw portabilityIdentityError("INVALID_PORTABILITY_RIO");
    a=(a+pos)%37;
    b=(2*b+pos)%37;
    c=(4*c+pos)%37;
  }
  return RIO_ALPHABET[a]+RIO_ALPHABET[b]+RIO_ALPHABET[c];
}

function frNationalNumber(e164){
  const value=String(e164||"").replace(/\s+/g,"");
  if(!/^\+33[1-9][0-9]{8}$/.test(value))throw portabilityIdentityError("INVALID_PORTABILITY_NUMBER");
  return "0"+value.slice(3);
}

function requireSecret(secret){
  const value=String(secret||"");
  if(value.length<32)throw portabilityIdentityError("PORTABILITY_SECRET_UNAVAILABLE");
  return value;
}

function portabilityIdentityError(code){
  const error=new Error(code);
  error.code=code;
  return error;
}

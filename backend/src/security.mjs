import {createHmac,createHash,randomBytes,scryptSync,timingSafeEqual} from "node:crypto";

export function parseCookies(header=""){
  const out={};
  for(const part of String(header).split(";")){
    const i=part.indexOf("=");
    if(i<1)continue;
    const k=part.slice(0,i).trim();
    const v=part.slice(i+1).trim();
    try{out[k]=decodeURIComponent(v);}catch{out[k]=v;}
  }
  return out;
}

export function hashPassword(password){
  if(typeof password!=="string"||password.length<12)throw new Error("password must be at least 12 characters");
  const salt=randomBytes(16);
  const N=16384,r=8,p=1;
  const digest=scryptSync(password,salt,64,{N,r,p,maxmem:64*1024*1024});
  return ["scrypt",N,r,p,salt.toString("base64url"),digest.toString("base64url")].join("$");
}

export function verifyPassword(password,encoded){
  try{
    const [kind,n,r,p,saltB64,digestB64]=String(encoded).split("$");
    if(kind!=="scrypt")return false;
    const expected=Buffer.from(digestB64,"base64url");
    const actual=scryptSync(String(password),Buffer.from(saltB64,"base64url"),expected.length,{
      N:Number(n),r:Number(r),p:Number(p),maxmem:64*1024*1024
    });
    return expected.length===actual.length&&timingSafeEqual(expected,actual);
  }catch{return false;}
}

export function issueSession({secret,user,ttlSeconds}){
  if(!secret)throw new Error("session secret required");
  const now=Math.floor(Date.now()/1000);
  const csrf=randomBytes(24).toString("base64url");
  const payload={sub:String(user.id),role:user.role,name:user.name,iat:now,exp:now+ttlSeconds,csrf};
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=createHmac("sha256",secret).update(encoded).digest("base64url");
  return {token:encoded+"."+sig,csrf,payload};
}

export function verifySession(token,secret){
  try{
    const [encoded,sig]=String(token||"").split(".");
    if(!encoded||!sig)return null;
    const expected=createHmac("sha256",secret).update(encoded).digest();
    const actual=Buffer.from(sig,"base64url");
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
    const payload=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
    if(!payload.exp||payload.exp<Math.floor(Date.now()/1000))return null;
    return payload;
  }catch{return null;}
}

export function constantTimeTokenEqual(a,b){
  const ah=createHash("sha256").update(String(a||"")).digest();
  const bh=createHash("sha256").update(String(b||"")).digest();
  return timingSafeEqual(ah,bh);
}

export function sessionCookie(token,maxAge){
  return "__Host-pgi_session="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+maxAge;
}
export function csrfCookie(token,maxAge){
  return "__Host-pgi_csrf="+encodeURIComponent(token)+"; Path=/; Secure; SameSite=Strict; Max-Age="+maxAge;
}
export function clearSessionCookies(){
  return [
    "__Host-pgi_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    "__Host-pgi_csrf=; Path=/; Secure; SameSite=Strict; Max-Age=0"
  ];
}

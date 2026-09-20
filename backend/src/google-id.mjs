import {createPublicKey,createVerify} from "node:crypto";

const GOOGLE_JWKS_URL="https://www.googleapis.com/oauth2/v3/certs";
let cache={expiresAt:0,keys:[]};

function failure(code,status=401){const e=new Error(code);e.code=code;e.status=status;return e;}
function decodePart(value){try{return JSON.parse(Buffer.from(String(value),"base64url").toString("utf8"));}catch{throw failure("GOOGLE_ID_TOKEN_INVALID");}}
function maxAge(header){const m=String(header||"").match(/(?:^|,)\s*max-age=(\d+)/i);return m?Math.max(60,Math.min(86400,Number(m[1])||300)):300;}
async function keys(fetchImpl,force=false){
  const now=Date.now();
  if(!force&&cache.keys.length&&cache.expiresAt>now)return cache.keys;
  const response=await fetchImpl(GOOGLE_JWKS_URL,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw failure("GOOGLE_KEYS_UNAVAILABLE",503);
  const body=await response.json(),list=Array.isArray(body?.keys)?body.keys.filter(x=>x&&x.kty==="RSA"&&x.kid):[];
  if(!list.length)throw failure("GOOGLE_KEYS_UNAVAILABLE",503);
  cache={keys:list,expiresAt:now+maxAge(response.headers.get("cache-control"))*1000};
  return list;
}
function audienceMatches(aud,clientId){return Array.isArray(aud)?aud.includes(clientId):String(aud||"")===clientId;}
function authorizedPartyMatches(payload,clientId){
  const aud=payload?.aud;
  const azp=payload?.azp==null?"":String(payload.azp);
  if(Array.isArray(aud)&&aud.length>1)return azp===clientId;
  return !azp||azp===clientId;
}
function validIssuedAt(payload,nowSec){
  const iat=Number(payload?.iat);
  return Number.isFinite(iat)&&iat>0&&iat<=nowSec+60;
}

export async function verifyGoogleIdToken(token,clientId,{fetchImpl=fetch,now=Date.now()}={}){
  if(!clientId)throw failure("GOOGLE_AUTH_NOT_CONFIGURED",503);
  const parts=String(token||"").split(".");
  if(parts.length!==3)throw failure("GOOGLE_ID_TOKEN_INVALID");
  const header=decodePart(parts[0]),payload=decodePart(parts[1]);
  if(header.alg!=="RS256"||!header.kid)throw failure("GOOGLE_ID_TOKEN_INVALID");
  let list=await keys(fetchImpl),jwk=list.find(x=>x.kid===header.kid);
  if(!jwk){list=await keys(fetchImpl,true);jwk=list.find(x=>x.kid===header.kid);}
  if(!jwk)throw failure("GOOGLE_ID_TOKEN_INVALID");
  let ok=false;
  try{
    const verifier=createVerify("RSA-SHA256");verifier.update(parts[0]+"."+parts[1]);verifier.end();
    ok=verifier.verify(createPublicKey({key:jwk,format:"jwk"}),Buffer.from(parts[2],"base64url"));
  }catch{}
  if(!ok)throw failure("GOOGLE_ID_TOKEN_INVALID");
  const nowSec=Math.floor(Number(now)/1000),exp=Number(payload.exp);
  if(!["accounts.google.com","https://accounts.google.com"].includes(payload.iss))throw failure("GOOGLE_ID_TOKEN_INVALID");
  if(!audienceMatches(payload.aud,clientId)||!authorizedPartyMatches(payload,clientId))throw failure("GOOGLE_ID_TOKEN_INVALID");
  if(!Number.isFinite(exp)||exp<=nowSec)throw failure("GOOGLE_ID_TOKEN_EXPIRED");
  if(!validIssuedAt(payload,nowSec)||exp<=Number(payload.iat))throw failure("GOOGLE_ID_TOKEN_INVALID");
  if(payload.nbf!=null&&Number(payload.nbf)>nowSec+60)throw failure("GOOGLE_ID_TOKEN_INVALID");
  if(!payload.sub||String(payload.sub).length>255||!payload.email||String(payload.email).length>320||payload.email_verified!==true)throw failure("GOOGLE_EMAIL_NOT_VERIFIED",403);
  const email=String(payload.email).trim().toLowerCase(),hd=payload.hd?String(payload.hd).trim().toLowerCase():null;
  if(!email||!email.includes("@"))throw failure("GOOGLE_EMAIL_NOT_VERIFIED",403);
  return Object.freeze({provider:"google",subject:String(payload.sub),email,email_verified:true,display_name:String(payload.name||payload.given_name||email).slice(0,160),hosted_domain:hd,picture_url:payload.picture?String(payload.picture).slice(0,2048):null,authoritative_email:email.endsWith("@gmail.com")||Boolean(hd)});
}
export function resetGoogleKeyCacheForTests(){cache={expiresAt:0,keys:[]};}

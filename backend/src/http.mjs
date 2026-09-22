import {randomUUID} from "node:crypto";

export function securityHeaders(res,requestId){
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy","same-origin");
  res.setHeader("Cross-Origin-Opener-Policy","same-origin-allow-popups");
  res.setHeader("X-Permitted-Cross-Domain-Policies","none");
  res.setHeader("Origin-Agent-Cluster","?1");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Request-Id",requestId||randomUUID());
}

export async function readJson(req,limitBytes){
  const declared=Number(req.headers?.["content-length"]||0);
  if(Number.isFinite(declared)&&declared>limitBytes){
    const e=new Error("BODY_TOO_LARGE");e.status=413;e.code="BODY_TOO_LARGE";throw e;
  }
  const contentType=String(req.headers?.["content-type"]||"").toLowerCase();
  if(declared>0&&!contentType.startsWith("application/json")){
    const e=new Error("JSON content type required");e.status=415;e.code="UNSUPPORTED_MEDIA_TYPE";throw e;
  }
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>limitBytes){
      const e=new Error("BODY_TOO_LARGE");e.status=413;e.code="BODY_TOO_LARGE";throw e;
    }
    chunks.push(chunk);
  }
  if(!chunks.length)return {};
  const raw=Buffer.concat(chunks).toString("utf8");
  try{return JSON.parse(raw);}
  catch{
    const e=new Error("INVALID_JSON");e.status=400;e.code="INVALID_JSON";throw e;
  }
}

export function json(res,status,payload,extraHeaders={}){
  const body=JSON.stringify(payload);
  res.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

export function problemJson(res,error,requestId){
  const status=Number(error?.status)||500;
  const internalCode=String(error?.code||"REQUEST_FAILED");
  const expose=error?.expose===true;
  const code=status>=500&&!expose?"INTERNAL_ERROR":internalCode;
  const message=status>=500&&!expose?"Internal server error":String(error?.message||code);
  json(res,status,{error:{code,message,request_id:requestId}});
}

export function routeMatch(pathname,pattern){
  const a=pathname.split("/").filter(Boolean);
  const b=pattern.split("/").filter(Boolean);
  if(a.length!==b.length)return null;
  const params={};
  for(let i=0;i<b.length;i++){
    if(b[i].startsWith(":")){
      try{params[b[i].slice(1)]=decodeURIComponent(a[i]);}
      catch{
        const e=new Error("Invalid route parameter encoding");e.status=400;e.code="INVALID_PATH_ENCODING";throw e;
      }
    }else if(a[i]!==b[i])return null;
  }
  return params;
}

export function clientIp(req,trustProxy=false){
  const socketIp=String(req.socket?.remoteAddress||"unknown");
  if(trustProxy||isLoopbackProxy(socketIp)){
    const raw=req.headers?.["x-forwarded-for"];
    const value=Array.isArray(raw)?raw[0]:raw;
    const first=String(value||"").split(",")[0].trim();
    if(first&&first.length<=64&&/^[0-9a-fA-F:.%]+$/.test(first))return first;
  }
  return socketIp;
}

function isLoopbackProxy(ip){
  return ip==="127.0.0.1"||ip==="::1"||ip==="::ffff:127.0.0.1";
}

export function text(res,status,payload,contentType="text/plain; charset=utf-8"){
  const body=String(payload??"");
  res.writeHead(status,{"Content-Type":contentType,"Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store"});
  res.end(body);
}

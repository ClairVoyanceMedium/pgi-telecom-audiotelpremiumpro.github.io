import {randomUUID} from "node:crypto";

export function securityHeaders(res,requestId){
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Request-Id",requestId||randomUUID());
}

export async function readJson(req,limitBytes){
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
  const code=status>=500?"INTERNAL_ERROR":String(error?.code||"REQUEST_FAILED");
  json(res,status,{error:{code,message:status>=500?"Internal server error":String(error?.message||code),request_id:requestId}});
}

export function routeMatch(pathname,pattern){
  const a=pathname.split("/").filter(Boolean);
  const b=pattern.split("/").filter(Boolean);
  if(a.length!==b.length)return null;
  const params={};
  for(let i=0;i<b.length;i++){
    if(b[i].startsWith(":"))params[b[i].slice(1)]=decodeURIComponent(a[i]);
    else if(a[i]!==b[i])return null;
  }
  return params;
}

export function clientIp(req){
  return req.socket?.remoteAddress||"unknown";
}

export function text(res,status,payload,contentType="text/plain; charset=utf-8"){
  const body=String(payload??"");
  res.writeHead(status,{"Content-Type":contentType,"Content-Length":Buffer.byteLength(body),"Cache-Control":"no-store"});
  res.end(body);
}

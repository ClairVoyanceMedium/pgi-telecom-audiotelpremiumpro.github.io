import {randomUUID} from "node:crypto";

const base=String(process.env.PGI_SYNTHETIC_TARGET||"http://127.0.0.1:8080").replace(/\/$/,"");
const remote=!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(base);
if(remote&&!base.startsWith("https://"))throw new Error("Remote synthetic probes require HTTPS");
const probes=remote?[["api.health","/api/v1/health",200],["site.home","/",200],["site.client","/client.html",200],["auth.boundary","/api/v1/customer/auth/me",401]]:[["api.health","/api/v1/health",200],["api.ready","/api/v1/ready",200]];
const results=[];
for(const [key,path,expected] of probes){
  const started=performance.now();let status=null,success=false,errorCode=null;
  try{const r=await fetch(base+path,{headers:{Accept:"application/json","User-Agent":"PGI-Synthetic-Probe/1"},cache:"no-store",signal:AbortSignal.timeout(10000)});status=r.status;success=r.status===expected;const body=await r.json().catch(()=>null);if(!success)errorCode=body?.error?.code||"HTTP_"+r.status;}catch(e){errorCode=e?.name||"PROBE_FAILED";}
  const row={probe_key:key,success,latency_ms:performance.now()-started,http_status:status,release_id:process.env.PGI_RELEASE_ID||null,error_code:errorCode,details:{path,expected_status:expected}};
  results.push(row);
  const cookie=process.env.PGI_SYNTHETIC_ADMIN_COOKIE||"",csrf=process.env.PGI_SYNTHETIC_CSRF||"";
  if(cookie&&csrf){
    const r=await fetch(base+"/api/v1/platform/performance-lab/synthetic",{method:"POST",headers:{"Content-Type":"application/json","Cookie":cookie,"X-CSRF-Token":csrf,"Idempotency-Key":randomUUID()},body:JSON.stringify(row),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error("Unable to record synthetic probe: HTTP "+r.status);
  }
}
console.log(JSON.stringify({target:base,checked_at:new Date().toISOString(),results},null,2));
if(results.some(x=>!x.success))process.exitCode=1;

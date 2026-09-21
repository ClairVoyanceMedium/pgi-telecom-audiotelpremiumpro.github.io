import {randomUUID} from "node:crypto";

const args=Object.fromEntries(process.argv.slice(2).map(x=>{const [k,...v]=x.replace(/^--/,"").split("=");return [k,v.join("=")||"true"];}));
const base=String(args.target||process.env.PGI_PERF_TARGET||"http://127.0.0.1:8080").replace(/\/$/,"");
const scenario=String(args.scenario||process.env.PGI_PERF_SCENARIO||"load").toLowerCase();
if(!["load","stress","spike","soak"].includes(scenario))throw new Error("scenario must be load, stress, spike or soak");
const remote=!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(base);
if(remote&&String(process.env.PGI_PERF_ALLOW_REMOTE||"").toLowerCase()!=="true")throw new Error("Remote load tests require PGI_PERF_ALLOW_REMOTE=true");
const presets={load:{duration:20,concurrency:20},stress:{duration:30,concurrency:50},spike:{duration:15,concurrency:100},soak:{duration:120,concurrency:20}};
const duration=Math.max(3,Math.min(1800,Number(args.duration||process.env.PGI_PERF_DURATION_SECONDS||presets[scenario].duration)));
const concurrency=Math.max(1,Math.min(500,Number(args.concurrency||process.env.PGI_PERF_CONCURRENCY||presets[scenario].concurrency)));
const p95Limit=Math.max(10,Number(process.env.PGI_PERF_P95_MS||500)),errorLimit=Math.max(0,Math.min(1,Number(process.env.PGI_PERF_ERROR_RATE||0.01)));
const maxRps=Math.max(0,Math.min(50000,Number(process.env.PGI_PERF_MAX_RPS||0))),minWorkerGap=maxRps?1000*concurrency/maxRps:0;
const paths=String(process.env.PGI_PERF_PATHS||"/api/v1/health,/api/v1/ready").split(",").map(x=>x.trim()).filter(x=>x.startsWith("/")&&!/[?#]/.test(x));
if(!paths.length)throw new Error("PGI_PERF_PATHS must contain safe GET paths");
const samples=[],startedAt=new Date(),deadline=Date.now()+duration*1000;let requests=0,errors=0;
async function worker(index){
  let n=index;
  while(Date.now()<deadline){
    const path=paths[n++%paths.length],start=performance.now();
    try{
      const r=await fetch(base+path,{method:"GET",headers:{Accept:"application/json","User-Agent":"PGI-Performance-Lab/1"},redirect:"manual",signal:AbortSignal.timeout(10000)});
      const ms=performance.now()-start;samples.push(ms);requests++;
      if(!r.ok)errors++;
      await r.arrayBuffer();
    }catch{samples.push(performance.now()-start);requests++;errors++;}
    if(minWorkerGap>0){const rest=minWorkerGap-(performance.now()-start);if(rest>0)await new Promise(resolve=>setTimeout(resolve,rest));}
  }
}
await Promise.all(Array.from({length:concurrency},(_,i)=>worker(i)));
samples.sort((a,b)=>a-b);
const percentile=p=>samples.length?samples[Math.min(samples.length-1,Math.max(0,Math.ceil(samples.length*p)-1))]:0;
const completedAt=new Date(),elapsed=(completedAt-startedAt)/1000,errorRate=requests?errors/requests:1;
const result={run_type:scenario,scenario:"safe_get_mix",target:base,status:errorRate<=errorLimit&&percentile(.95)<=p95Limit?"passed":"failed",started_at:startedAt.toISOString(),completed_at:completedAt.toISOString(),requests_total:requests,errors_total:errors,error_rate:errorRate,p50_ms:percentile(.5),p95_ms:percentile(.95),p99_ms:percentile(.99),requests_per_second:requests/Math.max(.001,elapsed),virtual_users:concurrency,thresholds:{p95_ms:p95Limit,error_rate:errorLimit},details:{paths,duration_seconds:duration,remote,max_rps:maxRps||null}};
console.log(JSON.stringify(result,null,2));
const cookie=process.env.PGI_PERF_ADMIN_COOKIE||"",csrf=process.env.PGI_PERF_CSRF||"";
if(cookie&&csrf){
  const r=await fetch(base+"/api/v1/platform/performance-lab/runs",{method:"POST",headers:{"Content-Type":"application/json","Cookie":cookie,"X-CSRF-Token":csrf,"Idempotency-Key":randomUUID()},body:JSON.stringify(result),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error("Unable to record Performance Lab result: HTTP "+r.status);
}
if(result.status!=="passed")process.exitCode=1;

import assert from "node:assert/strict";
import {MemoryStore} from "../backend/src/store-memory.mjs";
import {EventBus} from "../backend/src/event-bus.mjs";

const store=new MemoryStore({mode:"simulator",rateLimitPerMinute:240},new EventBus());
const checks=[],start=new Date();
const record=(name,pass,detail)=>checks.push({name,pass,detail});
try{
  const recover=await store.enqueueWork("drill",{kind:"lease-recovery"},{max_attempts:3});
  let claimed=await store.claimWork("drill","worker-a",1,15);
  assert.equal(claimed[0].id,recover.id);
  const raw=store.workQueue.find(x=>x.id===recover.id);raw.lease_expires_at=new Date(Date.now()-1000).toISOString();
  claimed=await store.claimWork("drill","worker-b",1,15);
  assert.equal(claimed[0].id,recover.id);assert.equal(claimed[0].locked_by,"worker-b");
  await store.completeWork(recover.id,"worker-b");
  record("expired lease takeover",true,"worker-b reclaimed and completed abandoned work");

  const dead=await store.enqueueWork("drill",{kind:"dead-letter"},{max_attempts:1});
  claimed=await store.claimWork("drill","worker-c",1,15);
  const failed=await store.failWork(dead.id,"worker-c","controlled drill failure",1);
  assert.equal(failed.state,"dead_lettered");
  const health=await store.workQueueHealth();assert.equal(health.dead_lettered,1);
  record("dead-letter isolation",true,"failed work was isolated after max attempts");

  const good=await store.enqueueWork("drill",{kind:"healthy-after-failure"},{max_attempts:2});
  claimed=await store.claimWork("drill","worker-d",1,15);await store.completeWork(good.id,"worker-d");
  record("post-failure progress",true,"new work completed after controlled failure");
}catch(e){record("drill",false,e.message);process.exitCode=1;}
const end=new Date(),result={run_type:"chaos",scenario:"local_queue_resilience",status:checks.every(x=>x.pass)?"passed":"failed",started_at:start.toISOString(),completed_at:end.toISOString(),requests_total:0,errors_total:checks.filter(x=>!x.pass).length,error_rate:checks.some(x=>!x.pass)?1:0,p50_ms:null,p95_ms:null,p99_ms:null,requests_per_second:null,virtual_users:null,thresholds:{all_checks_pass:true},details:{checks}};
console.log(JSON.stringify(result,null,2));

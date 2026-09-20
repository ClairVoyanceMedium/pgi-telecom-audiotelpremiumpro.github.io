import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import {createBackend,evaluateReadiness,resolveTelephonyRoutingContext} from "../backend/server.mjs";
import {loadConfig} from "../backend/src/config.mjs";
import {hashPassword,verifyPassword,issueSession,verifySession,sessionCookie,csrfCookie,customerSessionCookie,customerCsrfCookie,clearCustomerSessionCookies} from "../backend/src/security.mjs";
import {selectExpert} from "../backend/src/expert-router.mjs";
import {clientIp,routeMatch} from "../backend/src/http.mjs";
import {sanitizeCdrPayload,deriveCallerHash} from "../backend/src/cdr-privacy.mjs";
import {normalizeFreeSwitchCdr} from "../backend/src/cdr-freeswitch.mjs";
import {computeExpertCost} from "../backend/src/expert-finance.mjs";

const backendServer=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");

function config(overrides={}){
  return {
    mode:"simulator",authMode:"disabled",host:"127.0.0.1",port:0,
    sessionSecret:"",adminPasswordHash:"",ingestToken:"",
    adminUsername:"admin",sessionTtlSeconds:3600,bodyLimitBytes:262144,rateLimitPerMinute:10000,
    authMaxFailures:8,authFailureWindowSeconds:900,
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,reconciliationToleranceHt:.01,
    version:"test",...overrides
  };
}

async function withServer(fn){
  const app=createBackend({config:config()});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  try{await fn({app,base});}finally{await app.close();}
}

test("production config rejects missing or malformed release identity",()=>{
  const secret="x".repeat(48);
  const base={
    PGI_BACKEND_MODE:"production",
    PGI_AUTH_MODE:"session",
    PGI_SESSION_SECRET:secret,
    PGI_ADMIN_PASSWORD_HASH:"scrypt$16384$8$1$placeholder$placeholder",
    PGI_INGEST_TOKEN:secret,
    PGI_TELEPHONY_USER:"pgi-telephony",
    PGI_TELEPHONY_PASSWORD:secret,
    PGI_CALLER_HASH_KEY:secret,
    PGI_DATABASE_URL:"postgresql://user:password@postgres:5432/pgi_telecom",
    PGI_DATABASE_SSL:"disable"
  };
  assert.throws(()=>loadConfig(base),/PGI_RELEASE_ID/);
  assert.throws(()=>loadConfig({...base,PGI_RELEASE_ID:"abc"}),/PGI_RELEASE_ID/);
  const cfg=loadConfig({...base,PGI_RELEASE_ID:"a".repeat(40)});
  assert.equal(cfg.releaseId,"a".repeat(40));
});

test("password hashing and signed sessions reject tampering",()=>{
  const encoded=hashPassword("a-very-long-test-password");
  assert.equal(verifyPassword("a-very-long-test-password",encoded),true);
  assert.equal(verifyPassword("wrong-password",encoded),false);
  const issued=issueSession({secret:"x".repeat(40),user:{id:"1",role:"admin",name:"A"},ttlSeconds:60});
  assert.equal(verifySession(issued.token,"x".repeat(40)).role,"admin");
  assert.equal(verifySession(issued.token+"x","x".repeat(40)),null);
});

test("traceparent is propagated with the same trace id",async()=>{
  await withServer(async({base})=>{
    const traceId="0123456789abcdef0123456789abcdef";
    const r=await fetch(base+"/api/v1/health",{
      headers:{traceparent:"00-"+traceId+"-0123456789abcdef-01"}
    });
    assert.equal(r.status,200);
    assert.equal(r.headers.get("x-trace-id"),traceId);
    assert.match(r.headers.get("traceparent")||"",new RegExp("^00-"+traceId+"-[0-9a-f]{16}-01$"));
  });
});

test("admin login has a dedicated per-client brute-force limit",async()=>{
  const password="correct-test-password-123";
  const app=createBackend({config:config({
    authMode:"session",sessionSecret:"x".repeat(40),
    adminPasswordHash:hashPassword(password),authMaxFailures:3,authFailureWindowSeconds:900
  })});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  const attempt=(candidate,ip)=>fetch(base+"/api/v1/auth/login",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Forwarded-For":ip},
    body:JSON.stringify({username:"admin",password:candidate})
  });
  try{
    for(let i=0;i<3;i++){
      const r=await attempt("wrong-password","203.0.113.7");
      assert.equal(r.status,401);
    }
    let r=await attempt("wrong-password","203.0.113.7");
    assert.equal(r.status,429);
    assert.equal((await r.json()).error.code,"AUTH_RATE_LIMITED");

    r=await attempt(password,"203.0.113.8");
    assert.equal(r.status,200);

    r=await fetch(base+"/metrics");
    assert.match(await r.text(),/pgi_auth_rate_limited_total 1/);
  }finally{
    await app.close();
  }
});

test("invalid encoded route parameters fail as a client error",()=>{
  assert.throws(
    ()=>routeMatch("/api/v1/experts/%/status","/api/v1/experts/:id/status"),
    error=>error.status===400&&error.code==="INVALID_PATH_ENCODING"
  );
});

test("customer can self-register by email without Google",async()=>{
  const app=createBackend({config:config({authMode:"session",sessionSecret:"x".repeat(40),adminPasswordHash:hashPassword("admin-password-for-tests")})});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  try{
    const response=await fetch(base+"/api/v1/customer/auth/register",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        first_name:"Camille",last_name:"Martin",company_name:"Cabinet Martin",country_code:"FR",
        registration_number:"",phone:"+33600000000",email:"camille@example.test",
        password:"long-password-12345",authority_confirmed:true,website:"",preferred_locale:"fr-FR",timezone:"Europe/Paris"
      })
    });
    assert.equal(response.status,201);
    const body=await response.json();
    assert.equal(body.account_created,true);
    assert.equal(body.onboarding,true);
    assert.equal(body.email_verification_required,true);
    assert.equal(body.user.role,"owner");
    assert.equal(body.user.tenant.status,"pending");
    assert.match(response.headers.get("set-cookie")||"",/__Host-pgi_customer_session=/);
  }finally{
    await app.close();
  }
});

test("different-origin browser login is rejected",async()=>{
  const password="correct-test-password-123";
  const app=createBackend({config:config({
    authMode:"session",sessionSecret:"x".repeat(40),
    adminPasswordHash:hashPassword(password)
  })});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  try{
    const r=await fetch(base+"/api/v1/auth/login",{
      method:"POST",
      headers:{"Content-Type":"application/json","Origin":"https://other.example","Sec-Fetch-Site":"cross-site"},
      body:JSON.stringify({username:"admin",password})
    });
    assert.equal(r.status,403);
    assert.equal((await r.json()).error.code,"CROSS_SITE_REQUEST");
  }finally{
    await app.close();
  }
});

test("session cookies use the Host-only prefix",()=>{
  const session=sessionCookie("token",60);
  const csrf=csrfCookie("token",60);
  assert.match(session,/^__Host-pgi_session=/);
  assert.match(session,/; Path=\//);
  assert.match(session,/; HttpOnly/);
  assert.match(session,/; Secure/);
  assert.match(session,/; SameSite=Strict/);
  assert.match(csrf,/^__Host-pgi_csrf=/);
  assert.match(csrf,/; Path=\//);
  assert.match(csrf,/; Secure/);
  assert.match(csrf,/; SameSite=Strict/);
});

test("generic CDR privacy removes full caller identifiers",()=>{
  const p=sanitizeCdrPayload({
    external_call_id:"c1",
    caller_masked:"0612345678",
    caller_id_number:"0612345678",
    ani:"0612345678",
    secret_field:"do-not-store",
    quality:{mos:4.2,private_metric:"no"}
  });
  assert.equal(p.caller_masked,"•• •• •• 56 78");
  assert.equal("caller_id_number" in p,false);
  assert.equal("ani" in p,false);
  assert.equal("secret_field" in p,false);
  assert.deepEqual(p.quality,{mos:4.2});

  const a=deriveCallerHash(p,{key:"k".repeat(32),source:"carrier",sourceEventId:"evt-1"});
  const b=deriveCallerHash({...p,external_call_id:"c2"},{key:"k".repeat(32),source:"carrier",sourceEventId:"evt-2"});
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,b);

  assert.throws(
    ()=>sanitizeCdrPayload({external_call_id:"x".repeat(161)}),
    error=>error.status===400&&error.code==="INVALID_CDR_FIELD"
  );
  assert.throws(
    ()=>sanitizeCdrPayload({call_status:"invented"}),
    error=>error.status===400&&error.code==="INVALID_CDR_FIELD"
  );
  assert.throws(
    ()=>sanitizeCdrPayload({origin_type:"satellite"}),
    error=>error.status===400&&error.code==="INVALID_CDR_FIELD"
  );
  assert.throws(
    ()=>sanitizeCdrPayload({quality:{mos:9}}),
    error=>error.status===400&&error.code==="INVALID_CDR_FIELD"
  );
  assert.equal(sanitizeCdrPayload({call_destination_id:7,destination_label:"Standard client"}).call_destination_id,7);
  assert.throws(()=>sanitizeCdrPayload({call_destination_id:-1}),error=>error.status===400&&error.code==="INVALID_CDR_FIELD");
});

test("expert compensation engine supports all declared modes",()=>{
  assert.equal(computeExpertCost({type:"per_minute",rate:.18,billableSeconds:600,expectedPayoutHt:5}),1.8);
  assert.equal(computeExpertCost({type:"percentage",rate:20,billableSeconds:600,expectedPayoutHt:5}),1);
  assert.equal(computeExpertCost({type:"fixed",rate:2.5,billableSeconds:600,expectedPayoutHt:5}),2.5);
  assert.equal(computeExpertCost({type:"none",rate:99,billableSeconds:600,expectedPayoutHt:5}),0);
  assert.throws(()=>computeExpertCost({type:"percentage",rate:120,billableSeconds:600,expectedPayoutHt:5}),/percentage/);
});



test("external billing stays disabled by default and requires a dedicated production token",()=>{
  const secret="x".repeat(48);
  const base={PGI_BACKEND_MODE:"production",PGI_AUTH_MODE:"session",PGI_SESSION_SECRET:secret,PGI_ADMIN_PASSWORD_HASH:"scrypt$16384$8$1$placeholder$placeholder",PGI_INGEST_TOKEN:secret,PGI_TELEPHONY_USER:"pgi-telephony",PGI_TELEPHONY_PASSWORD:secret,PGI_CALLER_HASH_KEY:secret,PGI_DATABASE_URL:"postgresql://user:password@postgres:5432/pgi_telecom",PGI_RELEASE_ID:"a".repeat(40)};
  const internalOnly=loadConfig(base);
  assert.equal(internalOnly.externalBillingEnabled,false);
  assert.throws(()=>loadConfig({...base,PGI_EXTERNAL_BILLING_ENABLED:"true"}),/PGI_BILLING_INGEST_TOKEN/);
  const enabled=loadConfig({...base,PGI_EXTERNAL_BILLING_ENABLED:"true",PGI_BILLING_INGEST_TOKEN:secret});
  assert.equal(enabled.externalBillingEnabled,true);
  assert.equal(enabled.billingIngestToken,secret);
});

test("production telephony routing requires an SVA context",()=>{
  const production={mode:"production"};
  assert.throws(
    ()=>resolveTelephonyRoutingContext(new URL("https://local/api/v1/internal/routing/next-expert"),production),
    error=>error.status===400&&error.code==="SVA_ROUTING_CONTEXT_REQUIRED"
  );
  assert.throws(
    ()=>resolveTelephonyRoutingContext(new URL("https://local/api/v1/internal/routing/next-expert?sva_number=0890%3Cscript%3E"),production),
    error=>error.status===400&&error.code==="INVALID_SVA_ROUTING_CONTEXT"
  );
  assert.deepEqual(
    resolveTelephonyRoutingContext(new URL("https://local/api/v1/internal/routing/next-expert?sva_number=0890123456"),production),
    {svaNumber:"0890123456"}
  );
  assert.deepEqual(resolveTelephonyRoutingContext(new URL("https://local/api/v1/internal/routing/next-destination?sva_number=0890123456"),production),{svaNumber:"0890123456"});
  assert.deepEqual(
    resolveTelephonyRoutingContext(new URL("https://local/api/v1/internal/routing/next-expert"),{mode:"simulator"}),
    {svaNumber:null}
  );
});

test("readiness requires production database and fresh critical workers",()=>{
  const now=Date.parse("2026-09-18T12:00:10Z");
  const cfg={mode:"production",outboxWorkerStaleSeconds:15,alertsWorkerStaleSeconds:120};
  const ok=evaluateReadiness(
    {store:"postgres"},
    {stats:{lastOutboxSuccessAt:"2026-09-18T12:00:05Z",lastAlertsSuccessAt:"2026-09-18T11:59:30Z"}},
    cfg,now
  );
  assert.equal(ok.ready,true);
  assert.deepEqual(ok.checks,{database:true,outbox_worker:true,alerts_worker:true});
  assert.deepEqual(ok.ages_seconds,{outbox_worker:5,alerts_worker:40});

  const badStore=evaluateReadiness(
    {store:"memory"},
    {stats:{lastOutboxSuccessAt:"2026-09-18T12:00:05Z",lastAlertsSuccessAt:"2026-09-18T11:59:30Z"}},
    cfg,now
  );
  assert.equal(badStore.ready,false);

  const staleWorker=evaluateReadiness(
    {store:"postgres"},
    {stats:{lastOutboxSuccessAt:"2026-09-18T11:59:00Z",lastAlertsSuccessAt:"2026-09-18T11:59:30Z"}},
    cfg,now
  );
  assert.equal(staleWorker.ready,false);
  assert.equal(staleWorker.checks.outbox_worker,false);
});

test("readiness for an API-only node does not require local workers",()=>{
  const now=Date.parse("2026-09-18T12:00:10Z");
  const cfg={mode:"production",processRole:"api",outboxWorkerStaleSeconds:15,alertsWorkerStaleSeconds:120};
  const result=evaluateReadiness(
    {store:"postgres"},
    {stats:{lastOutboxSuccessAt:null,lastAlertsSuccessAt:null}},
    cfg,now
  );
  assert.equal(result.ready,true);
  assert.deepEqual(result.checks,{database:true});
  assert.equal(result.process_role,"api");
});

test("expert router chooses available least-loaded expert",()=>{
  const x=selectExpert([
    {id:1,status:"available",enabled:true,active_calls:2,last_assigned_at:"2026-01-01T00:00:00Z"},
    {id:2,status:"available",enabled:true,active_calls:0,last_assigned_at:"2026-01-02T00:00:00Z"},
    {id:3,status:"away",enabled:true,active_calls:0}
  ]);
  assert.equal(x.id,2);
});

test("shutdown drains an open SSE stream without hanging",async()=>{
  const app=createBackend({config:config({shutdownGraceMs:1000})});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  const response=await fetch(base+"/api/v1/events");
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const first=await reader.read();
  assert.equal(first.done,false);
  assert.match(Buffer.from(first.value).toString("utf8"),/event: ready/);

  await Promise.race([
    app.close(),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error("shutdown timeout")),1500))
  ]);

  const final=await reader.read();
  assert.equal(final.done,true);
});

test("backend health summary calls and metrics are operational",async()=>{
  await withServer(async({base})=>{
    let r=await fetch(base+"/api/v1/health");
    assert.equal(r.status,200);
    assert.equal((await r.json()).status,"ok");

    r=await fetch(base+"/api/v1/dashboard/summary");
    assert.equal(r.status,200);
    const summary=await r.json();
    assert.ok(summary.calls_total>0);
    assert.ok(summary.expected_payout_ht>=summary.confirmed_payout_ht);

    r=await fetch(base+"/api/v1/calls?limit=5");
    const calls=await r.json();
    assert.equal(r.status,200);
    assert.equal(calls.data.length,5);
    assert.ok(calls.next_cursor);

    r=await fetch(base+"/metrics");
    assert.equal(r.status,200);
    const metricsText=await r.text();
    assert.match(metricsText,/pgi_http_requests_total/);
    assert.match(metricsText,/pgi_worker_outbox_errors_total/);
    assert.match(metricsText,/pgi_worker_alert_errors_total/);
    assert.match(metricsText,/pgi_cdr_lag_seconds/);
    assert.match(metricsText,/pgi_experts_available/);
  });
});

test("app bootstrap collapses control-plane startup",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/app/bootstrap");
    assert.equal(r.status,200);
    const body=await r.json();
    assert.ok(body.user);
    assert.ok(body.baselines&&Array.isArray(body.baselines.data));
    assert.ok(body.wholesale);
    assert.equal(body.wholesale.foundation_version,"1.16");
    assert.ok(Number.isFinite(Date.parse(body.server_time)));
  });
});

test("dashboard bootstrap returns decision-ready data in one call",async()=>{
  await withServer(async({base})=>{
    const from="2026-09-01T00:00:00.000Z";
    const to="2026-09-30T23:59:59.999Z";
    const previousFrom="2026-08-01T00:00:00.000Z";
    const previousTo="2026-08-31T23:59:59.999Z";
    const q=new URLSearchParams({
      from,to,previous_from:previousFrom,previous_to:previousTo
    });
    const r=await fetch(base+"/api/v1/dashboard/bootstrap?"+q.toString());
    assert.equal(r.status,200);
    const body=await r.json();
    assert.ok(body.summary);
    assert.ok(body.previous_summary);
    assert.ok(body.analytics);
    assert.ok(body.experts&&Array.isArray(body.experts.data));
    assert.ok(body.system);
    assert.ok(body.route);
    assert.ok(body.reconciliation&&Array.isArray(body.reconciliation.data));
    assert.ok(Number.isFinite(Date.parse(body.server_time)));
  });
});

test("dashboard bootstrap rejects half-specified previous ranges",async()=>{
  await withServer(async({base})=>{
    const q=new URLSearchParams({
      from:"2026-09-01T00:00:00.000Z",
      to:"2026-09-30T23:59:59.999Z",
      previous_from:"2026-08-01T00:00:00.000Z"
    });
    const r=await fetch(base+"/api/v1/dashboard/bootstrap?"+q.toString());
    assert.equal(r.status,400);
    assert.equal((await r.json()).error.code,"INVALID_PREVIOUS_RANGE");
  });
});

test("dashboard analytics provides bounded chart dimensions",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/dashboard/analytics");
    assert.equal(r.status,200);
    const body=await r.json();
    assert.ok(["hour","day"].includes(body.granularity));
    assert.ok(Array.isArray(body.series)&&body.series.length>0);
    assert.ok(Array.isArray(body.hours)&&body.hours.length>0&&body.hours.length<=24);
    assert.ok(Array.isArray(body.weekdays)&&body.weekdays.length>0&&body.weekdays.length<=7);
    assert.ok(Array.isArray(body.heatmap)&&body.heatmap.length>0&&body.heatmap.length<=168);
    assert.ok(body.quality&&Number(body.quality.samples)>=0);
    assert.ok(Array.isArray(body.experts)&&body.experts.length<=50);
    assert.ok(Array.isArray(body.carriers)&&body.carriers.length<=50);
    assert.ok(Array.isArray(body.durations));
  });
});

test("wholesale overview is read-only and empty in simulator",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/platform/overview");
    assert.equal(r.status,200);
    const body=await r.json();
    assert.equal(body.foundation_version,"1.16");
    assert.equal(body.summary.tenants_total,0);
    assert.equal(body.summary.assignments_total,0);
    assert.equal(body.summary.payment_compliance_active,false);
    assert.deepEqual(body.tenants,[]);
    assert.deepEqual(body.numbers,[]);
    assert.deepEqual(body.settlements,[]);
    assert.equal(body.scale.bucket_capacity,4096);
    assert.equal(body.scale.call_fact_partitions,64);
    assert.equal(body.scale.clusters_ready,1);
    assert.equal(body.scale.regions_ready,1);
    assert.equal(body.scale.dr_targets_total,4);
  });
});

test("distributed work queue completes and dead-letters deterministically",async()=>{
  const app=createBackend({config:config()});
  const ok=await app.store.enqueueWork("test", {kind:"ok"}, {max_attempts:2});
  let claimed=await app.store.claimWork("test","worker-a",10,30);
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].id,ok.id);
  const completed=await app.store.completeWork(ok.id,"worker-a");
  assert.ok(completed.completed_at);

  const bad=await app.store.enqueueWork("test", {kind:"bad"}, {max_attempts:1});
  claimed=await app.store.claimWork("test","worker-b",10,30);
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].id,bad.id);
  const failed=await app.store.failWork(bad.id,"worker-b","boom",1);
  assert.equal(failed.state,"dead_lettered");
  const health=await app.store.workQueueHealth();
  assert.equal(health.dead_lettered,1);
});

test("tenant context contract rejects invalid tenant identifiers",async()=>{
  const app=createBackend({config:config()});
  await assert.rejects(()=>app.store.withTenantContext(0,async()=>true),/INVALID_TENANT_CONTEXT/);
  const value=await app.store.withTenantContext(1,async()=>42);
  assert.equal(value,42);
});

test("tenant directory is cursor-paginated and empty in simulator",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/platform/tenants?limit=25&q=test");
    assert.equal(r.status,200);
    const body=await r.json();
    assert.deepEqual(body.data,[]);
    assert.equal(body.next_cursor,null);
  });
});

test("customer fleet summary stays compact",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/platform/tenants/summary");
    assert.equal(r.status,200);
    const body=await r.json();
    assert.equal(body.tenants_total,0);
    assert.equal(body.assignments_active,0);
    assert.ok(Object.hasOwn(body,"subscription_access_blocked"));
  });
});

test("CDR ingest is idempotent",async()=>{
  await withServer(async({base})=>{
    const envelope={
      source:"test-carrier",
      source_event_id:"evt-1",
      payload:{
        external_call_id:"external-1",
        started_at:"2026-09-18T12:00:00Z",
        bridged_at:"2026-09-18T12:00:10Z",
        ended_at:"2026-09-18T12:10:10Z",
        conversation_seconds:600,
        call_status:"connected",
        caller_masked:"06 •• •• 12 34",
        origin_carrier:"Orange",
        origin_type:"mobile",
        host_carrier:"TestHost",
        sva_number:"0890000000",
        expert_id:1,
        expert_name:"Frederick",
        sip_final_code:200
      }
    };
    let r=await fetch(base+"/api/v1/ingest/cdr",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(envelope)});
    assert.equal(r.status,201);
    assert.equal((await r.json()).duplicate,false);

    r=await fetch(base+"/api/v1/ingest/cdr",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(envelope)});
    assert.equal(r.status,200);
    assert.equal((await r.json()).duplicate,true);
  });
});

test("CDR envelope rejects oversized source identifiers",async()=>{
  await withServer(async({base})=>{
    const r=await fetch(base+"/api/v1/ingest/cdr",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        source:"x".repeat(65),
        source_event_id:"evt-1",
        payload:{external_call_id:"call-1",started_at:"2026-09-18T12:00:00Z",ended_at:"2026-09-18T12:00:01Z"}
      })
    });
    assert.equal(r.status,400);
    assert.equal((await r.json()).error.code,"CDR_ENVELOPE_FIELD_INVALID");
  });
});

test("baseline mutations replay safely with same idempotency key",async()=>{
  await withServer(async({base})=>{
    const headers={"Content-Type":"application/json","Idempotency-Key":"11111111-1111-4111-8111-111111111111"};
    const body=JSON.stringify({scope:"global",reason:"test"});
    let r=await fetch(base+"/api/v1/metrics/baselines",{method:"POST",headers,body});
    assert.equal(r.status,201);
    const a=await r.json();
    assert.equal(a.replayed,false);

    r=await fetch(base+"/api/v1/metrics/baselines",{method:"POST",headers,body});
    assert.equal(r.status,201);
    const b=await r.json();
    assert.equal(b.replayed,true);
    assert.equal(b.id,a.id);

    r=await fetch(base+"/api/v1/metrics/baselines?scope=global&limit=20");
    assert.equal(r.status,200);
    const history=await r.json();
    assert.equal(history.data.length,1);
    assert.equal(history.data[0].id,a.id);
    assert.ok(history.data[0].effective_from);
  });
});

test("carrier switch can activate and rollback",async()=>{
  await withServer(async({base})=>{
    const key="22222222-2222-4222-8222-222222222222";
    let r=await fetch(base+"/api/v1/carrier-switches",{
      method:"POST",
      headers:{"Content-Type":"application/json","Idempotency-Key":key},
      body:JSON.stringify({route_key:"sva-primary",to_carrier_id:"Carrier-B",connection_id:2,rollback_window_minutes:60})
    });
    assert.equal(r.status,201);
    const planned=await r.json();

    r=await fetch(base+`/api/v1/carrier-switches/${planned.id}/activate`,{
      method:"POST",headers:{"Idempotency-Key":"33333333-3333-4333-8333-333333333333"}
    });
    assert.equal(r.status,200);
    let active=await r.json();
    assert.equal(active.route.active_carrier,"Carrier-B");

    r=await fetch(base+`/api/v1/carrier-switches/${planned.id}/rollback`,{
      method:"POST",headers:{"Idempotency-Key":"44444444-4444-4444-8444-444444444444"}
    });
    assert.equal(r.status,200);
    const rolled=await r.json();
    assert.equal(rolled.switch.status,"rolled_back");
  });
});

test("realtime subscribers are bounded",async()=>{
  const app=createBackend({config:config({maxEventSubscribers:1})});
  const address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`;
  const controller=new AbortController();
  try{
    const first=await fetch(base+"/api/v1/events",{signal:controller.signal});
    assert.equal(first.status,200);
    const second=await fetch(base+"/api/v1/events");
    assert.equal(second.status,503);
    assert.equal((await second.json()).error.code,"SSE_CAPACITY_REACHED");
  }finally{
    controller.abort();
    await app.close();
  }
});

test("production cannot accidentally start with memory store",()=>{
  assert.throws(()=>createBackend({config:config({
    mode:"production",authMode:"session",sessionSecret:"x".repeat(40),
    adminPasswordHash:"configured",ingestToken:"y".repeat(24)
  })}),/persistent store/);
});


test("forwarded client IP is trusted only from the loopback proxy",()=>{
  assert.equal(clientIp({socket:{remoteAddress:"127.0.0.1"},headers:{"x-forwarded-for":"203.0.113.7, 127.0.0.1"}}),"203.0.113.7");
  assert.equal(clientIp({socket:{remoteAddress:"::ffff:127.0.0.1"},headers:{"x-forwarded-for":"2001:db8::7"}}),"2001:db8::7");
  assert.equal(clientIp({socket:{remoteAddress:"198.51.100.9"},headers:{"x-forwarded-for":"203.0.113.7"}}),"198.51.100.9");
  assert.equal(clientIp({socket:{remoteAddress:"127.0.0.1"},headers:{"x-forwarded-for":"spoofed-host"}}),"127.0.0.1");
});


test("customer sessions carry tenant claims and use isolated Host cookies",()=>{const issued=issueSession({secret:"x".repeat(64),user:{id:"11111111-1111-4111-8111-111111111111",role:"customer",name:"Client",actor_type:"customer",tenant_id:42,tenant_public_id:"22222222-2222-4222-8222-222222222222",customer_role:"finance",authorization_version:3,session_version:7},ttlSeconds:300});const payload=verifySession(issued.token,"x".repeat(64));assert.equal(payload.actor_type,"customer");assert.equal(payload.tenant_id,42);assert.equal(payload.customer_role,"finance");assert.match(customerSessionCookie(issued.token,300),/__Host-pgi_customer_session=/);assert.match(customerCsrfCookie(issued.csrf,300),/__Host-pgi_customer_csrf=/);assert.equal(clearCustomerSessionCookies().length,2);});


test("customer password changes require the authenticated customer flow",()=>{assert.match(backendServer,/\/api\/v1\/customer\/auth\/change-password/);assert.match(backendServer,/INVALID_CURRENT_PASSWORD/);assert.match(backendServer,/PASSWORD_UNCHANGED/);assert.match(backendServer,/clearCustomerSessionCookies/);});


test("Google customer auth validates on the backend and keeps tenant selection",()=>{assert.match(backendServer,/verifyGoogleIdToken/);assert.match(backendServer,/\/api\/v1\/customer\/auth\/google/);assert.match(backendServer,/CUSTOMER_TENANT_REQUIRED/);});

test("billing orchestration is ready without connecting a payment provider",()=>{
  assert.match(backendServer,/\/api\/v1\/customer\/billing\/status/);
  assert.match(backendServer,/\/api\/v1\/customer\/billing\/checkout-session/);
  assert.match(backendServer,/\/api\/v1\/customer\/billing\/portal-session/);
  assert.match(backendServer,/customerBillingPreparation/);
  assert.match(backendServer,/PAYMENT_PROVIDER_NOT_CONNECTED/);
  assert.match(backendServer,/NO_ACTIVE_BILLING_OFFER/);
  assert.match(backendServer,/target_provider:"stripe"/);
  assert.match(backendServer,/checkout_mode:"provider_hosted"/);
  assert.match(backendServer,/payment_data_storage:"provider_only"/);
  assert.match(backendServer,/pgi_stores_card_data:false/);
  assert.match(backendServer,/event_collision_detection:true/);
  assert.match(backendServer,/tenant_binding_validation:true/);
  assert.match(backendServer,/automatic_access_recovery:true/);
  assert.match(backendServer,/sva_payout_flow:"carrier_to_customer"/);
  assert.match(backendServer,/funds_held_by_pgi:false/);
});



test("customer comparison route is tenant-scoped and filtered call parameters are forwarded",()=>{
  assert.match(backendServer,/\/api\/v1\/customer\/comparison/);
  assert.match(backendServer,/customerPortalComparison/);
  assert.match(backendServer,/customerPortalCalls\(context\.tenant_id,params\)/);
});


test("FreeSWITCH normalization preserves PDD, hangup side and distinct RTP loss metrics",()=>{
  const raw={variables:{
    uuid:"fs-voice-1",start_epoch:"1789723200",progress_epoch:"1789723203",answer_epoch:"1789723208",end_epoch:"1789723268",
    duration:"68",billsec:"60",destination_number:"33890000000",caller_id_number:"0612345678",
    hangup_cause:"NORMAL_CLEARING",sip_term_status:"200",sip_hangup_disposition:"recv_bye",read_codec:"PCMA",
    rtp_audio_in_packet_loss_percent:"0.4",rtp_audio_in_packet_loss:"4",rtp_audio_in_jitter_max_variance:"3.2",
    rtp_audio_in_rtt:"55",rtp_audio_in_mos:"4.31",rtp_audio_in_packet_count:"1000",rtp_audio_out_packet_count:"990",
    rtp_audio_in_media_bytes:"160000",rtp_audio_out_media_bytes:"158400"
  },callStats:{audio:{inbound:{latency_ms:28}}}};
  const out=normalizeFreeSwitchCdr(raw,{callerHashKey:"k".repeat(32)});
  assert.equal(out.payload.post_dial_delay_ms,3000);
  assert.equal(out.payload.hangup_party,"caller");
  assert.equal(out.payload.quality.packet_loss_percent,0.4);
  assert.equal(out.payload.quality.packets_lost,4);
  assert.equal(out.payload.quality.rtt_ms,55);
  assert.equal(out.payload.quality.mos,4.31);
});

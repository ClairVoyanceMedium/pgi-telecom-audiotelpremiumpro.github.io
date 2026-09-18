import test from "node:test";
import assert from "node:assert/strict";
import {createBackend} from "../backend/server.mjs";
import {hashPassword,verifyPassword,issueSession,verifySession,sessionCookie,csrfCookie} from "../backend/src/security.mjs";
import {selectExpert} from "../backend/src/expert-router.mjs";
import {clientIp,routeMatch} from "../backend/src/http.mjs";

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

test("password hashing and signed sessions reject tampering",()=>{
  const encoded=hashPassword("a-very-long-test-password");
  assert.equal(verifyPassword("a-very-long-test-password",encoded),true);
  assert.equal(verifyPassword("wrong-password",encoded),false);
  const issued=issueSession({secret:"x".repeat(40),user:{id:"1",role:"admin",name:"A"},ttlSeconds:60});
  assert.equal(verifySession(issued.token,"x".repeat(40)).role,"admin");
  assert.equal(verifySession(issued.token+"x","x".repeat(40)),null);
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

test("expert router chooses available least-loaded expert",()=>{
  const x=selectExpert([
    {id:1,status:"available",enabled:true,active_calls:2,last_assigned_at:"2026-01-01T00:00:00Z"},
    {id:2,status:"available",enabled:true,active_calls:0,last_assigned_at:"2026-01-02T00:00:00Z"},
    {id:3,status:"away",enabled:true,active_calls:0}
  ]);
  assert.equal(x.id,2);
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

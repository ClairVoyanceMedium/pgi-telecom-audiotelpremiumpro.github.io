import http from "node:http";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {loadConfig} from "./src/config.mjs";
import {EventBus} from "./src/event-bus.mjs";
import {MemoryStore} from "./src/store-memory.mjs";
import {parseCookies,verifyPassword,issueSession,verifySession,constantTimeTokenEqual,sessionCookie,csrfCookie,clearSessionCookies} from "./src/security.mjs";
import {securityHeaders,readJson,json,text,problemJson,routeMatch,clientIp} from "./src/http.mjs";
import {normalizeFreeSwitchCdr} from "./src/cdr-freeswitch.mjs";
import {startWorkers} from "./src/workers.mjs";

export async function createDefaultBackend(){
  const config=loadConfig();
  const eventBus=new EventBus();
  if(config.mode==="production"){
    const {PostgresStore}=await import("./src/store-postgres.mjs");
    const store=await PostgresStore.connect(config,eventBus);
    return createBackend({config,eventBus,store,closeStore:true});
  }
  return createBackend({config,eventBus});
}

export function createBackend(options={}){
  const config=options.config||loadConfig();
  const eventBus=options.eventBus||new EventBus();

  if(config.mode==="production"&&!options.store){
    throw new Error("production requires an explicit persistent store; memory store is simulator-only");
  }

  const store=options.store||new MemoryStore(config,eventBus);
  if(config.mode==="simulator"&&typeof store.seedSimulator==="function")store.seedSimulator();

  const metrics={
    requests:0,errors:0,rateLimited:0,authFailures:0,authRateLimited:0,
    startedAt:Date.now(),byStatus:new Map(),byRoute:new Map()
  };
  const rateBuckets=new Map();
  const authBuckets=new Map();

  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    const started=performance.now();
    securityHeaders(res,requestId);

    try{
      metrics.requests++;
      rateLimit(req,config,rateBuckets,metrics);
      const url=new URL(req.url||"/","http://localhost");
      const pathname=url.pathname;
      const method=(req.method||"GET").toUpperCase();

      if(method==="GET"&&pathname==="/api/v1/health"){
        return done(res,metrics,started,"health",200,{
          status:"ok",timestamp:new Date().toISOString(),version:config.version,mode:config.mode
        });
      }
      if(method==="GET"&&pathname==="/api/v1/ready"){
        const snapshot=await store.systemSnapshot();
        return done(res,metrics,started,"ready",200,{
          status:"ok",timestamp:new Date().toISOString(),store:snapshot.store,mode:config.mode
        });
      }
      if(method==="GET"&&pathname==="/metrics"){
        return metricsResponse(res,metrics,store);
      }

      if(method==="POST"&&pathname==="/api/v1/auth/login"){
        if(config.authMode!=="session")return done(res,metrics,started,"auth.login",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const usernameOk=constantTimeTokenEqual(String(body.username||""),config.adminUsername);
        const passwordOk=verifyPassword(String(body.password||""),config.adminPasswordHash);
        const ok=usernameOk&&passwordOk;
        if(!ok){
          metrics.authFailures++;
          recordAuthFailure(authKey,config,authBuckets);
          const e=new Error("Invalid credentials");e.status=401;e.code="INVALID_CREDENTIALS";throw e;
        }
        authBuckets.delete(authKey);
        const issued=issueSession({
          secret:config.sessionSecret,
          user:{id:"admin",role:"admin",name:"Administrator"},
          ttlSeconds:config.sessionTtlSeconds
        });
        return done(res,metrics,started,"auth.login",200,{user:{id:"admin",role:"admin",name:"Administrator"}},{
          "Set-Cookie":[sessionCookie(issued.token,config.sessionTtlSeconds),csrfCookie(issued.csrf,config.sessionTtlSeconds)]
        });
      }

      const actor=authenticate(req,config);
      if(method==="POST"&&pathname==="/api/v1/auth/logout"){
        requireActor(actor);
        requireCsrf(req,actor,config);
        return done(res,metrics,started,"auth.logout",200,{ok:true},{"Set-Cookie":clearSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/auth/me"){
        requireActor(actor);
        return done(res,metrics,started,"auth.me",200,{user:publicActor(actor)});
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/summary"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const range=rangeParams(url);
        return done(res,metrics,started,"dashboard.summary",200,await store.summary(range.from,range.to));
      }

      if(method==="GET"&&pathname==="/api/v1/calls"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        if(actor.role==="expert")params.expert_id=actor.expert_id||actor.sub;
        return done(res,metrics,started,"calls.list",200,await store.listCalls(params));
      }

      if(method==="GET"&&pathname==="/api/v1/experts"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"experts.list",200,{data:await store.listExperts()});
      }

      let match=routeMatch(pathname,"/api/v1/experts/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);
        requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"experts.status",200,await store.setExpertStatus(match.id,body.status));
      }

      if(method==="POST"&&pathname==="/api/v1/routing/next-expert"){
        requireRole(actor,["admin"]);
        requireCsrf(req,actor,config);
        const expert=await store.selectExpert();
        return done(res,metrics,started,"routing.next_expert",expert?200:404,expert||{error:{code:"NO_EXPERT_AVAILABLE"}});
      }

      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-expert/text"){
        authorizeTelephony(req,config);
        const expert=await store.selectExpert();
        if(!expert?.destination_uri){
          res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
          res.end("");
          return;
        }
        const line=[expert.destination_uri,String(expert.id||""),String(expert.display_name||"").replace(/[\t\r\n]/g," ")].join("\t");
        text(res,200,line);
        return;
      }

      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-expert"){
        authorizeTelephony(req,config);
        const expert=await store.selectExpert();
        return done(res,metrics,started,"routing.internal",expert?200:404,expert||{error:{code:"NO_EXPERT_AVAILABLE"}});
      }

      match=routeMatch(pathname,"/api/v1/internal/experts/:id/release");
      if(method==="POST"&&match){
        authorizeTelephony(req,config);
        return done(res,metrics,started,"routing.release",200,await store.releaseExpert(match.id));
      }

      if(method==="GET"&&pathname==="/api/v1/finance/reconciliation"){
        requireRole(actor,["admin","finance","readonly"]);
        const range=rangeParams(url);
        return done(res,metrics,started,"finance.reconciliation",200,{data:await store.reconciliation(range.from,range.to)});
      }

      if(method==="GET"&&pathname==="/api/v1/system/health"){
        requireRole(actor,["admin","readonly"]);
        return done(res,metrics,started,"system.health",200,await store.systemSnapshot());
      }

      if(method==="GET"&&pathname==="/api/v1/carrier-routing"){
        requireRole(actor,["admin","readonly"]);
        return done(res,metrics,started,"carrier.routing",200,await store.carrierRouting());
      }

      if(method==="POST"&&pathname==="/api/v1/carrier-switches"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.plan",body,()=>store.planCarrierSwitch(body,actor));
        return done(res,metrics,started,"carrier.switch.plan",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/carrier-switches/:id/activate");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.activate",body,()=>store.activateCarrierSwitch(match.id));
        return done(res,metrics,started,"carrier.switch.activate",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/carrier-switches/:id/rollback");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.rollback",body,()=>store.rollbackCarrierSwitch(match.id));
        return done(res,metrics,started,"carrier.switch.rollback",200,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/metrics/baselines"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"baseline.create",body,()=>store.createBaseline(body,actor));
        return done(res,metrics,started,"baseline.create",201,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/ingest/cdr"){
        authorizeIngest(req,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.ingestCdr(body);
        return done(res,metrics,started,"cdr.ingest",result.duplicate?200:201,result);
      }

      if(method==="POST"&&pathname==="/api/v1/ingest/freeswitch"){
        authorizeTelephony(req,config);
        const raw=await readJson(req,config.bodyLimitBytes);
        const envelope=normalizeFreeSwitchCdr(raw,{uuid:url.searchParams.get("uuid"),callerHashKey:config.callerHashKey||"simulator-caller-hash-key"});
        const result=await store.ingestCdr(envelope);
        return done(res,metrics,started,"cdr.freeswitch",result.duplicate?200:201,result);
      }

      if(method==="GET"&&pathname==="/api/v1/events"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        return openEventStream(req,res,eventBus,requestId,config);
      }

      return done(res,metrics,started,"not_found",404,{error:{code:"NOT_FOUND",request_id:requestId}});
    }catch(error){
      metrics.errors++;
      const status=Number(error?.status)||500;
      bump(metrics.byStatus,status);
      problemJson(res,error,requestId);
    }
  });

  server.headersTimeout=15000;
  server.requestTimeout=30000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;

  const workers=startWorkers({store,eventBus,config});

  return {
    server,store,eventBus,config,metrics,
    async listen(){
      await new Promise((resolve,reject)=>{
        server.once("error",reject);
        server.listen(config.port,config.host,()=>{server.off("error",reject);resolve();});
      });
      return server.address();
    },
    async close(){
      workers.stop();
      if(server.listening)await new Promise(resolve=>server.close(()=>resolve()));
      if(options.closeStore&&typeof store.close==="function")await store.close();
    }
  };
}

function authenticate(req,config){
  if(config.authMode==="disabled"){
    if(config.mode==="production")return null;
    return {sub:"local-admin",role:"admin",name:"Local Simulator",csrf:"disabled"};
  }
  const cookies=parseCookies(req.headers.cookie||"");
  return verifySession(cookies["__Host-pgi_session"],config.sessionSecret);
}
function requireActor(actor){
  if(!actor){const e=new Error("Authentication required");e.status=401;e.code="AUTH_REQUIRED";throw e;}
}
function requireRole(actor,roles){
  requireActor(actor);
  if(!roles.includes(actor.role)){const e=new Error("Forbidden");e.status=403;e.code="FORBIDDEN";throw e;}
}
function requireCsrf(req,actor,config){
  if(config.authMode==="disabled")return;
  const cookies=parseCookies(req.headers.cookie||"");
  const header=String(req.headers["x-csrf-token"]||"");
  const cookieToken=cookies["__Host-pgi_csrf"]||"";
  if(!header||!cookieToken||!constantTimeTokenEqual(header,cookieToken)||!constantTimeTokenEqual(header,actor.csrf)){
    const e=new Error("CSRF validation failed");e.status=403;e.code="CSRF_FAILED";throw e;
  }
}
function authorizeTelephony(req,config){
  if(config.mode==="simulator"&&!config.telephonyUser&&!config.telephonyPassword){
    if(!isLoopback(clientIp(req))){const e=new Error("Telephony endpoint restricted to loopback");e.status=403;e.code="TELEPHONY_FORBIDDEN";throw e;}
    return;
  }
  const header=String(req.headers.authorization||"");
  if(!header.startsWith("Basic ")){const e=new Error("Telephony authentication required");e.status=401;e.code="TELEPHONY_AUTH_REQUIRED";throw e;}
  let decoded="";
  try{decoded=Buffer.from(header.slice(6),"base64").toString("utf8");}catch{}
  const i=decoded.indexOf(":");
  const user=i>=0?decoded.slice(0,i):"";
  const pass=i>=0?decoded.slice(i+1):"";
  if(!constantTimeTokenEqual(user,config.telephonyUser)||!constantTimeTokenEqual(pass,config.telephonyPassword)){
    const e=new Error("Invalid telephony credentials");e.status=401;e.code="TELEPHONY_AUTH_FAILED";throw e;
  }
}

function authorizeIngest(req,config){
  if(config.mode==="simulator"&&!config.ingestToken){
    if(!isLoopback(clientIp(req))){const e=new Error("Ingest restricted to loopback");e.status=403;e.code="INGEST_FORBIDDEN";throw e;}
    return;
  }
  const token=String(req.headers["x-pgi-ingest-token"]||"");
  if(!config.ingestToken||!constantTimeTokenEqual(token,config.ingestToken)){
    const e=new Error("Invalid ingest token");e.status=401;e.code="INGEST_AUTH_FAILED";throw e;
  }
}
function isLoopback(ip){return ip==="127.0.0.1"||ip==="::1"||ip==="::ffff:127.0.0.1";}
function requireSameOriginBrowser(req){
  const site=String(req.headers["sec-fetch-site"]||"").toLowerCase();
  if(site==="cross-site"){
    const e=new Error("Cross-site request rejected");e.status=403;e.code="CROSS_SITE_REQUEST";throw e;
  }
  const origin=String(req.headers.origin||"");
  if(!origin)return;
  let originHost="";
  try{originHost=new URL(origin).host;}catch{
    const e=new Error("Invalid Origin header");e.status=403;e.code="INVALID_ORIGIN";throw e;
  }
  const requestHost=String(req.headers.host||"");
  if(!requestHost||!constantTimeTokenEqual(originHost.toLowerCase(),requestHost.toLowerCase())){
    const e=new Error("Origin mismatch");e.status=403;e.code="ORIGIN_MISMATCH";throw e;
  }
}
function enforceAuthLoginRate(req,config,buckets,metrics){
  const key=clientIp(req);
  const now=Date.now();
  const windowMs=Number(config.authFailureWindowSeconds||900)*1000;
  const current=buckets.get(key);
  if(current&&now-current.startedAt>=windowMs){
    buckets.delete(key);
    return key;
  }
  if(current&&current.failures>=Number(config.authMaxFailures||8)){
    metrics.authRateLimited++;
    const e=new Error("Too many authentication attempts");e.status=429;e.code="AUTH_RATE_LIMITED";throw e;
  }
  return key;
}
function recordAuthFailure(key,config,buckets){
  const now=Date.now();
  const windowMs=Number(config.authFailureWindowSeconds||900)*1000;
  const current=buckets.get(key);
  if(!current||now-current.startedAt>=windowMs)buckets.set(key,{startedAt:now,failures:1});
  else current.failures++;
  if(buckets.size>5000){
    for(const [k,v] of buckets)if(now-v.startedAt>=windowMs)buckets.delete(k);
  }
}
function rangeParams(url){
  const now=new Date();
  const from=url.searchParams.get("from")||new Date(now.getTime()-24*3600000).toISOString();
  const to=url.searchParams.get("to")||now.toISOString();
  if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<Date.parse(from)){
    const e=new Error("Invalid range");e.status=400;e.code="INVALID_RANGE";throw e;
  }
  return {from,to};
}
function publicActor(a){return {id:a.sub,role:a.role,name:a.name,expert_id:a.expert_id||null};}
function rateLimit(req,config,buckets,metrics){
  const key=clientIp(req);
  const minute=Math.floor(Date.now()/60000);
  const current=buckets.get(key);
  if(!current||current.minute!==minute)buckets.set(key,{minute,count:1});
  else{
    current.count++;
    if(current.count>config.rateLimitPerMinute){
      metrics.rateLimited++;
      const e=new Error("Rate limit exceeded");e.status=429;e.code="RATE_LIMITED";throw e;
    }
  }
  if(buckets.size>5000&&Math.random()<.01){
    for(const [k,v] of buckets)if(v.minute<minute-2)buckets.delete(k);
  }
}
function done(res,metrics,started,route,status,payload,headers={}){
  bump(metrics.byStatus,status);bump(metrics.byRoute,route);
  headers["Server-Timing"]="app;dur="+Math.max(0,performance.now()-started).toFixed(1);
  json(res,status,payload,headers);
}
function bump(map,key){map.set(String(key),(map.get(String(key))||0)+1);}
async function metricsResponse(res,metrics,store){
  const m=await store.metrics();
  const lines=[
    "# TYPE pgi_http_requests_total counter",
    "pgi_http_requests_total "+metrics.requests,
    "# TYPE pgi_http_errors_total counter",
    "pgi_http_errors_total "+metrics.errors,
    "# TYPE pgi_rate_limited_total counter",
    "pgi_rate_limited_total "+metrics.rateLimited,
    "# TYPE pgi_auth_failures_total counter",
    "pgi_auth_failures_total "+metrics.authFailures,
    "# TYPE pgi_auth_rate_limited_total counter",
    "pgi_auth_rate_limited_total "+metrics.authRateLimited,
    "# TYPE pgi_calls_total gauge",
    "pgi_calls_total "+m.calls_total,
    "# TYPE pgi_calls_connected gauge",
    "pgi_calls_connected "+m.calls_connected,
    "# TYPE pgi_outbox_pending gauge",
    "pgi_outbox_pending "+m.outbox_pending,
    "# TYPE pgi_event_subscribers gauge",
    "pgi_event_subscribers "+m.event_subscribers,
    "# TYPE pgi_process_uptime_seconds gauge",
    "pgi_process_uptime_seconds "+((Date.now()-metrics.startedAt)/1000).toFixed(3)
  ];
  const body=lines.join("\n")+"\n";
  res.writeHead(200,{"Content-Type":"text/plain; version=0.0.4; charset=utf-8","Content-Length":Buffer.byteLength(body)});
  res.end(body);
}
function openEventStream(req,res,eventBus,requestId,config){
  if(eventBus.size>=Number(config.maxEventSubscribers||32)){
    const e=new Error("Realtime capacity reached");e.status=503;e.code="SSE_CAPACITY_REACHED";throw e;
  }
  res.writeHead(200,{
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-store",
    "Connection":"keep-alive",
    "X-Accel-Buffering":"no",
    "X-Request-Id":requestId
  });
  res.write("event: ready\ndata: {}\n\n");
  const unsubscribe=eventBus.subscribe(event=>{
    if(res.destroyed)return;
    res.write("event: "+safeEventName(event.type)+"\ndata: "+JSON.stringify(event)+"\n\n");
  });
  const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(": ping\n\n");},15000);
  heartbeat.unref?.();
  req.on("close",()=>{clearInterval(heartbeat);unsubscribe();});
}
function safeEventName(x){return String(x||"event").replace(/[^a-zA-Z0-9_.-]/g,"_");}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=await createDefaultBackend();
  const shutdown=async signal=>{
    process.stdout.write(JSON.stringify({level:"info",event:"shutdown",signal})+"\n");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM",()=>shutdown("SIGTERM"));
  process.on("SIGINT",()=>shutdown("SIGINT"));
  app.listen().then(address=>{
    process.stdout.write(JSON.stringify({level:"info",event:"listening",address,mode:app.config.mode,version:app.config.version})+"\n");
  }).catch(error=>{
    process.stderr.write(JSON.stringify({level:"error",event:"startup_failed",message:error.message})+"\n");
    process.exit(1);
  });
}

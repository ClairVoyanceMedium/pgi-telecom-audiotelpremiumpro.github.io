(function(root){
  "use strict";

  function timeoutSignal(ms){
    if(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function")return AbortSignal.timeout(ms);
    var controller=new AbortController();
    setTimeout(function(){controller.abort();},ms);
    return controller.signal;
  }

  function baseUrl(){
    var cfg=root.PGI_CONFIG||{};
    if(!cfg.apiBaseUrl)throw new Error("API_NOT_CONFIGURED");
    return String(cfg.apiBaseUrl).replace(/\/$/,"");
  }

  function cookie(name){
    var prefix=encodeURIComponent(name)+"=";
    var parts=String(document.cookie||"").split(";");
    for(var i=0;i<parts.length;i++){
      var item=parts[i].trim();
      if(item.indexOf(prefix)===0){
        try{return decodeURIComponent(item.slice(prefix.length));}
        catch(_e){return item.slice(prefix.length);}
      }
    }
    return "";
  }

  async function request(path,options){
    options=options||{};
    var method=(options.method||"GET").toUpperCase();
    var headers=Object.assign(
      {"Accept":"application/json"},
      options.body?{"Content-Type":"application/json"}:{},
      options.headers||{}
    );
    if(!["GET","HEAD","OPTIONS"].includes(method)){
      var csrf=cookie("__Host-pgi_csrf");
      if(csrf)headers["X-CSRF-Token"]=csrf;
    }

    var response=await fetch(baseUrl()+path,{
      method:method,
      credentials:"include",
      cache:"no-store",
      headers:headers,
      body:options.body?JSON.stringify(options.body):undefined,
      signal:timeoutSignal(options.timeoutMs||8000)
    });

    var type=response.headers.get("content-type")||"";
    var payload=null;
    if(type.includes("application/json")){
      try{payload=await response.json();}catch(_e){}
    }

    if(!response.ok){
      var code=payload&&payload.error&&payload.error.code?payload.error.code:"API_HTTP_"+response.status;
      if(response.status===401&&path!=="/auth/login"){
        try{root.dispatchEvent(new CustomEvent("pgi:auth-required",{detail:{code:code}}));}catch(_e){}
      }
      var error=new Error(code);
      error.status=response.status;
      error.code=code;
      error.payload=payload;
      throw error;
    }

    if(!type.includes("application/json"))throw new Error("API_INVALID_CONTENT_TYPE");
    return payload;
  }

  function newIdempotencyKey(){
    if(root.crypto&&typeof root.crypto.randomUUID==="function")return root.crypto.randomUUID();
    if(root.crypto&&typeof root.crypto.getRandomValues==="function"){
      var b=new Uint8Array(16);root.crypto.getRandomValues(b);
      b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
      var h=Array.from(b,function(x){return x.toString(16).padStart(2,"0");}).join("");
      return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
    }
    throw new Error("SECURE_RANDOM_UNAVAILABLE");
  }

  function events(){
    return new EventSource(baseUrl()+"/events",{withCredentials:true});
  }

  root.PGIApi=Object.freeze({
    health:function(){return request("/health",{timeoutMs:4000});},
    ready:function(){return request("/ready",{timeoutMs:4000});},
    me:function(){return request("/auth/me",{timeoutMs:4000});},
    appBootstrap:function(){return request("/app/bootstrap",{timeoutMs:8000});},
    dashboardBootstrap:function(from,to,market,previousFrom,previousTo){
      var q=new URLSearchParams({from:from,to:to});
      if(market)q.set("market",market);
      if(previousFrom&&previousTo){
        q.set("previous_from",previousFrom);
        q.set("previous_to",previousTo);
      }
      return request("/dashboard/bootstrap?"+q.toString(),{timeoutMs:10000});
    },
    login:function(username,password){return request("/auth/login",{method:"POST",body:{username:username,password:password},timeoutMs:8000});},
    logout:function(){return request("/auth/logout",{method:"POST",body:{}});},
    summary:function(from,to,market){
      var q=new URLSearchParams({from:from,to:to});
      if(market)q.set("market",market);
      return request("/dashboard/summary?"+q.toString());
    },
    analytics:function(from,to,market){
      var q=new URLSearchParams({from:from,to:to});
      if(market)q.set("market",market);
      return request("/dashboard/analytics?"+q.toString());
    },
    calls:function(params){
      var q=new URLSearchParams(params||{}).toString();
      return request("/calls"+(q?"?"+q:""));
    },
    experts:function(){return request("/experts");},
    reconciliation:function(from,to,market){
      var q=new URLSearchParams({from:from,to:to});
      if(market)q.set("market",market);
      return request("/finance/reconciliation?"+q.toString());
    },
    systemHealth:function(){return request("/system/health");},
    carrierRouting:function(){return request("/carrier-routing");},
    wholesaleOverview:function(){return request("/platform/overview");},\n    subscriptionBilling:function(){return request("/platform/subscription-billing");},\n    createSubscriptionPrice:function(payload,idempotencyKey){if(!idempotencyKey)throw new Error("IDEMPOTENCY_KEY_REQUIRED");return request("/platform/subscription-prices",{method:"POST",body:payload,headers:{"Idempotency-Key":idempotencyKey}});},
    tenants:function(params){
      var q=new URLSearchParams(params||{}).toString();
      return request("/platform/tenants"+(q?"?"+q:""));
    },
    events:events,
    baselines:function(params){
      var q=new URLSearchParams(params||{}).toString();
      return request("/metrics/baselines"+(q?"?"+q:""));
    },
    newIdempotencyKey:newIdempotencyKey,
    createBaseline:function(payload,idempotencyKey){
      if(!idempotencyKey)throw new Error("IDEMPOTENCY_KEY_REQUIRED");
      return request("/metrics/baselines",{method:"POST",body:payload,headers:{"Idempotency-Key":idempotencyKey}});
    }
  });
})(window);

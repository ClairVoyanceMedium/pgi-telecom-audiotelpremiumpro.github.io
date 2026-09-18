(function(root){
  "use strict";
  function timeoutSignal(ms){
    if(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function")return AbortSignal.timeout(ms);
    var controller=new AbortController();
    setTimeout(function(){controller.abort();},ms);
    return controller.signal;
  }
  async function request(path,options){
    options=options||{};
    var cfg=root.PGI_CONFIG||{};
    if(!cfg.apiBaseUrl)throw new Error("API_NOT_CONFIGURED");
    var base=String(cfg.apiBaseUrl).replace(/\/$/,"");
    var response=await fetch(base+path,{
      method:options.method||"GET",
      credentials:"include",
      cache:"no-store",
      headers:Object.assign({"Accept":"application/json"},options.body?{"Content-Type":"application/json"}:{},options.headers||{}),
      body:options.body?JSON.stringify(options.body):undefined,
      signal:timeoutSignal(options.timeoutMs||8000)
    });
    if(!response.ok){
      var error=new Error("API_HTTP_"+response.status);
      error.status=response.status;
      throw error;
    }
    var type=response.headers.get("content-type")||"";
    if(!type.includes("application/json"))throw new Error("API_INVALID_CONTENT_TYPE");
    return response.json();
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

  root.PGIApi=Object.freeze({
    health:function(){return request("/health",{timeoutMs:4000});},
    summary:function(from,to){return request("/dashboard/summary?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to));},
    calls:function(params){
      var q=new URLSearchParams(params||{}).toString();
      return request("/calls"+(q?"?"+q:""));
    },
    newIdempotencyKey:newIdempotencyKey,
    createBaseline:function(payload,idempotencyKey){
      if(!idempotencyKey)throw new Error("IDEMPOTENCY_KEY_REQUIRED");
      return request("/metrics/baselines",{method:"POST",body:payload,headers:{"Idempotency-Key":idempotencyKey}});
    }
  });
})(window);
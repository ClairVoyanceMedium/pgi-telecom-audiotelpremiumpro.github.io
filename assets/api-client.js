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
  root.PGIApi=Object.freeze({
    health:function(){return request("/health",{timeoutMs:4000});},
    summary:function(from,to){return request("/dashboard/summary?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to));},
    calls:function(params){
      var q=new URLSearchParams(params||{}).toString();
      return request("/calls"+(q?"?"+q:""));
    },
    createBaseline:function(payload){return request("/metrics/baselines",{method:"POST",body:payload});}
  });
})(window);
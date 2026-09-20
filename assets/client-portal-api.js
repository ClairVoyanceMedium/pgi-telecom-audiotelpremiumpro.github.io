(function(root){
"use strict";
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
      try{return decodeURIComponent(item.slice(prefix.length));}catch(_e){return item.slice(prefix.length);}
    }
  }
  return "";
}
function timeoutSignal(ms){
  if(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function")return AbortSignal.timeout(ms);
  var controller=new AbortController();
  setTimeout(function(){controller.abort();},ms);
  return controller.signal;
}
async function request(path,options){
  options=options||{};
  var method=(options.method||"GET").toUpperCase();
  var headers={"Accept":"application/json"};
  if(options.body)headers["Content-Type"]="application/json";
  if(options.idempotencyKey)headers["Idempotency-Key"]=String(options.idempotencyKey);
  if(!["GET","HEAD","OPTIONS"].includes(method)){
    var csrf=cookie("__Host-pgi_customer_csrf");
    if(csrf)headers["X-CSRF-Token"]=csrf;
  }
  var response=await fetch(baseUrl()+path,{
    method:method,credentials:"include",cache:"no-store",headers:headers,
    body:options.body?JSON.stringify(options.body):undefined,
    signal:timeoutSignal(options.timeoutMs||10000)
  });
  var payload=null;
  var type=response.headers.get("content-type")||"";
  if(type.includes("application/json"))try{payload=await response.json();}catch(_e){}
  if(!response.ok){
    var code=payload&&payload.error&&payload.error.code?payload.error.code:"API_HTTP_"+response.status;
    var error=new Error(code);error.code=code;error.status=response.status;error.payload=payload;throw error;
  }
  if(!type.includes("application/json"))throw new Error("API_INVALID_CONTENT_TYPE");
  return payload;
}
root.PGICustomerApi=Object.freeze({
  login:function(email,password,tenant){return request("/customer/auth/login",{method:"POST",body:{email:email,password:password,tenant:tenant||null}});},
  register:function(payload){return request("/customer/auth/register",{method:"POST",body:payload});},
  google:function(credential,tenant,invite){return request("/customer/auth/google",{method:"POST",body:{credential:credential,tenant:tenant||null,invite:invite||null}});},
  activate:function(token,displayName,password){return request("/customer/auth/activate",{method:"POST",body:{token:token,display_name:displayName,password:password}});},
  me:function(){return request("/customer/auth/me",{timeoutMs:5000});},
  logout:function(){return request("/customer/auth/logout",{method:"POST",body:{}});},
  changePassword:function(currentPassword,newPassword){return request("/customer/auth/change-password",{method:"POST",body:{current_password:currentPassword,new_password:newPassword}});},
  billingStatus:function(){return request("/customer/billing/status",{timeoutMs:5000});},
  newIdempotencyKey:function(){return typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"customer-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);},
  createBillingCheckout:function(idempotencyKey){return request("/customer/billing/checkout-session",{method:"POST",body:{},idempotencyKey:idempotencyKey});},
  createBillingPortal:function(){return request("/customer/billing/portal-session",{method:"POST",body:{}});},
  portability:function(){return request("/customer/portability",{timeoutMs:8000});},
  createPortability:function(payload,idempotencyKey){return request("/customer/portability",{method:"POST",body:payload,idempotencyKey:idempotencyKey});},
  cancelPortability:function(id,idempotencyKey){return request("/customer/portability/"+encodeURIComponent(id)+"/cancel",{method:"POST",body:{},idempotencyKey:idempotencyKey});},
  portal:function(from,to){var q=new URLSearchParams({from:from,to:to});return request("/customer/portal?"+q.toString(),{timeoutMs:12000});},
  resetMetrics:function(metricKeys,idempotencyKey){return request("/customer/metrics/reset",{method:"POST",body:{metric_keys:metricKeys},idempotencyKey:idempotencyKey});},
  incidents:function(id){var q=id?"?incident_id="+encodeURIComponent(id):"";return request("/customer/incidents"+q,{timeoutMs:8000});},
  createIncident:function(payload,idempotencyKey){return request("/customer/incidents",{method:"POST",body:payload,idempotencyKey:idempotencyKey});},
  addIncidentNote:function(id,body,idempotencyKey){return request("/customer/incidents/"+encodeURIComponent(id)+"/notes",{method:"POST",body:{body:body},idempotencyKey:idempotencyKey});},
  simulateRouting:function(payload){return request("/customer/routing/simulate",{method:"POST",body:payload||{}});},
  voiceStudio:function(){return request("/customer/voice-studio",{timeoutMs:8000});},
  createVoiceService:function(payload,idempotencyKey){return request("/customer/voice-studio/services",{method:"POST",body:payload,idempotencyKey:idempotencyKey});},
  saveVoiceServiceDraft:function(id,payload,idempotencyKey){return request("/customer/voice-studio/services/"+encodeURIComponent(id)+"/draft",{method:"POST",body:payload,idempotencyKey:idempotencyKey});},
  simulateVoiceService:function(id,payload){return request("/customer/voice-studio/services/"+encodeURIComponent(id)+"/simulate",{method:"POST",body:payload||{}});},
  publishVoiceService:function(id,idempotencyKey){return request("/customer/voice-studio/services/"+encodeURIComponent(id)+"/publish",{method:"POST",body:{},idempotencyKey:idempotencyKey});},
  rollbackVoiceService:function(id,versionId,idempotencyKey){return request("/customer/voice-studio/services/"+encodeURIComponent(id)+"/rollback",{method:"POST",body:{version_id:versionId},idempotencyKey:idempotencyKey});},
  comparison:function(from,to){var q=new URLSearchParams({from:from,to:to});return request("/customer/comparison?"+q.toString(),{timeoutMs:10000});},
  calls:function(from,to,cursor,limit,filters){
    var q=new URLSearchParams({from:from,to:to,limit:String(limit||100)});
    if(cursor)q.set("cursor",cursor);
    filters=filters||{};
    [["status","status"],["number_id","numberId"],["min_duration","minDuration"],["max_duration","maxDuration"],["min_amount","minAmount"],["max_amount","maxAmount"]].forEach(function(pair){
      var value=filters[pair[1]];
      if(value!=null&&value!=="")q.set(pair[0],String(value));
    });
    return request("/customer/calls?"+q.toString(),{timeoutMs:12000});
  }
});
})(window);

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
function get(path,timeoutMs){return request(path,timeoutMs?{timeoutMs:timeoutMs}:{});}
function post(path,body,idempotencyKey){return request(path,{method:"POST",body:body||{},idempotencyKey:idempotencyKey});}
root.PGICustomerApi=Object.freeze({
login:function(email,password,tenant){return post("/customer/auth/login",{email:email,password:password,tenant:tenant||null});},
register:function(payload){return post("/customer/auth/register",Object.assign(payload,root.PGIOrderMeta||{}));},
google:function(credential,tenant,invite){return post("/customer/auth/google",{credential:credential,tenant:tenant||null,invite:invite||null});},
activate:function(token,displayName,password){return post("/customer/auth/activate",{token:token,display_name:displayName,password:password});},
me:function(){return get("/customer/auth/me",5000);},
logout:function(){return post("/customer/auth/logout",{});},
changePassword:function(currentPassword,newPassword){return post("/customer/auth/change-password",{current_password:currentPassword,new_password:newPassword});},
forgotPassword:function(email){return post("/customer/auth/password/forgot",{email:email});},
resetPassword:function(token,newPassword){return post("/customer/auth/password/reset",{token:token,new_password:newPassword});},
requestEmailChange:function(newEmail,currentPassword){return post("/customer/auth/email/change/request",{new_email:newEmail,current_password:currentPassword});},
confirmEmailChange:function(token){return post("/customer/auth/email/change/confirm",{token:token});},
passkeys:function(){return get("/customer/security/passkeys",5000);},
passkeyRegisterOptions:function(){return post("/customer/security/passkeys/register-options",{});},
passkeyRegister:function(body){return post("/customer/security/passkeys/register",body);},
passkeyAssertOptions:function(){return post("/customer/security/passkeys/assert-options",{});},
passkeyVerify:function(body){return post("/customer/security/passkeys/verify",body);},
billingStatus:function(){return get("/customer/billing/status",5000);},
newIdempotencyKey:function(){return typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"customer-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);},
createBillingCheckout:function(idempotencyKey){return post("/customer/billing/checkout-session",{},idempotencyKey);},
createBillingPortal:function(){return post("/customer/billing/portal-session",{});},
portability:function(){return get("/customer/portability",8000);},
createPortability:function(payload,idempotencyKey){return post("/customer/portability",payload,idempotencyKey);},
cancelPortability:function(id,idempotencyKey){return post("/customer/portability/"+encodeURIComponent(id)+"/cancel",{},idempotencyKey);},
portal:function(from,to){var q=new URLSearchParams({from:from,to:to});return get("/customer/portal?"+q.toString(),12000);},
resetMetrics:function(metricKeys,idempotencyKey){return post("/customer/metrics/reset",{metric_keys:metricKeys},idempotencyKey);},
jackpot:function(){return request("/customer/jackpot");},
resetJackpot:function(k){return post("/customer/jackpot/reset",{},k);},
incidents:function(id){var q=id?"?incident_id="+encodeURIComponent(id):"";return get("/customer/incidents"+q,8000);},
relations:function(){return get("/customer/relations",10000);},
createRelationDispute:function(payload,idempotencyKey){return post("/customer/relations/disputes",payload,idempotencyKey);},
createExitRequest:function(payload,idempotencyKey){return post("/customer/relations/exits",payload,idempotencyKey);},
addRelationMessage:function(id,body,idempotencyKey){return post("/customer/relations/"+encodeURIComponent(id)+"/messages",{body:body},idempotencyKey);},
cancelRelationCase:function(id,idempotencyKey){return post("/customer/relations/"+encodeURIComponent(id)+"/cancel",{},idempotencyKey);},
confirmRelationAction:function(id,idempotencyKey){return post("/customer/relations/actions/"+encodeURIComponent(id)+"/confirm",{},idempotencyKey);},
createIncident:function(payload,idempotencyKey){return post("/customer/incidents",payload,idempotencyKey);},
addIncidentNote:function(id,body,idempotencyKey){return post("/customer/incidents/"+encodeURIComponent(id)+"/notes",{body:body},idempotencyKey);},
simulateRouting:function(payload){return post("/customer/routing/simulate",payload||{});},
voiceStudio:function(){return get("/customer/voice-studio",8000);},
createVoiceService:function(payload,idempotencyKey){return post("/customer/voice-studio/services",payload,idempotencyKey);},
saveVoiceServiceDraft:function(id,payload,idempotencyKey){return post("/customer/voice-studio/services/"+encodeURIComponent(id)+"/draft",payload,idempotencyKey);},
simulateVoiceService:function(id,payload){return post("/customer/voice-studio/services/"+encodeURIComponent(id)+"/simulate",payload||{});},
publishVoiceService:function(id,idempotencyKey){return post("/customer/voice-studio/services/"+encodeURIComponent(id)+"/publish",{},idempotencyKey);},
rollbackVoiceService:function(id,versionId,idempotencyKey){return post("/customer/voice-studio/services/"+encodeURIComponent(id)+"/rollback",{version_id:versionId},idempotencyKey);},
comparison:function(from,to){var q=new URLSearchParams({from:from,to:to});return get("/customer/comparison?"+q.toString(),10000);},
calls:function(from,to,cursor,limit,filters){
  var q=new URLSearchParams({from:from,to:to,limit:String(limit||100)});
  if(cursor)q.set("cursor",cursor);
  filters=filters||{};
  [["status","status"],["number_id","numberId"],["min_duration","minDuration"],["max_duration","maxDuration"],["min_amount","minAmount"],["max_amount","maxAmount"]].forEach(function(pair){
    var value=filters[pair[1]];
    if(value!=null&&value!=="")q.set(pair[0],String(value));
  });
  return get("/customer/calls?"+q.toString(),12000);
}
});
})(window);

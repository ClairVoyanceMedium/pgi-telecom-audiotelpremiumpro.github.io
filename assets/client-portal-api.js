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
  activate:function(token,displayName,password){return request("/customer/auth/activate",{method:"POST",body:{token:token,display_name:displayName,password:password}});},
  me:function(){return request("/customer/auth/me",{timeoutMs:5000});},
  logout:function(){return request("/customer/auth/logout",{method:"POST",body:{}});},
  portal:function(from,to){var q=new URLSearchParams({from:from,to:to});return request("/customer/portal?"+q.toString(),{timeoutMs:12000});},
  calls:function(from,to,cursor,limit){var q=new URLSearchParams({from:from,to:to,limit:String(limit||100)});if(cursor)q.set("cursor",cursor);return request("/customer/calls?"+q.toString(),{timeoutMs:12000});}
});
})(window);

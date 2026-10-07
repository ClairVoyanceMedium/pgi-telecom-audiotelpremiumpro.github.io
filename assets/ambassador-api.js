(function(root){"use strict";
function base(){var b=String(root.PGI_CONFIG&&root.PGI_CONFIG.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw new Error("API_NOT_CONFIGURED");return b}
function cookie(name){var p=encodeURIComponent(name)+"=";for(var part of String(document.cookie||"").split(";")){part=part.trim();if(part.indexOf(p)===0){try{return decodeURIComponent(part.slice(p.length))}catch(_e){return part.slice(p.length)}}}return""}
function signal(ms){if(typeof AbortSignal!=="undefined"&&AbortSignal.timeout)return AbortSignal.timeout(ms);var c=new AbortController();setTimeout(function(){c.abort()},ms);return c.signal}
async function request(path,opt){opt=opt||{};var method=String(opt.method||"GET").toUpperCase(),headers={Accept:"application/json"};if(opt.body)headers["Content-Type"]="application/json";if(opt.key)headers["Idempotency-Key"]=String(opt.key);if(!["GET","HEAD","OPTIONS"].includes(method)){var csrf=cookie("__Host-pgi_customer_csrf");if(csrf)headers["X-CSRF-Token"]=csrf}var res=await fetch(base()+path,{method,credentials:"include",cache:"no-store",headers,body:opt.body?JSON.stringify(opt.body):undefined,signal:signal(opt.timeout||10000)}),data=null;try{data=await res.json()}catch(_e){}if(!res.ok){var e=new Error(data&&data.error&&data.error.code||"API_HTTP_"+res.status);e.code=data&&data.error&&data.error.code||"API_HTTP_"+res.status;e.status=res.status;e.payload=data;throw e}return data}
function post(path,body,key){return request(path,{method:"POST",body:body||{},key:key})}
root.PGIAmbassadorApi=Object.freeze({
 login:function(email,password,tenant,remember){return post("/customer/auth/login",{email,password,tenant:tenant||null,remember_me:remember===true})},
 activate:function(token,name,password){return post("/customer/auth/activate",{token,display_name:name,password,legal_terms_accepted:true,privacy_notice_acknowledged:true,legal_version:"2026-09-26-b2b-b2c-v4"})},
 forgot:function(email){return post("/ambassador/auth/password/forgot",{email})},
 reset:function(token,password){return post("/customer/auth/password/reset",{token,new_password:password})},
 me:function(){return request("/customer/auth/me",{timeout:5000})},
 logout:function(){return post("/customer/auth/logout",{})},
 dashboard:function(){return request("/ambassador/dashboard",{timeout:12000})},
 createCode:function(key){return post("/ambassador/referral/code",{},key)},
 inviteReferral:function(email,key){return post("/ambassador/referral/invite",{email:email,consent_confirmed:true},key)},
 connectPayout:function(key){return post("/ambassador/payout-account",{},key)},
 changePassword:function(currentPassword,newPassword){return post("/customer/auth/change-password",{current_password:currentPassword,new_password:newPassword})},
 key:function(){return typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"amb-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)}
});
})(window);
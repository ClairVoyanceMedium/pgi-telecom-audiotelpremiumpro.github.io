const d=s=>Uint8Array.from(atob(String(s).replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(String(s).length/4)*4,"=")),c=>c.charCodeAt(0)),e=b=>{let s="";for(const x of new Uint8Array(b))s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
function supported(){return Boolean(window.PublicKeyCredential&&navigator.credentials)}
function convertCreate(x){const p={...x,challenge:d(x.challenge),user:{...x.user,id:d(x.user.id)}};p.excludeCredentials=(x.excludeCredentials||[]).map(v=>({...v,id:d(v.id)}));return p}
function convertGet(x){return{...x,challenge:d(x.challenge),allowCredentials:(x.allowCredentials||[]).map(v=>({...v,id:d(v.id)}))}}
export async function enroll(api,label="Passkey"){
  if(!supported())throw Object.assign(new Error("WEBAUTHN_UNSUPPORTED"),{code:"WEBAUTHN_UNSUPPORTED"});
  const o=await api.passkeyRegisterOptions(),cred=await navigator.credentials.create({publicKey:convertCreate(o.publicKey)}),r=cred?.response;
  if(!cred||!r||typeof r.getPublicKey!=="function"||typeof r.getAuthenticatorData!=="function")throw Object.assign(new Error("PASSKEY_EXPORT_UNAVAILABLE"),{code:"PASSKEY_EXPORT_UNAVAILABLE"});
  const pk=r.getPublicKey(),ad=r.getAuthenticatorData();if(!pk||!ad)throw Object.assign(new Error("PASSKEY_EXPORT_UNAVAILABLE"),{code:"PASSKEY_EXPORT_UNAVAILABLE"});
  return api.passkeyRegister({state:o.state,credential_id:e(cred.rawId),client_data_json:e(r.clientDataJSON),authenticator_data:e(ad),public_key_spki:e(pk),transports:typeof r.getTransports==="function"?r.getTransports():[],label});
}
export async function verify(api){
  if(!supported())throw Object.assign(new Error("WEBAUTHN_UNSUPPORTED"),{code:"WEBAUTHN_UNSUPPORTED"});
  const o=await api.passkeyAssertOptions(),cred=await navigator.credentials.get({publicKey:convertGet(o.publicKey)}),r=cred?.response;
  if(!cred||!r)throw Object.assign(new Error("WEBAUTHN_CANCELLED"),{code:"WEBAUTHN_CANCELLED"});
  return api.passkeyVerify({state:o.state,credential_id:e(cred.rawId),client_data_json:e(r.clientDataJSON),authenticator_data:e(r.authenticatorData),signature:e(r.signature),user_handle:r.userHandle?e(r.userHandle):null});
}
export{supported};

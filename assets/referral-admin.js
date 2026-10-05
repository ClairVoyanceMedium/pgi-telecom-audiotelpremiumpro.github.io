let busy=false,ctx=null,viewPromise=null;
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return b}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.indexOf(p)===0){try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}}return""}
async function request(path,method="GET",body=null,key=""){const headers={"Accept":"application/json"};if(body!==null)headers["Content-Type"]="application/json";const csrf=cookie("__Host-pgi_csrf");if(csrf&&method!=="GET")headers["X-CSRF-Token"]=csrf;if(key)headers["Idempotency-Key"]=key;const res=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:body===null?undefined:JSON.stringify(body)}),payload=await res.json().catch(()=>null);if(!res.ok){const e=new Error(payload?.error?.code||"API_HTTP_"+res.status);e.code=payload?.error?.code||"API_HTTP_"+res.status;e.status=res.status;throw e}return payload}
const referralProgram=()=>request("/platform/referral-program");
const updateReferralProgram=(payload,key)=>request("/platform/referral-program","POST",payload,key);
const settleReferralReward=(id,payload,key)=>request("/platform/referral-rewards/"+encodeURIComponent(id)+"/paid","POST",payload,key);
const ambassadorProfiles=()=>request("/platform/ambassadors");
const updateAmbassadorStatus=(id,payload,key)=>request("/platform/ambassadors/"+encodeURIComponent(id)+"/status","POST",payload,key);
const feedback=(msg,type="")=>ctx?.feedback?.(msg,type);
function ensureStyle(){if(document.getElementById("referral-admin-css"))return;const link=document.createElement("link");link.id="referral-admin-css";link.rel="stylesheet";link.href=new URL("./referral-admin.css",import.meta.url).href;document.head.appendChild(link)}
function view(){return viewPromise||(viewPromise=import("./referral-admin-view.js"))}
async function load(){if(!ctx?.root)return;ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du parrainage...</p>';try{const [data,profiles,ui]=await Promise.all([referralProgram(),ambassadorProfiles(),view()]);ui.render(ctx.root,{...data,ambassador_profiles:Array.isArray(profiles?.data)?profiles.data:[]})}catch(err){ctx.root.innerHTML='<p class="pa-note">Parrainage indisponible : '+String(err?.code||"erreur").replace(/[<>&]/g,"")+'</p>'}}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-refresh]")){await load();return}
  const copy=e.target.closest("[data-copy-referral]");
  if(copy){const code=String(copy.dataset.copyReferral||"");if(!code)return;try{await navigator.clipboard.writeText(code);feedback("Code ambassadeur copié.","ok")}catch{feedback("Copie impossible sur cet appareil.","error")}return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme de parrainage avec le barème fixe en vigueur ?"))return;
    busy=true;feedback("Mise à jour du parrainage...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme de parrainage mis à jour.","ok");await load()}catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const ambassadorStatus=e.target.closest("[data-ambassador-status]");
  if(ambassadorStatus){
    const id=String(ambassadorStatus.dataset.ambassadorId||""),status=String(ambassadorStatus.dataset.ambassadorStatus||"");
    if(!id||!["active","suspended","rejected"].includes(status))return;
    const reason=status==="active"?"Validation du profil ambassadeur":prompt(status==="suspended"?"Motif de suspension :":"Motif du refus :")||"";
    if(status!=="active"&&!String(reason).trim())return;
    if(!confirm(status==="active"?"Valider ce profil ambassadeur et préparer son accès sécurisé ?":"Confirmer le changement de statut ambassadeur ?"))return;
    busy=true;feedback("Mise à jour du profil ambassadeur...");
    try{const result=await updateAmbassadorStatus(id,{status,reason:String(reason).trim()},window.PGIApi.newIdempotencyKey());feedback(status==="active"?(result?.customer_access?.email_sent?"Profil validé et invitation envoyée.":"Profil validé."):"Statut ambassadeur mis à jour.","ok");await load()}catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement déjà effectué au parrain :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette prime a déjà été versée et enregistrer la référence ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{await settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré.","ok");await load()}catch(err){feedback(err?.code||"Enregistrement impossible","error")}finally{busy=false}
  }
}
export async function open(options={}){
  if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});
  ctx=options;ensureStyle();
  if(!ctx.root.dataset.referralBound){
    ctx.root.dataset.referralBound="1";
    ctx.root.addEventListener("click",handle);
    ctx.root.addEventListener("input",async e=>{if(e.target.matches("[data-referral-search]"))(await view()).filterAmbassadors(ctx.root,e.target.value)});
  }
  await load();
}

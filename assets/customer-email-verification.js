let current={token:"",email:"",onVerified:null,timer:null};

function apiBase(){return String(window.PGI_CONFIG&&window.PGI_CONFIG.apiBaseUrl||"/api/v1").replace(/\/$/,"");}
async function post(path,body){
  const r=await fetch(apiBase()+path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  let payload={};try{payload=await r.json();}catch(_e){}
  if(!r.ok){const e=new Error(payload?.error?.code||"EMAIL_VERIFICATION_FAILED");e.code=payload?.error?.code||"EMAIL_VERIFICATION_FAILED";e.payload=payload;throw e;}
  return payload;
}
function ensurePanel(){
  let p=document.getElementById("email-verification-panel");if(p)return p;
  p=document.createElement("div");p.id="email-verification-panel";p.hidden=true;
  p.innerHTML='<p class="cp-kicker">VÉRIFICATION E-MAIL</p><h1>Entrez le code reçu</h1><p class="cp-muted" id="email-verification-note"></p><form id="email-verification-form" class="cp-form"><label>Code à 6 chiffres<input id="email-verification-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="cp-primary" type="submit">Vérifier mon e-mail</button></form><button id="email-verification-resend" class="cp-ghost cp-register-back" type="button">Renvoyer le code</button><button id="email-verification-login" class="cp-ghost cp-register-back" type="button">Retour à la connexion</button><p id="email-verification-message" class="cp-form-message" role="status"></p>';
  const anchor=document.getElementById("activation-panel");anchor.parentNode.insertBefore(p,anchor);
  p.querySelector("#email-verification-form").addEventListener("submit",verify);
  p.querySelector("#email-verification-resend").addEventListener("click",resend);
  p.querySelector("#email-verification-login").addEventListener("click",showLogin);
  return p;
}
function message(text,bad=false){const e=document.getElementById("email-verification-message");e.textContent=text||"";e.classList.toggle("bad",bad);}
function showLogin(){
  ensurePanel().hidden=true;
  ["register-panel","activation-panel"].forEach(id=>{const e=document.getElementById(id);if(e)e.hidden=true;});
  const l=document.getElementById("login-panel");if(l)l.hidden=false;
}
function cooldown(seconds){
  const b=document.getElementById("email-verification-resend");clearInterval(current.timer);
  let n=Math.max(0,Number(seconds)||0);b.disabled=n>0;const base="Renvoyer le code";
  if(n>0)b.textContent=base+" ("+n+" s)";
  current.timer=setInterval(()=>{n--;if(n<=0){clearInterval(current.timer);b.disabled=false;b.textContent=base;}else b.textContent=base+" ("+n+" s)";},1000);
}
async function verify(e){
  e.preventDefault();message("");
  const code=String(document.getElementById("email-verification-code").value||"").trim();
  if(!/^[0-9]{6}$/.test(code)){message("Saisissez les 6 chiffres du code.",true);return;}
  const b=e.submitter;b.disabled=true;
  try{
    const result=await post("/customer/auth/email/verify",{token:current.token,code});
    clearInterval(current.timer);ensurePanel().hidden=true;
    if(typeof current.onVerified==="function")current.onVerified(result.user);
  }catch(err){
    const m={EMAIL_VERIFICATION_INVALID:"Code incorrect.",EMAIL_VERIFICATION_EXPIRED:"Ce code a expiré. Demandez-en un nouveau.",EMAIL_VERIFICATION_LOCKED:"Trop d’essais. Demandez un nouveau code."};
    message(m[err.code]||"Vérification impossible.",true);
  }finally{b.disabled=false;}
}
async function resend(){
  const b=document.getElementById("email-verification-resend");b.disabled=true;message("");
  try{
    const result=await post("/customer/auth/email/resend",{token:current.token});
    message("Un nouveau code vient d’être envoyé.");cooldown(result.resend_after_seconds||60);
  }catch(err){
    if(err.code==="EMAIL_VERIFICATION_RESEND_TOO_SOON"){message("Veuillez patienter avant un nouvel envoi.",true);cooldown(err.payload?.retry_after_seconds||60);}
    else message(err.code==="EMAIL_DELIVERY_UNAVAILABLE"?"L’envoi de l’e-mail est momentanément indisponible.":"Impossible de renvoyer le code.",true);
    b.disabled=false;
  }
}
export function open({token,email,onVerified}){
  current.token=String(token||"");current.email=String(email||"");current.onVerified=onVerified;
  ["login-panel","register-panel","activation-panel"].forEach(id=>{const e=document.getElementById(id);if(e)e.hidden=true;});
  const p=ensurePanel();p.hidden=false;
  document.getElementById("email-verification-note").textContent="Un code à 6 chiffres a été envoyé à "+current.email+". Il expire dans 10 minutes.";
  document.getElementById("email-verification-code").value="";
  message("");cooldown(60);document.getElementById("email-verification-code").focus();
}

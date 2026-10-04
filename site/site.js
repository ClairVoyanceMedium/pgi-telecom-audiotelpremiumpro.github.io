(function migrateLegacyRootServiceWorker(){
  if(!("serviceWorker" in navigator))return;
  try{
    navigator.serviceWorker.getRegistrations().then(async function(regs){
      var legacy=false;
      for(const reg of regs){
        try{
          if(new URL(reg.scope).pathname==="/"){legacy=true;await reg.unregister()}
        }catch(_e){}
      }
      if(legacy&&navigator.serviceWorker.controller&&sessionStorage.getItem("pgi-public-sw-migrated")!=="1"){
        sessionStorage.setItem("pgi-public-sw-migrated","1");
        location.reload();
      }
    }).catch(function(){});
  }catch(_e){}
})();
(()=>{
const $=id=>document.getElementById(id);
const gap=$("saving-gap"),hours=$("saving-hours"),days=$("saving-days");
if(!gap||!hours||!days)return;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
const nf=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
function render(){
  const g=clamp(parseFloat(gap.value),0,2);
  const h=clamp(parseFloat(hours.value),0,24);
  const d=clamp(parseFloat(days.value),0,31);
  const minutes=h*60*d;
  const perMonth=minutes*g;
  $("saving-month").textContent=money.format(perMonth);
  $("saving-year").textContent=money.format(perMonth*12);
  $("saving-minutes").textContent=nf.format(minutes);
}
[gap,hours,days].forEach(el=>el.addEventListener("input",render));
render();
})();

;(()=>{
const KEY="pgi_public_order_intent_v1",DRAFT_KEY="pgi_public_order_draft_v1",MAX_AGE=3600000;
const form=document.getElementById("order-form");
if(!form)return;
const typeInputs=[...form.querySelectorAll('input[name="order_account_type"]')];
const companyWrap=document.getElementById("order-company-wrap");
const company=document.getElementById("order-company");
const value=id=>String(document.getElementById(id)?.value||"").trim();
function selectedType(){return form.querySelector('input[name="order_account_type"]:checked')?.value||""}
function syncType(){
  const type=selectedType(),business=type==="business";
  if(companyWrap)companyWrap.hidden=!business;
  if(company){company.disabled=!business;if(!business)company.value=""}
}
function snapshot(){const type=selectedType();
  return {version:1,created_at:Date.now(),account_type:type,first_name:value("order-first-name").slice(0,80),last_name:value("order-last-name").slice(0,80),company_name:type==="business"?value("order-company").slice(0,200):"",email:value("order-email").slice(0,320),phone:value("order-phone").slice(0,40),service_intent:value("order-service-intent"),country_code:"FR",preferred_locale:(navigator.languages&&navigator.languages[0])||navigator.language||"fr-FR",timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Paris"),processing_consent:!!document.getElementById("order-processing-consent")?.checked,marketing_consent:!!document.getElementById("order-marketing-consent")?.checked,marketing_consent_version:"2026-10-01-v1",website:value("order-website")};
}
function saveDraft(){try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(snapshot()))}catch(_e){}}
function hydrateDraft(){
  try{
    const raw=sessionStorage.getItem(DRAFT_KEY);if(!raw)return;
    const x=JSON.parse(raw),age=Date.now()-Number(x.created_at||0);
    if(!x||x.version!==1||age<0||age>MAX_AGE){sessionStorage.removeItem(DRAFT_KEY);return}
    const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null&&!el.value)el.value=String(v)};
    if(["individual","business"].includes(x.account_type)){const radio=form.querySelector('input[name="order_account_type"][value="'+x.account_type+'"]');if(radio)radio.checked=true}
    set("order-first-name",x.first_name);set("order-last-name",x.last_name);set("order-company",x.company_name);set("order-email",x.email);set("order-phone",x.phone);set("order-service-intent",x.service_intent);
  }catch(_e){try{sessionStorage.removeItem(DRAFT_KEY)}catch(_x){}}
}
function applyRequestedProfile(){
  const profile=new URLSearchParams(location.search).get("profil"),type=["business","professionnel","entreprise"].includes(profile)?"business":["individual","particulier"].includes(profile)?"individual":"";
  if(!type)return;
  const radio=form.querySelector('input[name="order_account_type"][value="'+type+'"]');if(radio)radio.checked=true;
}
function applyRequestedIntent(){
  const params=new URLSearchParams(location.search),requested=String(params.get("type")||params.get("besoin")||"").toLowerCase();
  const map={portabilite:"portability",portability:"portability",nouveau:"new_number",new_number:"new_number",conseil:"advice",advice:"advice"};
  const intent=map[requested],select=document.getElementById("order-service-intent");
  if(intent&&select&&!select.value)select.value=intent;
}
hydrateDraft();applyRequestedProfile();applyRequestedIntent();
typeInputs.forEach(x=>x.addEventListener("change",syncType));
document.querySelectorAll("[data-order-type]").forEach(link=>link.addEventListener("click",()=>{
  const radio=form.querySelector('input[name="order_account_type"][value="'+link.dataset.orderType+'"]');
  if(radio){radio.checked=true;syncType();saveDraft()}
}));
form.addEventListener("input",saveDraft);
form.addEventListener("change",saveDraft);
async function captureLead(i){try{const r=await fetch("/api/v1/public/hubspot/lead",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",keepalive:true,body:JSON.stringify({...i,page_uri:location.href.split("#")[0],page_name:document.title})}),data=await r.json().catch(()=>({}));if(r.ok&&data.accepted)window.PGIAnalytics?.track("generate_lead");return {ok:r.ok,data}}catch(_e){return null}}
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const type=selectedType();
  if(!["individual","business"].includes(type))return;
  const intent={...snapshot(),source:"public_marketing_site"};
  const referralCode=String(new URL(location.href).searchParams.get("ref")||"").trim().toUpperCase();
  if(/^PGI-[A-Z0-9]{12,24}$/.test(referralCode))intent.referral_code=referralCode;
  if(intent.processing_consent!==true)return;
  try{sessionStorage.setItem(KEY,JSON.stringify(intent));sessionStorage.removeItem(DRAFT_KEY)}
  catch(_e){const s=document.getElementById("order-status");if(s)s.hidden=false;return}
  const b=form.querySelector('button[type="submit"]');if(b){b.disabled=true;b.setAttribute("aria-busy","true");b.innerHTML="Création de votre dossier…"}
  const result=await Promise.race([captureLead(intent),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
  const sent=result&&result.ok&&result.data&&result.data.access_email_sent===true;
  location.href="../client.html?opening="+(sent?"access-sent":"received");
});
syncType();
})();

;(()=>{
const box=document.getElementById("simulateur");
if(!box)return;
const head=box.querySelector(".hero-savings-head");
if(head&&!head.querySelector(".public-demo-badge"))head.insertAdjacentHTML("beforeend",'<span class="public-demo-badge">SIMULATION · NON CONTRACTUELLE</span>');
})();;

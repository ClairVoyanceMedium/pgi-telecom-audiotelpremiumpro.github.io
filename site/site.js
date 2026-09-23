(()=>{
const $=id=>document.getElementById(id);
const rate=$("rate"),hours=$("hours"),days=$("days");
if(!rate||!hours||!days)return;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
const nf=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
function render(){
  const r=clamp(parseFloat(rate.value),0,1);
  const h=clamp(parseFloat(hours.value),0,24);
  const d=clamp(parseFloat(days.value),0,31);
  const minutes=h*60*d;
  const perDay=h*60*r;
  const perMonth=minutes*r;
  $("calc-minutes").textContent=nf.format(minutes);
  $("calc-day").textContent=money.format(perDay)+" HT";
  $("calc-month").textContent=money.format(perMonth)+" HT";
  $("calc-year").textContent=money.format(perMonth*12)+" HT";
}
[rate,hours,days].forEach(el=>el.addEventListener("input",render));
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
  const type=selectedType();
  const business=type==="business";
  if(companyWrap)companyWrap.hidden=!business;
  if(company){company.disabled=!business;if(!business)company.value=""}
}
function snapshot(){
  const type=selectedType();
  return {version:1,created_at:Date.now(),account_type:type,first_name:value("order-first-name").slice(0,80),last_name:value("order-last-name").slice(0,80),company_name:type==="business"?value("order-company").slice(0,200):"",email:value("order-email").slice(0,320),phone:value("order-phone").slice(0,40),service_intent:value("order-service-intent")};
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
hydrateDraft();applyRequestedProfile();
typeInputs.forEach(x=>x.addEventListener("change",syncType));
document.querySelectorAll("[data-order-type]").forEach(link=>link.addEventListener("click",()=>{
  const radio=form.querySelector('input[name="order_account_type"][value="'+link.dataset.orderType+'"]');
  if(radio){radio.checked=true;syncType();saveDraft()}
}));
form.addEventListener("input",saveDraft);
form.addEventListener("change",saveDraft);
form.addEventListener("submit",e=>{
  e.preventDefault();
  const type=selectedType();
  if(!["individual","business"].includes(type))return;
  const intent={...snapshot(),source:"public_marketing_site"};
  try{sessionStorage.setItem(KEY,JSON.stringify(intent));sessionStorage.removeItem(DRAFT_KEY)}
  catch(_e){const s=document.getElementById("order-status");if(s)s.hidden=false;return}
  const b=form.querySelector('button[type="submit"]');if(b){b.disabled=true;b.setAttribute("aria-busy","true");b.innerHTML="Ouverture de l’inscription…"}
  location.href="../client.html?register=1";
});
syncType();
})();

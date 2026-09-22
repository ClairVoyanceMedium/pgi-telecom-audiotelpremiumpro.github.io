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
const KEY="pgi_public_order_intent_v1";
const form=document.getElementById("order-form");
if(!form)return;
const typeInputs=[...form.querySelectorAll('input[name="order_account_type"]')];
const companyWrap=document.getElementById("order-company-wrap");
const company=document.getElementById("order-company");
function syncType(){
  const type=form.querySelector('input[name="order_account_type"]:checked')?.value||"";
  const business=type==="business";
  if(companyWrap)companyWrap.hidden=!business;
  if(company){company.disabled=!business;if(!business)company.value=""}
}
typeInputs.forEach(x=>x.addEventListener("change",syncType));
document.querySelectorAll("[data-order-type]").forEach(link=>link.addEventListener("click",()=>{
  const radio=form.querySelector('input[name="order_account_type"][value="'+link.dataset.orderType+'"]');
  if(radio){radio.checked=true;syncType()}
}));
form.addEventListener("submit",e=>{
  e.preventDefault();
  const type=form.querySelector('input[name="order_account_type"]:checked')?.value||"";
  if(!["individual","business"].includes(type))return;
  const intent={
    version:1,
    created_at:Date.now(),
    source:"public_marketing_site",
    account_type:type,
    first_name:String(document.getElementById("order-first-name")?.value||"").trim().slice(0,80),
    last_name:String(document.getElementById("order-last-name")?.value||"").trim().slice(0,80),
    company_name:type==="business"?String(company?.value||"").trim().slice(0,200):"",
    email:String(document.getElementById("order-email")?.value||"").trim().slice(0,320),
    phone:String(document.getElementById("order-phone")?.value||"").trim().slice(0,40),
    service_intent:String(document.getElementById("order-service-intent")?.value||"")
  };
  try{sessionStorage.setItem(KEY,JSON.stringify(intent))}catch(_e){}
  location.href="../client.html?register=1";
});
syncType();
})();

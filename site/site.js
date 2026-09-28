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
  return {version:1,created_at:Date.now(),account_type:type,first_name:value("order-first-name").slice(0,80),last_name:value("order-last-name").slice(0,80),company_name:type==="business"?value("order-company").slice(0,200):"",email:value("order-email").slice(0,320),phone:value("order-phone").slice(0,40),service_intent:value("order-service-intent"),processing_consent:Boolean(document.getElementById("order-processing-consent")?.checked),website:value("order-website")};
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
async function captureLead(intent){const payload={...intent,page_uri:location.href.split("#")[0],page_name:document.title};window.PGIAnalytics?.track("generate_lead");try{return await fetch("/api/v1/public/hubspot/lead",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",keepalive:true,body:JSON.stringify(payload)})}catch(_e){return null}}
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const type=selectedType();
  if(!["individual","business"].includes(type))return;
  const intent={...snapshot(),source:"public_marketing_site"};
  if(intent.processing_consent!==true)return;
  try{sessionStorage.setItem(KEY,JSON.stringify(intent));sessionStorage.removeItem(DRAFT_KEY)}
  catch(_e){const s=document.getElementById("order-status");if(s)s.hidden=false;return}
  const b=form.querySelector('button[type="submit"]');if(b){b.disabled=true;b.setAttribute("aria-busy","true");b.innerHTML="Ouverture de l’inscription…"}
  await Promise.race([captureLead(intent),new Promise(resolve=>setTimeout(resolve,900))]);
  location.href="../client.html?register=1";
});
syncType();
})();


;(()=>{
if(document.querySelector("[data-contact-widget]"))return;
const root=document.createElement("div");
root.className="contact-widget";
root.dataset.contactWidget="";
root.innerHTML=`
<button class="contact-widget-button" type="button" aria-label="Nous contacter" aria-expanded="false" aria-controls="contact-widget-panel">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 5.75h16.5v12.5H3.75z"></path><path d="m4.5 6.5 7.5 6 7.5-6"></path></svg>
  <span>Nous contacter</span>
</button>
<section id="contact-widget-panel" class="contact-widget-panel" aria-label="Contacter Audiotel Premium Pro" hidden>
  <div class="contact-widget-head">
    <div><strong>Nous contacter</strong><span>Une question ? Écrivez-nous directement.</span></div>
    <button class="contact-widget-close" type="button" aria-label="Fermer">×</button>
  </div>
  <form class="contact-widget-form" novalidate>
    <label>Votre adresse email<input name="email" type="email" autocomplete="email" inputmode="email" maxlength="320" required placeholder="vous@exemple.fr"></label>
    <label>Votre message<textarea name="message" rows="5" maxlength="4000" required placeholder="Comment pouvons-nous vous aider ?"></textarea></label>
    <label class="contact-widget-honeypot" aria-hidden="true">Site web<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
    <button class="contact-widget-submit" type="submit">Envoyer mon message</button>
    <p class="contact-widget-status" role="status" aria-live="polite"></p>
    <p class="contact-widget-privacy">Vos informations sont utilisées uniquement pour traiter votre demande. <a href="/confidentialite/">Confidentialité</a></p>
  </form>
</section>`;
document.body.appendChild(root);
const toggle=root.querySelector(".contact-widget-button");
const panel=root.querySelector(".contact-widget-panel");
const close=root.querySelector(".contact-widget-close");
const form=root.querySelector(".contact-widget-form");
const status=root.querySelector(".contact-widget-status");
const email=form.elements.email;
const message=form.elements.message;
const submit=form.querySelector(".contact-widget-submit");
function setOpen(open){
  panel.hidden=!open;
  toggle.setAttribute("aria-expanded",String(open));
  root.classList.toggle("is-open",open);
  if(open)setTimeout(()=>email.focus(),0);
}
toggle.addEventListener("click",()=>setOpen(panel.hidden));
close.addEventListener("click",()=>setOpen(false));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!panel.hidden)setOpen(false)});
form.addEventListener("submit",async e=>{
  e.preventDefault();
  status.className="contact-widget-status";
  status.textContent="";
  if(!form.reportValidity())return;
  const payload={
    email:String(email.value||"").trim(),
    message:String(message.value||"").trim(),
    website:String(form.elements.website?.value||"").trim(),
    page_path:location.pathname+location.search,
    page_title:document.title
  };
  if(payload.message.length<2){status.textContent="Merci de préciser votre message.";status.classList.add("bad");message.focus();return}
  submit.disabled=true;
  submit.setAttribute("aria-busy","true");
  submit.textContent="Envoi en cours…";
  try{
    const response=await fetch("/api/v1/public/contact",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error("contact_failed");
    const result=await response.json().catch(()=>({}));
    if(result.accepted!==true)throw new Error("contact_rejected");
    form.reset();
    status.textContent="Votre message a bien été envoyé. Nous vous répondrons par email.";
    status.classList.add("ok");
  }catch(_error){
    status.textContent="L’envoi n’a pas abouti. Merci de réessayer dans quelques instants.";
    status.classList.add("bad");
  }finally{
    submit.disabled=false;
    submit.removeAttribute("aria-busy");
    submit.textContent="Envoyer mon message";
  }
});
})();

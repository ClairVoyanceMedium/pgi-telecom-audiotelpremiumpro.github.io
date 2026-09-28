(()=>{
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
const contactSource="floating_email_widget";
let formStarted=false;
function contactContext(){
  const p=String(location.pathname||"/").toLowerCase();
  if(p==="/")return "home";
  if(/tarif|comparateur/.test(p))return "pricing";
  if(/portabilite/.test(p))return "portability";
  if(/reversement/.test(p))return "payouts";
  if(/guide|numero-sva|numero-surtaxe/.test(p))return "education";
  if(/audiotel-(voyance|coaching|professionnels|independants)/.test(p))return "industry";
  if(/demande-ouverture/.test(p))return "opening";
  if(/conditions|confidentialite|mentions-legales|retractation|resilier|cookies/.test(p))return "legal";
  return "other";
}
function track(name,extra={}){
  window.PGIAnalytics?.track(name,{contact_context:contactContext(),contact_source:contactSource,...extra});
}
function setOpen(open){
  panel.hidden=!open;
  toggle.setAttribute("aria-expanded",String(open));
  root.classList.toggle("is-open",open);
  if(open){track("contact_widget_open");setTimeout(()=>email.focus(),0);}
}
toggle.addEventListener("click",()=>setOpen(panel.hidden));
close.addEventListener("click",()=>setOpen(false));
form.addEventListener("focusin",()=>{
  if(formStarted)return;
  formStarted=true;
  track("contact_form_start");
},{once:true});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!panel.hidden)setOpen(false)});
form.addEventListener("submit",async e=>{
  e.preventDefault();
  status.className="contact-widget-status";
  status.textContent="";
  if(!form.reportValidity()){track("contact_message_error",{error_type:"validation"});return;}
  const payload={
    email:String(email.value||"").trim(),
    message:String(message.value||"").trim(),
    website:String(form.elements.website?.value||"").trim(),
    page_path:location.pathname+location.search,
    page_title:document.title
  };
  if(payload.message.length<2){track("contact_message_error",{error_type:"validation"});status.textContent="Merci de préciser votre message.";status.classList.add("bad");message.focus();return}
  track("contact_message_submit");
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
    track("contact_message_success",{crm_sync:result.crm_sync===true?"synced":"not_synced"});
    form.reset();
    status.textContent="Votre message a bien été envoyé. Nous vous répondrons par email.";
    status.classList.add("ok");
  }catch(_error){
    track("contact_message_error",{error_type:"network_or_server"});
    status.textContent="L’envoi n’a pas abouti. Merci de réessayer dans quelques instants.";
    status.classList.add("bad");
  }finally{
    submit.disabled=false;
    submit.removeAttribute("aria-busy");
    submit.textContent="Envoyer mon message";
  }
});
})();
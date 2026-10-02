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
<div class="contact-widget-backdrop" hidden></div>
<section id="contact-widget-panel" class="contact-widget-panel" role="dialog" aria-modal="true" aria-label="Contacter Audiotel Premium Pro" hidden>
  <div class="contact-widget-head">
    <div><strong>Nous contacter</strong><span>Une question ? Écrivez-nous directement.</span></div>
    <button class="contact-widget-close" type="button" aria-label="Fermer">×</button>
  </div>
  <form class="contact-widget-form" novalidate>
    <label>Votre adresse email<input name="email" type="email" autocomplete="email" inputmode="email" maxlength="320" required placeholder="vous@exemple.fr"></label>
    <label>Votre message<textarea name="message" rows="5" maxlength="4000" required placeholder="Comment pouvons-nous vous aider ?"></textarea></label>
    <label class="contact-widget-marketing"><input name="marketing_consent" type="checkbox" value="yes"><span>J’accepte de recevoir par e-mail les actualités, offres et informations commerciales d’Audiotel Premium Pro. Je peux me désinscrire à tout moment.</span></label>
    <label class="contact-widget-honeypot" aria-hidden="true">Site web<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
    <button class="contact-widget-submit" type="submit">Envoyer mon message</button>
    <p class="contact-widget-status" role="status" aria-live="polite"></p>
    <p class="contact-widget-privacy">Vos informations servent à traiter votre demande. Les communications commerciales ne sont envoyées que si vous cochez volontairement la case ci-dessus. <a href="/confidentialite/">Confidentialité</a></p>
  </form>
</section>`;
document.body.appendChild(root);
const toggle=root.querySelector(".contact-widget-button");
const panel=root.querySelector(".contact-widget-panel");
const backdrop=root.querySelector(".contact-widget-backdrop");
const close=root.querySelector(".contact-widget-close");
const form=root.querySelector(".contact-widget-form");
const status=root.querySelector(".contact-widget-status");
const email=form.elements.email;
const message=form.elements.message;
const submit=form.querySelector(".contact-widget-submit");
const contactSource="floating_email_widget";
const dragMargin=10;
let formStarted=false,dragState=null,suppressClick=false;
function clamp(value,min,max){return Math.min(Math.max(value,min),Math.max(min,max))}
function placeWidget(left,top){
  const width=toggle.offsetWidth||58,height=toggle.offsetHeight||58;
  const maxLeft=window.innerWidth-width-dragMargin,maxTop=window.innerHeight-height-dragMargin;
  root.style.left=clamp(Math.round(left),dragMargin,maxLeft)+"px";
  root.style.top=clamp(Math.round(top),dragMargin,maxTop)+"px";
  root.style.right="auto";
  root.style.bottom="auto";
}
function clampWidgetToViewport(){
  if(!root.style.left&&!root.style.top)return;
  const rect=root.getBoundingClientRect();
  placeWidget(rect.left,rect.top);
}
function beginDrag(event){
  if(!panel.hidden||event.button>0)return;
  const rect=root.getBoundingClientRect();
  dragState={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top,moved:false};
  toggle.setPointerCapture?.(event.pointerId);
}
function moveDrag(event){
  if(!dragState||event.pointerId!==dragState.pointerId)return;
  const dx=event.clientX-dragState.startX,dy=event.clientY-dragState.startY;
  if(!dragState.moved&&Math.hypot(dx,dy)<5)return;
  dragState.moved=true;
  suppressClick=true;
  toggle.classList.add("is-dragging");
  placeWidget(dragState.left+dx,dragState.top+dy);
  event.preventDefault();
}
function endDrag(event){
  if(!dragState||event.pointerId!==dragState.pointerId)return;
  const moved=dragState.moved;
  try{toggle.releasePointerCapture?.(event.pointerId)}catch(_e){}
  dragState=null;
  toggle.classList.remove("is-dragging");
  if(moved)setTimeout(()=>{suppressClick=false},0);
}
toggle.addEventListener("pointerdown",beginDrag);
toggle.addEventListener("pointermove",moveDrag);
toggle.addEventListener("pointerup",endDrag);
toggle.addEventListener("pointercancel",endDrag);
window.addEventListener("resize",()=>requestAnimationFrame(clampWidgetToViewport));
window.visualViewport?.addEventListener("resize",()=>requestAnimationFrame(clampWidgetToViewport));
function contactContext(){
  const p=String(location.pathname||"/").toLowerCase();
  if(p==="/")return "home";
  if(/tarif|comparateur/.test(p))return "pricing";
  if(/portabilite/.test(p))return "portability";
  if(/reversement/.test(p))return "payouts";
  if(/guide|numero-sva|numero-surtaxe|audiotel-sans-siret/.test(p))return "education";
  if(/audiotel-(voyance|coaching|professionnels|independants)/.test(p))return "industry";
  if(/demande-ouverture/.test(p))return "opening";
  if(/conditions|confidentialite|mentions-legales|retractation|resilier|cookies/.test(p))return "legal";
  return "other";
}
function track(name,extra={}){
  window.PGIAnalytics?.track(name,{contact_context:contactContext(),contact_source:contactSource,...extra});
}
function setOpen(open){
  const wasOpen=!panel.hidden;
  panel.hidden=!open;
  backdrop.hidden=!open;
  toggle.setAttribute("aria-expanded",String(open));
  root.classList.toggle("is-open",open);
  if(open){track("contact_widget_open");setTimeout(()=>email.focus({preventScroll:true}),0);}
  else if(wasOpen)setTimeout(()=>toggle.focus({preventScroll:true}),0);
}
toggle.addEventListener("click",event=>{
  if(suppressClick){event.preventDefault();return}
  setOpen(panel.hidden);
});
backdrop.addEventListener("click",()=>setOpen(false));
close.addEventListener("click",()=>setOpen(false));
form.addEventListener("focusin",()=>{
  if(formStarted)return;
  formStarted=true;
  track("contact_form_start");
},{once:true});
document.addEventListener("keydown",e=>{
  if(panel.hidden)return;
  if(e.key==="Escape"){e.preventDefault();setOpen(false);return}
  if(e.key!=="Tab")return;
  const focusable=[...panel.querySelectorAll("button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]")].filter(el=>el.getClientRects().length>0);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
form.addEventListener("submit",async e=>{
  e.preventDefault();
  status.className="contact-widget-status";
  status.textContent="";
  if(!form.checkValidity()){track("contact_message_error",{error_type:"validation"});status.textContent="Merci de compléter les champs obligatoires.";status.classList.add("bad");const invalid=form.querySelector(":invalid");if(invalid){invalid.scrollIntoView({block:"center",inline:"nearest"});try{invalid.focus({preventScroll:true})}catch(_e){invalid.focus()}}return;}
  const payload={
    email:String(email.value||"").trim(),
    message:String(message.value||"").trim(),
    website:String(form.elements.website?.value||"").trim(),
    page_path:location.pathname+location.search,
    page_title:document.title,
    marketing_consent:Boolean(form.elements.marketing_consent?.checked),
    marketing_consent_version:"2026-10-01-v1"
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
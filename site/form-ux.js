(()=>{
"use strict";
const form=document.getElementById("order-form");if(!form)return;
form.noValidate=true;
const submit=form.querySelector('button[type="submit"]'),status=document.createElement("p");
status.className="order-status";status.hidden=true;status.setAttribute("role","alert");status.setAttribute("aria-live","polite");status.dataset.orderValidation="";
if(submit)submit.before(status);else form.appendChild(status);
const controls=[...form.querySelectorAll("input,select,textarea")].filter(el=>!el.disabled&&el.type!=="hidden");
function firstInvalid(){return controls.find(el=>el.validity&&!el.validity.valid)||null}
function fieldName(el){const n=String(el?.name||"");if(n==="order_account_type")return "votre profil";if(n==="first_name")return "votre prénom";if(n==="last_name")return "votre nom";if(n==="email")return el.validity?.typeMismatch?"une adresse e-mail valide":"votre adresse e-mail";if(n==="service_intent")return "votre besoin principal";if(n==="processing_consent")return "votre accord pour le traitement de la demande";return "ce champ"}
function clearError(el){el?.removeAttribute?.("aria-invalid");el?.closest?.("label")?.classList.remove("has-error");if(el?.name==="order_account_type")form.querySelector(".account-choice")?.classList.remove("has-error")}
function showInvalid(el){controls.forEach(clearError);if(!el)return;el.setAttribute("aria-invalid","true");el.closest("label")?.classList.add("has-error");let target=el;if(el.name==="order_account_type"){target=form.querySelector(".account-choice")||el;target.classList.add("has-error");target.tabIndex=-1}status.textContent="Merci de compléter "+fieldName(el)+" avant de continuer.";status.hidden=false;const behavior=matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";target.scrollIntoView({block:"center",inline:"nearest",behavior});setTimeout(()=>{try{target.focus({preventScroll:true})}catch(_e){target.focus()}},behavior==="smooth"?180:0)}
function validate(){form.checkValidity();const invalid=firstInvalid();if(!invalid){status.hidden=true;status.textContent="";controls.forEach(clearError);return true}showInvalid(invalid);return false}
form.addEventListener("submit",event=>{if(validate())return;event.preventDefault();event.stopImmediatePropagation()},true);
form.addEventListener("input",event=>{clearError(event.target);if(!firstInvalid()){status.hidden=true;status.textContent=""}});
form.addEventListener("change",event=>{clearError(event.target);if(!firstInvalid()){status.hidden=true;status.textContent=""}});
})();
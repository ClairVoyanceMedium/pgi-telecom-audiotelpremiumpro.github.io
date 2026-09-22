let bound=false;
function $(id){return document.getElementById(id)}
function apply(){
  const type=$("register-account-type")?.value||"",business=type==="business",individual=type==="individual";
  const companyWrap=$("register-business-company-wrap"),numberWrap=$("register-business-number-wrap"),company=$("register-company"),number=$("register-number"),note=$("register-profile-note"),authority=$("register-authority-text");
  if(companyWrap)companyWrap.hidden=!business;
  if(numberWrap)numberWrap.hidden=!business;
  if(company){company.disabled=!business;if(!business)company.value=""}
  if(number){number.disabled=!business;if(!business)number.value=""}
  if(note)note.textContent=business?"Les informations professionnelles restent facultatives à l’inscription et pourront être vérifiées avant l’activation des services.":individual?"Votre espace reste simple et personnel ; les fonctions d’équipe ne sont pas affichées.":"Choisissez le profil correspondant au titulaire du compte.";
  if(authority)authority.textContent=business?"Je confirme être autorisé à créer ce compte pour cette activité.":individual?"Je confirme créer ce compte pour mon propre usage et être la personne titulaire de ce compte.":"Je confirme l’exactitude des informations fournies pour ce compte.";
}
function hydratePublicOrderIntent(){
  try{
    const raw=sessionStorage.getItem("pgi_public_order_intent_v1");if(!raw)return;
    const x=JSON.parse(raw),age=Date.now()-Number(x.created_at||0);
    if(!x||x.version!==1||age<0||age>3600000){sessionStorage.removeItem("pgi_public_order_intent_v1");return}
    const set=(id,value)=>{const el=$(id);if(el&&value!=null)el.value=String(value)};
    if(["individual","business"].includes(x.account_type))set("register-account-type",x.account_type);
    set("register-first-name",x.first_name);set("register-last-name",x.last_name);set("register-email",x.email);set("register-phone",x.phone);
    if(x.account_type==="business")set("register-company",x.company_name);
    const form=$("customer-register-form");if(form){form.dataset.acquisitionSource="public_marketing_site";form.dataset.serviceIntent=String(x.service_intent||"").slice(0,40)}
    sessionStorage.removeItem("pgi_public_order_intent_v1");
  }catch(_e){try{sessionStorage.removeItem("pgi_public_order_intent_v1")}catch(_x){}}
}
export function init(){
  const select=$("register-account-type"),form=$("customer-register-form");if(!select)return;
  if(!bound){
    select.addEventListener("change",apply);
    if((window.PGI_CONFIG||{}).mode==="demo"&&form)form.addEventListener("submit",e=>{e.preventDefault();e.stopImmediatePropagation();const m=$("auth-message");if(m){m.classList.remove("bad");m.textContent="Démonstration : aucune demande réelle n’est envoyée depuis GitHub Pages. Le même parcours enverra la création du compte dès que l’API de production sera raccordée.";}},{capture:true});
    bound=true
  }
  hydratePublicOrderIntent();apply();
}

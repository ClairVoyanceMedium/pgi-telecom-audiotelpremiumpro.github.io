let bound=false;
function $(id){return document.getElementById(id)}
function ensureLegalAcceptance(){
  if($("register-legal"))return;
  const authority=$("register-authority")?.closest("label");if(!authority)return;
  const label=document.createElement("label");label.className="cp-check";
  label.innerHTML='<input id="register-legal" type="checkbox" required><span>J’accepte les <a href="/conditions-utilisation/" target="_blank" rel="noopener">CGU</a> et les <a href="/conditions-abonnement/" target="_blank" rel="noopener">conditions d’abonnement</a>. J’ai pris connaissance de la <a href="/confidentialite/" target="_blank" rel="noopener">politique de confidentialité</a>.</span>';
  authority.insertAdjacentElement("afterend",label);
}
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
    const clean=(v,n=180)=>String(v||"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,n);
    window.PGIOrderMeta={
      acquisition_source:"public_marketing_site",
      service_intent:clean(x.service_intent,40),
      utm_source:clean(x.utm_source),utm_medium:clean(x.utm_medium),utm_campaign:clean(x.utm_campaign),
      utm_term:clean(x.utm_term),utm_content:clean(x.utm_content),
      landing_path:clean(String(x.landing_path||"").split("?")[0],300),
      referrer_host:clean(x.referrer_host,180),
      acquisition_session_id:clean(x.acquisition_session_id,120)
    };
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
  ensureLegalAcceptance();hydratePublicOrderIntent();apply();
}

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
export function init(){
  const select=$("register-account-type");if(!select)return;
  if(!bound){select.addEventListener("change",apply);bound=true}
  apply();
}

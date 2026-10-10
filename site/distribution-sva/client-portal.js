// Private client portal of the future direct SVA business unit.
// No signup or demo data. Never requests data outside the authenticated tenant.
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const state={authenticated:false,active:false,data:null};
function notice(message){const el=$("ds-client-notice");if(el)el.textContent=String(message);}
async function json(path){
 const response=await fetch(path,{method:"GET",credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json"}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok){const e=new Error(body?.error?.code||"HTTP_"+response.status);e.httpStatus=response.status;throw e;}
 return body;
}
const formatDate=x=>{const d=new Date(x);return x&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"Non disponible";};
function table(headers,rows){
 if(!rows.length)return '<p class="subtle">Aucun élément pour cette activité.</p>';
 return '<table><thead><tr>'+headers.map(s=>'<th scope="col">'+esc(s)+'</th>').join("")+'</tr></thead><tbody>'+
 rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
}
function render(data){
 if(!data||data.business_unit!=="direct_sva"||data.source!=="direct_sva_only"||
    data.tenant_scope!=="authenticated_customer_only"||!Array.isArray(data.cases)||
    !Array.isArray(data.numbers)||!Array.isArray(data.features)){
  throw Error("DIRECT_SVA_RESPONSE_INTEGRITY_INVALID");
 }
 state.data=data;
 $("ds-client-content").hidden=false;
 $("ds-client-cases").innerHTML=table(["Référence","Dossier","État","Ouverture"],
  (data.cases||[]).map(c=>[c.reference,c.kind,c.status,formatDate(c.created_at)]));
 $("ds-client-numbers").innerHTML=table(["Numéro","État","Conformité"],
  (data.numbers||[]).map(n=>[n.number,n.status,n.compliance_status]));
 $("ds-client-features").innerHTML=(data.features||[]).map(f=>'<article class="card"><h3>'+esc(f.label)+'</h3><p>Module : '+esc(f.status)+'. Ce service ne produit pas d’opération bancaire pendant la préparation.</p></article>').join("");
 $("ds-client-finance").textContent="Le suivi financier sera alimenté uniquement par des relevés directs validés et associés à votre compte. Paiements désactivés : aucune somme fictive n’est affichée.";
 notice("Accès documentaire seulement. Aucun numéro, routage ou reversement direct ne peut être activé.");
}
async function load(){
 try{
  const who=await json("/api/v1/customer/auth/me");
  state.authenticated=Boolean(who?.user);
  if(!state.authenticated)throw Error("AUTH_REQUIRED");
  const payload=await json("/api/v1/customer/direct-sva/overview");
  render(payload);state.active=true;$("ds-client-auth").hidden=true;
 }catch(error){
  state.active=false;state.data=null;
  $("ds-client-content").hidden=true;
  $("ds-client-auth").hidden=false;
  if(error.httpStatus===401||error.message==="AUTH_REQUIRED")notice("Veuillez vous connecter à votre compte client PGI.");
  else if(error.httpStatus===403||error.httpStatus===404)notice("L'accès à PGI Telecom Distribution n'est pas encore ouvert pour ce compte. L'activité Audiotel reste indépendante.");
  else if(error.message==="DIRECT_SVA_RESPONSE_INTEGRITY_INVALID")notice("Réponse incompatible avec PGI Telecom Distribution. Aucun dossier ni chiffre affiché.");
  else notice("Ce service est indisponible en préparation. Aucun changement à votre compte.");
 }
}
document.querySelectorAll("[data-ds-year]").forEach(n=>{n.textContent=String(new Date().getFullYear());});
$("ds-client-refresh")?.addEventListener("click",load);
$("ds-client-print")?.addEventListener("click",()=>window.print());
load();

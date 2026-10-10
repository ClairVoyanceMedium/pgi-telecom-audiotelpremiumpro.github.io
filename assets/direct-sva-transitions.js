// Private administrator-only preparation of customer-stable provider migrations.
// Loaded only inside the disabled-by-default SVA distributor cockpit.
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
let root=null,records=null,plans=null,tenantFilter="",busy=false,notice="";
function apiBase(){
 const url=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");
 if(!url)throw Error("API_NOT_CONFIGURED");
 return url;
}
function csrf(){
 for(const item of String(document.cookie||"").split(";")){
  const entry=item.trim();
  if(entry.startsWith("__Host-pgi_csrf="))return decodeURIComponent(entry.slice(16));
 }
 return "";
}
async function api(path,method="GET",payload=null){
 const headers={Accept:"application/json"};
 if(method!=="GET"){headers["Content-Type"]="application/json";headers["X-CSRF-Token"]=csrf();
   headers["Idempotency-Key"]=window.PGIApi?.newIdempotencyKey?.()||crypto.randomUUID();}
 const res=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,
  body:payload==null?undefined:JSON.stringify(payload)});
 const body=await res.json().catch(()=>null);
 if(!res.ok)throw Error(body?.error?.code||"HTTP_"+res.status);
 return body;
}
function render(){
 if(!root||!root.isConnected)return;
 const available=(records?.records||[]).filter(r=>r.eligible_to_prepare);
 const all=records?.records||[],history=plans?.plans||[];
 root.innerHTML='<section class="ds-panel"><h3>Continuité des clients et Business Live</h3>'+
 '<p class="ds-note">Le même dossier client, numéro surtaxé, abonnement, identifiant et historique restent la référence. La distribution évolue derrière l’espace client, sans réinitialiser Business Live. Aucun montant historique ne sera recalculé avec le tarif du futur opérateur.</p>'+
 '<div class="ds-warning">Préparation uniquement. Le transfert réel d’un numéro et le changement contractuel éventuel exigent les validations opérateur et réglementaires, les contrôles sur la facturation, ainsi que les informations clients légalement nécessaires. Aucun changement de numéro, routage ou virement n’est déclenché ici.</div></section>'+
 '<section class="ds-panel"><h3>Choisir un client existant</h3>'+
 '<form class="ds-actions" data-transition-filter><label class="ds-note">ID client interne (facultatif)'+
 '<input class="ds-input" type="number" min="1" data-transition-tenant value="'+esc(tenantFilter)+'" placeholder="Tous les clients actifs"></label>'+
 '<button class="ds-button" type="submit">Rechercher les lignes</button></form>'+
 (records?'<div class="ds-table"><table><thead><tr><th>Dossier</th><th>Numéro</th><th>Hébergeur actuel</th><th>Statut</th></tr></thead><tbody>'+
 all.map(x=>'<tr><td>'+esc(x.tenant_id)+'</td><td>'+esc(x.e164)+'</td><td>'+esc(x.source_host_name||"À identifier")+'</td><td>'+esc(x.already_prepared?"Plan préparé":x.eligible_to_prepare?"Préparable":"Contrôle requis")+'</td></tr>').join("")+
 '</tbody></table></div><p class="ds-note">Au maximum 100 lignes affichées.'+(records.truncated_possible?" Filtrer par ID client pour une recherche exhaustive.":"")+'</p>':
 '<p class="ds-note">Charger les clients actifs pour afficher les lignes éligibles.</p>')+'</section>'+
 '<section class="ds-panel"><h3>Enregistrer un plan de changement de distributeur</h3>'+
 '<form class="ds-form" data-transition-form>'+
 '<label class="ds-wide">Ligne et client existants<select class="ds-input" name="assignment_id" required><option value="">Sélectionner</option>'+
 available.map(x=>'<option value="'+esc(x.assignment_id)+'">'+esc(x.e164+" | client "+x.tenant_id+" | "+(x.source_host_name||"source inconnue"))+'</option>').join("")+'</select></label>'+
 '<label>Nouvelle distribution<select class="ds-input" name="target_mode"><option value="direct_sva">PGI Telecom Distribution (en préparation)</option>'+
 '<option value="partner">Autre prestataire SVA</option></select></label>'+
 '<label>Identifiant du prestataire cible (si prestataire externe)<input class="ds-input" name="target_carrier_id" type="number" min="1" placeholder="Non requis pour PGI direct"></label>'+
 '<label>Fenêtre de bascule envisagée<input class="ds-input" type="datetime-local" name="planned_cutover_at"></label>'+
 '<label class="ds-wide">Référence interne documentée<input class="ds-input" name="evidence_reference" required minlength="8" placeholder="DECISION-PGI-2026-001"></label>'+
 '<div class="ds-actions"><button class="ds-button" type="submit" '+(!available.length||busy?'disabled':'')+'>Préparer, sans modifier le service</button></div></form></section>'+
 '<section class="ds-panel"><h3>Historique des plans</h3>'+
 (plans?(history.length?'<div class="ds-table"><table><thead><tr><th>Client</th><th>Numéro conservé</th><th>Destination envisagée</th><th>État</th></tr></thead><tbody>'+
 history.map(x=>'<tr><td>'+esc(x.tenant_id)+'</td><td>'+esc(x.number)+'</td><td>'+esc(x.target_mode==="direct_sva"?"PGI Telecom Distribution":"Prestataire "+x.target_carrier_id)+'</td><td>Préparé, aucune bascule</td></tr>').join("")+'</tbody></table></div>':
 '<p class="ds-note">Aucun plan pour la sélection.</p>'):'<p class="ds-note">Plans non consultés.</p>')+
 '</section><p class="ds-status" role="status" aria-live="polite">'+esc(notice)+'</p>';
 root.querySelector("[data-transition-filter]")?.addEventListener("submit",e=>{
  e.preventDefault();const next=String(root.querySelector("[data-transition-tenant]")?.value||"").trim();
  if(next&&!/^[1-9][0-9]*$/.test(next)){notice="ID client invalide.";render();return;}
  tenantFilter=next;refresh();
 });
 root.querySelector("[data-transition-form]")?.addEventListener("submit",async e=>{
  e.preventDefault();if(busy)return;
  const f=new FormData(e.currentTarget);
  const mode=String(f.get("target_mode")),target=String(f.get("target_carrier_id")||"").trim();
  if((mode==="partner"&&!target)||(mode==="direct_sva"&&target)){
   notice="La cible ne correspond pas au type de distributeur.";render();return;
  }
  const time=String(f.get("planned_cutover_at")||"").trim();
  let iso=null;
  if(time){const parsed=new Date(time);if(!Number.isFinite(parsed.getTime())){notice="Date invalide.";render();return;}iso=parsed.toISOString();}
  const body={assignment_id:Number(f.get("assignment_id")),target_mode:mode,
    target_carrier_id:mode==="partner"?Number(target):null,
    planned_cutover_at:iso,evidence_reference:String(f.get("evidence_reference")||"").trim()};
  busy=true;
  try{
   const item=await api("/platform/direct-sva/transitions/prepare","POST",body);
   notice="Plan "+item.id+" enregistré. Le numéro, le client, le routage et Business Live restent inchangés.";
   await load();
  }catch(error){notice="Préparation refusée : "+String(error.message);render();}
  finally{busy=false;}
 });
}
async function load(){
 const filter=tenantFilter?"?tenant_id="+encodeURIComponent(tenantFilter):"";
 const result=await Promise.all([api("/platform/direct-sva/transitions/eligible"+filter),
   api("/platform/direct-sva/transitions"+filter)]);
 records=result[0];plans=result[1];render();
}
async function refresh(){
 if(busy)return;busy=true;notice="Lecture des dossiers existants...";
 try{await load();notice="Dossiers chargés. Aucun changement de distributeur exécuté.";}
 catch(error){records=null;plans=null;notice="Module non disponible en préparation : "+String(error.message);}
 finally{busy=false;render();}
}
export function mountDirectSvaTransitions(element){
 if(!element)return;
 if(root===element&&records){render();return;}
 root=element;refresh();
}

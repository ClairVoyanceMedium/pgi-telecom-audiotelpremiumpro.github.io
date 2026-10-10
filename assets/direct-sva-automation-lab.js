// Internal-only workflow test console. It cannot send customer data or call
// HubSpot, GA4, payment providers, telecom networks or email services.
const escape=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const DISPLAY=Object.freeze({
 lead_routing:"Orientation du prospect",compliance_check:"Contrôle du dossier",
 contract_review:"Préparation du contrat",number_assignment:"Attribution de numéro",
 portability:"Portabilité",cdr_ingestion:"Intégration des appels",
 settlement_reconciliation:"Rapprochement financier",accounting_draft:"Écriture comptable",
 invoice_review:"Contrôle des factures",publisher_payout:"Reversement éditeur",
 hubspot_sync:"Synchronisation HubSpot",analytics_delivery:"Suivi Analytics",
 support_followup:"Suivi du support"
});
const STATUS=Object.freeze({
 ready_for_simulation:"Scénario validé en simulation",
 missing_inputs:"Informations simulées manquantes",
 retry_planned:"Nouvel essai recommandé",
 manual_review:"Examen humain recommandé"
});
const styles=".dsr{padding:14px;border:1px solid #395162;border-radius:11px;background:#0b1a28;display:grid;gap:13px}.dsr h3{margin:0;font-size:15px}.dsr p,.dsr small{font-size:11px;color:#9cb7ca;line-height:1.6}.dsr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dsr label{display:grid;gap:5px;font-size:12px}.dsr select,.dsr button{border:1px solid #526778;border-radius:7px;background:#152c3d;color:#fff;padding:9px;font:inherit}.dsr button{cursor:pointer;font-size:12px}.dsr button:disabled{opacity:.5;cursor:wait}.dsr-checks{display:flex;flex-wrap:wrap;gap:9px}.dsr-checks label{display:flex;align-items:center;gap:6px;border:1px solid #445968;border-radius:6px;padding:7px 9px}.dsr-table{max-width:100%;overflow:auto}.dsr table{width:100%;border-collapse:collapse;min-width:650px}.dsr td,.dsr th{text-align:left;padding:8px;border-bottom:1px solid #324756;font-size:11px}.dsr strong{color:#fff}.dsr-actions{display:flex;flex-wrap:wrap;gap:9px}.dsr-tag{font-size:11px;color:#efd39f}.dsr-warning{border:1px solid #87663d;background:#2a231e;border-radius:8px;padding:10px;color:#ffe7c1;font-size:11px}@media(max-width:680px){.dsr-grid{grid-template-columns:1fr}}";
function injectStyles(){if(document.getElementById("pgi-ds-rehearsal-styles"))return;const s=document.createElement("style");s.id="pgi-ds-rehearsal-styles";s.textContent=styles;document.head.appendChild(s);}
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Error("API_NOT_CONFIGURED");return b;}
function cookie(name){const prefix=encodeURIComponent(name)+"=";for(const p of String(document.cookie||"").split(";")){const v=p.trim();if(v.startsWith(prefix))return decodeURIComponent(v.slice(prefix.length));}return"";}
async function api(path,method="GET",payload=null){
 const headers={Accept:"application/json"};
 if(method!=="GET"){headers["Content-Type"]="application/json";headers["X-CSRF-Token"]=cookie("__Host-pgi_csrf");}
 const response=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:payload==null?undefined:JSON.stringify(payload)});
 const value=await response.json().catch(()=>null);
 if(!response.ok)throw Error(value?.error?.code||"HTTP_"+response.status);
 return value;
}
const id=()=>crypto.randomUUID();
const newSource=()=>"DSVA-SIM-"+id();
const newIdempotency=()=>"dsva_sim_"+id();
const short=x=>new Intl.NumberFormat("fr-FR").format(Number(x||0));
export function mountDirectSvaRehearsals(root){
 if(!root)return;
 injectStyles();
 let rules=[],history=null,selected="lead_routing",busy=false;
 let feedback="";let error=false;
 const known=()=>rules.find(r=>r.workflow===selected)||rules[0];
 const render=()=>{
  if(!root.isConnected)return;
  const selection=known();if(selection)selected=selection.workflow;
  const missing=history?.status_counts||{};
  root.innerHTML='<div class="dsr" aria-label="Simulations PGI Telecom Distribution">'+
   '<h3>Laboratoire des 13 automatisations</h3>'+
   '<div class="dsr-warning">Mode test uniquement : données fictives, aucune synchronisation HubSpot/GA4, aucun appel opérateur et aucun paiement. Les cases cochées ne sont pas des preuves réglementaires.</div>'+
   '<div class="dsr-grid">'+
   '<label>Processus à tester<select data-dsr-workflow>'+
   rules.map(r=>'<option value="'+escape(r.workflow)+'" '+(r.workflow===selected?'selected':'')+'>'+escape(DISPLAY[r.workflow]||r.workflow)+'</option>').join("")+
   '</select></label>'+
   '<label>Incident à simuler<select data-dsr-failure><option value="none">Aucun</option><option value="timeout">Délai dépassé</option><option value="rate_limit">Limite fournisseur</option><option value="validation_error">Données invalides</option></select></label></div>'+
   '<fieldset style="border:1px solid #405466;border-radius:8px;padding:10px"><legend>Préconditions fictives</legend><div class="dsr-checks">'+
   (selection?.required_evidence||[]).map(key=>'<label><input type="checkbox" data-dsr-evidence="'+escape(key)+'"> '+escape(key.replaceAll("_"," "))+'</label>').join("")+
   '</div></fieldset>'+
   '<div class="dsr-actions"><button type="button" data-dsr-run '+(busy?'disabled':'')+'>Tester ce processus</button>'+
   '<button type="button" data-dsr-all '+(busy?'disabled':'')+'>Tester automatiquement les 13 scénarios fictifs</button>'+
   '<button type="button" data-dsr-refresh '+(busy?'disabled':'')+'>Actualiser l’historique</button></div>'+
   '<div role="status" aria-live="polite" class="'+(error?'dsr-tag':'')+'">'+escape(feedback)+'</div>'+
   '<div class="dsr-grid">'+
   '<div><small>Simulations conservées</small><br><strong>'+short(history?.total_simulation_count)+'</strong></div>'+
   '<div><small>Examens humains recommandés</small><br><strong>'+short(missing.manual_review)+'</strong></div>'+
   '<div><small>Reprises recommandées</small><br><strong>'+short(missing.retry_planned)+'</strong></div>'+
   '<div><small>Actions réelles exécutées</small><br><strong>0, par conception</strong></div>'+
   '</div><h3>Historique des dernières simulations</h3>'+
   '<div class="dsr-table"><table><thead><tr><th>Processus</th><th>Résultat</th><th>Essai</th><th>Prérequis fictifs manquants</th></tr></thead><tbody>'+
   (history?.recent||[]).map(x=>'<tr><td>'+escape(DISPLAY[x.workflow_key]||x.workflow_key)+'</td>'+
    '<td>'+escape(STATUS[x.result_status]||x.result_status)+'</td><td>'+short(x.attempt_number)+'</td>'+
    '<td>'+escape((x.missing_checks||[]).join(", ")||"Aucun")+'</td></tr>').join("")+
   '</tbody></table></div>'+
   '<small>Seuls les 50 derniers essais sont affichés. Les historiques restent propres à PGI Telecom Distribution.</small></div>';
  root.querySelector("[data-dsr-workflow]")?.addEventListener("change",e=>{selected=e.target.value;render();});
  root.querySelector("[data-dsr-refresh]")?.addEventListener("click",refresh);
  root.querySelector("[data-dsr-run]")?.addEventListener("click",runOne);
  root.querySelector("[data-dsr-all]")?.addEventListener("click",runAll);
 };
 async function refresh(){
  try{
   const [catalog,list]=await Promise.all([
    api("/platform/direct-sva/automation"),
    api("/platform/direct-sva/automation/rehearsals")
   ]);
   if(catalog.business_unit!=="direct_sva"||list.business_unit!=="direct_sva"||list.external_actions_executed!==false)throw Error("INVALID_DISTRIBUTOR_DATA");
   rules=(catalog.jobs||[]).filter(r=>Object.hasOwn(DISPLAY,r.workflow));
   history=list;error=false;render();
  }catch(e){feedback="Simulation indisponible : "+String(e.message);error=true;render();}
 }
 async function runOne(){
  if(busy)return;
  const rule=known();if(!rule)return;
  const facts={};
  root.querySelectorAll("[data-dsr-evidence]").forEach(n=>facts[n.dataset.dsrEvidence]=n.checked===true);
  const mode=root.querySelector("[data-dsr-failure]")?.value||"none";
  busy=true;feedback="Simulation en cours, aucune connexion fournisseur...";error=false;render();
  try{
   const result=await api("/platform/direct-sva/automation/rehearsals","POST",{
    workflow_key:rule.workflow,source_reference:newSource(),idempotency_key:newIdempotency(),
    facts,failure_mode:mode,attempt_number:1
   });
   if(result.external_action_executed!==false||result.plan?.business_unit!=="direct_sva")throw Error("RESULT_NOT_A_DRY_RUN");
   feedback=STATUS[result.result_status]||"Simulation enregistrée";
   busy=false;await refresh();
  }catch(e){feedback="Échec de simulation : "+String(e.message);error=true;busy=false;render();}
 }
 async function runAll(){
  if(busy)return;
  busy=true;error=false;feedback="Test automatique des 13 scénarios avec faits fictifs uniquement...";render();
  let completed=0,failed=0;
  for(const rule of rules){
   const facts=Object.fromEntries((rule.required_evidence||[]).map(k=>[k,true]));
   try{
    const result=await api("/platform/direct-sva/automation/rehearsals","POST",{
     workflow_key:rule.workflow,source_reference:newSource(),idempotency_key:newIdempotency(),
     facts,failure_mode:"none",attempt_number:1
    });
    if(result.result_status==="ready_for_simulation"&&result.external_action_executed===false)completed++;
    else failed++;
   }catch{failed++;}
  }
  busy=false;feedback=completed+" scénario(s) réussis en simulation, "+failed+" à examiner. Aucune action réelle.";error=failed>0;
  await refresh();
 }
 refresh();
}

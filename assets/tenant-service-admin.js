import {esc,date} from "./tenant-control-utils.js";

const states={open:"Ouvert",investigating:"Pris en charge",waiting_customer:"Client attendu",monitoring:"Surveillance",resolved:"Résolu",closed:"Clos"};
const priorities={low:"Faible",normal:"Normale",high:"Haute",critical:"Critique"};
const cats={telephony:"Téléphonie",portability:"Portabilité",billing:"Facturation",payout:"Reversement",account:"Compte",routing:"Routage",quality:"Qualité",other:"Autre"};
const lab=(map,v)=>map[v]||v||"—";
const serviceChip=v=>'<span class="td-chip '+esc(v||"neutral")+'">'+esc(lab(states,v))+"</span>";

export function renderServiceOperations(data){
  const incidents=data.service_incidents||[],alerts=data.operational_alerts||[];
  const rows=incidents.map(x=>'<div class="td-alert" data-service-incident="'+esc(x.public_id)+'"><div class="td-section-head"><strong>'+esc(x.title)+'</strong>'+serviceChip(x.status)+'</div><p>'+esc(lab(cats,x.category)+" · Priorité "+lab(priorities,x.severity)+" · équipe "+(x.assigned_team||"PGI Operations"))+'</p><small>Réponse cible '+esc(date(x.first_response_due_at))+' · résolution '+esc(date(x.target_resolution_at))+'</small><div class="td-actions"><button class="td-btn mini" data-service-status="investigating">Prendre en charge</button><button class="td-btn mini" data-service-status="waiting_customer">Attendre le client</button><button class="td-btn mini" data-service-status="monitoring">Surveiller</button><button class="td-btn mini success" data-service-status="resolved">Résoudre</button></div></div>').join("");
  const alertRows=alerts.map(a=>'<div class="td-alert"><strong>'+esc(a.title)+'</strong><p>'+esc(a.message)+'</p><small>'+esc(a.severity)+(a.due_at?" · échéance "+date(a.due_at):"")+'</small></div>').join("");
  return '<section class="td-section"><div class="td-section-head"><h3>Centre de service & incidents</h3><span>'+incidents.filter(x=>!["resolved","closed"].includes(x.status)).length+' ouverts</span></div>'+
    '<div class="td-route-form"><select id="td-incident-category"><option value="telephony">Téléphonie</option><option value="portability">Portabilité</option><option value="billing">Facturation</option><option value="payout">Reversement</option><option value="routing">Routage</option><option value="quality">Qualité</option><option value="account">Compte</option><option value="other">Autre</option></select><select id="td-incident-severity"><option value="normal">Normale</option><option value="high">Haute</option><option value="critical">Critique</option><option value="low">Faible</option></select><input id="td-incident-title" maxlength="180" placeholder="Titre du dossier"><input id="td-incident-description" maxlength="5000" placeholder="Description"><button class="td-btn success" data-service-create>Ouvrir un dossier</button><button class="td-btn" data-routing-simulate>Simuler le routage</button></div>'+
    '<div id="td-routing-simulation"></div>'+
    (alertRows?'<div class="td-two"><div>'+alertRows+'</div><div>'+(rows||'<p class="td-empty">Aucun dossier.</p>')+'</div></div>':(rows||'<p class="td-empty">Aucun dossier.</p>'))+
    '</section>';
}

export async function runServiceOperation(e,api,tenantId){
  const create=e.target.closest("[data-service-create]");
  if(create){
    const title=document.getElementById("td-incident-title")?.value.trim()||"",description=document.getElementById("td-incident-description")?.value.trim()||"";
    if(!title||!description)return {handled:true,error:"Titre et description requis."};
    await api.createServiceIncident(tenantId,{category:document.getElementById("td-incident-category").value,severity:document.getElementById("td-incident-severity").value,title,description},api.newIdempotencyKey());
    return {handled:true,message:"Dossier de service ouvert."};
  }
  const status=e.target.closest("[data-service-status]");
  if(status){
    const card=status.closest("[data-service-incident]");
    await api.updateServiceIncident(card.dataset.serviceIncident,{status:status.dataset.serviceStatus},api.newIdempotencyKey());
    return {handled:true,message:"État du dossier mis à jour."};
  }
  const sim=e.target.closest("[data-routing-simulate]");
  if(sim){
    const result=await api.simulateTenantRouting(tenantId,{});
    const out=document.getElementById("td-routing-simulation");
    if(out)out.innerHTML='<p class="td-empty">'+(result.selected?('Simulation sans effet réel : '+esc(result.selected.label)+' → '+esc(result.selected.destination_uri)):('Aucune destination disponible. '+esc((result.warnings||[]).join(" · "))))+'</p>';
    return {handled:true,message:"Simulation terminée."};
  }
  return {handled:false};
}

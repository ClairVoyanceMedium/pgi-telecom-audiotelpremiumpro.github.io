import {esc,date,nf,lab} from "./tenant-control-utils.js";

export function renderCustomerIdentity(data,t){
  const owner=(data.users||[]).find(u=>u.role==="owner")||(data.users||[])[0]||{};
  const signup=owner.signup_source==="public_marketing_site"?"Site public":owner.signup_source==="self_service_email"||owner.signup_source==="self_service"?"Inscription directe":owner.signup_source||"—";
  const intent=({new_number:"Nouveau numéro",portability:"Portabilité d’un numéro",advice:"Demande d’orientation"}[owner.service_intent]||owner.service_intent||"—");
  const users=(data.users||[]).map(u=>'<div class="td-expert"><strong>'+esc(u.display_name||u.email||"Utilisateur")+'</strong><small>'+esc(u.email||"—")+' • '+esc(lab(u.role||"readonly"))+' • '+esc(u.email_verified?"E-mail vérifié":"E-mail non vérifié")+'</small><small>'+esc(u.phone||"Téléphone non renseigné")+' • Inscrit '+esc(date(u.created_at))+' • Dernière connexion '+esc(date(u.last_authenticated_at))+'</small></div>').join("");
  const invitations=(data.invitations||[]).filter(i=>i.status==="pending").map(i=>'<div class="td-alert"><strong>'+esc(i.email)+'</strong><p>Invitation '+esc(lab(i.role||"readonly"))+' • expire '+esc(date(i.expires_at))+'</p></div>').join("");
  return '<section class="td-section"><div class="td-section-head"><h3>Identité & inscription</h3><span>'+esc(date(t.created_at))+'</span></div><div class="td-two"><div><p class="td-empty">Société : '+esc(t.legal_name||t.display_name||"—")+'<br>E-mail facturation : '+esc(t.billing_email||"—")+'<br>Pays : '+esc(t.country_code||"—")+'<br>Langue : '+esc(t.preferred_locale||"—")+'<br>Fuseau : '+esc(t.timezone||"—")+'<br>Origine : '+esc(signup)+'<br>Demande initiale : '+esc(intent)+'</p></div><div><p class="td-empty">Immatriculation : '+esc(t.registration_number||"—")+'<br>Création : '+esc(date(t.created_at))+'<br>Mise à jour : '+esc(date(t.updated_at))+'<br>Utilisateurs : '+nf((data.users||[]).length)+'<br>Invitations en attente : '+nf((data.invitations||[]).filter(i=>i.status==="pending").length)+'</p></div></div><div class="td-experts" style="margin-top:9px">'+(users||'<p class="td-empty">Aucun utilisateur portail rattaché.</p>')+'</div>'+(invitations?'<div style="margin-top:9px">'+invitations+'</div>':"")+'</section>';
}

const csvCell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
export function downloadCustomerExport(data){
  const rows=[["Section","Champ","Valeur"]],add=(section,field,value)=>rows.push([section,field,value??""]);
  Object.entries(data.tenant||{}).forEach(([k,v])=>add("Client",k,v));
  for(const [key,label] of [["users","Utilisateur"],["invitations","Invitation"],["subscriptions","Abonnement"],["lines","Ligne"],["portability","Portabilité"],["settlements","Reversement"]]){
    (data[key]||[]).forEach((row,i)=>Object.entries(row).forEach(([k,v])=>add(label+" "+(i+1),k,v)));
  }
  Object.entries(data.activity||{}).forEach(([k,v])=>add("Activité",k,v));
  const csv="\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a"),safe=String(data.tenant?.display_name||"client").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"client";
  a.href=url;a.download="dossier-client-"+safe+"-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

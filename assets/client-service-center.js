const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const dt=(v,locale)=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale||"fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";};
const states={open:"Ouvert",investigating:"Pris en charge",waiting_customer:"Votre réponse est attendue",monitoring:"Sous surveillance",resolved:"Résolu",closed:"Clos"};
const priorities={low:"Faible",normal:"Normale",high:"Haute",critical:"Critique"};
const cats={telephony:"Téléphonie",portability:"Portabilité",billing:"Facturation",payout:"Reversement",account:"Compte",routing:"Routage",quality:"Qualité",other:"Autre"};
const label=(map,v)=>map[String(v||"")]||String(v||"—");
let styled=false;

function ensureStyle(){
  if(styled||document.getElementById("client-service-center-style"))return;styled=true;
  const s=document.createElement("style");s.id="client-service-center-style";
  s.textContent=".csc-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.csc-alert{padding:10px;border:1px solid rgba(239,68,68,.18);border-radius:12px;background:rgba(239,68,68,.04);margin:7px 0}.csc-alert strong,.csc-incident strong{display:block}.csc-alert span,.csc-incident span{display:block;margin-top:4px;color:var(--muted);font-size:12px}.csc-incident{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.02);margin:7px 0}.csc-incident button{min-height:34px}.csc-route-result{margin-top:8px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px}.csc-route-result span,.csc-route-result small{display:block;margin-top:4px}.csc-timeline{display:grid;gap:8px;max-height:330px;overflow:auto}.csc-event{padding:8px;border-left:2px solid rgba(255,255,255,.12)}.csc-event time{display:block;color:var(--muted);font-size:11px}.csc-note{margin:4px 0 0;white-space:pre-wrap}.csc-deadline{font-size:11px;color:var(--muted)}@media(max-width:680px){.csc-incident{grid-template-columns:1fr}}";
  document.head.appendChild(s);
}
function chip(status){
  const tone=["resolved","closed"].includes(status)?"ok":status==="critical"?"bad":["waiting_customer","high"].includes(status)?"warn":"neutral";
  return '<span class="cp-chip '+tone+'">'+esc(label(states,status))+"</span>";
}

export function createController({api,reload,toast,locale}){
  ensureStyle();
  let busy=false,createDialog=null,detailDialog=null;

  function ensureCreateDialog(){
    if(createDialog)return createDialog;
    createDialog=document.createElement("dialog");createDialog.id="client-incident-dialog";createDialog.className="cp-export-dialog";
    createDialog.innerHTML='<form id="client-incident-form" class="cp-export-card cp-form"><div class="cp-export-head"><div><p class="cp-kicker">CENTRE DE SERVICE</p><h2>Signaler un problème</h2></div><button class="cp-close" type="button" data-incident-close aria-label="Fermer">×</button></div><p class="cp-export-note">Audiotel Premium Pro joint automatiquement au dossier un diagnostic technique non sensible pour éviter de vous redemander les mêmes informations.</p><p class="cp-export-note csc-good-faith">Un signalement de bonne foi reste gratuit. Tout signalement manifestement abusif ou frauduleux peut entraîner les mesures prévues au contrat applicable. Des frais éventuels ne peuvent être appliqués que s’ils sont expressément prévus, transparents et justifiés par une intervention effectivement réalisée.</p><div class="cp-form-grid"><label>Catégorie<select id="incident-category"><option value="telephony">Téléphonie</option><option value="quality">Qualité d’appel</option><option value="routing">Routage</option><option value="portability">Portabilité</option><option value="billing">Facturation</option><option value="payout">Reversement</option><option value="account">Compte</option><option value="other">Autre</option></select></label><label>Priorité<select id="incident-severity"><option value="normal">Normale</option><option value="high">Haute</option><option value="critical">Critique</option><option value="low">Faible</option></select></label></div><label>Ligne concernée <span class="cp-optional">(facultatif)</span><select id="incident-number"><option value="">Toutes mes lignes</option></select></label><label>Titre<input id="incident-title" maxlength="180" required placeholder="Ex. appels qui n’aboutissent plus"></label><label>Description<textarea id="incident-description" maxlength="5000" rows="6" required placeholder="Décrivez ce que vous constatez."></textarea></label><p id="incident-message" class="cp-form-message" role="status"></p><button class="cp-primary" type="submit">Créer le dossier</button></form>';
    document.body.appendChild(createDialog);
    createDialog.querySelector("[data-incident-close]").addEventListener("click",()=>createDialog.close());
    createDialog.querySelector("#client-incident-form").addEventListener("submit",submit);
    return createDialog;
  }

  function populateNumbers(numbers){
    const d=ensureCreateDialog(),sel=d.querySelector("#incident-number");
    const current=sel.value;
    sel.innerHTML='<option value="">Toutes mes lignes</option>'+numbers.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.display_number||n.e164)+'</option>').join("");
    if([...sel.options].some(o=>o.value===current))sel.value=current;
  }

  function render(data){
    const incidents=data.service_incidents||[],alerts=data.operational_alerts||[];
    const count=$("service-incident-count"),list=$("service-incident-list"),alertRoot=$("service-alert-list");
    if(count)count.textContent=String(incidents.filter(x=>!["resolved","closed"].includes(x.status)).length);
    if(alertRoot)alertRoot.innerHTML=alerts.length?alerts.map(a=>'<div class="csc-alert"><strong>'+esc(a.title)+'</strong><span>'+esc(a.message)+(a.due_at?" · Échéance "+esc(dt(a.due_at,locale)):"")+'</span></div>').join(""):'';
    if(list)list.innerHTML=incidents.length?incidents.map(x=>
      '<div class="csc-incident"><div><strong>'+esc(x.title)+'</strong><span>'+esc(label(cats,x.category)+" · Priorité "+label(priorities,x.severity)+" · Mis à jour "+dt(x.updated_at,locale))+'</span><span class="csc-deadline">Réponse cible : '+esc(dt(x.first_response_due_at,locale))+' · Résolution cible : '+esc(dt(x.target_resolution_at,locale))+'</span></div><div>'+chip(x.status)+' <button class="cp-ghost" type="button" data-service-detail="'+esc(x.public_id)+'">Suivre</button></div></div>'
    ).join(""):'<p class="cp-empty">Aucun dossier de service ouvert.</p>';
    populateNumbers(data.numbers||[]);
  }

  function openCreate(){
    const d=ensureCreateDialog();
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }

  async function submit(e){
    e.preventDefault();if(busy)return;
    const d=ensureCreateDialog(),message=d.querySelector("#incident-message");
    message.textContent="";
    const payload={
      category:d.querySelector("#incident-category").value,
      severity:d.querySelector("#incident-severity").value,
      sva_number_id:d.querySelector("#incident-number").value||null,
      title:d.querySelector("#incident-title").value.trim(),
      description:d.querySelector("#incident-description").value.trim()
    };
    busy=true;
    try{
      await api.createIncident(payload,api.newIdempotencyKey());
      d.querySelector("#client-incident-form").reset();d.close();await reload();
      toast("Dossier créé. Audiotel Premium Pro suivra son avancement dans cet espace.");
    }catch(err){message.textContent=err?.code||"Impossible de créer le dossier.";}
    finally{busy=false;}
  }

  function ensureDetailDialog(){
    if(detailDialog)return detailDialog;
    detailDialog=document.createElement("dialog");detailDialog.className="cp-export-dialog";detailDialog.id="client-incident-detail-dialog";
    detailDialog.innerHTML='<div class="cp-export-card"><div class="cp-export-head"><div><p class="cp-kicker">SUIVI DE DOSSIER</p><h2 id="incident-detail-title">Dossier</h2></div><button class="cp-close" type="button" data-service-detail-close aria-label="Fermer">×</button></div><div id="incident-detail-meta" class="cp-export-note"></div><div id="incident-detail-timeline" class="csc-timeline"></div><form id="incident-note-form" class="cp-form"><label>Ajouter un message<textarea id="incident-note-body" maxlength="5000" rows="4" required></textarea></label><button class="cp-primary" type="submit">Envoyer à Audiotel Premium Pro</button><p id="incident-note-message" class="cp-form-message"></p></form></div>';
    document.body.appendChild(detailDialog);
    detailDialog.querySelector("[data-service-detail-close]").addEventListener("click",()=>detailDialog.close());
    detailDialog.querySelector("#incident-note-form").addEventListener("submit",addNote);
    return detailDialog;
  }

  function renderDetail(data){
    const inc=data.incident||{},d=ensureDetailDialog();
    d.dataset.incidentId=inc.public_id||d.dataset.incidentId||"";
    d.querySelector("#incident-detail-title").textContent=inc.title||"Dossier";
    d.querySelector("#incident-detail-meta").textContent=label(cats,inc.category)+" · "+label(priorities,inc.severity)+" · "+label(states,inc.status)+" · Équipe : "+(inc.assigned_team==="PGI Operations"?"Équipe Audiotel Premium Pro":(inc.assigned_team||"Équipe Audiotel Premium Pro"));
    const rows=[
      ...(data.events||[]).map(x=>({at:x.occurred_at,kind:"Événement",text:x.message||label(states,x.new_value)||x.event_type})),
      ...(data.notes||[]).map(x=>({at:x.created_at,kind:x.author_type==="customer"?"Vous":"Audiotel Premium Pro",text:x.body}))
    ].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    d.querySelector("#incident-detail-timeline").innerHTML=rows.length?rows.map(x=>'<div class="csc-event"><time>'+esc(dt(x.at,locale))+'</time><strong>'+esc(x.kind)+'</strong><p class="csc-note">'+esc(x.text)+'</p></div>').join(""):'<p class="cp-empty">Aucun événement supplémentaire.</p>';
    d.querySelector("#incident-note-form").hidden=inc.status==="closed";
    return d;
  }

  async function showDetail(id){
    if(busy)return;busy=true;
    try{
      const data=await api.incidents(id),d=renderDetail(data);
      if(d.showModal&&!d.open)d.showModal();else if(!d.open)d.setAttribute("open","");
    }catch(err){toast(err?.code||"Dossier indisponible.");}
    finally{busy=false;}
  }

  async function addNote(e){
    e.preventDefault();if(busy)return;
    const d=ensureDetailDialog(),id=d.dataset.incidentId,body=d.querySelector("#incident-note-body").value.trim(),msg=d.querySelector("#incident-note-message");
    if(!body)return;busy=true;msg.textContent="";
    try{
      await api.addIncidentNote(id,body,api.newIdempotencyKey());
      d.querySelector("#incident-note-body").value="";
      renderDetail(await api.incidents(id));
      await reload();
    }catch(err){msg.textContent=err?.code||"Message non envoyé.";}
    finally{busy=false;}
  }

  async function simulate(){
    if(busy)return;busy=true;
    const out=$("routing-simulation-result");
    try{
      const data=await api.simulateRouting({});
      out.hidden=false;
      if(data.selected){
        out.innerHTML='<strong>Routage disponible</strong><span>'+esc(data.selected.label+" · "+data.selected.destination_uri)+'</span>'+
          ((data.warnings||[]).length?'<small>'+esc(data.warnings.join(" · "))+'</small>':'');
      }else{
        out.innerHTML='<strong>Aucun routage disponible</strong><span>'+esc((data.warnings||[]).join(" · ")||"Aucune destination éligible.")+'</span>';
      }
    }catch(err){out.hidden=false;out.textContent=err?.code||"Simulation indisponible.";}
    finally{busy=false;}
  }

  $("service-incident-open")?.addEventListener("click",openCreate);
  $("service-incident-list")?.addEventListener("click",e=>{const b=e.target.closest("[data-service-detail]");if(b)showDetail(b.dataset.serviceDetail);});
  $("routing-simulate")?.addEventListener("click",simulate);
  return {render};
}

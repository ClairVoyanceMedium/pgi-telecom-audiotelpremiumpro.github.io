const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

const CONTROLS=[
  ["exclusive_stable_assignee","Titulaire exclusif et stable"],
  ["single_service","Un seul service par numéro"],
  ["portability_offered","Portabilité proposée"],
  ["tariff_ceiling","Plafond tarifaire respecté"],
  ["no_temporary_contact_use","Pas d’usage temporaire de contact"],
  ["public_body_eligibility","Éligibilité organisme public"],
  ["caller_id_block","089 interdit en identifiant appelant"],
  ["parental_control_classification","Classification 0895 / contrôle parental"]
];
const FIELD={
  exclusive_stable_assignee:"exclusive_stable_assignee_status",
  single_service:"single_service_status",
  portability_offered:"portability_offered_status",
  tariff_ceiling:"tariff_ceiling_status",
  no_temporary_contact_use:"no_temporary_contact_use_status",
  public_body_eligibility:"public_body_eligibility_status",
  caller_id_block:"caller_id_block_status",
  parental_control_classification:"parental_control_classification_status"
};
const LABEL=Object.fromEntries(CONTROLS);
let busy=false;

function ensureStyle(){
  if($("platform-regulatory-style"))return;
  const s=document.createElement("style");
  s.id="platform-regulatory-style";
  s.textContent=".pa-wide{grid-column:1/-1}.pa-checklist{display:grid;gap:7px;margin-top:10px}.pa-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px;border:1px solid rgba(128,158,192,.08);border-radius:10px}.pa-check strong{display:block;font-size:8.5px}.pa-check small{display:block;margin-top:3px;color:#6d8398;font-size:7px}.pa-compliance-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.pa-compliance-head h3{margin:0}.pa-form-grid{display:grid;grid-template-columns:1.1fr .8fr .8fr 1.5fr;gap:8px;margin-top:12px}@media(max-width:760px){.pa-form-grid{grid-template-columns:1fr}.pa-wide{grid-column:auto}}";
  document.head.appendChild(s);
}
function badgeClass(status){
  status=String(status||"not_started").toLowerCase();
  if(status==="verified"||status==="not_applicable")return"ok";
  if(status==="failed"||status==="expired")return"bad";
  return"warn";
}
function render(ctx,row){
  const editor=$("pa-compliance-editor");
  if(!editor||!row)return;
  const checks=CONTROLS.map(([key,label])=>{
    const status=row[FIELD[key]]||"not_started";
    return '<div class="pa-check"><div><strong>'+esc(label)+'</strong><small>'+esc(key)+'</small></div><span class="pa-badge '+badgeClass(status)+'">'+esc(String(status).replace(/_/g," "))+'</span></div>';
  }).join("");
  const options=CONTROLS.map(([key,label])=>'<option value="'+esc(key)+'">'+esc(label)+'</option>').join("");
  editor.hidden=false;
  editor.dataset.assignmentId=String(row.assignment_id);
  editor.innerHTML='<div class="pa-compliance-head"><div><p class="pa-note">NUMÉRO • '+esc(row.display_number||row.e164||row.assignment_id)+'</p><h3>Conformité ARCEP 2026</h3></div><span class="pa-badge '+(row.arcep_2026_ready?"ok":"warn")+'">'+(row.arcep_2026_ready?"ARCEP PRÊT":"À DOCUMENTER")+'</span></div><p class="pa-note">Aucun contrôle n’est validé automatiquement. Chaque changement ajoute un événement immuable à la chaîne de preuves SHA-256. Pour le statut « verified », une référence de preuve est obligatoire.</p><div class="pa-checklist">'+checks+'</div><div class="pa-form-grid"><label class="pa-field">Contrôle<select id="pa-arcep-control">'+options+'</select></label><label class="pa-field">Statut<select id="pa-arcep-status"><option value="pending">En attente</option><option value="verified">Vérifié</option><option value="failed">Échec</option><option value="expired">Expiré</option><option value="not_applicable">Non applicable</option><option value="not_started">Non démarré</option></select></label><label class="pa-field">Source<select id="pa-arcep-source"><option value="internal">Interne</option><option value="operator">Opérateur</option><option value="apnf_rsva">APNF / RSVA</option><option value="af2m">AF2M</option><option value="arcep">ARCEP</option><option value="customer">Client</option><option value="dgccrf">DGCCRF</option><option value="other">Autre</option></select></label><label class="pa-field">Référence de preuve<input id="pa-arcep-reference" maxlength="500" placeholder="Contrat, ticket, URL interne, référence opérateur…"></label></div><div class="pa-actions"><button class="pa-btn success" type="button" data-arcep-evidence-save>Ajouter la preuve</button><button class="pa-btn" type="button" data-evidence-pack="'+esc(row.assignment_id)+'">Exporter l’Evidence Pack</button></div>';
  const save=editor.querySelector("[data-arcep-evidence-save]");
  if(save)save.addEventListener("click",event=>{event.stopPropagation();void saveEvidence(ctx,row);});
  editor.scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function saveEvidence(ctx,row){
  if(busy)return;
  const control=$("pa-arcep-control")?.value,status=$("pa-arcep-status")?.value,source=$("pa-arcep-source")?.value,reference=String($("pa-arcep-reference")?.value||"").trim();
  if(!row?.assignment_id||!LABEL[control])return ctx.feedback("Contrôle ARCEP invalide.","error");
  if(status==="verified"&&!reference)return ctx.feedback("Une référence de preuve est obligatoire pour marquer ce contrôle comme vérifié.","error");
  if(!confirm("Ajouter un événement de preuve « "+status+" » pour : "+LABEL[control]+" ?"))return;
  busy=true;ctx.feedback("Enregistrement de la preuve ARCEP 2026…");
  try{
    const data=await ctx.postJson("/platform/tenant-number-assignments/"+encodeURIComponent(row.assignment_id)+"/regulatory-evidence",{control_key:control,status:status,source:source,evidence_reference:reference||null,metadata:{recorded_from:"cockpit_arcep_2026"}});
    row[FIELD[control]]=status;
    if(data?.profile?.arcep_2026_ready!=null)row.arcep_2026_ready=Boolean(data.profile.arcep_2026_ready);
    busy=false;render(ctx,row);
    ctx.feedback("Preuve ajoutée à la chaîne immuable. État ARCEP 2026 recalculé.","ok");
    window.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:"refresh"}}));
  }catch(err){busy=false;ctx.feedback(err.code||"Enregistrement impossible","error");}
}
export function open(options={}){
  ensureStyle();
  const assignmentId=String(options.assignmentId||"");
  const numbers=options.platform?.regulatory_trust?.numbers||[];
  const row=numbers.find(x=>String(x.assignment_id)===assignmentId);
  if(!row)return options.feedback?.("Numéro réglementaire introuvable.","error");
  if(typeof options.postJson!=="function"||typeof options.feedback!=="function")throw new Error("REGULATORY_EDITOR_CONTEXT_REQUIRED");
  render(options,row);
}

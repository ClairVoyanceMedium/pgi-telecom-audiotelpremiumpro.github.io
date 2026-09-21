import {esc,date} from "./tenant-control-utils.js";

function style(){
  if(document.getElementById("customer-internal-notes-style"))return;
  const s=document.createElement("style");s.id="customer-internal-notes-style";
  s.textContent=".tin-form{display:grid;gap:7px}.tin-form textarea{width:100%;min-height:88px;resize:vertical;padding:9px;border:1px solid rgba(128,158,192,.16);border-radius:10px;background:#07101b;color:#e2eef6;font:inherit;box-sizing:border-box}.tin-note{padding:9px;border:1px solid rgba(128,158,192,.09);border-radius:10px;background:#0a1320;margin-top:7px}.tin-note p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 7px;color:#d6e6f0;font-size:8px;line-height:1.45}.tin-note small{color:#6d8499;font-size:7px}.tin-note-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}.tin-private{color:#f6d48e;font-size:7px}";
  document.head.appendChild(s);
}
function draw(root,rows){
  const list=root.querySelector("[data-internal-notes-list]");
  if(!list)return;
  list.innerHTML=rows.length?rows.map(n=>'<article class="tin-note"><p>'+esc(n.body)+'</p><div class="tin-note-foot"><small>'+esc(n.author_name||"Administrateur")+' • '+esc(date(n.created_at))+'</small><button class="td-btn mini danger" type="button" data-internal-note-archive="'+esc(n.id)+'">Archiver</button></div></article>').join(""):'<p class="td-empty">Aucune note interne pour ce client.</p>';
}
async function load(id,root){
  try{
    const r=await window.PGIApi.tenantInternalNotes(id);root.hidden=false;draw(root,Array.isArray(r.data)?r.data:[]);
  }catch(e){
    if(e?.status===403||e?.status===401){root.hidden=true;return;}
    const list=root.querySelector("[data-internal-notes-list]");if(list)list.innerHTML='<p class="td-empty">Notes internes momentanément indisponibles.</p>';
  }
}
export async function mountInternalNotes(id,root){
  if(!root||!window.PGIApi?.tenantInternalNotes)return;
  style();root.dataset.tenantId=id;
  root.innerHTML='<div class="td-section-head"><div><h3>Notes internes</h3><span class="tin-private">Privé • jamais visible par le client</span></div></div><div class="tin-form"><textarea maxlength="2000" data-internal-note-body placeholder="Ajouter une note privée sur ce client…"></textarea><div><button class="td-btn success" type="button" data-internal-note-add>Ajouter la note</button></div></div><div data-internal-notes-list><p class="td-empty">Chargement…</p></div>';
  root.onclick=async e=>{
    const add=e.target.closest("[data-internal-note-add]");
    if(add){
      const area=root.querySelector("[data-internal-note-body]"),body=area?.value.trim()||"";
      if(!body){area?.focus();return;}
      add.disabled=true;
      try{await window.PGIApi.addTenantInternalNote(id,{body},window.PGIApi.newIdempotencyKey());area.value="";await load(id,root);}
      finally{add.disabled=false;}
      return;
    }
    const archive=e.target.closest("[data-internal-note-archive]");
    if(archive){
      if(!confirm("Archiver cette note interne ? Elle restera traçable dans l’audit."))return;
      archive.disabled=true;
      try{await window.PGIApi.archiveTenantInternalNote(archive.dataset.internalNoteArchive,window.PGIApi.newIdempotencyKey());await load(id,root);}
      finally{archive.disabled=false;}
    }
  };
  await load(id,root);
}

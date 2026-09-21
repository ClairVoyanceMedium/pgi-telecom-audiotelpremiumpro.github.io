import {esc,date} from "./tenant-control-utils.js";

function csrf(){const p=String(document.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("__Host-pgi_csrf="));return p?decodeURIComponent(p.slice(17)):"";}
async function call(path,method="GET",body=null,key=""){
  const base=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!base)throw new Error("API_NOT_CONFIGURED");
  const headers={Accept:"application/json"};if(body)headers["Content-Type"]="application/json";if(method!=="GET"){const token=csrf();if(token)headers["X-CSRF-Token"]=token;if(key)headers["Idempotency-Key"]=key;}
  const response=await fetch(base+path,{method,credentials:"include",cache:"no-store",headers,body:body?JSON.stringify(body):undefined});
  const payload=await response.json().catch(()=>null);if(!response.ok){const e=new Error(payload?.error?.code||"API_HTTP_"+response.status);e.status=response.status;e.code=e.message;throw e;}return payload;
}
const list=id=>call("/platform/tenants/"+encodeURIComponent(id)+"/internal-notes");
const add=(id,body,key)=>call("/platform/tenants/"+encodeURIComponent(id)+"/internal-notes","POST",{body},key);
const archive=(id,key)=>call("/platform/tenant-internal-notes/"+encodeURIComponent(id)+"/archive","POST",{},key);

function style(){
  if(document.getElementById("customer-internal-notes-style"))return;
  const s=document.createElement("style");s.id="customer-internal-notes-style";
  s.textContent=".tin-form{display:grid;gap:7px}.tin-form textarea{width:100%;min-height:88px;resize:vertical;padding:9px;border:1px solid rgba(128,158,192,.16);border-radius:10px;background:#07101b;color:#e2eef6;font:inherit;box-sizing:border-box}.tin-note{padding:9px;border:1px solid rgba(128,158,192,.09);border-radius:10px;background:#0a1320;margin-top:7px}.tin-note p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 7px;color:#d6e6f0;font-size:8px;line-height:1.45}.tin-note small{color:#6d8499;font-size:7px}.tin-note-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}.tin-private{color:#f6d48e;font-size:7px}";
  document.head.appendChild(s);
}
function noteStatus(root,msg,type=""){const el=root.querySelector("[data-internal-note-status]");if(el){el.textContent=msg||"";el.className="td-feedback "+type;}}
function draw(root,rows){
  const list=root.querySelector("[data-internal-notes-list]");
  if(!list)return;
  list.innerHTML=rows.length?rows.map(n=>'<article class="tin-note"><p>'+esc(n.body)+'</p><div class="tin-note-foot"><small>'+esc(n.author_name||"Administrateur")+' • '+esc(date(n.created_at))+'</small><button class="td-btn mini danger" type="button" data-internal-note-archive="'+esc(n.id)+'">Archiver</button></div></article>').join(""):'<p class="td-empty">Aucune note interne pour ce client.</p>';
}
async function load(id,root){
  try{
    const r=await list(id);root.hidden=false;draw(root,Array.isArray(r.data)?r.data:[]);
  }catch(e){
    if(e?.status===403||e?.status===401){root.hidden=true;return;}
    const list=root.querySelector("[data-internal-notes-list]");if(list)list.innerHTML='<p class="td-empty">Notes internes momentanément indisponibles.</p>';
  }
}
export async function mountInternalNotes(id,root){
  if(!root||!window.PGIApi?.newIdempotencyKey)return;
  style();root.dataset.tenantId=id;
  root.innerHTML='<div class="td-section-head"><div><h3>Notes internes</h3><span class="tin-private">Privé • jamais visible par le client</span></div></div><div class="tin-form"><textarea maxlength="2000" data-internal-note-body placeholder="Ajouter une note privée sur ce client…"></textarea><div><button class="td-btn success" type="button" data-internal-note-add>Ajouter la note</button></div></div><p data-internal-note-status class="td-feedback" role="status" aria-live="polite"></p><div data-internal-notes-list><p class="td-empty">Chargement…</p></div>';
  root.onclick=async e=>{
    const add=e.target.closest("[data-internal-note-add]");
    if(add){
      const area=root.querySelector("[data-internal-note-body]"),body=area?.value.trim()||"";
      if(!body){area?.focus();return;}
      add.disabled=true;
      noteStatus(root,"Enregistrement…");
      try{await add(id,body,window.PGIApi.newIdempotencyKey());area.value="";await load(id,root);noteStatus(root,"Note interne ajoutée.","ok");}
      catch(err){noteStatus(root,err?.code||"Impossible d’ajouter la note.","error");}
      finally{add.disabled=false;}
      return;
    }
    const archiveBtn=e.target.closest("[data-internal-note-archive]");
    if(archiveBtn){
      if(!confirm("Archiver cette note interne ? Elle restera traçable dans l’audit."))return;
      archiveBtn.disabled=true;
      noteStatus(root,"Archivage…");
      try{await archive(archiveBtn.dataset.internalNoteArchive,window.PGIApi.newIdempotencyKey());await load(id,root);noteStatus(root,"Note archivée.","ok");}
      catch(err){noteStatus(root,err?.code||"Impossible d’archiver la note.","error");}
      finally{archiveBtn.disabled=false;}
    }
  };
  await load(id,root);
}

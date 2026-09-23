function apiBase(){const c=window.PGI_CONFIG||{};if(!c.apiBaseUrl)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return String(c.apiBaseUrl).replace(/\/$/,"")}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const raw of String(document.cookie||"").split(";")){const x=raw.trim();if(x.startsWith(p))try{return decodeURIComponent(x.slice(p.length))}catch(_e){return x.slice(p.length)}}return""}
function timeout(ms){if(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function")return AbortSignal.timeout(ms);const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal}
async function teamRequest(path,options={}){
  const method=String(options.method||"GET").toUpperCase(),headers={Accept:"application/json"};
  if(options.body!=null)headers["Content-Type"]="application/json";
  if(options.idempotencyKey)headers["Idempotency-Key"]=String(options.idempotencyKey);
  if(!["GET","HEAD","OPTIONS"].includes(method)){const csrf=cookie("__Host-pgi_customer_csrf");if(csrf)headers["X-CSRF-Token"]=csrf}
  const response=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:options.body==null?undefined:JSON.stringify(options.body),signal:timeout(8000)});
  let payload=null;try{payload=await response.json()}catch(_e){}
  if(!response.ok){const code=payload?.error?.code||"API_HTTP_"+response.status;throw Object.assign(new Error(code),{code,status:response.status,payload})}
  return payload;
}
function idempotencyKey(){if(typeof crypto!=="undefined"&&crypto.randomUUID)return crypto.randomUUID();return"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^Math.random()*16>>c/4).toString(16))}
const api={
  team:()=>teamRequest("/customer/team"),
  invite:(payload)=>teamRequest("/customer/team/invitations",{method:"POST",body:payload,idempotencyKey:idempotencyKey()}),
  update:(id,payload)=>teamRequest("/customer/team/members/"+encodeURIComponent(id),{method:"PATCH",body:payload}),
  revoke:(id)=>teamRequest("/customer/team/invitations/"+encodeURIComponent(id)+"/revoke",{method:"POST",body:{}})
};
const ROLE_LABELS={owner:"Propriétaire",admin:"Administrateur",finance:"Finance",operator:"Opérations",analyst:"Analyste",readonly:"Lecture seule"};
const ROLE_HELP={
  owner:"Tous les droits, y compris la gestion des accès.",
  admin:"Gestion opérationnelle et gestion de l’équipe, hors propriété du compte.",
  finance:"Reversements, facturation, exports financiers et lecture des données utiles.",
  operator:"Appels, routage et incidents opérationnels.",
  analyst:"Analyses, appels et consultation financière.",
  readonly:"Consultation uniquement."
};
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function roleOptions(current,allowOwner=true){return Object.keys(ROLE_LABELS).filter(r=>allowOwner||r!=="owner").map(r=>'<option value="'+r+'"'+(r===current?" selected":"")+'>'+ROLE_LABELS[r]+'</option>').join("")}
function canManage(user){return Array.isArray(user?.permissions)&&(user.permissions.includes("*")||user.permissions.includes("team.manage"))}
function statusLabel(s){return ({active:"Actif",suspended:"Suspendu",revoked:"Révoqué",pending:"Invitation en attente",expired:"Expirée"})[s]||s||"—"}
export async function mountTeamAccess(pane,user,flash){
  pane.innerHTML='<p class="pp-note">Chargement de votre équipe…</p>';
  let state;
  try{state=await api.team()}catch(e){pane.innerHTML='<p class="pp-note">Impossible de charger les accès de l’équipe.</p>';return}
  const manage=canManage(user);
  const members=state.members||[],invites=state.invitations||[],owner=String(user?.role||"")==="owner",activationLink=flash?.activation_path?new URL(flash.activation_path,window.location.href).href:"";
  pane.innerHTML=
    '<p class="pp-note">Chaque collaborateur dispose de son propre compte. Les rôles limitent ce qui peut être consulté ou modifié. Les invitations sont préparées ici mais aucun e-mail n’est envoyé tant qu’un service d’envoi n’est pas connecté.</p>'+
    '<div class="pp-grid">'+Object.keys(ROLE_LABELS).map(r=>'<div class="pp-card"><span>'+esc(ROLE_LABELS[r])+'</span><strong>'+esc(r)+'</strong><small>'+esc(ROLE_HELP[r])+'</small></div>').join("")+'</div>'+
    (manage?'<div class="pp-row"><label><strong>Inviter un collaborateur</strong><small>Crée un lien d’activation à transmettre manuellement.</small></label><div style="display:grid;gap:8px;min-width:min(100%,360px)"><input data-team-email type="email" autocomplete="email" placeholder="nom@entreprise.fr" maxlength="320"><select data-team-role>'+roleOptions("readonly",owner)+'</select><button data-team-invite>Créer l’invitation</button></div></div><p class="pp-note" data-team-result></p>':"")+
    (activationLink?'<div class="pp-item" data-team-flash><strong>Invitation créée</strong><p>Copiez ce lien et transmettez-le au collaborateur concerné. Aucun e-mail automatique n’a été envoyé.</p><code>'+esc(activationLink)+'</code><button data-team-copy type="button">Copier le lien</button></div>':'')+
    '<h3>Membres</h3><div class="pp-list" data-team-members></div><h3>Invitations</h3><div class="pp-list" data-team-invites></div>';
  const memberBox=pane.querySelector("[data-team-members]"),inviteBox=pane.querySelector("[data-team-invites]");
  pane.querySelector("[data-team-copy]")?.addEventListener("click",async()=>{const b=pane.querySelector("[data-team-copy]");try{await navigator.clipboard.writeText(String(activationLink||""));if(b)b.textContent="Copié"}catch(_e){if(b)b.textContent="Copie impossible"}});
  memberBox.innerHTML=members.length?members.map(m=>'<div class="pp-item"><strong>'+esc(m.display_name||m.email)+'</strong><p>'+esc(m.email)+' · '+esc(statusLabel(m.membership_status))+'</p>'+(manage&&m.id!==user?.id&&(m.role!=="owner"||owner)?'<div style="display:flex;gap:8px;flex-wrap:wrap"><select data-member-role="'+esc(m.id)+'">'+roleOptions(m.role,owner)+'</select><select data-member-status="'+esc(m.id)+'"><option value="active"'+(m.membership_status==="active"?" selected":"")+'>Actif</option><option value="suspended"'+(m.membership_status==="suspended"?" selected":"")+'>Suspendu</option><option value="revoked"'+(m.membership_status==="revoked"?" selected":"")+'>Révoqué</option></select><button data-member-save="'+esc(m.id)+'">Enregistrer</button></div>':'<small>'+esc(ROLE_LABELS[m.role]||m.role)+'</small>')+'</div>').join(""):'<div class="pp-item"><strong>Aucun autre membre</strong><p>Le compte est actuellement géré par une seule personne.</p></div>';
  inviteBox.innerHTML=invites.length?invites.map(i=>'<div class="pp-item"><strong>'+esc(i.email)+'</strong><p>'+esc(ROLE_LABELS[i.role]||i.role)+' · expire '+esc(new Date(i.expires_at).toLocaleString())+'</p>'+(manage&&(i.role!=="owner"||owner)?'<button data-invite-revoke="'+esc(i.id)+'">Révoquer</button>':"")+'</div>').join(""):'<div class="pp-item"><strong>Aucune invitation en attente</strong><p>Aucun accès temporaire n’est ouvert.</p></div>';
  pane.querySelector("[data-team-invite]")?.addEventListener("click",async()=>{
    const email=pane.querySelector("[data-team-email]").value.trim(),role=pane.querySelector("[data-team-role]").value,out=pane.querySelector("[data-team-result]");
    if(!email){out.textContent="Adresse e-mail requise.";return}
    try{const r=await api.invite({email,role});await mountTeamAccess(pane,user,{activation_path:r.activation_path||""})}catch(e){out.textContent=e.code==="CUSTOMER_PERMISSION_DENIED"?"Vous n’avez pas le droit de gérer l’équipe.":"Invitation impossible."}
  });
  pane.querySelectorAll("[data-member-save]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.memberSave,role=pane.querySelector('[data-member-role="'+CSS.escape(id)+'"]').value,status=pane.querySelector('[data-member-status="'+CSS.escape(id)+'"]').value;
    try{await api.update(id,{role,status});await mountTeamAccess(pane,user)}catch(e){alert(e.code==="LAST_CUSTOMER_OWNER_REQUIRED"?"Le dernier propriétaire actif ne peut pas être rétrogradé ou révoqué.":"Modification impossible.")}
  }));
  pane.querySelectorAll("[data-invite-revoke]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;b.textContent="Révocation…";try{await api.revoke(b.dataset.inviteRevoke);await mountTeamAccess(pane,user)}catch(_e){b.disabled=false;b.textContent="Réessayer la révocation"}}));
}

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const money=(v,c="EUR")=>v==null?"—":new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(Number(v)||0);
const date=v=>v?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";
function crBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw new Error("API_NOT_CONFIGURED");return b;}
function crCookie(name){const p=encodeURIComponent(name)+"=";for(const x of String(document.cookie||"").split(";")){const v=x.trim();if(v.startsWith(p))return decodeURIComponent(v.slice(p.length));}return "";}
async function crRequest(path,options={}){const method=String(options.method||"GET").toUpperCase(),headers={Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})};if(!["GET","HEAD","OPTIONS"].includes(method)){const csrf=crCookie("__Host-pgi_csrf");if(csrf)headers["X-CSRF-Token"]=csrf;}const r=await fetch(crBase()+path,{method,credentials:"include",cache:"no-store",headers,body:options.body?JSON.stringify(options.body):undefined});const p=await r.json().catch(()=>null);if(!r.ok){const e=new Error(p?.error?.code||"API_HTTP_"+r.status);e.code=p?.error?.code||"API_HTTP_"+r.status;throw e;}return p;}
function crIdem(path,body){return crRequest(path,{method:"POST",body:body||{},headers:{"Idempotency-Key":window.PGIApi.newIdempotencyKey()}});}
const label=v=>String(v||"—").replace(/_/g," ");
function style(){
 if(document.getElementById("customer-relations-style"))return;
 const s=document.createElement("style");s.id="customer-relations-style";s.textContent=".cr{display:grid;gap:10px}.cr-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-end;flex-wrap:wrap}.cr-head h3{margin:0}.cr-badges{display:flex;gap:6px;flex-wrap:wrap}.cr-badge{display:inline-flex;padding:4px 7px;border:1px solid rgba(128,158,192,.16);border-radius:999px;font-size:7px;color:#9ab0c3;text-transform:uppercase}.cr-badge.ok{color:#92e9cb}.cr-badge.warn{color:#f6d48e}.cr-badge.bad{color:#ffadad}.cr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cr-card{padding:10px;border:1px solid rgba(128,158,192,.1);border-radius:12px;background:rgba(7,16,27,.72)}.cr-card h4{margin:0 0 5px;font-size:10px}.cr-meta{display:flex;gap:6px;flex-wrap:wrap;color:#72889c;font-size:7px}.cr-text{margin:7px 0;color:#8ca0b3;font-size:8px;line-height:1.5}.cr-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.cr-btn{min-height:34px;padding:6px 9px;border:1px solid rgba(53,216,255,.2);border-radius:9px;background:rgba(53,216,255,.05);color:#dff8ff;font-size:7px;font-weight:850;cursor:pointer}.cr-btn.danger{border-color:rgba(239,68,68,.22);color:#ffb0b0}.cr-btn.success{border-color:rgba(34,211,165,.24);color:#9be9ca}.cr-reply{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px}.cr-reply textarea{min-height:58px;resize:vertical;padding:8px;border:1px solid #253447;border-radius:9px;background:#07101b;color:#e2eef6;font-size:8px}.cr-list{display:grid;gap:7px}.cr-empty{padding:18px;text-align:center;color:#73889b;font-size:8px}.cr-note{margin:0;color:#71879b;font-size:7px;line-height:1.45}.cr-fleet{margin-top:10px}.cr-amount{font-size:12px;color:#eff9ff;font-weight:900}@media(max-width:800px){.cr-grid{grid-template-columns:1fr}.cr-reply{grid-template-columns:1fr}.cr-btn{min-height:44px}.cr-reply textarea{font-size:16px}}";
 document.head.appendChild(s);
}
function badge(s){s=String(s||"").toLowerCase();const cls=["resolved","closed","completed","approved"].includes(s)?"ok":["critical","failed","blocked"].includes(s)?"bad":"warn";return '<span class="cr-badge '+cls+'">'+esc(label(s))+'</span>';}
function caseActions(c,exit){
 const b=[];
 if(["billing_dispute","payout_dispute"].includes(c.case_kind)){
   b.push(["collect_evidence","Preuves"],["reconcile_billing","Réconcilier"],["place_dispute_hold","Geler le contesté"]);
 }
 if(["contract_termination","port_out"].includes(c.case_kind)||exit){
   b.push(["prepare_exit","Préparer sortie"],["generate_data_export","Préparer export"]);
   if(c.case_kind==="port_out"||exit?.port_out_requested)b.push(["check_portability","Vérifier portabilité"]);
 }
 if(c.customer_capacity==="consumer")b.push(["prepare_mediation","Préparer médiation"]);
 b.push(["resolve_case","Proposer résolution"]);
 return b.map(x=>'<button class="cr-btn" data-cr-action="'+esc(x[0])+'" data-case="'+esc(c.public_id)+'">'+esc(x[1])+'</button>').join("");
}
function tenantHtml(data){
 const exits=new Map((data.exits||[]).map(x=>[String(x.case_id),x])),cases=data.cases||[],actions=data.actions||[];
 const open=cases.filter(x=>!["resolved","closed","cancelled"].includes(x.status)).length,disputes=cases.filter(x=>["billing_dispute","payout_dispute"].includes(x.case_kind)&&!["resolved","closed","cancelled"].includes(x.status)).length,leaving=(data.exits||[]).filter(x=>!["completed","cancelled"].includes(x.status)).length;
 const cards=cases.map(c=>{
   const ex=exits.get(String(c.id)),amount=c.disputed_amount!=null?'<span class="cr-amount">'+esc(money(c.disputed_amount,c.disputed_currency||"EUR"))+'</span>':"";
   return '<article class="cr-card" data-cr-case-card="'+esc(c.public_id)+'"><div class="cr-head"><div><h4>'+esc(c.title)+'</h4><div class="cr-meta"><span>'+esc(label(c.case_kind))+'</span><span>Créé '+esc(date(c.created_at))+'</span><span>Échéance '+esc(date(c.target_resolution_at))+'</span></div></div><div class="cr-badges">'+badge(c.status)+badge(c.ai_state)+amount+'</div></div><p class="cr-text">'+esc(c.description)+'</p>'+(c.invoice_reference?'<p class="cr-note">Réf. facture : '+esc(c.invoice_reference)+'</p>':"")+(ex?'<p class="cr-note">Sortie : '+esc(label(ex.status))+' · Numéros : '+esc(ex.number_retention_preference)+(ex.requested_effective_date?' · souhaitée '+esc(ex.requested_effective_date):'')+'</p>':"")+'<div class="cr-actions">'+caseActions(c,ex)+'</div><div class="cr-reply"><textarea data-cr-message="'+esc(c.public_id)+'" maxlength="8000" placeholder="Réponse visible par le client…"></textarea><button class="cr-btn success" data-cr-send="'+esc(c.public_id)+'">Répondre</button></div></article>';
 }).join("");
 const pending=actions.filter(x=>x.status==="proposed"&&x.execution_mode==="approval_required").map(x=>'<div class="cr-card"><div class="cr-head"><div><h4>Validation requise · '+esc(label(x.action_type))+'</h4><p class="cr-note">'+esc(x.explanation||"Action proposée par l’agent.")+'</p></div>'+badge(x.risk_class)+'</div><div class="cr-actions"><button class="cr-btn success" data-cr-approve="'+esc(x.public_id)+'">Approuver</button></div></div>').join("");
 return '<div class="cr-head"><div><p class="panel-kicker">RELATION CLIENT</p><h3>Litiges, réclamations & départs</h3></div><div class="cr-badges"><span class="cr-badge">'+open+' ouvert(s)</span><span class="cr-badge">'+disputes+' litige(s)</span><span class="cr-badge">'+leaving+' départ(s)</span></div></div><p class="cr-note">Le moteur agent travaille uniquement sur les faits du PGI. Les remboursements, avoirs, libérations définitives de numéros et clôtures externes restent soumis à leur garde-fou.</p><div class="cr-list">'+(cards||'<p class="cr-empty">Aucun dossier de relation client.</p>')+pending+'</div>';
}
async function act(root,caseId,actionType){
 const p={action_type:actionType,confidence:1,explanation:"Action demandée depuis le Dossier Client 360.",payload:{}};
 const r=await crIdem("/platform/customer-relations/"+encodeURIComponent(caseId)+"/actions",p);
 return r;
}
export async function mountTenantRelations(tenantPublicId,root){
 if(!root||!tenantPublicId)return;style();root.hidden=false;root.classList.add("cr");
 const load=async()=>{root.innerHTML='<p class="cr-empty">Chargement de la relation client…</p>';try{const data=await crRequest("/platform/tenants/"+encodeURIComponent(tenantPublicId)+"/customer-relations");root.innerHTML=tenantHtml(data);}catch(e){root.innerHTML='<p class="cr-empty">Relation client indisponible : '+esc(e.code||e.message||"erreur")+'</p>';}};
 root.addEventListener("click",async e=>{
   const a=e.target.closest("[data-cr-action]");if(a){a.disabled=true;try{await act(root,a.dataset.case,a.dataset.crAction);await load();}catch(err){alert(err.code||"Action impossible");}finally{a.disabled=false;}return;}
   const send=e.target.closest("[data-cr-send]");if(send){const ta=root.querySelector('[data-cr-message="'+CSS.escape(send.dataset.crSend)+'"]'),message=ta?.value.trim();if(!message)return;send.disabled=true;try{await crIdem("/platform/customer-relations/"+encodeURIComponent(send.dataset.crSend)+"/actions",{action_type:"respond_customer",confidence:1,explanation:"Réponse envoyée depuis le cockpit.",payload:{message}});await load();}catch(err){alert(err.code||"Réponse impossible");}finally{send.disabled=false;}return;}
   const ap=e.target.closest("[data-cr-approve]");if(ap){ap.disabled=true;try{await crIdem("/platform/customer-relations/actions/"+encodeURIComponent(ap.dataset.crApprove)+"/approve",{});await load();}catch(err){alert(err.code||"Validation impossible");}finally{ap.disabled=false;}}
 });
 await load();
}
function fleetHtml(data){
 const rows=data.data||[],open=rows.length,disputes=rows.filter(x=>["billing_dispute","payout_dispute"].includes(x.case_kind)).length,exits=rows.filter(x=>x.exit_public_id).length;
 return '<div class="cr-head"><div><p class="panel-kicker">RELATION CLIENT</p><h3>File litiges & départs</h3></div><div class="cr-badges"><span class="cr-badge">'+open+' dossier(s)</span><span class="cr-badge">'+disputes+' financier(s)</span><span class="cr-badge">'+exits+' départ(s)</span></div></div><div class="cr-list">'+(rows.slice(0,12).map(x=>'<div class="cr-card"><div class="cr-head"><div><h4>'+esc(x.tenant)+' · '+esc(x.title)+'</h4><div class="cr-meta"><span>'+esc(label(x.case_kind))+'</span><span>Échéance '+esc(date(x.target_resolution_at))+'</span></div></div>'+badge(x.status)+'</div><div class="cr-actions"><button class="cr-btn" data-dossier="'+esc(x.tenant_public_id)+'" data-name="'+esc(x.tenant)+'">Ouvrir le dossier client</button></div></div>').join("")||'<p class="cr-empty">Aucun litige ou départ ouvert.</p>')+'</div>';
}
export async function mountFleetRelations(host){
 if(!host)return;style();let root=document.getElementById("ca-customer-relations");if(!root){root=document.createElement("article");root.id="ca-customer-relations";root.className="ca-card cr-fleet cr";const grid=host.querySelector(".ca-grid");if(grid)grid.before(root);else host.appendChild(root);}
 try{root.innerHTML= fleetHtml(await crRequest("/platform/customer-relations/queue?status=active&limit=50"));}catch(e){root.innerHTML='<p class="cr-empty">File relation client indisponible.</p>';}
}

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const date=v=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"—";};
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100);}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c;}};
let busy=false;
let lastPlatform=null;
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw new Error("API_NOT_CONFIGURED");return b;}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.indexOf(p)===0){try{return decodeURIComponent(v.slice(p.length));}catch{return v.slice(p.length);}}}return "";}
async function postJson(path,body){
  const csrf=cookie("__Host-pgi_csrf"),headers={"Accept":"application/json","Content-Type":"application/json","Idempotency-Key":window.PGIApi.newIdempotencyKey()};
  if(csrf)headers["X-CSRF-Token"]=csrf;
  const res=await fetch(apiBase()+path,{method:"POST",credentials:"include",cache:"no-store",headers,body:JSON.stringify(body||{})});
  const payload=await res.json().catch(()=>null);
  if(!res.ok){const e=new Error(payload?.error?.code||"EXPORT_FAILED");e.code=payload?.error?.code||"EXPORT_FAILED";throw e;}
  return payload;
}
function saveJson(name,data){const blob=new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),0);}
function ensure(){
  if($("platform-admin-dialog"))return $("platform-admin-dialog");
  const s=document.createElement("style");s.id="platform-admin-style";s.textContent=".pa-dialog{width:min(900px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 24px);padding:0;border:1px solid rgba(128,158,192,.18);border-radius:20px;background:#07101b;color:#dcebf5}.pa-dialog::backdrop{background:rgba(0,0,0,.76);backdrop-filter:blur(8px)}.pa-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid rgba(128,158,192,.1)}.pa-head p{margin:0 0 4px;color:#58d8ff;font-size:7px;font-weight:900;letter-spacing:.08em}.pa-head h2{margin:0;font-size:19px}.pa-close{width:42px;height:42px;border:1px solid rgba(128,158,192,.16);border-radius:12px;background:#0a1421;color:#b9cad8;font-size:20px}.pa-body{max-height:calc(100dvh - 100px);overflow:auto;padding:14px}.pa-feedback{min-height:18px;color:#71889e;font-size:8px}.pa-feedback.ok{color:#8de4c6}.pa-feedback.error{color:#ff9d9d}.pa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pa-card{padding:13px;border:1px solid rgba(128,158,192,.11);border-radius:14px;background:rgba(10,18,30,.88)}.pa-card h3{margin:0 0 10px;font-size:13px}.pa-state{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.pa-state div{padding:9px;border:1px solid rgba(128,158,192,.08);border-radius:10px}.pa-state span{display:block;color:#687f95;font-size:6.5px;text-transform:uppercase}.pa-state strong{display:block;margin-top:4px;font-size:10px}.pa-field{display:grid;gap:5px;margin-top:9px;color:#71879b;font-size:7px;font-weight:850;text-transform:uppercase}.pa-field input,.pa-field select{width:100%;min-height:42px;padding:8px 10px;border:1px solid rgba(128,158,192,.15);border-radius:10px;background:#06101a;color:#eef7fb;font-size:12px}.pa-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.pa-btn{min-height:40px;padding:8px 11px;border:1px solid rgba(53,216,255,.2);border-radius:10px;background:rgba(53,216,255,.055);color:#ddf8ff;font-size:8px;font-weight:850;cursor:pointer}.pa-btn.danger{border-color:rgba(239,68,68,.25);color:#ffb0b0;background:rgba(239,68,68,.06)}.pa-btn.success{border-color:rgba(34,211,165,.25);color:#9ceaca;background:rgba(34,211,165,.06)}.pa-btn:disabled{opacity:.4}.pa-list{display:grid;gap:6px;margin-top:10px}.pa-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;padding:9px;border:1px solid rgba(128,158,192,.08);border-radius:10px}.pa-row strong{display:block;font-size:8.5px}.pa-row small{display:block;margin-top:3px;color:#6d8398;font-size:7px}.pa-note{color:#6f8599;font-size:7.5px;line-height:1.5}.pa-badge{display:inline-flex;align-items:center;padding:4px 7px;border:1px solid rgba(128,158,192,.13);border-radius:999px;color:#9cb0c2;font-size:6.5px;font-weight:900;text-transform:uppercase}.pa-badge.ok{border-color:rgba(34,211,165,.25);color:#9ceaca}.pa-badge.warn{border-color:rgba(245,158,11,.25);color:#ffd28a}.pa-badge.bad{border-color:rgba(239,68,68,.25);color:#ffb0b0}@media(max-width:760px){.pa-dialog{width:100vw;max-height:92dvh;margin:auto 0 0;border-radius:22px 22px 0 0;border-bottom:0}.pa-grid{grid-template-columns:1fr}.pa-body{padding:10px}.pa-field input,.pa-field select{min-height:44px;font-size:16px}.pa-btn{min-height:44px}.pa-state{grid-template-columns:1fr 1fr}}";
  document.head.appendChild(s);
  const d=document.createElement("dialog");d.id="platform-admin-dialog";d.className="pa-dialog";d.innerHTML='<header class="pa-head"><div><p>ADMINISTRATION PLATEFORME</p><h2>Abonnement & opérateur</h2></div><button class="pa-close" type="button" aria-label="Fermer">×</button></header><main id="pa-body" class="pa-body"></main>';
  document.body.appendChild(d);d.querySelector(".pa-close").addEventListener("click",()=>d.close());d.addEventListener("click",e=>{if(e.target===d)d.close();});d.addEventListener("click",handle);return d;
}
function feedback(msg,type=""){const e=$("pa-feedback");if(e){e.textContent=msg||"";e.className="pa-feedback "+type;}}
async function load(){
  const body=$("pa-body");if(!body)return;body.innerHTML='<p class="pa-note">Chargement de l’administration…</p>';
  try{
    const [billing,carrier,platform]=await Promise.all([window.PGIApi.subscriptionBilling(),window.PGIApi.carrierSwitchOptions(),window.PGIApi.wholesaleOverview()]);
    render(billing,carrier,platform);
  }catch(e){body.innerHTML='<p class="pa-note">Administration disponible uniquement lorsque l’API privée de production est connectée. '+esc(e.code||"")+'</p>';}
}
function render(billing,carrier,platform){
  lastPlatform=platform||null;
  const price=billing.current_price||{},route=carrier.route||{},targets=(carrier.targets||[]).filter(x=>Number(x.carrier_id)!==Number(route.active_carrier_id));
  const switches=carrier.recent_switches||[];
  const targetOptions=targets.map(x=>'<option value="'+esc(x.connection_id)+'" data-carrier="'+esc(x.carrier_id)+'">'+esc(x.carrier_name+" • "+x.connection_name+" • "+x.state)+'</option>').join("");
  const swRows=switches.map(x=>{let action="";if(["ready","planned"].includes(x.status))action='<button class="pa-btn success" data-switch-activate="'+esc(x.id)+'">Activer</button>';else if(x.status==="completed"&&(!x.rollback_deadline||Date.now()<Date.parse(x.rollback_deadline)))action='<button class="pa-btn danger" data-switch-rollback="'+esc(x.id)+'">Rollback</button>';return '<div class="pa-row"><div><strong>#'+esc(x.id)+" • "+esc(x.from_carrier||"—")+" → "+esc(x.to_carrier||"—")+'</strong><small>'+esc(x.status)+" • "+esc(date(x.created_at))+(x.rollback_deadline?" • rollback jusqu’au "+esc(date(x.rollback_deadline)):"")+'</small></div>'+action+'</div>';}).join("");
  const history=(billing.price_history||[]).slice(0,5).map(x=>'<div class="pa-row"><div><strong>'+money(x.amount_minor,x.currency)+' TTC/mois</strong><small>Depuis '+esc(date(x.effective_from))+(x.effective_to?" • fin "+esc(date(x.effective_to)):" • tarif courant")+'</small></div><span class="pa-badge">'+esc(x.currency||"EUR")+'</span></div>').join("");
  const trust=platform?.regulatory_trust||{},rs=trust.summary||{},rnums=trust.numbers||[],rcontrols=trust.platform_controls||[];
  const regulatoryRows=rnums.map(x=>'<div class="pa-row"><div><strong>'+esc(x.display_number||x.e164||"Numéro")+' • '+esc(x.tenant||"—")+'</strong><small>'+esc(x.market||"—")+' • RSVA '+esc(x.rsva_status||"non démarré")+' • MGIT '+esc(x.mgit_status||"non démarré")+' • ARCEP 2026 '+(x.arcep_2026_ready?"prêt":"bloqué")+'</small></div><div class="pa-actions"><span class="pa-badge '+(x.activation_ready?"ok":"warn")+'">'+(x.activation_ready?"PRÊT":"BLOQUÉ")+'</span><button class="pa-btn" type="button" data-regulatory-open="'+esc(x.assignment_id)+'">Conformité 2026</button><button class="pa-btn" type="button" data-evidence-pack="'+esc(x.assignment_id)+'">Evidence Pack</button></div></div>').join("");
  const platformRows=rcontrols.slice(0,8).map(x=>'<div class="pa-row"><div><strong>'+esc(String(x.control_key||"").replace(/_/g," "))+'</strong><small>'+esc(x.market||"Plateforme")+(x.valid_until?" • valable jusqu’au "+esc(date(x.valid_until)):"")+'</small></div><span class="pa-badge '+(x.status==="verified"?"":"warn")+'">'+esc(x.status||"—")+'</span></div>').join("");

  $("pa-body").innerHTML='<p id="pa-feedback" class="pa-feedback" role="status"></p><div class="pa-grid"><section class="pa-card"><h3>Tarif abonnement externe</h3><div class="pa-state"><div><span>Tarif courant</span><strong>'+money(price.amount_minor||0,price.currency||"EUR")+' TTC/mois</strong></div><div><span>Modèle</span><strong>Versionné</strong></div></div><label class="pa-field">Nouveau tarif mensuel en EUR<input id="pa-price" type="number" min="0.01" step="0.01" placeholder="3.00"></label><label class="pa-field">Date d’effet<input id="pa-effective" type="datetime-local"></label><div class="pa-actions"><button class="pa-btn" data-price-publish>Publier une nouvelle version</button></div><p class="pa-note">La publication ne réécrit jamais les anciens tarifs. Les contrats existants restent reliés à leur version tant qu’ils ne sont pas migrés explicitement.</p><div class="pa-list">'+(history||'<p class="pa-note">Aucun historique.</p>')+'</div></section><section class="pa-card"><h3>Bascule opérateur SVA</h3><div class="pa-state"><div><span>Actif</span><strong>'+esc(route.active_carrier||"Non configuré")+'</strong></div><div><span>Standby</span><strong>'+esc(route.standby_carrier||"Aucun")+'</strong></div><div><span>Génération</span><strong>'+esc(route.generation||1)+'</strong></div><div><span>Connexion</span><strong>'+esc(route.active_connection_state||"—")+'</strong></div></div><label class="pa-field">Cible prête<select id="pa-target"><option value="">Sélectionner…</option>'+targetOptions+'</select></label><label class="pa-field">Fenêtre rollback en minutes<input id="pa-rollback" type="number" min="5" max="10080" value="1440"></label><div class="pa-actions"><button class="pa-btn" data-switch-plan '+(!targets.length?"disabled":"")+'>1. Préparer la bascule</button></div><p class="pa-note">La préparation ne modifie pas la route active. L’activation exige la validation d’un second administrateur dans Control Tower. Le rollback d’urgence reste disponible dans la fenêtre configurée.</p><div class="pa-list">'+(swRows||'<p class="pa-note">Aucune bascule récente.</p>')+'</div></section><section class="pa-card"><h3>Regulatory Trust Center</h3><div class="pa-state"><div><span>Numéros prêts</span><strong>'+esc(rs.numbers_ready||0)+' / '+esc(rs.numbers_total||0)+'</strong></div><div><span>Preuves chaînées</span><strong>'+esc(rs.evidence_events||0)+'</strong></div><div><span>Bloquants</span><strong>'+esc(rs.review_blocking||0)+'</strong></div><div><span>Aujourd’hui</span><strong>'+esc(rs.review_today||0)+'</strong></div><div><span>Bientôt</span><strong>'+esc(rs.review_soon||0)+'</strong></div><div><span>Preuves ARCEP 2026</span><strong>'+esc(rs.arcep_2026_evidence_events||0)+'</strong></div><div><span>Écosystème SVA prêt</span><strong>'+esc(rs.sva_ecosystem_ready||0)+'</strong></div><div><span>Signalements ouverts</span><strong>'+esc(rs.abuse_open||0)+'</strong></div><div><span>Critiques</span><strong>'+esc(rs.abuse_critical||0)+'</strong></div></div><p class="pa-note">Activation externe fail-closed : Trust Center + ARCEP 2026 + readiness SVA requis. Les échéances n’entraînent aucune suspension automatique.</p><div class="pa-actions"><button class="pa-btn" type="button" data-regulatory-attention>Voir les échéances à traiter</button></div><div class="pa-list">'+(regulatoryRows||'<p class="pa-note">Aucun numéro externe à contrôler.</p>')+'</div></section><section class="pa-card"><h3>Contrôles plateforme</h3><div class="pa-state"><div><span>Vérifiés</span><strong>'+esc(rs.platform_controls_verified||0)+'</strong></div><div><span>À corriger</span><strong>'+esc(rs.platform_controls_attention||0)+'</strong></div></div><p class="pa-note">Préparation CE, APNF/RSVA, CGS AF2M, MAN, traçabilité anti-fraude, notifications d’incident et traitement 33700.</p><div class="pa-list">'+(platformRows||'<p class="pa-note">Contrôles à documenter lors de la contractualisation opérateur.</p>')+'</div></section><section id="pa-compliance-editor" class="pa-card pa-wide" hidden></section></div>';
}

async function handle(e){
  if(busy)return;
  const attention=e.target.closest("[data-regulatory-attention]");
  if(attention){
    try{
      const module=await import("./platform-regulatory-tools.js");
      module.openAttention({platform:lastPlatform,feedback});
    }catch(err){feedback(err.code||"Centre d’échéances indisponible","error");}
    return;
  }
  const open=e.target.closest("[data-regulatory-open]");
  if(open){
    try{
      const module=await import("./platform-regulatory-tools.js");
      module.open({assignmentId:open.dataset.regulatoryOpen,platform:lastPlatform,postJson,feedback});
    }catch(err){feedback(err.code||"Éditeur réglementaire indisponible","error");}
    return;
  }
  const pack=e.target.closest("[data-evidence-pack]");
  if(pack){
    const id=pack.dataset.evidencePack;busy=true;feedback("Génération du dossier d’audit…");
    try{
      const data=await postJson("/platform/tenant-number-assignments/"+encodeURIComponent(id)+"/regulatory-evidence-pack",{});
      const stamp=String(data.generated_at||new Date().toISOString()).replace(/[:.]/g,"-");
      const number=String(data.assignment?.display_number||data.assignment?.e164||id).replace(/[^0-9A-Za-z_-]+/g,"-");
      saveJson("evidence-pack-"+number+"-"+stamp+".json",data);
      busy=false;feedback("Evidence Pack exporté et empreinte SHA-256 enregistrée.","ok");
    }catch(err){busy=false;feedback(err.code||"Export impossible","error");}
    return;
  }
  if(e.target.closest("[data-price-publish]")){
    const amount=Number($("pa-price")?.value),effective=$("pa-effective")?.value;
    if(!Number.isFinite(amount)||amount<=0)return feedback("Tarif invalide.","error");
    if(!confirm("Publier ce nouveau tarif versionné : "+amount.toFixed(2)+" EUR TTC/mois ?"))return;
    busy=true;feedback("Publication du tarif…");
    try{const payload={amount_minor:Math.round(amount*100),currency:"EUR"};if(effective)payload.effective_from=new Date(effective).toISOString();await window.PGIApi.createSubscriptionPrice(payload,window.PGIApi.newIdempotencyKey());busy=false;feedback("Nouveau tarif publié.","ok");await load();window.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:"refresh"}}));}catch(err){busy=false;feedback(err.code||"Publication impossible","error");}return;
  }
  if(e.target.closest("[data-switch-plan]")){
    const sel=$("pa-target"),opt=sel&&sel.options[sel.selectedIndex];if(!sel?.value||!opt)return feedback("Sélectionner une connexion cible.","error");
    const carrierId=Number(opt.dataset.carrier),connectionId=Number(sel.value),rollback=Math.max(5,Math.min(10080,Number($("pa-rollback")?.value)||1440));
    if(!confirm("Préparer une bascule vers "+opt.textContent+" ? La route active ne changera pas encore."))return;
    busy=true;feedback("Préparation de la bascule…");
    try{await window.PGIApi.planCarrierSwitch({route_key:"sva-primary",to_carrier_id:carrierId,connection_id:connectionId,rollback_window_minutes:rollback,notes:"Préparée depuis le cockpit"},window.PGIApi.newIdempotencyKey());busy=false;feedback("Bascule préparée. Validation d’un second administrateur requise dans Control Tower.","ok");await load();}catch(err){busy=false;feedback(err.code||"Préparation impossible","error");}return;
  }
  const activate=e.target.closest("[data-switch-activate]");if(activate){if(!confirm("Activer maintenant cette bascule opérateur ?"))return;busy=true;feedback("Activation atomique…");try{await window.PGIApi.activateCarrierSwitch(activate.dataset.switchActivate,window.PGIApi.newIdempotencyKey());busy=false;feedback("Nouvelle route activée.","ok");await load();window.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:"refresh"}}));}catch(err){busy=false;feedback(err.code==="DUAL_CONTROL_APPROVAL_REQUIRED"?"Validation 4 yeux requise dans Control Tower.":(err.code||"Activation impossible"),"error");}return;}
  const rollback=e.target.closest("[data-switch-rollback]");if(rollback){if(!confirm("Revenir vers l’opérateur précédent maintenant ?"))return;busy=true;feedback("Rollback…");try{await window.PGIApi.rollbackCarrierSwitch(rollback.dataset.switchRollback,window.PGIApi.newIdempotencyKey());busy=false;feedback("Rollback effectué.","ok");await load();window.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:"refresh"}}));}catch(err){busy=false;feedback(err.code||"Rollback impossible","error");}}
}
export async function open(){const d=ensure();if(!d.open)d.showModal();await load();}

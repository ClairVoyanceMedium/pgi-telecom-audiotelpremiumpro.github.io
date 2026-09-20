const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const pct=v=>new Intl.NumberFormat("fr-FR",{style:"percent",maximumFractionDigits:2}).format(Number(v)||0);
const money=(v,c)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",maximumFractionDigits:2}).format(Number(v)||0);
const badge=(s)=>{s=String(s||"").toLowerCase();const k=["healthy","allowed","executed","approved"].includes(s)?"ok":["critical","blocked","rejected"].includes(s)?"bad":"warn";return '<span class="ct-badge '+k+'">'+esc(s.replace(/_/g," "))+'</span>';};
const id=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(16).slice(2);

function shadowRows(data){
  const rows=data?.assurance?.shadow_billing?.currencies||[];
  if(!rows.length)return '<p class="ct-note">Aucune donnée financière à rapprocher pour la fenêtre actuelle.</p>';
  return '<div class="ct-list">'+rows.map(x=>'<div class="ct-row"><div><strong>'+esc(x.currency)+' · attendu '+money(x.expected_payout_ht,x.currency)+'</strong><small>Confirmé '+money(x.confirmed_payout_ht,x.currency)+' · payé '+money(x.paid_payout_ht,x.currency)+' · écart '+money(x.variance_ht,x.currency)+' ('+pct(x.variance_ratio)+')</small></div>'+badge(x.status)+'</div>').join("")+'</div>';
}
function signalRows(data){
  const rows=data?.assurance?.risk?.signals||[];
  return rows.length?'<div class="ct-list">'+rows.slice(0,6).map(x=>'<div class="ct-row"><div><strong>'+esc(x.code)+'</strong><small>'+esc(x.label)+'</small></div><span class="ct-badge">'+esc(x.points)+' pts</span></div>').join("")+'</div>':'<p class="ct-note">Aucun signal agrégé significatif.</p>';
}
function sloRows(data){
  const rows=data?.assurance?.slo?.objectives||[];
  return '<div class="ct-list">'+rows.map(x=>'<div class="ct-row"><div><strong>'+esc(x.label)+'</strong><small>Valeur '+esc(x.value)+' · cible '+esc(x.target)+'</small></div>'+badge(x.pass?"healthy":"attention")+'</div>').join("")+'</div>';
}
function changeRows(data){
  const rows=data?.assurance?.change_requests||[];
  if(!rows.length)return '<p class="ct-note">Aucun changement critique en attente.</p>';
  return '<div class="ct-list">'+rows.map(x=>'<div class="ct-row" data-change-row="'+esc(x.id)+'"><div><strong>'+esc(x.change_type.replace(/_/g," "))+' · '+esc(x.entity_type)+' #'+esc(x.entity_id)+'</strong><small>Demandé par '+esc(x.requested_by_name||x.requested_by)+' · expire '+esc(new Date(x.expires_at).toLocaleString("fr-FR"))+'</small><input class="ct-approval-reason" data-change-reason="'+esc(x.id)+'" placeholder="Motif (requis pour un refus)" maxlength="500"></div><div class="ct-actions">'+badge(x.status)+(x.status==="pending"?'<button class="ct-btn" data-change-approve="'+esc(x.id)+'">Approuver</button><button class="ct-btn" data-change-reject="'+esc(x.id)+'">Refuser</button>':'')+'</div></div>').join("")+'</div>';
}
async function act(slot,request,reload,kind,changeId){
  const field=slot.querySelector('[data-change-reason="'+CSS.escape(String(changeId))+'"]');
  const reason=String(field?.value||"").trim();
  if(kind==="reject"&&!reason){if(field){field.focus();field.setCustomValidity("Motif requis pour refuser.");field.reportValidity();setTimeout(()=>field.setCustomValidity(""),1200);}return;}
  const buttons=slot.querySelectorAll("[data-change-approve],[data-change-reject]");buttons.forEach(b=>b.disabled=true);
  try{
    await request("/platform/change-requests/"+encodeURIComponent(changeId)+"/"+kind,{reason},id());
    await reload();
  }catch(e){
    const row=slot.querySelector('[data-change-row="'+CSS.escape(String(changeId))+'"]');
    if(row)row.insertAdjacentHTML("beforeend",'<small class="ct-note">'+esc(e.code||e.message||"Action impossible")+'</small>');
    buttons.forEach(b=>b.disabled=false);
  }
}
export function render(slot,data,request,reload){
  if(!slot)return;
  const risk=data?.assurance?.risk||{},slo=data?.assurance?.slo||{},shadow=data?.assurance?.shadow_billing||{};
  slot.innerHTML='<h3>Assurance opérationnelle</h3><p class="ct-note">Contrôles internes sans connexion externe : risque agrégé, SLO instantanés, shadow billing et double validation.</p>'+
  '<div class="ct-kpis"><div class="ct-kpi"><span>Risk Engine</span><strong>'+esc(risk.score||0)+'/100</strong>'+badge(risk.level)+'</div><div class="ct-kpi"><span>SLO internes</span><strong>'+esc(slo.score||0)+'%</strong>'+badge(slo.state)+'</div><div class="ct-kpi"><span>Shadow billing</span><strong>'+esc((shadow.currencies||[]).length)+' devise(s)</strong>'+badge(shadow.status)+'</div><div class="ct-kpi"><span>4 yeux</span><strong>'+esc(data?.kpis?.approvals_pending||0)+' en attente</strong>'+badge((data?.kpis?.approvals_pending||0)>0?"attention":"healthy")+'</div></div>'+
  '<div class="ct-grid" style="margin-top:10px"><section><h3>Signaux de risque</h3>'+signalRows(data)+'</section><section><h3>SLO / error budget</h3>'+sloRows(data)+'</section><section class="ct-wide"><h3>Shadow billing · 30 jours</h3>'+shadowRows(data)+'</section><section class="ct-wide"><h3>Validations 4 yeux</h3><p class="ct-note">Le demandeur ne peut jamais approuver sa propre action. Le rollback d’urgence reste indépendant.</p>'+changeRows(data)+'</section></div>';
  slot.querySelectorAll("[data-change-approve]").forEach(b=>b.addEventListener("click",()=>act(slot,request,reload,"approve",b.dataset.changeApprove)));
  slot.querySelectorAll("[data-change-reject]").forEach(b=>b.addEventListener("click",()=>act(slot,request,reload,"reject",b.dataset.changeReject)));
}

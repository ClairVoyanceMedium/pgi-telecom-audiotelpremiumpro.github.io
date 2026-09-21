const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const nf=v=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(Number(v)||0);
const date=v=>v?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";
const badge=s=>{s=String(s||"").toLowerCase();const c=["passed","fresh","ready","healthy"].includes(s)?"ok":["failed","critical","unproven"].includes(s)?"bad":"warn";return '<span class="ct-badge '+c+'">'+esc(s.replace(/_/g," "))+'</span>';};
function bytes(v){v=Number(v)||0;const units=["o","Ko","Mo","Go","To"];let i=0;while(v>=1024&&i<units.length-1){v/=1024;i++;}return nf(v)+" "+units[i];}
function loadRows(data){
  const rows=data?.load?.runs||[];
  if(!rows.length)return '<p class="ct-note">Aucune preuve de charge enregistrée. Utilisez le banc de charge avant le branchement opérateur.</p>';
  return '<div class="ct-list">'+rows.slice(0,8).map(x=>'<div class="ct-row"><div><strong>'+esc(x.run_type)+' · '+esc(x.scenario)+'</strong><small>'+date(x.completed_at)+' · p95 '+nf(x.p95_ms)+' ms · p99 '+nf(x.p99_ms)+' ms · '+nf(x.requests_per_second)+' req/s · erreurs '+nf((Number(x.error_rate)||0)*100)+' %</small></div>'+badge(x.status)+'</div>').join("")+'</div>';
}
function dbRows(data){
  const d=data.database||{},rows=d.attention||[];
  const head='<div class="ct-kpis"><div class="ct-kpi"><span>Connexions</span><strong>'+esc(d.connections_total||0)+' / '+esc(d.max_connections||0)+'</strong></div><div class="ct-kpi"><span>Réserve DB</span><strong>'+nf(d.connection_headroom_percent)+' %</strong></div><div class="ct-kpi"><span>Taille DB</span><strong>'+bytes(d.size_bytes)+'</strong></div><div class="ct-kpi"><span>Tables à revoir</span><strong>'+esc(rows.length)+'</strong></div></div>';
  const list=rows.length?'<div class="ct-list" style="margin-top:8px">'+rows.slice(0,8).map(x=>'<div class="ct-row"><div><strong>'+esc(x.relname)+'</strong><small>'+nf(x.live_rows)+' lignes · dead rows '+nf(x.dead_row_percent)+' % · seq '+nf(x.seq_scan)+' · index '+nf(x.idx_scan)+'</small></div>'+badge("attention")+'</div>').join("")+'</div>':'<p class="ct-note">Aucune table majeure ne remonte d’alerte simple d’index/vacuum.</p>';
  return head+list;
}
function blockerRows(data){
  const rows=data?.preproduction_gate?.blockers||[];
  return rows.length?'<div class="ct-list">'+rows.map(x=>'<div class="ct-row"><div><strong>'+esc(x.code)+'</strong><small>'+esc(x.label)+'</small></div>'+badge("attention")+'</div>').join("")+'</div>':'<p class="ct-note">Aucun bloqueur mesuré pour le gate préproduction.</p>';
}
function drRows(data){
  const dr=data.disaster_recovery||{},r=dr.latest_restore;
  const restore=r?'<div class="ct-row"><div><strong>Dernier restore drill</strong><small>'+date(r.completed_at)+' · RPO '+esc(r.observed_rpo_seconds??"—")+' s · RTO '+esc(r.observed_rto_seconds??"—")+' s</small></div>'+badge(r.status)+'</div>':'<div class="ct-row"><div><strong>Restore drill</strong><small>Aucune preuve enregistrée.</small></div>'+badge("unproven")+'</div>';
  return '<div class="ct-list">'+restore+'<div class="ct-row"><div><strong>Cibles DR actives</strong><small>'+esc((dr.targets||[]).length)+' composant(s) avec RPO/RTO déclarés.</small></div>'+badge((dr.targets||[]).length?"ready":"attention")+'</div></div>';
}
function synthetic(data){
  const s=data.synthetic||{},p=s.success_percent;
  return '<div class="ct-kpis"><div class="ct-kpi"><span>Checks 24 h</span><strong>'+esc(s.checks_24h||0)+'</strong></div><div class="ct-kpi"><span>Succès 24 h</span><strong>'+(p==null?"—":nf(p)+" %")+'</strong></div><div class="ct-kpi"><span>Latence moyenne</span><strong>'+nf(s.avg_latency_ms)+' ms</strong></div><div class="ct-kpi"><span>Dernier échec</span><strong>'+esc(date(s.last_failure_at))+'</strong></div></div>';
}
export async function render(slot,request){
  if(!slot)return;
  slot.innerHTML='<h3>Performance & Resilience Lab</h3><p class="ct-note">Chargement des preuves de capacité et de résilience…</p>';
  try{
    const data=await request("/platform/performance-lab");
    const gate=data.preproduction_gate||{},q=data.queue||{},limits=data.rate_limits||{};
    slot.innerHTML='<h3>Performance & Resilience Lab</h3><p class="ct-note">Preuves mesurées avant branchement opérateur. Aucun chiffre de capacité n’est présenté comme garanti tant qu’un test réel n’a pas été enregistré.</p>'+
      '<div class="ct-status">'+badge(gate.ready?"ready":"attention")+badge(data.capacity_proof)+'<span class="ct-badge">GLOBAL '+esc(limits.global_per_minute||0)+'/min</span><span class="ct-badge">HEAVY '+esc(limits.heavy_read_per_minute||0)+'/min</span><span class="ct-badge">WRITE '+esc(limits.write_per_minute||0)+'/min</span></div>'+
      '<div class="ct-grid" style="margin-top:10px"><section><h3>Gate préproduction</h3>'+blockerRows(data)+'</section><section><h3>Sondes synthétiques</h3>'+synthetic(data)+'</section><section class="ct-wide"><h3>PostgreSQL</h3>'+dbRows(data)+'</section><section class="ct-wide"><h3>Tests de charge</h3>'+loadRows(data)+'</section><section><h3>Files de travaux</h3><div class="ct-kpis"><div class="ct-kpi"><span>En attente</span><strong>'+esc(q.pending||0)+'</strong></div><div class="ct-kpi"><span>Loués</span><strong>'+esc(q.leased||0)+'</strong></div><div class="ct-kpi"><span>Dead letters</span><strong>'+esc(q.dead_lettered||0)+'</strong></div><div class="ct-kpi"><span>Plus ancien</span><strong>'+nf(q.oldest_pending_seconds)+' s</strong></div></div></section><section><h3>Disaster Recovery</h3>'+drRows(data)+'</section></div>';
  }catch(e){slot.innerHTML='<h3>Performance & Resilience Lab</h3><p class="ct-note">Lab indisponible : '+esc(e.code||e.message||"erreur")+'</p>';}
}

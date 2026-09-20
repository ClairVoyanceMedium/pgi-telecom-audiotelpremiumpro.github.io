"use strict";

const $=id=>document.getElementById(id);
const N=(v,d=1)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d}).format(Number(v)||0);
const P=(v,t)=>Number(t)>0?Number(v||0)/Number(t)*100:0;
const C=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const E=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const DATE=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—";};
function ensureStyles(){
  if(document.getElementById("voice-intelligence-styles"))return;
  const style=document.createElement("style");style.id="voice-intelligence-styles";style.textContent=`
.voice-overview-strip{display:grid;grid-template-columns:minmax(210px,.6fr) minmax(0,1.4fr);gap:12px;align-items:stretch;margin-bottom:14px;padding:12px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(135deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}
.voice-overview-copy{display:flex;flex-direction:column;justify-content:center;padding:7px 9px}.voice-overview-copy>strong{font-size:19px}.voice-overview-copy>span{margin-top:5px;color:var(--muted);font-size:9px}
.voice-overview-kpis,.voice-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.voice-metric{min-width:0;padding:11px;border:1px solid rgba(255,255,255,.075);border-radius:11px;background:rgba(255,255,255,.02)}
.voice-metric>span,.voice-metric>small{display:block}.voice-metric>span{color:var(--muted);font-size:8px;font-weight:750}.voice-metric>strong{display:block;margin:6px 0 4px;font-size:17px;letter-spacing:-.025em}.voice-metric>small{color:#738394;font-size:8px;line-height:1.4}
.voice-metric.good{border-color:rgba(83,191,137,.22)}.voice-metric.warn{border-color:rgba(220,166,81,.28)}.voice-metric.bad{border-color:rgba(221,92,92,.32)}
.voice-noc-panel,.carrier-health-panel{margin-top:14px}.voice-metric-grid{grid-template-columns:repeat(5,minmax(0,1fr));margin-top:12px}.voice-noc-split{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.voice-noc-split>div,.voice-incidents{padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.08)}.voice-noc-split h3,.voice-incidents h3{margin:0 0 9px;font-size:10px}
.voice-sip-list,.voice-hangup-list{display:grid;gap:6px}.voice-sip-list>div,.voice-hangup-list>div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:9px}
.voice-sip-list>div:last-child,.voice-hangup-list>div:last-child{border-bottom:0}.voice-incidents{margin-top:10px}.voice-incident{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:9px;align-items:start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}.voice-incident:last-child{border-bottom:0}
.voice-incident>i{width:8px;height:8px;margin-top:3px;border-radius:50%;background:#7b8792}.voice-incident.warning>i{background:#dca651}.voice-incident.critical>i{background:#dd5c5c}.voice-incident.resolved>i{background:#53bf89}.voice-incident strong,.voice-incident span{display:block}.voice-incident strong{font-size:9px}.voice-incident span{margin-top:3px;color:var(--muted);font-size:8px}.voice-incident>b{font-size:7px;letter-spacing:.05em}
.voice-threshold-note{margin:10px 2px 0;color:#718090;font-size:8px;line-height:1.5}.voice-carrier-table td,.voice-carrier-table th{white-space:nowrap}.voice-health{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid var(--line);font-size:8px;font-weight:800}
.voice-health.good{color:#8bd9b3;border-color:rgba(83,191,137,.28)}.voice-health.warn{color:#e1ba78;border-color:rgba(220,166,81,.3)}.voice-health.bad{color:#ee9696;border-color:rgba(221,92,92,.34)}.voice-health.neutral{color:var(--muted)}.voice-action-note{display:block;max-width:150px;margin-top:5px;color:#d7aa68;font-size:7px;white-space:normal;line-height:1.35}
@media(max-width:1100px){.voice-metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.voice-overview-strip{grid-template-columns:1fr}.voice-overview-kpis,.voice-metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.voice-noc-split{grid-template-columns:1fr}.voice-metric>strong{font-size:16px}}@media(max-width:390px){.voice-overview-kpis,.voice-metric-grid{grid-template-columns:1fr}}
`;document.head.appendChild(style);
}

function summarize(rows){
  rows=rows||[];
  const quality=rows.filter(x=>Number(x.mos)>0||Number(x.packetLoss)>0||Number(x.jitter)>0||Number(x.latency)>0);
  const pdd=rows.filter(x=>x.pddMs!=null&&Number.isFinite(Number(x.pddMs)));
  const avg=(items,fn)=>items.length?items.reduce((a,x)=>a+Number(fn(x)||0),0)/items.length:null;
  return {
    calls_total:rows.length,
    calls_connected:rows.filter(x=>x.status==="connected").length,
    calls_failed:rows.filter(x=>!["connected","abandoned"].includes(x.status)).length,
    pdd_samples:pdd.length,avg_pdd_ms:avg(pdd,x=>x.pddMs),high_pdd_calls:pdd.filter(x=>Number(x.pddMs)>8000).length,
    quality_samples:quality.length,
    network_affected_calls:quality.filter(x=>Number(x.packetLoss)>=5||Number(x.jitter)>5||Number(x.latency)>150).length,
    low_mos_calls:quality.filter(x=>Number(x.mos)>0&&Number(x.mos)<3.5).length,
    mos:avg(quality,x=>x.mos),packet_loss_percent:avg(quality,x=>x.packetLoss),jitter_ms:avg(quality,x=>x.jitter),
    latency_ms:avg(quality,x=>x.latency),rtt_ms:avg(quality,x=>x.rtt),
    sip_4xx_calls:rows.filter(x=>x.sipFinalCode>=400&&x.sipFinalCode<500).length,
    sip_5xx_calls:rows.filter(x=>x.sipFinalCode>=500&&x.sipFinalCode<600).length,
    caller_hangups:rows.filter(x=>x.hangupParty==="caller").length,
    callee_hangups:rows.filter(x=>x.hangupParty==="callee").length,
    network_hangups:rows.filter(x=>x.hangupParty==="network").length
  };
}
function derive(rows){
  const group=role=>{
    const map=new Map();
    for(const x of rows||[]){
      const carrier=role==="host"?(x.hostCarrier||"Opérateur hôte"):(x.carrier||"Inconnu");
      if(!map.has(carrier))map.set(carrier,[]);
      map.get(carrier).push(x);
    }
    return [...map].map(([carrier,items],i)=>({carrier_role:role,carrier_id:i+1,carrier,...summarize(items)}));
  };
  const sip=new Map();
  for(const x of rows||[]){const code=Number(x.sipFinalCode);if(code>=100&&code<=699)sip.set(code,(sip.get(code)||0)+1);}
  return {summary:summarize(rows||[]),carriers:group("host").concat(group("origin")),sip_codes:[...sip].map(([sip_final_code,calls_total])=>({sip_final_code,calls_total})),incidents:[]};
}
function metrics(x){
  x=x||{};
  return {
    connection:P(x.calls_connected,x.calls_total),
    failed:P(x.calls_failed,x.calls_total),
    highPdd:P(x.high_pdd_calls,x.pdd_samples),
    affected:P(x.network_affected_calls,x.quality_samples),
    lowMos:P(x.low_mos_calls,x.quality_samples),
    sip5:P(x.sip_5xx_calls,x.calls_total),
    mos:Number(x.mos||0)
  };
}
function healthScore(x){
  const m=metrics(x);
  if(!Number(x.calls_total||0))return null;
  const mosScore=x.quality_samples?C((m.mos/4.5)*100,0,100):100;
  return C(m.connection*.45+(100-m.affected)*.20+(100-m.highPdd)*.15+(100-m.sip5)*.10+mosScore*.10,0,100);
}
function health(score){
  if(score==null)return {label:"Sans données",tone:"neutral"};
  if(score>=88)return {label:"Sain",tone:"good"};
  if(score>=72)return {label:"À surveiller",tone:"warn"};
  return {label:"Dégradé",tone:"bad"};
}
function metric(label,value,note,tone=""){
  return '<div class="voice-metric '+E(tone)+'"><span>'+E(label)+'</span><strong>'+E(value)+'</strong><small>'+E(note||"")+'</small></div>';
}
function renderOverview(v){
  const root=$("voice-intelligence-overview");if(!root)return;
  const s=v.summary||{},m=metrics(s),score=healthScore(s),h=health(score);
  root.innerHTML=
    '<div class="voice-overview-copy"><p class="panel-kicker">SANTÉ VOIX</p><strong>'+E(h.label)+'</strong><span>Diagnostic technique interne • '+(score==null?"—":N(score,0)+"/100")+'</span></div>'+
    '<div class="voice-overview-kpis">'+
      metric("Connexion",s.calls_total?N(m.connection,1)+" %":"—","Appels aboutis")+
      metric("PDD",s.pdd_samples?N(Number(s.avg_pdd_ms||0)/1000,2)+" s":"—","Temps avant sonnerie")+
      metric("Réseau affecté",s.quality_samples?N(m.affected,1)+" %":"—","RTP dégradé")+
      metric("MOS",s.quality_samples?N(s.mos,2):"—","Qualité moyenne")+
    '</div>';
}
function renderSystem(v){
  const root=$("voice-intelligence-system");if(!root)return;
  const s=v.summary||{},m=metrics(s),inc=(v.incidents||[]),open=inc.filter(x=>x.state==="open");
  const hangTotal=Number(s.caller_hangups||0)+Number(s.callee_hangups||0)+Number(s.network_hangups||0);
  const sip=(v.sip_codes||[]).slice(0,8);
  root.innerHTML=
    '<section class="panel voice-noc-panel">'+
      '<div class="panel-head"><div><p class="panel-kicker">VOICE INTELLIGENCE</p><h2>Qualité, signalisation & incidents</h2></div><span class="metric-badge">'+E(open.length?open.length+" incident"+(open.length>1?"s":"")+" ouvert"+(open.length>1?"s":""):"Aucun incident ouvert")+'</span></div>'+
      '<div class="voice-metric-grid">'+
        metric("Taux de connexion",s.calls_total?N(m.connection,1)+" %":"—",N(s.calls_total||0,0)+" appels",m.connection<75?"bad":m.connection<88?"warn":"good")+
        metric("PDD moyen",s.pdd_samples?N(Number(s.avg_pdd_ms||0)/1000,2)+" s":"—",s.pdd_samples?N(m.highPdd,1)+" % > 8 s":"Pas d’échantillon",m.highPdd>=15?"warn":"good")+
        metric("Réseau affecté",s.quality_samples?N(m.affected,1)+" %":"—",N(s.quality_samples||0,0)+" échantillons",m.affected>=15?"bad":m.affected>=5?"warn":"good")+
        metric("MOS moyen",s.quality_samples?N(s.mos,2):"—",s.quality_samples?N(m.lowMos,1)+" % < 3,5":"Pas d’échantillon",Number(s.mos||4.5)<3.5?"bad":Number(s.mos||4.5)<4?"warn":"good")+
        metric("Perte paquets",s.quality_samples?N(s.packet_loss_percent,2)+" %":"—","Seuil diagnostic 5 %",Number(s.packet_loss_percent||0)>=5?"bad":"good")+
        metric("Jitter",s.quality_samples?N(s.jitter_ms,1)+" ms":"—","Seuil diagnostic 5 ms",Number(s.jitter_ms||0)>5?"warn":"good")+
        metric("Latence",s.quality_samples?N(s.latency_ms,0)+" ms":"—","Seuil diagnostic 150 ms",Number(s.latency_ms||0)>150?"bad":"good")+
        metric("RTT",s.quality_samples&&s.rtt_ms!=null?N(s.rtt_ms,0)+" ms":"—","Aller-retour RTP")+
        metric("SIP 5xx",s.calls_total?N(m.sip5,1)+" %":"—",N(s.sip_5xx_calls||0,0)+" appels",m.sip5>=10?"bad":"good")+
      '</div>'+
      '<div class="voice-noc-split">'+
        '<div><h3>Réponses SIP principales</h3><div class="voice-sip-list">'+(sip.length?sip.map(x=>'<div><span>SIP '+E(x.sip_final_code)+'</span><strong>'+N(x.calls_total,0)+'</strong></div>').join(""):'<p class="muted">Aucune réponse SIP disponible.</p>')+'</div></div>'+
        '<div><h3>Origine de fin d’appel</h3><div class="voice-hangup-list">'+
          '<div><span>Appelant</span><strong>'+(hangTotal?N(P(s.caller_hangups,hangTotal),1)+" %":"—")+'</strong></div>'+
          '<div><span>Destinataire</span><strong>'+(hangTotal?N(P(s.callee_hangups,hangTotal),1)+" %":"—")+'</strong></div>'+
          '<div><span>Réseau</span><strong>'+(hangTotal?N(P(s.network_hangups,hangTotal),1)+" %":"—")+'</strong></div>'+
        '</div></div>'+
      '</div>'+
      '<div class="voice-incidents"><h3>Historique des incidents</h3>'+
        (inc.length?inc.slice(0,12).map(x=>'<div class="voice-incident '+E(x.severity)+' '+E(x.state)+'"><i></i><div><strong>'+E(x.title)+'</strong><span>'+E(x.carrier||"Plateforme")+' • '+E(x.market||"Tous marchés")+' • '+DATE(x.started_at)+'</span></div><b>'+E(x.state==="open"?"OUVERT":"RÉSOLU")+'</b></div>').join(""):'<p class="muted">Aucun incident technique enregistré sur la sélection.</p>')+
      '</div>'+
      '<p class="voice-threshold-note">Seuils affichés = diagnostics techniques internes. Ils ne constituent pas un SLA contractuel.</p>'+
    '</section>';
}
function renderCarriers(v){
  const root=$("carrier-health-center");if(!root)return;
  const rows=(v.carriers||[]).slice().sort((a,b)=>(a.carrier_role===b.carrier_role?Number(b.calls_total||0)-Number(a.calls_total||0):(a.carrier_role==="host"?-1:1)));
  root.innerHTML=
    '<section class="panel carrier-health-panel"><div class="panel-head"><div><p class="panel-kicker">SANTÉ OPÉRATEURS</p><h2>Connexion, PDD, RTP & signalisation</h2></div><span class="metric-badge">Diagnostic automatique</span></div>'+
    '<div class="table-wrap wide"><table class="voice-carrier-table"><thead><tr><th>Rôle</th><th>Opérateur</th><th>Appels</th><th>Connexion</th><th>PDD élevé</th><th>Réseau affecté</th><th>MOS</th><th>SIP 5xx</th><th>Indice</th><th>Diagnostic</th></tr></thead><tbody>'+
    (rows.length?rows.map(x=>{const m=metrics(x),score=healthScore(x),h=health(score);return '<tr><td>'+E(x.carrier_role==="host"?"Hôte SVA":"Origine")+'</td><td><strong>'+E(x.carrier||"Inconnu")+'</strong></td><td>'+N(x.calls_total,0)+'</td><td>'+N(m.connection,1)+' %</td><td>'+(x.pdd_samples?N(m.highPdd,1)+" %":"—")+'</td><td>'+(x.quality_samples?N(m.affected,1)+" %":"—")+'</td><td>'+(x.quality_samples?N(x.mos,2):"—")+'</td><td>'+N(m.sip5,1)+' %</td><td>'+(score==null?"—":N(score,0)+"/100")+'</td><td><span class="voice-health '+h.tone+'">'+E(h.label)+'</span>'+(x.carrier_role==="host"&&score!=null&&score<72?'<small class="voice-action-note">Bascule à évaluer après confirmation technique</small>':"")+'</td></tr>';}).join(""):'<tr><td colspan="10" class="empty-row">Aucune donnée opérateur sur cette période.</td></tr>')+
    '</tbody></table></div><p class="voice-threshold-note">Aucune bascule automatique n’est déclenchée par ce tableau. Toute activation de route reste une action administrateur contrôlée.</p></section>';
}
export function render(payload){
  ensureStyles();
  const data=payload&&payload.data||{};
  const v=data.voice_intelligence||derive(payload&&payload.rows||[]);
  renderOverview(v);renderSystem(v);renderCarriers(v);
}

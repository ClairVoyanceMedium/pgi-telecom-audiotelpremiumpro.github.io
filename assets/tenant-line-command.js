const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const nf=(v,d=0)=>new Intl.NumberFormat("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(n(v));
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v));}catch(_e){return nf(v,2)+" "+(c||"EUR");}};
const dt=v=>{if(!v)return" - ";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):" - ";};
let styled=false;

function css(){
  if(styled||document.getElementById("tenant-line-command-style"))return;styled=true;
  const s=document.createElement("style");s.id="tenant-line-command-style";
  s.textContent=".tlc{display:grid;gap:10px}.tlc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap}.tlc-head h3{margin:0}.tlc-actions{display:flex;gap:7px;flex-wrap:wrap}.tlc-btn{min-height:34px;padding:6px 9px;border:1px solid rgba(53,216,255,.18);border-radius:9px;background:rgba(53,216,255,.05);color:#dff8ff;font-size:7px;font-weight:850;cursor:pointer}.tlc-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.tlc-kpi{padding:9px;border:1px solid rgba(128,158,192,.1);border-radius:10px;background:#0a1320}.tlc-kpi span,.tlc-kpi small{display:block;color:#748ba0;font-size:6.5px}.tlc-kpi strong{display:block;margin:4px 0 2px;font-size:13px}.tlc-live{color:#92e9cb}.tlc-table-wrap{overflow:auto}.tlc-table{width:100%;min-width:1280px;border-collapse:collapse}.tlc-table th,.tlc-table td{padding:7px;border-bottom:1px solid rgba(128,158,192,.07);text-align:left;font-size:7.5px;vertical-align:top}.tlc-table th{color:#657c92;font-size:6px;text-transform:uppercase;letter-spacing:.045em}.tlc-table td strong{display:block;color:#eaf5fb;font-size:8px}.tlc-table td small{display:block;margin-top:2px;color:#71879a;font-size:6.5px}.tlc-state{display:inline-flex;padding:3px 6px;border:1px solid rgba(128,158,192,.14);border-radius:999px;font-size:6px;font-weight:900;text-transform:uppercase}.tlc-state.ok{color:#92e9cb;border-color:rgba(34,211,165,.22)}.tlc-state.warn{color:#f6d48e;border-color:rgba(245,158,11,.24)}.tlc-state.bad{color:#ffadad;border-color:rgba(239,68,68,.24)}.tlc-alerts{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}.tlc-alert{padding:2px 5px;border-radius:999px;background:rgba(245,158,11,.08);color:#f6d48e;font-size:6px}.tlc-note{margin:0;color:#74899c;font-size:7px;line-height:1.45}@media(max-width:900px){.tlc-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.tlc-summary{grid-template-columns:1fr}}";
  document.head.appendChild(s);
}
function stateFor(row){
  const issues=[];
  if(String(row.assignment_status)!=="active")issues.push("ligne non active");
  if(n(row.calls_30d)>0&&n(row.payout_term_matches)===0)issues.push("conditions de reversement absentes");
  if(n(row.active_routes)===0)issues.push("aucun routage actif");
  if(n(row.open_incidents)>0)issues.push(n(row.open_incidents)+" incident(s)");
  if(issues.some(x=>x.includes("conditions")||x.includes("routage")))return {tone:"bad",label:"À traiter",issues};
  if(issues.length)return {tone:"warn",label:"À surveiller",issues};
  return {tone:"ok",label:"Prête",issues:[]};
}
function csv(rows){
  const head=["Numéro","Statut","Palier","Prix service TTC/min","Appels 30j","Décrochés 30j","Minutes 30j","CA service TTC 30j","Reversement opérateur attendu HT 30j","Frais PGI estimés HT 30j","Net client estimé HT 30j","Reversement confirmé HT 30j","Reversement payé HT 30j","Appels actifs","Vitesse opérateur HT/s","Vitesse client HT/s","Routages actifs","Incidents ouverts","Dernier appel"];
  const data=rows.map(x=>[x.display_number||x.e164,x.assignment_status,x.tariff_code||"",x.service_rate_ttc_per_min,x.calls_30d,x.connected_30d,n(x.billable_seconds_30d)/60,x.revenue_ttc_30d,x.upstream_expected_ht_30d,x.platform_fee_estimated_ht_30d,x.client_net_estimated_ht_30d,x.upstream_confirmed_ht_30d,x.upstream_paid_ht_30d,x.active_calls,x.upstream_rate_ht_per_second,x.client_rate_ht_per_second,x.active_routes,x.open_incidents,x.last_call_at||""]);
  const cell=v=>{const s=String(v??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return "\ufeff"+[head,...data].map(r=>r.map(cell).join(";")).join("\r\n");
}
function download(rows){
  const b=new Blob([csv(rows)],{type:"text/csv;charset=utf-8"}),u=URL.createObjectURL(b),a=document.createElement("a");
  a.href=u;a.download="audiotel-pilotage-lignes-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function rowHtml(x){
  const c=x.currency||"EUR",calls=n(x.calls_30d),connected=n(x.connected_30d),asr=calls?connected/calls*100:0,st=stateFor(x);
  const alerts=st.issues.length?'<div class="tlc-alerts">'+st.issues.map(v=>'<span class="tlc-alert">'+esc(v)+'</span>').join("")+'</div>':"";
  const live=n(x.active_calls)>0?'<strong class="tlc-live">'+nf(x.active_calls)+' actif(s)</strong><small>+'+esc(money(x.upstream_rate_ht_per_second,c))+'/s amont · +'+esc(money(x.client_rate_ht_per_second,c))+'/s client</small>':'<strong>0</strong><small>Aucun appel actif</small>';
  return '<tr>'+
    '<td><strong>'+esc(x.display_number||x.e164||" - ")+'</strong><small>'+esc(x.e164||"")+'</small></td>'+
    '<td><span class="tlc-state '+st.tone+'">'+esc(st.label)+'</span>'+alerts+'</td>'+
    '<td><strong>'+esc(x.tariff_code||" - ")+'</strong><small>'+esc(money(x.service_rate_ttc_per_min,c))+'/min</small></td>'+
    '<td><strong>'+nf(calls)+'</strong><small>'+nf(asr,1)+' % décrochés</small></td>'+
    '<td><strong>'+nf(n(x.billable_seconds_30d)/60,1)+' min</strong><small>Dernier '+esc(dt(x.last_call_at))+'</small></td>'+
    '<td><strong>'+esc(money(x.revenue_ttc_30d,c))+'</strong><small>service TTC</small></td>'+
    '<td><strong>'+esc(money(x.upstream_expected_ht_30d,c))+'</strong><small>confirmé '+esc(money(x.upstream_confirmed_ht_30d,c))+'</small></td>'+
    '<td><strong>'+esc(n(x.payout_term_matches)>0?money(x.platform_fee_estimated_ht_30d,c):" - ")+'</strong><small>part PGI estimée</small></td>'+
    '<td><strong>'+esc(n(x.payout_term_matches)>0?money(x.client_net_estimated_ht_30d,c):" - ")+'</strong><small>net client estimé</small></td>'+
    '<td>'+live+'</td>'+
    '<td><strong>'+nf(x.active_routes)+'</strong><small>route(s) active(s)</small></td>'+
    '<td><strong>'+nf(x.open_incidents)+'</strong><small>incident(s) ouvert(s)</small></td>'+
  '</tr>';
}
export function mountTenantLineCommand(data,root){
  if(!root)return;css();root.hidden=false;root.classList.add("tlc");
  const rows=Array.isArray(data?.line_performance)?data.line_performance:[];
  const currencies=[...new Set(rows.map(x=>x.currency||"EUR"))];
  const single=currencies.length<=1,c=currencies[0]||data?.tenant?.default_currency||"EUR";
  const sum=k=>rows.reduce((a,x)=>a+n(x[k]),0);
  const calls=sum("calls_30d"),connected=sum("connected_30d"),active=sum("active_calls"),routes=sum("active_routes"),incidents=sum("open_incidents");
  const financial=value=>single?money(value,c):"Multi-devises";
  const feeReady=rows.every(x=>n(x.calls_30d)===0||n(x.payout_term_matches)>0);
  root.innerHTML='<div class="tlc-head"><div><p class="panel-kicker">PILOTAGE LIGNES & BUSINESS LIVE</p><h3>Contrôle financier et télécom par numéro</h3></div><div class="tlc-actions"><button class="tlc-btn" type="button" data-tlc-export'+(rows.length?"":" disabled")+'>Exporter CSV</button></div></div>'+
    '<div class="tlc-summary">'+
      '<div class="tlc-kpi"><span>Appels 30 jours</span><strong>'+nf(calls)+'</strong><small>'+nf(connected)+' décrochés</small></div>'+
      '<div class="tlc-kpi"><span>Reversement opérateur attendu</span><strong>'+esc(financial(sum("upstream_expected_ht_30d")))+'</strong><small>CDR des 30 jours</small></div>'+
      '<div class="tlc-kpi"><span>Part PGI estimée</span><strong>'+esc(feeReady?financial(sum("platform_fee_estimated_ht_30d")):" - ")+'</strong><small>'+(feeReady?"conditions actives":"conditions incomplètes")+'</small></div>'+
      '<div class="tlc-kpi"><span>Net client estimé</span><strong>'+esc(feeReady?financial(sum("client_net_estimated_ht_30d")):" - ")+'</strong><small>avant consolidation finale</small></div>'+
      '<div class="tlc-kpi"><span>Business Live</span><strong class="tlc-live">'+nf(active)+' appel(s)</strong><small>'+(single?"+"+money(sum("upstream_rate_ht_per_second"),c)+"/s amont":"multi-devises")+'</small></div>'+
      '<div class="tlc-kpi"><span>Exploitation</span><strong>'+nf(routes)+' routes</strong><small>'+nf(incidents)+' incident(s) ouvert(s)</small></div>'+
    '</div>'+
    '<div class="tlc-table-wrap"><table class="tlc-table"><thead><tr><th>Ligne</th><th>État intelligent</th><th>Palier / prix</th><th>Appels 30j</th><th>Minutes</th><th>CA TTC</th><th>Amont HT</th><th>PGI estimé</th><th>Client estimé</th><th>Business Live</th><th>Routage</th><th>Incidents</th></tr></thead><tbody>'+(rows.length?rows.map(rowHtml).join(""):'<tr><td colspan="12">Aucune ligne affectée. Le module s’alimentera automatiquement dès l’affectation d’un numéro réel.</td></tr>')+'</tbody></table></div>'+
    '<p class="tlc-note">Cette vue est analytique : elle n’invente aucun tarif ni reversement. Les montants “estimés” reposent sur les CDR et conditions de reversement enregistrées ; les montants rapprochés et payés restent l’autorité comptable. Business Live se mettra à refléter les appels réels dès que les événements opérateur alimenteront la plateforme.</p>';
  root.querySelector("[data-tlc-export]")?.addEventListener("click",()=>download(rows));
}

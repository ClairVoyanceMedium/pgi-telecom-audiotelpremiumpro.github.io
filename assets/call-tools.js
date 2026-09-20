const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const n=(v,d=2)=>new Intl.NumberFormat("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0);
const money=v=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(Number(v)||0);
const d=v=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"short"}).format(new Date(v));
const t=v=>v?new Intl.DateTimeFormat("fr-FR",{timeStyle:"medium"}).format(new Date(v)):"—";
const dur=s=>{s=Math.max(0,Number(s)||0);const m=Math.floor(s/60),r=Math.floor(s%60);return m+":"+String(r).padStart(2,"0");};
const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';

let callRows=[],callCurrency="EUR",callExpanded=false;
function callMoney(v){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:callCurrency}).format(Number(v)||0);}
  catch{return n(v,2)+" "+callCurrency;}
}
function callTime(v){return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(new Date(v));}
function callChip(status){
  const label=status==="connected"?"ABOUTI":status==="abandoned"?"ABANDON":"ÉCHEC";
  return '<span class="status-chip '+esc(status)+'">'+label+"</span>";
}
function ensureCallDisclosure(){
  const table=$("calls-table");if(!table)return null;
  let button=$("calls-toggle");
  if(!button){
    const style=document.createElement("style");
    style.textContent=".calls-disclosure{display:flex;justify-content:center;padding-top:10px;border-top:1px solid rgba(73,51,40,.45)}.calls-toggle{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--cyan);font-size:10px;font-weight:800;padding:7px 10px}.calls-toggle-arrow{display:inline-block;font-size:14px;transition:transform .18s ease}.calls-toggle.expanded .calls-toggle-arrow{transform:rotate(180deg)}";
    document.head.appendChild(style);
    const wrap=document.createElement("div");wrap.className="calls-disclosure";
    wrap.innerHTML='<button id="calls-toggle" class="calls-toggle" type="button" aria-expanded="false"><span id="calls-toggle-label"></span><span class="calls-toggle-arrow" aria-hidden="true">⌄</span></button>';
    table.closest(".table-wrap")?.after(wrap);
    button=$("calls-toggle");
    button?.addEventListener("click",()=>{callExpanded=!callExpanded;renderCallTable(callRows,callCurrency);});
  }
  return button;
}
export function renderCallTable(rows,currency="EUR"){
  callRows=Array.isArray(rows)?rows:[];callCurrency=String(currency||"EUR").toUpperCase();
  const table=$("calls-table");if(!table)return;
  const visible=callExpanded?callRows:callRows.slice(0,8);
  table.innerHTML=visible.map(c=>"<tr><td>"+d(c.ts)+"</td><td>"+callTime(c.ts)+"</td><td>"+esc(c.caller)+"</td><td>"+esc(c.carrier)+"</td><td>"+esc(c.number)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+dur(c.wait)+"</td><td>"+dur(c.conversation)+"</td><td>"+esc(c.billable)+" min</td><td>"+callMoney(c.expected)+"</td><td>"+callChip(c.status)+'</td><td><button class="detail-btn" type="button" data-call-id="'+esc(c.id)+'">Voir</button></td></tr>').join("")||'<tr><td colspan="12">Aucune donnée sur cette période.</td></tr>';
  const button=ensureCallDisclosure(),label=$("calls-toggle-label");
  if(button){button.hidden=callRows.length<=8;button.classList.toggle("expanded",callExpanded);button.setAttribute("aria-expanded",callExpanded?"true":"false");}
  if(label)label.textContent=callExpanded?"Réduire la liste":"Afficher les "+new Intl.NumberFormat("fr-FR").format(callRows.length)+" appels";
}

export function exportCsv(rows,button){
  rows=Array.isArray(rows)?rows:[];
  if(button&&button.disabled)return;
  if(button)button.disabled=true;
  const header=["date","heure","appelant_masque","reseau","numero_sva","expert","attente_s","conversation_s","total_s","minutes_facturables","minutes_reversement","ca_service_ttc","reversement_attendu_ht","reversement_confirme_ht","ecart_ht","sip_code","cause_fin","codec","perte_paquets_pct","jitter_ms","latence_ms","mos","statut"];
  const lines=[header.join(";")];
  rows.forEach(c=>lines.push([
    d(c.ts),t(c.ts),c.caller,c.carrier,c.number,c.expert,c.wait,c.conversation,c.total,c.billable,c.payoutEligible,
    Number(c.serviceAmount||0).toFixed(2),Number(c.expected||0).toFixed(2),Number(c.confirmed||0).toFixed(2),Number(c.variance||0).toFixed(2),
    c.sipFinalCode,c.hangupCause,c.codec,c.packetLoss,c.jitter,c.latency,c.mos,c.status
  ].map(cell).join(";")));
  const blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="pgi-audiotel-cdr-"+new Date().toISOString().slice(0,10)+".csv";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);if(button)button.disabled=false;},1000);
}

export function showDetail(c){
  if(!c)return;
  const label=(k,v)=>'<div class="detail-metric"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>';
  const title=$("call-detail-title"),grid=$("call-detail-grid");
  if(title)title.textContent="Appel #"+c.id+" • "+d(c.ts)+" "+t(c.ts);
  if(grid)grid.innerHTML=
    label("Appelant",c.caller)+label("Réseau",c.carrier)+label("Numéro SVA",c.number)+label("Expert",c.expert)+
    label("Début",t(c.ts))+label("Entrée SVI",t(c.ivrStarted))+label("Mise en file",t(c.queued))+label("Mise en relation",c.bridged?t(c.bridged):"—")+
    label("Fin",t(c.ended))+label("Attente",dur(c.wait))+label("Conversation",dur(c.conversation))+label("Durée totale",dur(c.total))+
    label("Facturable",(c.billable||0)+" min")+label("Éligible reversement",(c.payoutEligible||0)+" min")+label("CA service TTC",money(c.serviceAmount))+label("Reversement attendu HT",money(c.expected))+
    label("Reversement confirmé HT",money(c.confirmed))+label("Reversement payé HT",money(c.paid))+label("Écart",money(c.variance))+label("PDD",c.pddMs==null?"—":n(c.pddMs/1000,2)+" s")+
    label("SIP final",String(c.sipFinalCode??"—"))+label("Cause de fin",c.hangupCause)+label("Qui a raccroché",c.hangupParty==="caller"?"Appelant":c.hangupParty==="callee"?"Destinataire":c.hangupParty==="network"?"Réseau":"Indéterminé")+
    label("Codec",c.codec)+label("Perte paquets",n(c.packetLoss,3)+" %")+label("Jitter",n(c.jitter)+" ms")+label("Latence",n(c.latency)+" ms")+label("RTT",n(c.rtt)+" ms")+label("MOS",n(c.mos))+
    label("Paquets reçus",n(c.packetsIn,0))+label("Paquets envoyés",n(c.packetsOut,0))+label("Paquets perdus",n(c.packetsLost,0))+label("Erreurs DTMF",n(c.dtmfErrors,0));
  const dialog=$("call-dialog");if(dialog&&typeof dialog.showModal==="function")dialog.showModal();
}

function downloadRows(name,rows){
  const blob=new Blob(["\ufeff"+rows.map(r=>r.map(cell).join(";")).join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),800);
}
function readValue(id){const el=$(id);return el?String(el.textContent||"").trim():"";}
function exportSummary(){
  const rows=[["PGI • Telecom - Audiotel Premium Pro"],["Export",new Date().toISOString()],["Période",readValue("command-period")],["Dernière synchro",readValue("command-sync")],[],["INDICATEURS"],["CA généré",readValue("kpi-ca")],["Reversement attendu",readValue("kpi-expected")],["Reversement encaissé",readValue("kpi-paid")],["Marge estimée",readValue("kpi-margin")],["Appels",readValue("kpi-calls")],["Minutes facturables",readValue("kpi-minutes")],["Taux de décroché",readValue("kpi-asr")],["Clients",readValue("overview-wh-tenants")],["089 affectés",readValue("overview-wh-numbers")],["Net clients",readValue("overview-wh-net")]];
  downloadRows("pgi-audiotel-synthese-"+new Date().toISOString().slice(0,10)+".csv",rows);
}
function exportFinance(){
  const ids=[["CA généré","kpi-ca"],["Reversement attendu","kpi-expected"],["Reversement encaissé","kpi-paid"],["Marge estimée","kpi-margin"],["Écart","kpi-gap"],["Concordance financière","pulse-recon"],["Confirmé / attendu","pulse-confirmed"],["Encaissé / attendu","pulse-paid"],["Valeur par appel","cockpit-value-call"],["Valeur par minute","cockpit-value-minute"],["Marge par appel","cockpit-margin-call"]];
  const rows=[["Indicateur","Valeur"]].concat(ids.map(x=>[x[0],readValue(x[1])]));
  downloadRows("pgi-audiotel-finance-"+new Date().toISOString().slice(0,10)+".csv",rows);
}
function ensureExportDialog(rows){
  let dialog=$("pgi-export-center");
  if(!dialog){
    const style=document.createElement("style");style.textContent=".pgi-export-dialog{width:min(660px,calc(100vw - 24px));padding:0;border:1px solid #3b4653;border-radius:16px;background:#11161d;color:#eaf2f8;box-shadow:0 28px 90px #000a}.pgi-export-dialog::backdrop{background:#000b;backdrop-filter:blur(4px)}.pgi-export-card{padding:18px}.pgi-export-head{display:flex;justify-content:space-between;gap:10px;align-items:start}.pgi-export-head h2{margin:2px 0 0;font-size:19px}.pgi-export-head button{width:34px;height:34px;border:1px solid #33404e;border-radius:9px;background:#1b2430;color:#fff}.pgi-export-note{color:#8fa2b7;font-size:10px;line-height:1.5}.pgi-export-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.pgi-export-grid button{padding:12px;text-align:left;border:1px solid #2a3745;border-radius:10px;background:#17202a;color:#eaf2f8}.pgi-export-grid button:hover{background:#202b37}.pgi-export-grid strong,.pgi-export-grid span{display:block}.pgi-export-grid strong{font-size:11px}.pgi-export-grid span{margin-top:4px;color:#8fa2b7;font-size:9px}@media(max-width:560px){.pgi-export-grid{grid-template-columns:1fr}}";document.head.appendChild(style);
    dialog=document.createElement("dialog");dialog.id="pgi-export-center";dialog.className="pgi-export-dialog";dialog.innerHTML='<form method="dialog" class="pgi-export-card"><div class="pgi-export-head"><div><small>EXPORTS</small><h2>Centre d’export PGI</h2></div><button value="cancel" aria-label="Fermer">×</button></div><p class="pgi-export-note">Exports locaux de la période et des filtres actuellement affichés.</p><div class="pgi-export-grid"><button type="button" data-pgi-export="calls"><strong>Appels CSV</strong><span>CDR filtrés</span></button><button type="button" data-pgi-export="summary"><strong>Synthèse CSV</strong><span>KPI principaux du cockpit</span></button><button type="button" data-pgi-export="finance"><strong>Finance CSV</strong><span>CA, reversements et marge</span></button><button type="button" data-pgi-export="print-calls"><strong>Appels PDF</strong><span>Ouvrir l’impression</span></button><button type="button" data-pgi-export="print-finance"><strong>Finance PDF</strong><span>Ouvrir l’impression</span></button></div></form>';document.body.appendChild(dialog);
    dialog.addEventListener("click",e=>{const b=e.target.closest("[data-pgi-export]");if(!b)return;const kind=b.dataset.pgiExport;dialog.close();if(kind==="calls")exportCsv(dialog._rows||[]);else if(kind==="summary")exportSummary();else if(kind==="finance")exportFinance();else window.dispatchEvent(new CustomEvent("pgi:command",{detail:{id:kind}}));});
  }
  dialog._rows=rows;if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();
}
export function openExports(rows){ensureExportDialog(Array.isArray(rows)?rows:[]);}

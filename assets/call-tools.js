const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const n=(v,d=2)=>new Intl.NumberFormat("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0);
const money=v=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(Number(v)||0);
const d=v=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"short"}).format(new Date(v));
const t=v=>v?new Intl.DateTimeFormat("fr-FR",{timeStyle:"medium"}).format(new Date(v)):"—";
const dur=s=>{s=Math.max(0,Number(s)||0);const m=Math.floor(s/60),r=Math.floor(s%60);return m+":"+String(r).padStart(2,"0");};
const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';

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
    label("Reversement confirmé HT",money(c.confirmed))+label("Reversement payé HT",money(c.paid))+label("Écart",money(c.variance))+label("SIP final",String(c.sipFinalCode??"—"))+label("Cause de fin",c.hangupCause)+
    label("Codec",c.codec)+label("Perte paquets",n(c.packetLoss,3)+" %")+label("Jitter",n(c.jitter)+" ms")+label("Latence",n(c.latency)+" ms")+label("MOS",n(c.mos));
  const dialog=$("call-dialog");if(dialog&&typeof dialog.showModal==="function")dialog.showModal();
}
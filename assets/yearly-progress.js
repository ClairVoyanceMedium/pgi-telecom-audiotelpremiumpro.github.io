const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(num(v));}catch(_e){return num(v).toFixed(2)+" "+c;}};
const nf=(v,d=0)=>new Intl.NumberFormat("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d}).format(num(v));
const monthFmt=new Intl.DateTimeFormat("fr-FR",{month:"short"});
let styleReady=false,clientBound=false;

function css(){
  if(styleReady||document.getElementById("yearly-progress-style"))return;styleReady=true;
  const s=document.createElement("style");s.id="yearly-progress-style";
  s.textContent=".yp{display:grid;gap:12px}.yp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}.yp-head h2,.yp-head h3{margin:0}.yp-head p{margin:4px 0 0;color:var(--muted,#74899c);font-size:12px}.yp-controls{display:flex;gap:8px;align-items:center}.yp-controls label{font-size:10px;color:var(--muted,#74899c)}.yp-controls select{min-height:36px;padding:6px 9px;border:1px solid rgba(128,158,192,.17);border-radius:9px;background:var(--panel,#0a1320);color:inherit}.yp-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.yp-kpi{padding:11px;border:1px solid rgba(128,158,192,.11);border-radius:12px;background:rgba(128,158,192,.035)}.yp-kpi span{display:block;color:var(--muted,#74899c);font-size:10px}.yp-kpi strong{display:block;margin:5px 0;font-size:18px}.yp-kpi small{display:block;color:var(--muted,#74899c);font-size:10px}.yp-change{display:inline-flex!important;width:max-content;padding:3px 7px;border-radius:999px;font-weight:850}.yp-change.up{color:#7de0b8;background:rgba(34,211,165,.08)}.yp-change.down{color:#ff9f9f;background:rgba(239,68,68,.08)}.yp-change.flat{color:#d6bd8b;background:rgba(245,158,11,.08)}.yp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.yp-chart{padding:11px;border:1px solid rgba(128,158,192,.1);border-radius:12px;background:rgba(128,158,192,.025)}.yp-chart-head{display:flex;justify-content:space-between;gap:8px;align-items:start;margin-bottom:8px}.yp-chart h4{margin:0;font-size:13px}.yp-legend{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted,#74899c);font-size:9px}.yp-legend i{display:inline-block;width:12px;height:3px;border-radius:9px;margin-right:4px;vertical-align:middle}.yp-legend .current i{background:#d7a76a}.yp-legend .previous i{background:#68c59a}.yp-svg{width:100%;height:210px;display:block;overflow:visible}.yp-axis{stroke:rgba(128,158,192,.12);stroke-width:1}.yp-current{fill:none;stroke:#d7a76a;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.yp-previous{fill:none;stroke:#68c59a;stroke-width:2;stroke-dasharray:5 5;stroke-linecap:round;stroke-linejoin:round}.yp-dot-current{fill:#d7a76a}.yp-dot-previous{fill:#68c59a}.yp-label{fill:currentColor;opacity:.58;font-size:10px}.yp-empty{padding:30px 10px;text-align:center;color:var(--muted,#74899c);font-size:11px}.yp-summary{margin:0;padding:10px 12px;border-left:3px solid rgba(215,167,106,.7);background:rgba(215,167,106,.05);border-radius:8px;color:inherit;font-size:11px;line-height:1.45}.yp-note{margin:0;color:var(--muted,#74899c);font-size:9px;line-height:1.45}@media(max-width:850px){.yp-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.yp-grid{grid-template-columns:1fr}}@media(max-width:520px){.yp-kpis{grid-template-columns:1fr}.yp-svg{height:190px}}";
  document.head.appendChild(s);
}
function pct(current,previous){
  const c=num(current),p=num(previous);
  if(p===0)return c>0?{value:null,label:"Nouvelle activité",tone:"up"}:{value:0,label:"0 %",tone:"flat"};
  const v=(c-p)/Math.abs(p)*100;
  return {value:v,label:(v>0?"+":"")+nf(v,1)+" %",tone:v>0.05?"up":v<-0.05?"down":"flat"};
}
function currencyRows(data,currency,period){return (data.summary||[]).find(x=>x.currency===currency&&x.period===period)||{};}
function dailyMap(data,currency,period){
  const map=new Map();
  (data.daily||[]).filter(x=>x.currency===currency&&x.period===period).forEach(x=>map.set(Number(x.day_index),x));
  return map;
}
function dayOrder(data){
  const from=new Date(data?.ranges?.current?.from||Date.now()),out=[];
  for(let i=0;i<365;i++){
    const d=new Date(from.getTime()+i*86400000);
    out.push({day:i,label:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit"}).format(d)});
  }
  return out;
}
function path(points){return points.map((p,i)=>(i?"L ":"M ")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");}
function chart(title,orders,currentMap,previousMap,key,format){
  const current=orders.map(x=>num(currentMap.get(x.day)?.[key])),previous=orders.map(x=>num(previousMap.get(x.day)?.[key]));
  const max=Math.max(1,...current,...previous),w=900,h=210,pad=30,step=(w-pad*2)/Math.max(1,orders.length-1);
  const pts=vals=>vals.map((v,i)=>({x:pad+i*step,y:h-pad-(v/max)*(h-pad*2),v}));
  const cpts=pts(current),ppts=pts(previous);
  const labelStep=30;
  const xlabels=orders.map((x,i)=>(i%labelStep===0||i===orders.length-1)?'<text class="yp-label" x="'+(pad+i*step).toFixed(1)+'" y="'+(h-6)+'" text-anchor="middle">'+esc(x.label)+'</text>':"").join("");
  const hits=orders.map((x,i)=>'<circle cx="'+cpts[i].x.toFixed(1)+'" cy="'+cpts[i].y.toFixed(1)+'" r="4" fill="transparent"><title>'+esc(x.label+" · actuel : "+format(cpts[i].v)+" · année précédente : "+format(ppts[i].v))+'</title></circle>').join("");
  return '<article class="yp-chart"><div class="yp-chart-head"><h4>'+esc(title)+'</h4><div class="yp-legend"><span class="current"><i></i>365 jours actuels</span><span class="previous"><i></i>même période N-1</span></div></div><svg class="yp-svg" viewBox="0 0 900 210" role="img" aria-label="'+esc(title+", comparaison jour par jour sur 365 jours")+'"><line class="yp-axis" x1="30" y1="180" x2="870" y2="180"></line><line class="yp-axis" x1="30" y1="30" x2="30" y2="180"></line><path class="yp-previous" d="'+path(ppts)+'"></path><path class="yp-current" d="'+path(cpts)+'"></path>'+hits+xlabels+'</svg></article>';
}
function render(root,data,mode){
  css();root.hidden=false;root.classList.add("yp");
  const currencies=data.currencies?.length?data.currencies:[data.tenant?.default_currency||"EUR"];
  const currency=root.dataset.currency&&currencies.includes(root.dataset.currency)?root.dataset.currency:(currencies.includes("EUR")?"EUR":currencies[0]);
  root.dataset.currency=currency;
  const cur=currencyRows(data,currency,"current"),prev=currencyRows(data,currency,"previous"),orders=dayOrder(data),cm=dailyMap(data,currency,"current"),pm=dailyMap(data,currency,"previous");
  const rev=pct(cur.generated_revenue_ttc,prev.generated_revenue_ttc),calls=pct(cur.calls_total,prev.calls_total),mins=pct(num(cur.billable_seconds)/60,num(prev.billable_seconds)/60);
  const completeCur=cur.net_payout_available===true||String(cur.net_available)==="true",completePrev=prev.net_payout_available===true||String(prev.net_available)==="true";
  const net=completeCur&&completePrev?pct(cur.estimated_client_net_ht,prev.estimated_client_net_ht):null;
  const kpi=(label,value,change,note)=>'<div class="yp-kpi"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(change?'<small class="yp-change '+change.tone+'">'+esc(change.label)+'</small>':"")+'<small>'+esc(note)+'</small></div>';
  root.innerHTML='<div class="yp-head"><div><p class="panel-kicker">PROGRESSION SUR 365 JOURS</p><'+(mode==="admin"?"h3":"h2")+'>Évolution par rapport à l’année précédente</'+(mode==="admin"?"h3":"h2")+'><p>Comparaison jour par jour des 365 derniers jours avec la même période un an plus tôt.</p></div><div class="yp-controls"><label>Devise <select data-yp-currency>'+currencies.map(c=>'<option value="'+esc(c)+'" '+(c===currency?"selected":"")+'>'+esc(c)+'</option>').join("")+'</select></label></div></div>'+
    '<div class="yp-kpis">'+
      kpi("Revenus générés",money(cur.generated_revenue_ttc,currency),rev,"contre "+money(prev.generated_revenue_ttc,currency))+
      kpi("Appels",nf(cur.calls_total),calls,"contre "+nf(prev.calls_total))+
      kpi("Minutes facturables",nf(num(cur.billable_seconds)/60,1),mins,"contre "+nf(num(prev.billable_seconds)/60,1))+
      kpi("Net client estimé",completeCur?money(cur.estimated_client_net_ht,currency):"—",net,completeCur&&completePrev?"comparaison selon conditions enregistrées":"conditions de reversement incomplètes")+
    '</div>'+
    '<p class="yp-summary">'+esc(summarySentence(cur,prev,currency))+'</p>'+
    '<div class="yp-grid">'+
      chart("Revenus générés TTC jour par jour",orders,cm,pm,"generated_revenue_ttc",v=>money(v,currency))+
      chart("Nombre d’appels jour par jour",orders,cm,pm,"calls_total",v=>nf(v))+
    '</div>'+
    '<p class="yp-note">Les comparaisons utilisent l’historique réel de la plateforme et ne sont pas affectées par une remise à zéro visuelle des métriques. Le net client reste une estimation tant que le rapprochement opérateur n’est pas définitif.</p>';
  root.querySelector("[data-yp-currency]")?.addEventListener("change",e=>{root.dataset.currency=e.target.value;render(root,data,mode);});
}
async function loadClient(root){
  if(!window.PGICustomerApi?.annualProgress)return;
  root.innerHTML='<p class="yp-empty">Calcul de votre progression annuelle…</p>';
  try{render(root,await window.PGICustomerApi.annualProgress(),"client");}catch(_e){root.innerHTML='<p class="yp-empty">La comparaison annuelle sera disponible dès qu’un historique suffisant aura été enregistré.</p>';}
}
export function mountClientAnnualProgress(){
  if(clientBound)return;clientBound=true;
  const mount=()=>{
    let root=document.getElementById("client-yearly-progress");
    if(!root){
      root=document.createElement("section");root.id="client-yearly-progress";root.className="cp-panel cp-chart-card cp-chart-wide yp";root.hidden=true;
      const anchor=document.getElementById("client-analytics-plus-mount");
      if(anchor?.parentNode)anchor.parentNode.insertBefore(root,anchor.nextSibling);
      else document.getElementById("client-main")?.appendChild(root);
    }
    loadClient(root);
  };
  document.addEventListener("pgi:portal-loaded",mount);
  if(window.PGIClientPortalData)mount();
}
export async function mountAdminAnnualProgress(id,root){
  if(!root||!window.PGIApi?.tenantAnnualProgress)return;
  css();root.hidden=false;root.classList.add("yp");root.innerHTML='<p class="yp-empty">Calcul de la progression annuelle du client…</p>';
  try{render(root,await window.PGIApi.tenantAnnualProgress(id),"admin");}catch(_e){root.innerHTML='<p class="yp-empty">Comparaison annuelle indisponible pour ce client.</p>';}
}

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const date=v=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"short"}).format(new Date(v));
const time=v=>new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(new Date(v));
const dur=s=>{s=Math.max(0,Number(s)||0);return Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");};
let rows=[],currency="EUR",expanded=false;

function money(v){
  try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(Number(v)||0);}
  catch{return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(Number(v)||0)+" "+currency;}
}
function chip(status){
  const label=status==="connected"?"ABOUTI":status==="abandoned"?"ABANDON":"ÉCHEC";
  return '<span class="status-chip '+esc(status)+'">'+label+"</span>";
}
function ensureUi(){
  const table=$("calls-table");if(!table)return null;
  let button=$("calls-toggle");
  if(button)return button;
  const style=document.createElement("style");
  style.textContent=".calls-disclosure{display:flex;justify-content:center;padding-top:10px;border-top:1px solid rgba(73,51,40,.45)}.calls-toggle{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--cyan);font-size:10px;font-weight:800;padding:7px 10px}.calls-toggle-arrow{display:inline-block;font-size:14px;transition:transform .18s ease}.calls-toggle.expanded .calls-toggle-arrow{transform:rotate(180deg)}";
  document.head.appendChild(style);
  const wrap=document.createElement("div");
  wrap.className="calls-disclosure";
  wrap.innerHTML='<button id="calls-toggle" class="calls-toggle" type="button" aria-expanded="false"><span id="calls-toggle-label"></span><span class="calls-toggle-arrow" aria-hidden="true">⌄</span></button>';
  table.closest(".table-wrap")?.after(wrap);
  button=$("calls-toggle");
  button?.addEventListener("click",()=>{expanded=!expanded;paint();});
  return button;
}
function paint(){
  const table=$("calls-table");if(!table)return;
  const shown=expanded?rows:rows.slice(0,8);
  table.innerHTML=shown.map(c=>"<tr><td>"+date(c.ts)+"</td><td>"+time(c.ts)+"</td><td>"+esc(c.caller)+"</td><td>"+esc(c.carrier)+"</td><td>"+esc(c.number)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+dur(c.wait)+"</td><td>"+dur(c.conversation)+"</td><td>"+esc(c.billable)+" min</td><td>"+money(c.expected)+"</td><td>"+chip(c.status)+'</td><td><button class="detail-btn" type="button" data-call-id="'+esc(c.id)+'">Voir</button></td></tr>').join("")||'<tr><td colspan="12">Aucune donnée sur cette période.</td></tr>';
  const button=ensureUi(),label=$("calls-toggle-label");
  if(button){button.hidden=rows.length<=8;button.classList.toggle("expanded",expanded);button.setAttribute("aria-expanded",expanded?"true":"false");}
  if(label)label.textContent=expanded?"Réduire la liste":"Afficher les "+new Intl.NumberFormat("fr-FR").format(rows.length)+" appels";
}
export function renderCallTable(nextRows,nextCurrency="EUR"){
  rows=Array.isArray(nextRows)?nextRows:[];
  currency=String(nextCurrency||"EUR").toUpperCase();
  paint();
}

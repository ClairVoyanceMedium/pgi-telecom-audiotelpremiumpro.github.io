const OPTIONS=[
  ["calls","Appels & décroché","Compteurs d’appels, aboutis, abandons et taux de décroché."],
  ["minutes","Minutes & durées","Minutes facturables, durée moyenne et indicateurs de durée."],
  ["revenue","Chiffre d’affaires","Montants de service et indicateurs de chiffre d’affaires."],
  ["payout","Reversements & marge","Reversements, coûts, marge et rapprochement financier visibles."],
  ["quality","Qualité & expérience","Qualité voix, attente, SVI, file et expérience appelant."]
];

function ensureStyle(){
  if(document.getElementById("metric-reset-style"))return;
  const s=document.createElement("style");s.id="metric-reset-style";
  s.textContent=".mr-dialog{width:min(620px,calc(100vw - 24px));max-height:88vh;padding:0;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:#171a1e;color:#f2f4f5;box-shadow:0 30px 90px rgba(0,0,0,.58)}.mr-dialog::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(5px)}.mr-card{padding:20px}.mr-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.mr-head h2{margin:3px 0 0;font-size:20px}.mr-kicker{margin:0;color:#8e969e;font-size:8px;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.mr-close{width:34px;height:34px;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:#22262b;color:#fff;font-size:20px}.mr-note{margin:10px 0 14px;color:#929aa2;font-size:10px;line-height:1.5}.mr-all{display:flex;align-items:center;gap:9px;margin-bottom:9px;padding:10px 12px;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(255,255,255,.03);font-size:10px;font-weight:850}.mr-grid{display:grid;gap:7px}.mr-option{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:11px 12px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:rgba(255,255,255,.018)}.mr-option strong,.mr-option small{display:block}.mr-option strong{font-size:10px}.mr-option small{margin-top:4px;color:#828b94;font-size:8px;line-height:1.4}.mr-option input,.mr-all input{margin-top:2px}.mr-warning{margin:12px 0 0;color:#b1b7bd;font-size:9px;line-height:1.5}.mr-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.mr-actions button{min-height:38px;padding:0 13px;border-radius:9px;border:1px solid rgba(255,255,255,.13);font-weight:850}.mr-cancel{background:#24282d;color:#fff}.mr-confirm{background:#842f2f;color:#fff}.mr-confirm:disabled{opacity:.45}@media(max-width:560px){.mr-card{padding:16px}.mr-actions{flex-direction:column-reverse}.mr-actions button{width:100%;min-height:44px}}";
  document.head.appendChild(s);
}
function ensureDialog(){
  let d=document.getElementById("metric-reset-dialog");if(d)return d;
  ensureStyle();
  d=document.createElement("dialog");d.id="metric-reset-dialog";d.className="mr-dialog";
  d.innerHTML='<form class="mr-card"><div class="mr-head"><div><p class="mr-kicker">STATISTIQUES</p><h2 id="metric-reset-title">Remettre des statistiques à zéro</h2></div><button class="mr-close" type="button" aria-label="Fermer">×</button></div><p id="metric-reset-note" class="mr-note"></p><label class="mr-all"><input id="metric-reset-all" type="checkbox">Tout sélectionner</label><div class="mr-grid">'+OPTIONS.map(x=>'<label class="mr-option"><input type="checkbox" name="metric-reset-key" value="'+x[0]+'"><span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></span></label>').join("")+'</div><p class="mr-warning">Cette action crée un nouveau point de départ pour les statistiques choisies. Les CDR, règlements, contrats et traces d’audit ne sont pas supprimés.</p><div class="mr-actions"><button class="mr-cancel" type="button">Annuler</button><button id="metric-reset-confirm" class="mr-confirm" type="submit" disabled>Remettre à zéro</button></div></form>';
  document.body.appendChild(d);
  const all=d.querySelector("#metric-reset-all"),boxes=[...d.querySelectorAll('[name="metric-reset-key"]')],confirm=d.querySelector("#metric-reset-confirm");
  const sync=()=>{all.checked=boxes.every(x=>x.checked);all.indeterminate=!all.checked&&boxes.some(x=>x.checked);confirm.disabled=!boxes.some(x=>x.checked);};
  all.addEventListener("change",()=>{boxes.forEach(x=>x.checked=all.checked);sync();});
  boxes.forEach(x=>x.addEventListener("change",sync));
  d.querySelector(".mr-close").addEventListener("click",()=>d.close());
  d.querySelector(".mr-cancel").addEventListener("click",()=>d.close());
  return d;
}
export function openMetricReset(options={}){
  const d=ensureDialog(),form=d.querySelector("form"),boxes=[...d.querySelectorAll('[name="metric-reset-key"]')],all=d.querySelector("#metric-reset-all"),confirm=d.querySelector("#metric-reset-confirm");
  boxes.forEach(x=>x.checked=false);all.checked=false;all.indeterminate=false;confirm.disabled=true;
  d.querySelector("#metric-reset-title").textContent=options.title||"Remettre des statistiques à zéro";
  d.querySelector("#metric-reset-note").textContent=options.note||"Choisissez uniquement les indicateurs qui doivent repartir de zéro.";
  form.onsubmit=async e=>{
    e.preventDefault();
    const keys=boxes.filter(x=>x.checked).map(x=>x.value);if(!keys.length)return;
    confirm.disabled=true;
    try{await options.onConfirm?.(keys);d.close();}finally{confirm.disabled=false;}
  };
  if(typeof d.showModal==="function")d.showModal();
}

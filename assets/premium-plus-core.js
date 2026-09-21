const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export {esc};
export function style(id,css){if(document.getElementById(id))return;const s=document.createElement("style");s.id=id;s.textContent=css;document.head.appendChild(s)}
export function read(key,defaults={}){try{return {...defaults,...JSON.parse(localStorage.getItem(key)||"{}")}}catch{return {...defaults}}}
export function write(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
export function applyDisplay(p){
  const h=document.documentElement;
  h.dataset.pgiContrast=p.contrast?"high":"normal";
  h.dataset.pgiMotion=p.motion===false?"reduced":"normal";
  h.dataset.pgiDensity=p.density||"comfortable";
  h.dataset.pgiText=p.text||"normal";
}
export function displayCss(){
return `
html[data-pgi-contrast="high"]{--border:rgba(255,255,255,.32)!important;--line:rgba(255,255,255,.28)!important;--muted:#d2d7dc!important}
html[data-pgi-contrast="high"] :where(.panel,.kpi,.cp-panel,.cp-kpis article,.secondary-btn,.cp-ghost){border-color:rgba(255,255,255,.32)!important}
html[data-pgi-motion="reduced"] *,html[data-pgi-motion="reduced"] *:before,html[data-pgi-motion="reduced"] *:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html[data-pgi-density="compact"] :where(.panel,.kpi,.cp-panel,.cp-kpis article){padding-block:10px!important}
html[data-pgi-density="compact"] :where(.metric-row,.health-row,.cp-row,td){padding-block:7px!important}
html[data-pgi-text="large"] :where(button,input,select,label,p,small,td,th,.muted,.cp-muted,.cp-row span,.cp-row strong){font-size:max(11px,1em)!important;line-height:1.5!important}
html[data-pgi-text="large"] :where(h1,.cp-intro h1){font-size:clamp(24px,7vw,34px)!important}
html[data-pgi-text="large"] :where(h2,.panel h2,.cp-panel h2){font-size:clamp(16px,4.8vw,21px)!important}
.pp-btn{position:relative}.pp-badge{position:absolute;right:-3px;top:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;display:grid;place-items:center;background:#d96e68;color:white;font:800 9px/1 system-ui}
.pp-dialog{width:min(900px,calc(100vw - 18px));max-height:92dvh;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:20px;background:#15181b;color:#f2f4f6;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden}.pp-dialog::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(5px)}
.pp-shell{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:min(640px,88dvh)}.pp-side{padding:18px 10px;border-right:1px solid rgba(255,255,255,.09);background:#111315}.pp-side h2{margin:0 8px 14px;font-size:16px}.pp-tabs{display:grid;gap:5px}.pp-tabs button{min-height:42px;border:0;border-radius:10px;background:transparent;color:#9aa2aa;text-align:left;padding:0 10px;cursor:pointer}.pp-tabs button[aria-selected="true"]{background:#252a2f;color:#fff}.pp-main{min-width:0;overflow:auto;padding:18px}.pp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.pp-head h3{margin:0;font-size:20px}.pp-close{width:42px;height:42px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:#22262a;color:#fff;font-size:20px;cursor:pointer}.pp-pane[hidden]{display:none!important}.pp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pp-card{padding:14px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:#1b1f23;min-width:0}.pp-card strong,.pp-card span,.pp-card small{display:block}.pp-card span{color:#a7aeb5;font-size:10px}.pp-card strong{margin-top:6px;font-size:15px}.pp-card small{margin-top:5px;color:#7f8790;font-size:9px;line-height:1.45}.pp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.07)}.pp-row:last-child{border-bottom:0}.pp-row label{min-width:0}.pp-row label strong,.pp-row label small{display:block}.pp-row label small{margin-top:4px;color:#818991;font-size:9px;line-height:1.4}.pp-row select,.pp-row button{min-height:42px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#22262a;color:#fff;padding:0 10px}.pp-switch{width:48px;height:28px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#282d32;position:relative;cursor:pointer;flex:0 0 auto}.pp-switch:after{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;border-radius:50%;background:#aab1b7;transition:.18s}.pp-switch[aria-pressed="true"]{background:#315c4a}.pp-switch[aria-pressed="true"]:after{left:23px;background:#d8f6e8}.pp-note{margin:0 0 12px;color:#929aa2;font-size:10px;line-height:1.55}.pp-list{display:grid;gap:7px}.pp-item{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:#1a1d21}.pp-item strong{display:block;font-size:10px}.pp-item p{margin:5px 0 0;color:#969ea6;font-size:9px;line-height:1.45}.pp-item[data-tone="warn"]{border-color:rgba(215,168,92,.25)}.pp-item[data-tone="bad"]{border-color:rgba(217,110,104,.28)}.pp-tour{position:fixed;inset:0;z-index:1000;pointer-events:none}.pp-tour:before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.55)}.pp-tour-card{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(460px,calc(100vw - 20px));pointer-events:auto;padding:15px;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:#171a1e;box-shadow:0 20px 60px rgba(0,0,0,.55)}.pp-tour-card strong{font-size:14px}.pp-tour-card p{color:#a2a9b0;font-size:10px;line-height:1.5}.pp-tour-actions{display:flex;justify-content:space-between;gap:8px}.pp-tour-actions button{min-height:42px;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:#23272c;color:#fff;padding:0 12px}.pp-focus{position:relative;z-index:1001!important;outline:3px solid rgba(238,241,244,.86)!important;outline-offset:4px!important}
@media(max-width:640px){.pp-dialog{width:100vw;height:100dvh;max-height:100dvh;border-radius:0;border:0}.pp-shell{display:block;min-height:100dvh}.pp-side{position:sticky;top:0;z-index:2;padding:9px;border-right:0;border-bottom:1px solid rgba(255,255,255,.1)}.pp-side h2{margin:2px 6px 8px;font-size:14px}.pp-tabs{display:flex;overflow:auto}.pp-tabs button{flex:0 0 auto;min-height:40px;white-space:nowrap}.pp-main{padding:13px}.pp-grid{grid-template-columns:1fr}.pp-row{align-items:flex-start}.pp-row select{max-width:45vw}}
`}
export function dialog(id,title,tabs){
  let d=document.getElementById(id);if(d)return d;
  d=document.createElement("dialog");d.id=id;d.className="pp-dialog";
  d.innerHTML='<div class="pp-shell"><aside class="pp-side"><h2>'+esc(title)+'</h2><div class="pp-tabs">'+tabs.map((x,i)=>'<button type="button" data-pp-tab="'+esc(x.id)+'" aria-selected="'+(i===0)+'">'+esc(x.label)+'</button>').join("")+'</div></aside><section class="pp-main"><div class="pp-head"><h3 data-pp-title>'+esc(tabs[0]?.label||title)+'</h3><button class="pp-close" type="button" aria-label="Fermer">×</button></div>'+tabs.map((x,i)=>'<div class="pp-pane" data-pp-pane="'+esc(x.id)+'" '+(i?"hidden":"")+'></div>').join("")+'</section></div>';
  document.body.appendChild(d);
  const buttons=[...d.querySelectorAll("[data-pp-tab]")];
  buttons.forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.ppTab;buttons.forEach(x=>x.setAttribute("aria-selected",String(x===b)));d.querySelectorAll("[data-pp-pane]").forEach(p=>p.hidden=p.dataset.ppPane!==id);d.querySelector("[data-pp-title]").textContent=b.textContent}));
  d.querySelector(".pp-close").addEventListener("click",()=>d.close());
  d.addEventListener("click",e=>{if(e.target===d)d.close()});
  return d
}
export function pane(d,id){return d.querySelector('[data-pp-pane="'+id+'"]')}
export function setupVitals(onChange){
  const v={lcp:null,cls:0,inp:null};let notify=()=>onChange?.({...v});
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())v.lcp=Math.round(e.startTime);notify()}).observe({type:"largest-contentful-paint",buffered:true})}catch{}
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)v.cls+=e.value;notify()}).observe({type:"layout-shift",buffered:true})}catch{}
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())v.inp=Math.max(v.inp||0,Math.round(e.duration));notify()}).observe({type:"event",buffered:true,durationThreshold:40})}catch{}
  return v
}
export function setupPwa(onState){
  const state={installable:false,standalone:matchMedia("(display-mode: standalone)").matches,update:false,prompt:null,registration:null};
  const emit=()=>onState?.({...state});
  addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.prompt=e;state.installable=true;emit()});
  if("serviceWorker" in navigator)navigator.serviceWorker.getRegistration().then(r=>r||navigator.serviceWorker.register("./service-worker.js")).then(r=>{state.registration=r||null;if(r?.waiting)state.update=true;if(r)r.addEventListener("updatefound",()=>{const w=r.installing;w?.addEventListener("statechange",()=>{if(w.state==="installed"&&navigator.serviceWorker.controller){state.update=true;emit()}})});emit()}).catch(()=>{});
  return {state,install:async()=>{if(!state.prompt)return false;await state.prompt.prompt();state.prompt=null;state.installable=false;emit();return true},check:async()=>{await state.registration?.update();emit()},activate:()=>{state.registration?.waiting?.postMessage({type:"SKIP_WAITING"})}}
}
export function tour(key,steps){
  let i=0,root=null,focused=null;
  const clear=()=>{focused?.classList.remove("pp-focus");focused=null;root?.remove();root=null};
  const render=()=>{focused?.classList.remove("pp-focus");focused=document.querySelector(steps[i].selector);focused?.classList.add("pp-focus");focused?.scrollIntoView({behavior:"smooth",block:"center"});root.querySelector("strong").textContent=steps[i].title;root.querySelector("p").textContent=steps[i].text;root.querySelector("[data-next]").textContent=i===steps.length-1?"Terminer":"Suivant";root.querySelector("[data-count]").textContent=(i+1)+" / "+steps.length};
  const start=()=>{if(root)return;root=document.createElement("div");root.className="pp-tour";root.innerHTML='<div class="pp-tour-card"><small data-count></small><strong></strong><p></p><div class="pp-tour-actions"><button type="button" data-stop>Fermer</button><button type="button" data-next>Suivant</button></div></div>';document.body.appendChild(root);root.querySelector("[data-stop]").onclick=()=>{write(key,{done:true});clear()};root.querySelector("[data-next]").onclick=()=>{if(i>=steps.length-1){write(key,{done:true});clear()}else{i++;render()}};render()};
  return {start,isDone:()=>read(key,{}).done===true}
}

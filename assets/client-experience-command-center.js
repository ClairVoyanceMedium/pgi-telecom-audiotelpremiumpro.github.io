const $=id=>document.getElementById(id);
const nf=(v,d=0)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d}).format(Number(v)||0);
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(Number(v)||0)}catch{return nf(v,2)+" "+c}};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DEFAULTS={calls_below:{enabled:false,threshold:10},abandon_rate_above:{enabled:false,threshold:25},revenue_target:{enabled:false,threshold:100},drop_vs_average:{enabled:false,threshold:30}};
let data=null,prefs={alerts:structuredClone(DEFAULTS)},monthData=null,dialog=null,busy=false,loadedPrefs=false,monthKey="";

function cfg(){return window.PGI_CONFIG||{}}
function demo(){const c=cfg();return c.mode==="demo"||!c.apiBaseUrl}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const raw of String(document.cookie||"").split(";")){const x=raw.trim();if(x.startsWith(p))try{return decodeURIComponent(x.slice(p.length))}catch{return x.slice(p.length)}}return ""}
async function preferenceRequest(method="GET",body){
  const c=cfg(),base=String(c.apiBaseUrl||"").replace(/\/$/,""),headers={Accept:"application/json"};
  if(body)headers["Content-Type"]="application/json";
  if(method!=="GET"){const csrf=cookie("__Host-pgi_customer_csrf");if(csrf)headers["X-CSRF-Token"]=csrf}
  const r=await fetch(base+"/customer/experience/preferences",{method,credentials:"include",cache:"no-store",headers,body:body?JSON.stringify(body):undefined});
  const p=await r.json().catch(()=>null);if(!r.ok){const e=new Error(p?.error?.code||"API_HTTP_"+r.status);e.code=e.message;throw e}return p;
}
function aggregate(x){
  const rows=x?.financial_by_currency||[],currency=x?.tenant?.default_currency||rows[0]?.currency||"EUR";
  let calls=0,connected=0,abandoned=0,billable=0,revenue=0;
  for(const r of rows){calls+=Number(r.calls_total||0);connected+=Number(r.calls_connected||0);abandoned+=Number(r.calls_abandoned||0);billable+=Number(r.billable_seconds||0);if(r.currency===currency)revenue+=Number(r.generated_revenue_ttc||0)}
  const payout=(x?.metric_net_payout_by_currency||[]).filter(r=>r.currency===currency).reduce((a,r)=>a+Number(r.net_payout_ht||0),0);
  return {currency,calls,connected,abandoned,billable,revenue,payout};
}
function isActiveSub(x){return Boolean(x?.billing_summary?.premium_call_access)||(x?.subscriptions||[]).some(s=>s.status==="active"&&(!s.current_period_end||Date.parse(s.current_period_end)>Date.now()))}
function activeNumber(x){return (x?.numbers||[]).some(n=>String(n.assignment_status||n.status)==="active"&&String(n.kyc_status)==="verified")}
function routingReady(x){return (x?.destinations||[]).some(r=>["active","ready","available","enabled"].includes(String(r.status||"").toLowerCase()))}
function openCritical(x){return (x?.service_incidents||[]).some(i=>!["resolved","closed"].includes(i.status)&&["critical","high"].includes(i.severity))}
function style(){
  if($("client-command-center-style"))return;
  const s=document.createElement("style");s.id="client-command-center-style";s.textContent=`
.ccx{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 12px}.ccx-card{min-width:0;padding:15px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.035),rgba(255,255,255,.012));box-shadow:0 14px 32px rgba(0,0,0,.12)}.ccx-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.ccx-kicker{font-size:7px;font-weight:900;letter-spacing:.11em;color:#b7957e}.ccx-card h3{margin:4px 0 0;font-size:14px}.ccx-status{font-size:8px;font-weight:900;border:1px solid var(--line);border-radius:999px;padding:5px 7px;white-space:nowrap}.ccx-status.ok{color:#9ce0c4;border-color:rgba(92,211,157,.28);background:rgba(92,211,157,.06)}.ccx-status.warn{color:#f2ca91;border-color:rgba(231,169,87,.3);background:rgba(231,169,87,.06)}.ccx-status.bad{color:#ffb2ae;border-color:rgba(239,96,90,.3);background:rgba(239,96,90,.06)}.ccx-big{display:block;margin:13px 0 3px;font-size:23px;letter-spacing:-.035em}.ccx-note{margin:0;color:var(--muted);font-size:8px;line-height:1.5}.ccx-list{display:grid;gap:5px;margin-top:10px}.ccx-line{display:flex;justify-content:space-between;gap:8px;font-size:8px}.ccx-line span{color:var(--muted)}.ccx-line b{font-size:8px;text-align:right}.ccx-actions{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}.ccx-btn{min-height:34px}.ccx-alert{padding:8px;border:1px solid rgba(231,169,87,.2);border-radius:10px;background:rgba(231,169,87,.045);font-size:8px;line-height:1.45}.ccx-alert+.ccx-alert{margin-top:6px}.ccx-alert.ok{border-color:rgba(92,211,157,.2);background:rgba(92,211,157,.04)}.ccx-projection{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.ccx-projection div{padding:8px;border:1px solid var(--line);border-radius:9px}.ccx-projection span,.ccx-projection strong{display:block}.ccx-projection span{font-size:7px;color:var(--muted)}.ccx-projection strong{margin-top:4px;font-size:10px}.ccx-steps{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin-top:10px}.ccx-step{position:relative;padding:9px 7px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.015)}.ccx-step strong,.ccx-step span{display:block}.ccx-step strong{font-size:8px}.ccx-step span{margin-top:4px;color:var(--muted);font-size:7px;line-height:1.35}.ccx-step.done{border-color:rgba(92,211,157,.2)}.ccx-step.current{border-color:rgba(231,169,87,.3)}.ccx-dialog{width:min(620px,calc(100vw - 24px));border:1px solid var(--line);border-radius:18px;background:#17110e;color:#f4e9e2;padding:0}.ccx-form{padding:18px}.ccx-form h2{margin:3px 0 5px}.ccx-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.ccx-setting{padding:10px;border:1px solid var(--line);border-radius:11px}.ccx-setting label{display:flex;gap:8px;align-items:flex-start;font-size:9px;font-weight:800}.ccx-setting input[type=number]{width:100%;margin-top:7px}.ccx-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}@media(max-width:1050px){.ccx{grid-template-columns:1fr 1fr}.ccx-steps{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.ccx{grid-template-columns:1fr}.ccx-steps,.ccx-form-grid{grid-template-columns:1fr 1fr}.ccx-card{padding:13px}}@media(max-width:380px){.ccx-steps,.ccx-form-grid,.ccx-projection{grid-template-columns:1fr}}
`;document.head.appendChild(s);
}
function ensure(){
  style();
  if(!$("client-command-center")){
    const root=document.createElement("section");root.id="client-command-center";root.className="ccx";root.setAttribute("aria-label","Centre de commande client");
    document.querySelector(".cp-command-bar")?.insertAdjacentElement("afterend",root);
  }
  if(!$("client-activation-premium")){
    const old=$("client-onboarding");if(old)old.hidden=true;
    const section=document.createElement("section");section.id="client-activation-premium";section.className="cp-panel";section.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">MISE EN SERVICE</p><h2>Mon parcours vers l’activation</h2></div><span id="ccx-activation-badge">Préparation</span></div><p class="cp-muted">Chaque étape correspond à un contrôle interne réel. Le statut opérateur externe ne sera affiché qu’après branchement effectif.</p><div id="ccx-steps" class="ccx-steps"></div>';
    $("client-command-center")?.insertAdjacentElement("afterend",section);
  }
}
function health(x){
  const tenant=x?.tenant||{},sub=isActiveSub(x),num=activeNumber(x),route=routingReady(x),critical=openCritical(x),kyc=tenant.kyc_status==="verified";
  const ready=tenant.status==="active"&&kyc&&sub&&num&&route&&!critical;
  const tone=critical?"bad":ready?"ok":"warn",label=critical?"Attention":ready?"Prêt côté plateforme":"Préparation";
  return {tone,label,ready,items:[["Compte",tenant.status==="active"?"Actif":"En préparation"],["KYC",kyc?"Vérifié":"À finaliser"],["Abonnement",sub?"Actif":"À activer"],["Numéro",num?"Attribué et validé":"En attente"],["Routage local",route?"Configuré":"À configurer"],["Incident critique",critical?"Oui":"Non"]]};
}
function serverDay(x){return String(x?.server_time||new Date().toISOString()).slice(0,10)}
function todayMetrics(x){
  const day=serverDay(x),rows=(x?.series||[]).filter(r=>String(r.bucket_date||r.bucket||"").slice(0,10)===day);
  if(rows.length){return rows.reduce((a,r)=>{a.calls+=Number(r.calls_total||0);a.abandoned+=Number(r.calls_abandoned||0);a.revenue+=Number(r.generated_revenue_ttc||0);return a},{calls:0,abandoned:0,revenue:0})}
  const a=aggregate(x);return {calls:a.calls,abandoned:a.abandoned,revenue:a.revenue};
}
function completedRows(x){
  const day=serverDay(x);return (x?.series||[]).filter(r=>String(r.bucket_date||r.bucket||"").slice(0,10)<day).sort((a,b)=>String(a.bucket_date||a.bucket).localeCompare(String(b.bucket_date||b.bucket)));
}
function evaluateAlerts(x){
  const a=prefs.alerts||DEFAULTS,t=todayMetrics(x),rate=t.calls?t.abandoned/t.calls*100:0,out=[];
  if(a.calls_below?.enabled&&t.calls<Number(a.calls_below.threshold||0))out.push("Activité du jour sous le seuil : "+nf(t.calls)+" appel(s) pour un seuil de "+nf(a.calls_below.threshold)+".");
  if(a.abandon_rate_above?.enabled&&rate>Number(a.abandon_rate_above.threshold||0))out.push("Abandons au-dessus du seuil : "+nf(rate,1)+" %.");
  const currency=x?.tenant?.default_currency||"EUR";
  if(a.revenue_target?.enabled&&t.revenue>=Number(a.revenue_target.threshold||0))out.push("Objectif du jour atteint : "+money(t.revenue,currency)+" de montant service TTC.");
  const done=completedRows(x);if(a.drop_vs_average?.enabled&&done.length>=3){
    const last=done[done.length-1],base=done.slice(Math.max(0,done.length-8),-1),avg=base.reduce((s,r)=>s+Number(r.calls_total||0),0)/Math.max(1,base.length),lv=Number(last.calls_total||0),drop=avg>0?(avg-lv)/avg*100:0;
    if(drop>=Number(a.drop_vs_average.threshold||0))out.push("Baisse d’activité détectée sur le dernier jour complet : "+nf(drop,1)+" % sous la moyenne récente.");
  }
  return out;
}
function renderHealth(x){
  const h=health(x);return '<article class="ccx-card"><div class="ccx-head"><div><div class="ccx-kicker">SANTÉ DU SERVICE</div><h3>État de ma plateforme</h3></div><span class="ccx-status '+h.tone+'">'+esc(h.label)+'</span></div><strong class="ccx-big">'+(h.ready?"Contrôles internes OK":"Actions à vérifier")+'</strong><p class="ccx-note">Ce statut couvre uniquement les contrôles PGI disponibles. Il ne prétend pas mesurer un opérateur non encore connecté.</p><div class="ccx-list">'+h.items.map(i=>'<div class="ccx-line"><span>'+esc(i[0])+'</span><b>'+esc(i[1])+'</b></div>').join("")+'</div></article>';
}
function renderAlerts(x){
  const alerts=evaluateAlerts(x),count=alerts.length;
  return '<article class="ccx-card"><div class="ccx-head"><div><div class="ccx-kicker">MES ALERTES</div><h3>Seuils personnels</h3></div><span class="ccx-status '+(count?"warn":"ok")+'">'+count+' active'+(count>1?"s":"")+'</span></div><div style="margin-top:10px">'+(alerts.length?alerts.map(v=>'<div class="ccx-alert">'+esc(v)+'</div>').join(""):'<div class="ccx-alert ok">Aucune alerte personnalisée déclenchée avec les données disponibles.</div>')+'</div><div class="ccx-actions"><button id="ccx-alert-settings" class="cp-ghost ccx-btn" type="button">Configurer mes seuils</button></div><p class="ccx-note">Pour l’instant, les alertes apparaissent dans le portail. Aucun SMS, e-mail ou push externe n’est branché.</p></article>';
}
function renderProjection(){
  const x=monthData||data;if(!x)return '<article class="ccx-card"><div class="ccx-kicker">PROJECTION</div><h3>Fin de mois</h3><p class="ccx-note">Calcul en préparation.</p></article>';
  const a=aggregate(x),now=new Date(x.server_time||Date.now()),start=new Date(now.getFullYear(),now.getMonth(),1),next=new Date(now.getFullYear(),now.getMonth()+1,1),days=(next-start)/86400000,elapsed=Math.max(.25,(now-start)/86400000),factor=days/elapsed;
  if(!Number.isFinite(factor)||elapsed<.5)return '<article class="ccx-card"><div class="ccx-kicker">PROJECTION</div><h3>Fin de mois</h3><p class="ccx-note">Données encore insuffisantes pour une projection utile.</p></article>';
  return '<article class="ccx-card"><div class="ccx-head"><div><div class="ccx-kicker">PROJECTION</div><h3>Fin de mois</h3></div><span class="ccx-status warn">'+nf(elapsed,1)+' j observés</span></div><div class="ccx-projection"><div><span>Appels projetés</span><strong>'+nf(a.calls*factor)+'</strong></div><div><span>Minutes projetées</span><strong>'+nf(a.billable/60*factor,0)+'</strong></div><div><span>Montant TTC projeté</span><strong>'+money(a.revenue*factor,a.currency)+'</strong></div><div><span>Reversement projeté</span><strong>'+money(a.payout*factor,a.currency)+'</strong></div></div><p class="ccx-note">Projection non contractuelle fondée sur le rythme moyen observé depuis le début du mois. Elle sera recalculée à chaque actualisation.</p></article>';
}
function renderNext(x){
  const h=health(x),next=h.items.find(i=>!["Actif","Vérifié","Attribué et validé","Configuré","Non"].includes(i[1]));
  return '<article class="ccx-card"><div class="ccx-head"><div><div class="ccx-kicker">PROCHAINE ACTION</div><h3>Ce qui mérite votre attention</h3></div><span class="ccx-status '+(h.ready?"ok":"warn")+'">'+(h.ready?"RAS":"À faire")+'</span></div><strong class="ccx-big">'+esc(next?next[0]:"Tout est prêt")+'</strong><p class="ccx-note">'+esc(next?"État actuel : "+next[1]+". Le portail continuera à afficher précisément ce qui manque.":"Les contrôles internes disponibles sont satisfaits. Le futur branchement opérateur restera une étape séparée et explicite.")+'</p></article>';
}
function renderSteps(x){
  const tenant=x?.tenant||{},steps=[
    ["Compte",tenant.status==="active","Compte actif"],
    ["E-mail",x?.user?.email_verified===true,"Adresse vérifiée"],
    ["KYC",tenant.kyc_status==="verified","Identité validée"],
    ["Abonnement",isActiveSub(x),"Accès commercial"],
    ["Numéro",activeNumber(x),"Numéro validé"],
    ["Routage",routingReady(x),"Configuration locale"]
  ],first=steps.findIndex(s=>!s[1]),all=first<0;
  $("ccx-steps").innerHTML=steps.map((s,i)=>'<div class="ccx-step '+(s[1]?"done":i===first?"current":"")+'"><strong>'+(s[1]?"✓ ":"")+esc(s[0])+'</strong><span>'+esc(s[1]?s[2]:(i===first?"Étape actuelle":"En attente"))+'</span></div>').join("");
  $("ccx-activation-badge").textContent=all?"Prêt pour branchement externe":"Préparation interne";
}
function render(x){
  data=x;ensure();$("client-command-center").innerHTML=renderHealth(x)+renderAlerts(x)+renderProjection()+renderNext(x);renderSteps(x);
  $("ccx-alert-settings")?.addEventListener("click",openDialog);
}
function normalize(p){
  const src=p?.alerts||{},out={};
  for(const [k,d] of Object.entries(DEFAULTS)){const r=src[k]||{};out[k]={enabled:r.enabled===true,threshold:Number.isFinite(Number(r.threshold))?Number(r.threshold):d.threshold}}
  return {alerts:out,updated_at:p?.updated_at||null};
}
async function loadPrefs(){
  if(loadedPrefs)return;loadedPrefs=true;
  if(demo()){try{prefs=normalize(JSON.parse(localStorage.getItem("pgi-client-alert-preferences")||"null"))}catch{prefs=normalize(null)};render(data);return}
  try{prefs=normalize(await preferenceRequest());render(data)}catch{prefs=normalize(null)}
}
function monthStartIso(now){const d=new Date(now);return new Date(d.getFullYear(),d.getMonth(),1).toISOString()}
async function loadMonth(x){
  const now=x?.server_time||new Date().toISOString(),key=String(now).slice(0,7);if(monthKey===key&&monthData)return;monthKey=key;
  if(demo()){monthData=x;render(x);return}
  try{monthData=await window.PGICustomerApi.portal(monthStartIso(now),now);render(x)}catch{monthData=x;render(x)}
}
function ensureDialog(){
  if(dialog)return dialog;dialog=document.createElement("dialog");dialog.className="ccx-dialog";dialog.innerHTML='<form id="ccx-alert-form" class="ccx-form"><div class="ccx-kicker">MES ALERTES</div><h2>Configurer mes seuils</h2><p class="ccx-note">Ces règles sont personnelles à votre compte. Elles n’envoient rien vers un fournisseur externe.</p><div class="ccx-form-grid"><div class="ccx-setting"><label><input id="ccx-calls-enabled" type="checkbox"> Activité du jour sous un seuil</label><input id="ccx-calls-value" type="number" min="0" max="1000000" step="1"></div><div class="ccx-setting"><label><input id="ccx-abandon-enabled" type="checkbox"> Abandons au-dessus de (%)</label><input id="ccx-abandon-value" type="number" min="0" max="100" step="1"></div><div class="ccx-setting"><label><input id="ccx-revenue-enabled" type="checkbox"> Objectif TTC du jour atteint</label><input id="ccx-revenue-value" type="number" min="0" max="100000000" step="1"></div><div class="ccx-setting"><label><input id="ccx-drop-enabled" type="checkbox"> Baisse vs moyenne récente (%)</label><input id="ccx-drop-value" type="number" min="0" max="100" step="1"></div></div><p id="ccx-alert-message" class="cp-form-message"></p><div class="ccx-dialog-actions"><button id="ccx-alert-cancel" class="cp-ghost" type="button">Annuler</button><button class="cp-primary" type="submit">Enregistrer</button></div></form>';document.body.appendChild(dialog);
  $("ccx-alert-cancel").addEventListener("click",()=>dialog.close());$("ccx-alert-form").addEventListener("submit",savePrefs);return dialog;
}
function openDialog(){
  const d=ensureDialog(),a=prefs.alerts;[["calls",a.calls_below],["abandon",a.abandon_rate_above],["revenue",a.revenue_target],["drop",a.drop_vs_average]].forEach(([k,v])=>{$("ccx-"+k+"-enabled").checked=v.enabled;$("ccx-"+k+"-value").value=v.threshold});
  $("ccx-alert-message").textContent="";d.showModal?d.showModal():d.setAttribute("open","");
}
async function savePrefs(e){
  e.preventDefault();if(busy)return;busy=true;const msg=$("ccx-alert-message"),payload={alerts:{
    calls_below:{enabled:$("ccx-calls-enabled").checked,threshold:Number($("ccx-calls-value").value||0)},
    abandon_rate_above:{enabled:$("ccx-abandon-enabled").checked,threshold:Number($("ccx-abandon-value").value||0)},
    revenue_target:{enabled:$("ccx-revenue-enabled").checked,threshold:Number($("ccx-revenue-value").value||0)},
    drop_vs_average:{enabled:$("ccx-drop-enabled").checked,threshold:Number($("ccx-drop-value").value||0)}
  }};
  try{
    if(demo()){localStorage.setItem("pgi-client-alert-preferences",JSON.stringify(payload));prefs=normalize(payload)}
    else prefs=normalize(await preferenceRequest("PUT",payload));
    dialog.close();render(data);
  }catch(err){msg.textContent="Enregistrement impossible : "+(err?.code||"ERREUR")}
  finally{busy=false}
}
document.addEventListener("pgi:portal-loaded",e=>{const x=e.detail?.data||{};render(x);loadPrefs();loadMonth(x)});
if(window.PGIClientPortalData){render(window.PGIClientPortalData);loadPrefs();loadMonth(window.PGIClientPortalData)}

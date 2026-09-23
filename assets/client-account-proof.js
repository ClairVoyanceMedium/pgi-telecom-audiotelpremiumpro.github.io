const $=id=>document.getElementById(id);
let current=null,loadedReceipts=false,busy=false;
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function nf(v,d=0){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d}).format(n(v))}
function money(v,c="EUR"){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:2}).format(n(v))}catch{return nf(v,2)+" "+c}}
function dt(v){const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d):"—"}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const x=part.trim();if(x.startsWith(p))try{return decodeURIComponent(x.slice(p.length))}catch{return x.slice(p.length)}}return ""}
function apiBase(){const c=window.PGI_CONFIG||{};return String(c.apiBaseUrl||"").replace(/\/$/,"")}
function demo(){const c=window.PGI_CONFIG||{};return c.mode==="demo"||!c.apiBaseUrl}
function key(){return crypto?.randomUUID?crypto.randomUUID():"receipt-"+Date.now().toString(36)}
async function call(path,opt={}){
  const method=opt.method||"GET",headers={Accept:"application/json"};
  if(opt.body)headers["Content-Type"]="application/json";
  if(opt.key)headers["Idempotency-Key"]=opt.key;
  if(method!=="GET"){const csrf=cookie("__Host-pgi_customer_csrf");if(csrf)headers["X-CSRF-Token"]=csrf}
  const r=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:opt.body?JSON.stringify(opt.body):undefined});
  const p=await r.json().catch(()=>null);if(!r.ok){const e=new Error(p?.error?.code||"API_HTTP_"+r.status);e.code=e.message;throw e}return p;
}
function style(){
 if($("client-account-proof-style"))return;
 const s=document.createElement("style");s.id="client-account-proof-style";s.textContent=
 ".cp-product-lockup{display:grid;gap:2px;min-width:max-content}.cp-product-lockup strong{font-size:17px;line-height:1;color:#f7ede5;letter-spacing:-.02em}.cp-product-lockup span{font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#d7a76a}.cp-product-lockup small{font-size:8px;color:#a88d79}.cp-number-memory{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;margin:0 0 12px;padding:16px 18px;border:1px solid rgba(215,167,106,.34);border-radius:17px;background:linear-gradient(135deg,rgba(215,167,106,.18),rgba(71,44,32,.82));box-shadow:0 18px 45px rgba(28,13,7,.18)}.cp-number-memory span,.cp-number-memory small,.cp-number-memory strong{display:block}.cp-number-memory span{font-size:8px;font-weight:900;letter-spacing:.12em;color:#c6a78e}.cp-number-memory strong{margin-top:5px;font-size:clamp(25px,4vw,38px);letter-spacing:.04em;color:#fff8f1}.cp-number-memory small{margin-top:5px;color:#cbb7a7;font-size:8px}.cp-number-copy{min-height:44px}.cp-proof-card{margin:0 0 12px}.cp-proof-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:10px 0}.cp-proof-grid div{padding:10px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.018)}.cp-proof-grid span,.cp-proof-grid strong{display:block}.cp-proof-grid span{font-size:7px;color:var(--muted);text-transform:uppercase}.cp-proof-grid strong{margin-top:5px;font-size:13px}.cp-proof-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cp-proof-ref{padding:8px 10px;border:1px solid rgba(103,199,155,.22);border-radius:9px;background:rgba(103,199,155,.06);font-size:8px;color:#b8e4ce}.cp-proof-note{margin:9px 0 0;color:var(--muted);font-size:8px;line-height:1.5}.cp-product-lockup-header{padding-right:12px;border-right:1px solid var(--line)}@media(max-width:760px){.cp-brand{flex-wrap:wrap}.cp-product-lockup-header{order:2;border-right:0;padding-right:0}.cp-company-title{order:3;flex-basis:100%}.cp-number-memory{grid-template-columns:1fr}.cp-number-copy{width:100%}.cp-proof-grid{grid-template-columns:1fr 1fr}}@media(max-width:380px){.cp-proof-grid{grid-template-columns:1fr}.cp-product-lockup strong{font-size:15px}}@media print{.cp-number-copy,#cp-proof-create{display:none!important}.cp-number-memory{background:#fff!important;color:#111!important;border-color:#aaa!important;box-shadow:none!important}.cp-number-memory *{color:#111!important}}";
 document.head.appendChild(s);
}
function ensure(){
 style();
 if(!$("client-number-memory")){const intro=document.querySelector(".cp-intro"),el=document.createElement("section");el.id="client-number-memory";el.className="cp-number-memory";el.hidden=true;el.innerHTML='<div><span>VOTRE NUMÉRO AUDIOTEL VALIDÉ</span><strong id="client-number-memory-value">—</strong><small id="client-number-memory-meta">Attribué et validé</small></div><button id="client-number-copy" class="cp-ghost cp-number-copy" type="button">Copier le numéro</button>';intro?.insertAdjacentElement("afterend",el);$("client-number-copy")?.addEventListener("click",copyNumber)}
 if(!$("client-consumption-proof")){const bar=document.querySelector(".cp-command-bar"),el=document.createElement("section");el.id="client-consumption-proof";el.className="cp-panel cp-proof-card";el.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">RELEVÉ DE CONTRÔLE</p><h2>Vérifier les chiffres de mon tableau de bord</h2></div><span id="cp-proof-period">Période affichée</span></div><div id="cp-proof-grid" class="cp-proof-grid"></div><div class="cp-proof-actions"><button id="cp-proof-create" class="cp-ghost" type="button">Créer un relevé horodaté</button><span id="cp-proof-ref" class="cp-proof-ref">Aucun relevé créé</span></div><p class="cp-proof-note">Le relevé fige les agrégats visibles et leur période exacte avec une empreinte SHA‑256. Il ne contient aucun numéro d’appelant ni donnée de carte.</p>';bar?.insertAdjacentElement("afterend",el);$("cp-proof-create")?.addEventListener("click",createReceipt)}
}
function aggregate(data){
 const rows=data?.financial_by_currency||[],currency=data?.tenant?.default_currency||rows[0]?.currency||"EUR";
 let calls=0,connected=0,billable=0;for(const x of rows){calls+=n(x.calls_total);connected+=n(x.calls_connected);billable+=n(x.billable_seconds)}
 const revenue=rows.filter(x=>x.currency===currency).reduce((a,x)=>a+n(x.generated_revenue_ttc),0);
 const payout=(data?.metric_net_payout_by_currency||[]).filter(x=>x.currency===currency).reduce((a,x)=>a+n(x.net_payout_ht),0);
 return {currency,calls,connected,billable,revenue,payout};
}
function renderCurrent(){
 ensure();if(!current)return;
 const valid=(current.numbers||[]).filter(x=>String(x.assignment_status||x.status)==="active"&&String(x.kyc_status)==="verified");
 const card=$("client-number-memory");
 if(valid.length){const p=valid[0];card.hidden=false;$("client-number-memory-value").textContent=p.display_number||p.e164;$("client-number-memory-value").dataset.copy=p.display_number||p.e164;$("client-number-memory-meta").textContent="Attribué et validé"+(valid.length>1?" · "+(valid.length-1)+" autre(s) ligne(s) validée(s)":"")+" · conservez-le comme référence";}
 else card.hidden=true;
 const a=aggregate(current),g=$("cp-proof-grid");g.innerHTML='<div><span>Appels</span><strong>'+nf(a.calls)+'</strong></div><div><span>Minutes facturables</span><strong>'+nf(a.billable/60,1)+'</strong></div><div><span>Montant TTC</span><strong>'+esc(money(a.revenue,a.currency))+'</strong></div><div><span>Reversement validé</span><strong>'+esc(money(a.payout,a.currency))+'</strong></div>';
 $("cp-proof-period").textContent=current.range?dt(current.range.from)+" → "+dt(current.range.to):"Période affichée";
}
async function copyNumber(){const v=$("client-number-memory-value")?.dataset.copy||"",b=$("client-number-copy");if(!v||!b)return;try{await navigator.clipboard.writeText(v);b.textContent="Copié"}catch{b.textContent="Copie impossible"}finally{setTimeout(()=>b.textContent="Copier le numéro",1600)}}
function showReceipt(r,prefix="Relevé"){if(!r)return;$("cp-proof-ref").textContent=prefix+" "+(r.reference||"")+" · "+dt(r.created_at)+" · SHA "+String(r.snapshot_sha256||"").slice(0,12)}
async function loadReceipts(){if(demo()||loadedReceipts)return;loadedReceipts=true;try{const r=await call("/customer/consumption-receipts");if(r.data?.[0])showReceipt(r.data[0],"Dernier relevé")}catch{}}
async function createReceipt(){
 if(busy||!current?.range)return;
 if(demo()){showReceipt({reference:"DEMO",created_at:new Date().toISOString(),snapshot_sha256:"demonstration-non-enregistree"},"Démonstration");return}
 busy=true;const b=$("cp-proof-create"),old=b.textContent;b.disabled=true;b.textContent="Création…";
 try{const r=await call("/customer/consumption-receipts",{method:"POST",body:{from:current.range.from,to:current.range.to},key:key()});showReceipt(r,"Relevé");}
 catch(e){$("cp-proof-ref").textContent="Création impossible : "+e.code}
 finally{busy=false;b.disabled=false;b.textContent=old}
}
function onData(data){current=data;renderCurrent();loadReceipts()}
document.addEventListener("pgi:portal-loaded",e=>onData(e.detail?.data||{}));
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{ensure();if(window.PGIClientPortalData)onData(window.PGIClientPortalData)},{once:true});else{ensure();if(window.PGIClientPortalData)onData(window.PGIClientPortalData)}

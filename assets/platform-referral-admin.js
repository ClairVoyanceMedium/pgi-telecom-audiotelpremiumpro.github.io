const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const date=v=>{if(!v)return"Non disponible";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"Non disponible"};
let state=null,busy=false;

function ensure(){
 if($("referral-admin-dialog"))return $("referral-admin-dialog");
 const style=document.createElement("style");style.id="referral-admin-style";style.textContent=".ra-dialog{width:min(820px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 24px);padding:0;border:1px solid rgba(194,151,91,.25);border-radius:20px;background:#07101b;color:#e8f1f6}.ra-dialog::backdrop{background:rgba(0,0,0,.76);backdrop-filter:blur(8px)}.ra-head{display:flex;justify-content:space-between;gap:14px;padding:17px 18px;border-bottom:1px solid rgba(128,158,192,.12)}.ra-head p{margin:0 0 4px;color:#d8b17b;font-size:8px;font-weight:900;letter-spacing:.08em}.ra-head h2{margin:0;font-size:20px}.ra-close{width:42px;height:42px;border:1px solid rgba(128,158,192,.18);border-radius:12px;background:#0a1421;color:#dce8f1;font-size:20px}.ra-body{max-height:calc(100dvh - 95px);overflow:auto;padding:16px}.ra-feedback{min-height:18px;color:#8097aa;font-size:11px}.ra-feedback.ok{color:#8de4c6}.ra-feedback.error{color:#ff9d9d}.ra-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.ra-kpi{padding:11px;border:1px solid rgba(128,158,192,.11);border-radius:12px;background:#0a1421}.ra-kpi span{display:block;color:#7d92a6;font-size:9px}.ra-kpi strong{display:block;margin-top:5px;font-size:15px}.ra-card{margin-top:12px;padding:14px;border:1px solid rgba(128,158,192,.11);border-radius:14px;background:rgba(10,18,30,.88)}.ra-card h3{margin:0 0 10px;font-size:14px}.ra-fields{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:end}.ra-field{display:grid;gap:5px;color:#7d92a6;font-size:9px;font-weight:850;text-transform:uppercase}.ra-field input{min-height:42px;padding:8px 10px;border:1px solid rgba(128,158,192,.16);border-radius:10px;background:#06101a;color:#eef7fb;font-size:15px}.ra-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.ra-btn{min-height:41px;padding:8px 12px;border:1px solid rgba(53,216,255,.22);border-radius:10px;background:rgba(53,216,255,.06);color:#def8ff;font-size:10px;font-weight:850;cursor:pointer}.ra-btn.success{border-color:rgba(34,211,165,.28);color:#9ceaca}.ra-btn.danger{border-color:rgba(239,68,68,.3);color:#ffb0b0}.ra-btn:disabled{opacity:.4}.ra-note{color:#8195a7;font-size:11px;line-height:1.55}.ra-list{display:grid;gap:7px}.ra-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;padding:10px;border:1px solid rgba(128,158,192,.09);border-radius:11px}.ra-row strong{display:block;font-size:11px}.ra-row small{display:block;margin-top:4px;color:#7c91a4;font-size:9px}.ra-badge{display:inline-flex;align-items:center;padding:5px 8px;border:1px solid rgba(128,158,192,.18);border-radius:999px;color:#a7b9c7;font-size:8px;font-weight:900}.ra-badge.ok{border-color:rgba(34,211,165,.28);color:#9ceaca}.ra-badge.warn{border-color:rgba(245,158,11,.28);color:#ffd28a}@media(max-width:700px){.ra-dialog{width:100vw;max-height:92dvh;margin:auto 0 0;border-radius:22px 22px 0 0}.ra-grid{grid-template-columns:1fr 1fr}.ra-fields{grid-template-columns:1fr}.ra-body{padding:11px}}";
 document.head.appendChild(style);
 const d=document.createElement("dialog");d.id="referral-admin-dialog";d.className="ra-dialog";d.innerHTML='<header class="ra-head"><div><p>ACQUISITION CLIENT</p><h2>Pilotage du parrainage</h2></div><button class="ra-close" type="button" aria-label="Fermer">×</button></header><main id="referral-admin-body" class="ra-body"></main>';document.body.appendChild(d);
 d.querySelector(".ra-close").addEventListener("click",()=>d.close());d.addEventListener("click",e=>{if(e.target===d)d.close()});d.addEventListener("click",handle);return d;
}
function feedback(message,type=""){const e=$("referral-admin-feedback");if(e){e.textContent=message||"";e.className="ra-feedback "+type}}
async function load(){
 const body=$("referral-admin-body");if(!body)return;body.innerHTML='<p class="ra-note">Chargement du programme…</p>';
 try{state=await window.PGIApi.referralProgram();render()}catch(e){body.innerHTML='<p class="ra-note">Pilotage indisponible : '+esc(e.code||"erreur API")+'.</p>'}
}
function render(){
 const body=$("referral-admin-body");if(!body||!state)return;
 const cfg=state.configuration||{},m=state.metrics||{},rows=state.recent_rewards||[],currency=cfg.currency||"EUR";
 const list=rows.map(x=>{const status=String(x.status||"earned"),action=status==="earned"?'<button class="ra-btn success" data-referral-paid="'+esc(x.public_id)+'">Enregistrer le règlement</button>':'<span class="ra-badge '+(status==="paid"?"ok":"warn")+'">'+esc(status.toUpperCase())+'</span>';return '<div class="ra-row"><div><strong>'+esc(x.dossier_ref||x.tenant_name||"Client")+' : '+money(x.amount_minor,x.currency)+'</strong><small>'+esc(date(x.earned_at))+(x.paid_reference?' : réf. '+esc(x.paid_reference):'')+'</small></div>'+action+'</div>'}).join("");
 body.innerHTML='<p id="referral-admin-feedback" class="ra-feedback" role="status"></p><div class="ra-grid"><div class="ra-kpi"><span>Programme</span><strong>'+(state.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div class="ra-kpi"><span>Prime future</span><strong>'+money(cfg.reward_minor||0,currency)+'</strong></div><div class="ra-kpi"><span>Parrainages</span><strong>'+Number(m.total||0)+'</strong></div><div class="ra-kpi"><span>Primes acquises</span><strong>'+money(m.earned_minor||0,currency)+'</strong></div></div><section class="ra-card"><h3>Règle commerciale</h3><div class="ra-fields"><label class="ra-field">Prime par filleul réellement payé<input id="referral-admin-reward" type="number" min="0.01" max="1000" step="0.01" value="'+((Number(cfg.reward_minor||0)/100)||0).toFixed(2)+'"></label><button class="ra-btn" data-referral-save>Enregistrer la prime future</button></div><div class="ra-actions"><button class="ra-btn '+(state.enabled?"danger":"success")+'" data-referral-toggle="'+(state.enabled?"0":"1")+'">'+(state.enabled?"Désactiver les nouveaux parrainages":"Activer le parrainage")+'</button><button class="ra-btn" data-referral-refresh>Actualiser</button></div><p class="ra-note">La prime est figée au dépôt de la demande avec un code valide. Elle devient acquise uniquement après confirmation serveur d’un abonnement actif et d’une facture payée. Une désactivation bloque les nouveaux parrainages sans annuler les droits déjà enregistrés. Aucun virement n’est déclenché automatiquement.</p></section><section class="ra-card"><h3>Primes à rapprocher</h3><div class="ra-list">'+(list||'<p class="ra-note">Aucune prime à rapprocher.</p>')+'</div></section>';
}
async function handle(e){
 if(busy)return;
 if(e.target.closest("[data-referral-refresh]")){await load();return}
 const paid=e.target.closest("[data-referral-paid]");
 if(paid){
  const reference=prompt("Référence du règlement réellement effectué :","");if(!reference||String(reference).trim().length<3)return;
  if(!confirm("Confirmer l'enregistrement de ce règlement ? Cette action trace le paiement mais ne déclenche aucun virement."))return;
  busy=true;feedback("Enregistrement du règlement…");
  try{await window.PGIApi.markReferralRewardPaid(paid.dataset.referralPaid,{reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());busy=false;feedback("Règlement enregistré.","ok");await load()}catch(err){busy=false;feedback(err.code||"Enregistrement impossible","error")}return;
 }
 if(e.target.closest("[data-referral-save]")){
  const amount=Math.round((Number($("referral-admin-reward")?.value)||0)*100),currency=state?.configuration?.currency||"EUR";
  if(!Number.isInteger(amount)||amount<1||amount>100000)return feedback("Prime invalide.","error");
  if(!confirm("Enregistrer "+money(amount,currency)+" pour les futurs parrainages uniquement ? Les parrainages déjà déposés gardent leur montant d'origine."))return;
  busy=true;feedback("Mise à jour…");try{await window.PGIApi.updateReferralProgram({enabled:Boolean(state?.enabled),reward_minor:amount,currency},window.PGIApi.newIdempotencyKey());busy=false;feedback("Prime future enregistrée.","ok");await load()}catch(err){busy=false;feedback(err.code||"Mise à jour impossible","error")}return;
 }
 const toggle=e.target.closest("[data-referral-toggle]");
 if(toggle){
  const enable=toggle.dataset.referralToggle==="1",amount=Math.round((Number($("referral-admin-reward")?.value)||0)*100),currency=state?.configuration?.currency||"EUR";
  if(enable&&(!Number.isInteger(amount)||amount<1||amount>100000))return feedback("Définissez une prime valide avant activation.","error");
  const message=enable?"Activer le parrainage avec une prime de "+money(amount,currency)+" par filleul réellement payé ?":"Désactiver immédiatement les nouveaux parrainages ? Les attributions déjà enregistrées et les primes acquises seront conservées.";
  if(!confirm(message))return;busy=true;feedback(enable?"Activation…":"Désactivation…");
  try{await window.PGIApi.updateReferralProgram({enabled:enable,reward_minor:amount||Number(state?.configuration?.reward_minor||0),currency},window.PGIApi.newIdempotencyKey());busy=false;feedback(enable?"Parrainage activé.":"Nouveaux parrainages désactivés.","ok");await load()}catch(err){busy=false;feedback(err.code||"Modification impossible","error")}
 }
}
export async function open(){const d=ensure();if(!d.open)d.showModal();await load()}

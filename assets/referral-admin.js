const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const date=v=>{if(!v)return"N/D";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"N/D"};
let busy=false,ctx=null;
function feedback(msg,type=""){ctx?.feedback?.(msg,type)}
function render(data){
  const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[];
  root.hidden=false;
  const rows=rewards.slice(0,30).map(x=>'<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+money(x.amount_minor,x.currency||"EUR")+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · '+esc(x.status||"earned")+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>').join("");
  root.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PARRAINAGE CLIENTS</p><h2>Programme et récompenses</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div><div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Prime</span><strong>'+money(data?.reward_minor||0,data?.currency||"EUR")+'</strong></div><div><span>Demandes</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Qualifiées</span><strong>'+esc(summary.rewarded||0)+'</strong></div></div><label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label><label class="pa-field">Prime par filleul qualifié en EUR<input id="pa-referral-reward" type="number" min="0" max="10000" step="0.01" value="'+esc(((Number(data?.reward_minor)||0)/100).toFixed(2))+'"></label><div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer</button></div><p class="pa-note">La désactivation bloque les nouveaux parrainages. Les parrainages déjà enregistrés restent historisés avec leur prime figée. Une prime devient acquise uniquement après abonnement actif et payé du filleul. Enregistrer un versement ne déclenche aucun virement : cela consigne un paiement déjà effectué.</p><div class="pa-list">'+(rows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>';
}
async function load(){
  if(!ctx?.root||!window.PGIApi?.referralProgram)return;
  ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du parrainage...</p>';
  try{render(await window.PGIApi.referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Parrainage indisponible : '+esc(err?.code||"erreur")+'</p>'}
}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true",amount=Number(document.getElementById("pa-referral-reward")?.value);
    if(!Number.isFinite(amount)||amount<0||amount>10000)return feedback("Prime de parrainage invalide.","error");
    if(enabled&&amount<=0)return feedback("Une prime positive est requise pour activer le programme.","error");
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme avec une prime de "+amount.toFixed(2)+" EUR par filleul qualifié ?"))return;
    busy=true;feedback("Mise à jour du parrainage...");
    try{await window.PGIApi.updateReferralProgram({enabled,reward_minor:Math.round(amount*100),currency:"EUR"},window.PGIApi.newIdempotencyKey());feedback("Programme de parrainage mis à jour.","ok");await load()}
    catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement déjà effectué au parrain :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette prime a déjà été versée et enregistrer la référence ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{await window.PGIApi.settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré.","ok");await load()}
    catch(err){feedback(err?.code||"Enregistrement impossible","error")}finally{busy=false}
  }
}
export async function open(options={}){
  if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});
  ctx=options;
  if(!ctx.root.dataset.referralBound){ctx.root.dataset.referralBound="1";ctx.root.addEventListener("click",handle)}
  await load();
}

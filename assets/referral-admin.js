const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const date=v=>{if(!v)return"N/D";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"N/D"};
let busy=false,ctx=null;
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return b}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.indexOf(p)===0){try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}}return""}
async function request(path,method="GET",body=null,key=""){
  const headers={"Accept":"application/json"};if(body!==null)headers["Content-Type"]="application/json";const csrf=cookie("__Host-pgi_csrf");if(csrf&&method!=="GET")headers["X-CSRF-Token"]=csrf;if(key)headers["Idempotency-Key"]=key;
  const res=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:body===null?undefined:JSON.stringify(body)}),payload=await res.json().catch(()=>null);
  if(!res.ok){const e=new Error(payload?.error?.code||"API_HTTP_"+res.status);e.code=payload?.error?.code||"API_HTTP_"+res.status;e.status=res.status;throw e}return payload;
}
const referralProgram=()=>request("/platform/referral-program");
const updateReferralProgram=(payload,key)=>request("/platform/referral-program","POST",payload,key);
const settleReferralReward=(id,payload,key)=>request("/platform/referral-rewards/"+encodeURIComponent(id)+"/paid","POST",payload,key);
function feedback(msg,type=""){ctx?.feedback?.(msg,type)}
function tierLabel(x){
  const range=x.to==null?x.from+" et +":x.from===x.to?String(x.from):x.from+" à "+x.to;
  return range+" filleul(s) qualifié(s) : "+money(x.reward_minor)+" par filleul";
}
function statusLabel(v){return({claimed:"EN VALIDATION",qualified:"QUALIFIÉ",rewarded:"RÉCOMPENSÉ",rejected:"REJETÉ"})[v]||String(v||"").toUpperCase()}
function render(data){
  const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],referrals=Array.isArray(data?.referrals)?data.referrals:[],schedule=Array.isArray(data?.schedule)?data.schedule:[],milestones=Array.isArray(data?.milestones)?data.milestones:[];
  root.hidden=false;
  const tierCards=schedule.map(x=>'<div class="pa-row"><div><strong>'+esc(tierLabel(x))+'</strong><small>Montant fixe et non modifiable.</small></div><span class="pa-badge ok">FIXE</span></div>').join("");
  const milestoneCards=milestones.map(x=>'<span class="pa-badge ok">N° '+esc(x.ordinal)+' : bonus +'+esc(money(x.bonus_minor))+'</span>').join(" ");
  const referralRows=referrals.map(x=>{
    const paid=Math.max(0,Math.min(Number(data?.qualification_paid_months||3),Number(x.paid_months||0))),need=Number(data?.qualification_paid_months||3);
    const progress=x.status==="rewarded"?"Qualification atteinte":paid+"/"+need+" mensualité(s) encaissée(s)";
    const reward=Number(x.reward_minor)>0?money(x.reward_minor,x.reward_currency||"EUR"):"Calcul automatique au rang de qualification";
    return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' → '+esc(x.referred_name||"Filleul")+'</strong><small>'+esc(progress)+' · '+esc(reward)+' · demande '+esc(date(x.claimed_at))+'</small></div><span class="pa-badge '+(x.status==="rewarded"?"ok":"")+'">'+esc(statusLabel(x.status))+'</span></div>';
  }).join("");
  const rewardRows=rewards.map(x=>'<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+money(x.amount_minor,x.currency||"EUR")+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>').join("");
  root.innerHTML=
    '<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PARRAINAGE CLIENTS</p><h2>Programme ambassadeur</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Qualification</span><strong>'+esc(data?.qualification_paid_months||3)+' mensualités</strong></div><div><span>Filleuls enregistrés</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Filleuls récompensés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>Primes à payer</span><strong>'+esc(money(summary.payable_minor||0))+'</strong></div><div><span>Primes payées</span><strong>'+esc(money(summary.paid_minor||0))+'</strong></div></div>'+
    '<label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
    '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’activation</button></div>'+
    '<p class="pa-note">Le barème est verrouillé dans le moteur serveur. Il ne peut pas être modifié depuis le cockpit. Un filleul devient qualifié uniquement après '+esc(data?.qualification_paid_months||3)+' mensualités d’abonnement distinctes réellement encaissées.</p>'+
    '<div class="pa-list"><div class="pa-head" style="padding:12px 0 6px;border:0"><div><p>BARÈME FIXE</p><h2>Récompense par rang qualifié</h2></div></div>'+tierCards+'<div style="padding:10px 0">'+milestoneCards+'</div><p class="pa-note">Bonus de palier ajoutés à la prime normale : 1er filleul +5 €, 5e +20 €, 10e +50 €. À partir du 25e filleul qualifié, la prime de base reste définitivement fixée à 20 € par filleul.</p></div>'+
    '<div class="pa-list"><div class="pa-head" style="padding:14px 0 6px;border:0"><div><p>VALIDATION</p><h2>Filleuls et progression des 3 mensualités</h2></div></div>'+(referralRows||'<p class="pa-note">Aucun filleul enregistré.</p>')+'</div>'+
    '<div class="pa-list"><div class="pa-head" style="padding:14px 0 6px;border:0"><div><p>RÈGLEMENTS</p><h2>Primes acquises</h2></div></div>'+(rewardRows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>';
}
async function load(){
  if(!ctx?.root)return;
  ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du parrainage...</p>';
  try{render(await referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Parrainage indisponible : '+esc(err?.code||"erreur")+'</p>'}
}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme ambassadeur avec son barème fixe ?"))return;
    busy=true;feedback("Mise à jour du parrainage...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme de parrainage mis à jour.","ok");await load()}
    catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement déjà effectué au parrain :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette prime a déjà été versée et enregistrer la référence ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{await settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré.","ok");await load()}
    catch(err){feedback(err?.code||"Enregistrement impossible","error")}finally{busy=false}
  }
}
export async function open(options={}){
  if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});
  ctx=options;
  if(!ctx.root.dataset.referralBound){ctx.root.dataset.referralBound="1";ctx.root.addEventListener("click",handle)}
  await load();
}

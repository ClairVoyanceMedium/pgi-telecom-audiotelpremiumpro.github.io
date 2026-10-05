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
function tiersHtml(data){
  const tiers=Array.isArray(data?.tiers)?data.tiers:[];
  return tiers.map(t=>'<div class="pa-row"><div><strong>'+esc(t.label||((t.from||1)+" à "+(t.to||"+")))+' filleuls qualifiés : '+esc(money(t.reward_minor,data.currency||"EUR"))+' par filleul</strong><small>Barème fixe serveur. '+(t.to==null?'À partir du 25e filleul, ce montant reste permanent et non négociable.':'')+'</small></div><span class="pa-badge ok">FIXE</span></div>').join("");
}
function milestonesHtml(data){
  const rows=Array.isArray(data?.milestones)?data.milestones:[];
  return rows.map(x=>'<div class="pa-row"><div><strong>'+esc(x.label||("Filleul n°"+x.ordinal))+' : bonus '+esc(money(x.bonus_minor,data.currency||"EUR"))+'</strong><small>Le bonus s’ajoute automatiquement à la prime de palier lors de la qualification.</small></div><span class="pa-badge ok">AUTO</span></div>').join("");
}
function render(data){
  const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],currency=data?.currency||"EUR";
  root.hidden=false;
  const rows=rewards.slice(0,50).map(x=>{
    const meta=x.referral_metadata&&typeof x.referral_metadata==="object"?x.referral_metadata:{};
    const base=Number(meta.base_reward_minor||0),bonus=Number(meta.milestone_bonus_minor||0),ordinal=Number(meta.qualification_ordinal||0);
    const detail=(ordinal?'Filleul qualifié n°'+ordinal+' · ':'')+(base?'prime '+money(base,x.currency||currency):'')+(bonus?' + bonus '+money(bonus,x.currency||currency):'');
    return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+money(x.amount_minor,x.currency||currency)+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · '+(detail||'barème automatique')+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>';
  }).join("");
  root.innerHTML=
    '<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PARRAINAGE CLIENTS</p><h2>Programme ambassadeur</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Visites liens</span><strong>'+esc(summary.visits||0)+'</strong></div><div><span>Demandes</span><strong>'+esc(summary.prospects||0)+'</strong></div><div><span>Qualification</span><strong>'+esc(data?.qualification_paid_invoices||3)+' PAIEMENTS</strong></div><div><span>Parrainages enregistrés</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Filleuls qualifiés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>Primes à verser</span><strong>'+money(summary.earned_unpaid_minor||0,currency)+'</strong></div><div><span>Primes versées</span><strong>'+money(summary.paid_minor||0,currency)+'</strong></div></div>'+
    '<label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
    '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’état du programme</button></div>'+
    '<p class="pa-note"><strong>Règle de qualification :</strong> une récompense devient acquise uniquement après 3 factures mensuelles distinctes réellement payées par le filleul. La désactivation bloque les nouveaux parrainages, sans supprimer l’historique ni les récompenses déjà acquises.</p>'+
    '<div class="pa-list"><div class="pa-head"><div><p>BARÈME FIXE</p><h2>Prime par filleul qualifié</h2></div></div>'+tiersHtml(data)+'</div>'+
    '<div class="pa-list"><div class="pa-head"><div><p>BONUS FIXES</p><h2>Paliers ambassadeur</h2></div></div>'+milestonesHtml(data)+'</div>'+
    '<p class="pa-note">Barème fixe : 20,00 € par filleul dès le 25e, sans commission sur le chiffre d’affaires SVA.</p>'+
    '<div class="pa-list"><div class="pa-head"><div><p>RÉCOMPENSES ACQUISES</p><h2>Versements à suivre</h2></div></div>'+(rows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>';
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
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme de parrainage avec le barème fixe en vigueur ?"))return;
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

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
function tierLabel(t){
  const range=t.max==null?"À partir du "+t.min+"e":t.min===t.max?String(t.min):t.min+" à "+t.max;
  return '<div class="pa-row"><div><strong>'+esc(range)+' filleul(s) qualifié(s)</strong><small>Récompense de base par nouveau filleul qualifié à ce rang</small></div><span class="pa-badge ok">'+esc(money(t.reward_minor,"EUR"))+'</span></div>';
}
function bonusLabel(b){
  return '<div class="pa-row"><div><strong>'+esc(b.rank)+'e filleul qualifié</strong><small>Bonus de palier ajouté à la récompense de base</small></div><span class="pa-badge">+'+esc(money(b.bonus_minor,"EUR"))+'</span></div>';
}
function render(data){
  const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],tiers=Array.isArray(data?.tiers)?data.tiers:[],bonuses=Array.isArray(data?.milestone_bonuses)?data.milestone_bonuses:[];
  const pendingRewards=rewards.filter(x=>x.status==="earned"),pendingMinor=pendingRewards.reduce((n,x)=>n+Number(x.amount_minor||0),0);
  root.hidden=false;
  const rows=rewards.slice(0,30).map(x=>{
    const meta=x.metadata||{},rank=Number(meta.rank||0),base=Number(meta.base_reward_minor||0),bonus=Number(meta.milestone_bonus_minor||0);
    const breakdown=rank?("Rang "+rank+" · base "+money(base,x.currency||"EUR")+(bonus?" · bonus "+money(bonus,x.currency||"EUR"):"")):"Barème historique";
    return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+money(x.amount_minor,x.currency||"EUR")+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · '+esc(breakdown)+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versement enregistré le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer le versement</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>';
  }).join("");
  root.innerHTML=
    '<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>AMBASSADEURS</p><h2>Programme et récompenses</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Barème</span><strong>FIXE</strong></div><div><span>Parrainages</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Qualifiés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>À payer</span><strong>'+esc(money(pendingMinor,"EUR"))+'</strong></div></div>'+
    '<label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
    '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’activation</button></div>'+
    '<p class="pa-note">Le barème est verrouillé côté serveur et ne peut pas être négocié ni modifié depuis le cockpit. Un filleul est qualifié uniquement après 3 mensualités réellement encaissées. La désactivation bloque les nouveaux parrainages, sans effacer les récompenses et historiques déjà acquis.</p>'+
    '<div class="pa-list"><div class="pa-head" style="padding:12px 0 6px;border:0"><div><p>BARÈME FIXE</p><h3>Récompense selon le rang du filleul qualifié</h3></div></div>'+tiers.map(tierLabel).join("")+'</div>'+
    '<div class="pa-list"><div class="pa-head" style="padding:12px 0 6px;border:0"><div><p>BONUS DE PALIER</p><h3>Ajouts automatiques</h3></div></div>'+bonuses.map(bonusLabel).join("")+'</div>'+
    '<div class="pa-list"><div class="pa-head" style="padding:12px 0 6px;border:0"><div><p>VERSEMENTS</p><h3>Récompenses acquises</h3></div></div>'+(rows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>'+
    '<p class="pa-note">Le bouton « Enregistrer le versement » ne déclenche aucun virement bancaire. Il consigne uniquement un paiement réellement effectué avec sa référence, afin que la comptabilité et l’espace client restent exacts.</p>';
}
async function load(){
  if(!ctx?.root)return;
  ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du programme Ambassadeur...</p>';
  try{render(await referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Programme indisponible : '+esc(err?.code||"erreur")+'</p>'}
}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme Ambassadeur avec le barème fixe publié ?"))return;
    busy=true;feedback("Mise à jour du programme Ambassadeur...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme Ambassadeur mis à jour.","ok");await load()}
    catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement réellement effectué à l’ambassadeur :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette récompense a réellement été versée et enregistrer la référence ?"))return;
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

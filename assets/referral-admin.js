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
function policy(data){
  const tiers=Array.isArray(data?.tiers)?data.tiers:[];
  return tiers.map(x=>'<div class="pa-row"><div><strong>'+(x.to==null?'À partir du '+esc(x.from)+'e filleul':esc(x.from)+'e au '+esc(x.to)+'e filleul')+'</strong><small>Base automatique par filleul qualifié</small></div><span class="pa-badge ok">'+money(x.reward_minor,data?.currency||"EUR")+'</span></div>').join("");
}
function render(data){
  const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],bonuses=data?.bonuses||{};
  root.hidden=false;
  const rows=rewards.slice(0,50).map(x=>{const meta=x.metadata||{};return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Ambassadeur")+' : '+money(x.amount_minor,x.currency||"EUR")+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · rang '+esc(meta.reward_ordinal||"?")+' · base '+money(meta.base_reward_minor||x.amount_minor,x.currency||"EUR")+(Number(meta.bonus_minor)>0?' · bonus '+money(meta.bonus_minor,x.currency||"EUR"):'')+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>';}).join("");
  root.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PROGRAMME AMBASSADEUR</p><h2>Parrainage automatisé</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Filleuls enregistrés</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Qualifiés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>Commissions acquises</span><strong>'+money(summary.reward_minor||0,data?.currency||"EUR")+'</strong></div><div><span>À verser</span><strong>'+money(summary.earned_minor||0,data?.currency||"EUR")+'</strong></div><div><span>Versées</span><strong>'+money(summary.paid_minor||0,data?.currency||"EUR")+'</strong></div></div>'+
    '<label class="pa-field">Ouverture des nouveaux parrainages<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivée</option><option value="true" '+(data?.enabled?"selected":"")+'>Activée</option></select></label>'+
    '<div class="pa-list"><div class="pa-row"><div><strong>Qualification protégée</strong><small>'+esc(data?.qualification_paid_invoices||3)+' mensualités distinctes réellement encaissées sont obligatoires.</small></div><span class="pa-badge ok">FIXE</span></div>'+policy(data)+
    '<div class="pa-row"><div><strong>Bonus automatiques</strong><small>1er filleul : +'+money(bonuses["1"]||0,data?.currency||"EUR")+' · 5e : +'+money(bonuses["5"]||0,data?.currency||"EUR")+' · 10e : +'+money(bonuses["10"]||0,data?.currency||"EUR")+'</small></div><span class="pa-badge ok">FIXES</span></div>'+
    '<div class="pa-row"><div><strong>Seuil de règlement</strong><small>Les commissions Ambassadeur restent séparées des reversements SVA.</small></div><span class="pa-badge">'+money(data?.payout_threshold_minor||2000,data?.currency||"EUR")+'</span></div></div>'+
    '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer uniquement l’activation</button></div>'+
    '<p class="pa-note">Le barème, les bonus et la règle des 3 mensualités sont verrouillés côté serveur. Ils ne sont pas négociables ni modifiables depuis le cockpit. La désactivation bloque uniquement les nouveaux parrainages et conserve tout l’historique.</p>'+
    '<div class="pa-head" style="padding:18px 0 8px;border:0"><div><p>COMMISSIONS</p><h3>Historique et règlements</h3></div></div><div class="pa-list">'+(rows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>';
}
async function load(){if(!ctx?.root)return;ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du programme Ambassadeur...</p>';try{render(await referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Programme indisponible : '+esc(err?.code||"erreur")+'</p>'}}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" les nouveaux parrainages ? Le barème fixe et les récompenses existantes ne seront pas modifiés."))return;
    busy=true;feedback("Mise à jour du programme Ambassadeur...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme Ambassadeur mis à jour.","ok");await load()}catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement déjà effectué à l’ambassadeur :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette commission a réellement été versée ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{await settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré.","ok");await load()}catch(err){feedback(err?.code||"Enregistrement impossible","error")}finally{busy=false}
  }
}
export async function open(options={}){if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});ctx=options;if(!ctx.root.dataset.referralBound){ctx.root.dataset.referralBound="1";ctx.root.addEventListener("click",handle)}await load()}

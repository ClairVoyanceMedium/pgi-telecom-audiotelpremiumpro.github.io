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
function tierText(t,c){return (t.to==null?"À partir du "+t.from+"e":t.from+"e au "+t.to+"e")+" filleul validé : "+money(t.reward_minor,c)+" par filleul";}
function render(data){
 const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],pending=Array.isArray(data?.pending)?data.pending:[],currency=data?.currency||"EUR";
 root.hidden=false;
 const tierRows=(data?.tiers||[]).map(t=>'<div class="pa-row"><div><strong>'+esc(tierText(t,currency))+'</strong><small>'+((t.from||0)>=25?'Statut Ambassadeur, montant fixe permanent et non négociable.':'Barème automatique selon le rang validé.')+'</small></div><span class="pa-badge ok">FIXE</span></div>').join("");
 const bonusRows=(data?.milestone_bonuses||[]).map(x=>'<div class="pa-row"><div><strong>Bonus au '+esc(x.rank)+'e filleul validé : '+esc(money(x.bonus_minor,currency))+'</strong><small>Ajouté automatiquement à la prime de base du palier.</small></div><span class="pa-badge">BONUS</span></div>').join("");
 const pendingRows=pending.map(x=>'<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Parrain")+' → '+esc(x.referred_name||"Filleul")+'</strong><small>'+esc(x.qualification_paid_invoice_count||0)+' / '+esc(data.qualification_paid_invoices||3)+' mensualités encaissées · enregistré le '+esc(date(x.claimed_at))+'</small></div><span class="pa-badge warn">EN COURS</span></div>').join("");
 const rewardRows=rewards.slice(0,50).map(x=>{
   const rank=x.qualified_rank?"n°"+x.qualified_rank:"rang historique",bonus=Number(x.milestone_bonus_minor||0)>0?" · bonus "+money(x.milestone_bonus_minor,x.currency||currency):"";
   return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+money(x.amount_minor,x.currency||currency)+'</strong><small>'+esc(rank)+' · filleul '+esc(x.referred_name||"Client")+' · base '+money(x.base_reward_minor||x.amount_minor,x.currency||currency)+bonus+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>';
 }).join("");
 root.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PARRAINAGE ET AMBASSADEURS</p><h2>Pilotage automatique du programme</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
 '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Filleuls validés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>Ambassadeurs</span><strong>'+esc(summary.ambassadors||0)+'</strong></div><div><span>Primes à régler</span><strong>'+money(summary.outstanding_minor||0,currency)+'</strong></div><div><span>Primes acquises</span><strong>'+money(summary.earned_minor||0,currency)+'</strong></div><div><span>Primes réglées</span><strong>'+money(summary.paid_minor||0,currency)+'</strong></div></div>'+
 '<label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
 '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’état du programme</button></div>'+
 '<p class="pa-note"><strong>Barème verrouillé.</strong> Aucun montant n’est modifiable dans le cockpit. Qualification après exactement '+esc(data.qualification_paid_invoices||3)+' mensualités réellement encaissées. À partir du 25e filleul validé, la prime reste fixée à 20 € par nouveau filleul qualifié, sans négociation individuelle.</p>'+
 '<div class="pa-grid"><section class="pa-card"><h3>Barème fixe</h3><div class="pa-list">'+tierRows+'</div></section><section class="pa-card"><h3>Bonus automatiques</h3><div class="pa-list">'+bonusRows+'</div></section></div>'+
 '<h3 style="margin-top:18px">Filleuls en cours de validation</h3><div class="pa-list">'+(pendingRows||'<p class="pa-note">Aucun filleul en cours de validation.</p>')+'</div>'+
 '<h3 style="margin-top:18px">Récompenses acquises</h3><div class="pa-list">'+(rewardRows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div>';
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
   if(!confirm(enabled?"Activer les nouveaux parrainages avec le barème fixe ?":"Désactiver les nouveaux parrainages ? Les dossiers existants restent suivis."))return;
   busy=true;feedback("Mise à jour du programme...");
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
 ctx=options;if(!ctx.root.dataset.referralBound){ctx.root.dataset.referralBound="1";ctx.root.addEventListener("click",handle)}await load();
}

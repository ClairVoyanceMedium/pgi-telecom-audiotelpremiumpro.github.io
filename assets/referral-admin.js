const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const date=v=>{if(!v)return"N/D";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"N/D"};
let busy=false,ctx=null,last=null;
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return b}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.indexOf(p)===0){try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}}return""}
async function request(path,method="GET",body=null,key=""){const headers={"Accept":"application/json"};if(body!==null)headers["Content-Type"]="application/json";const csrf=cookie("__Host-pgi_csrf");if(csrf&&method!=="GET")headers["X-CSRF-Token"]=csrf;if(key)headers["Idempotency-Key"]=key;const res=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:body===null?undefined:JSON.stringify(body)}),payload=await res.json().catch(()=>null);if(!res.ok){const e=new Error(payload?.error?.code||"API_HTTP_"+res.status);e.code=payload?.error?.code||"API_HTTP_"+res.status;e.status=res.status;throw e}return payload}
const referralProgram=()=>request("/platform/referral-program");
const updateReferralProgram=(payload,key)=>request("/platform/referral-program","POST",payload,key);
const settleReferralReward=(id,payload,key)=>request("/platform/referral-rewards/"+encodeURIComponent(id)+"/paid","POST",payload,key);
function feedback(msg,type=""){ctx?.feedback?.(msg,type)}
function tiers(data){return (data?.tiers||[]).map(x=>'<div class="pa-row"><div><strong>'+esc(x.label||"Palier")+'</strong><small>Montant fixe par client validé</small></div><span class="pa-badge ok">'+money(x.reward_minor,data.currency||"EUR")+'</span></div>').join("")}
function bonusRows(data){return (data?.milestone_bonuses||[]).map(x=>'<div class="pa-row"><div><strong>Bonus au '+esc(x.at)+'e client validé</strong><small>Ajouté automatiquement à la récompense du palier.</small></div><span class="pa-badge">'+money(x.amount_minor,data.currency||"EUR")+'</span></div>').join("")}
function render(data){
  last=data||{};const root=ctx.root,summary=data?.summary||{},rewards=Array.isArray(data?.rewards)?data.rewards:[],leaders=Array.isArray(data?.top_ambassadors)?data.top_ambassadors:[],currency=data?.currency||"EUR";
  const firstEarned=new Map();for(const r of rewards){if(r.status==="earned"&&!firstEarned.has(String(r.referrer_tenant_id)))firstEarned.set(String(r.referrer_tenant_id),r.id)}
  const leaderRows=leaders.map(x=>{const rewardId=firstEarned.get(String(x.id)),pay=x.payout_ready&&rewardId?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(rewardId)+'">Enregistrer le versement du solde</button>':'<span class="pa-badge '+(x.payout_ready?"ok":"warn")+'">'+(x.payout_ready?"VERSEMENT PRÊT":"SEUIL NON ATTEINT")+'</span>';return '<div class="pa-row"><div><strong>'+esc(x.display_name||"Client")+' · '+esc(x.qualified_count||0)+' client(s) validé(s)</strong><small>'+esc(x.claimed_count||0)+' recommandation(s) · '+money(x.earned_minor,currency)+' acquis · '+money(x.paid_minor,currency)+' versé · solde '+money(x.balance_minor,currency)+' · prochain taux '+money(x.current_rate_minor,currency)+'</small></div>'+pay+'</div>'}).join("");
  const rewardRows=rewards.slice(0,50).map(x=>'<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' · '+money(x.amount_minor,x.currency||currency)+'</strong><small>'+(x.qualified_sequence?"Client validé n°"+esc(x.qualified_sequence)+" · ":"")+esc(x.reward_tier||"palier")+(Number(x.milestone_bonus_minor||0)>0?" · bonus "+money(x.milestone_bonus_minor,x.currency||currency):"")+' · '+esc(x.status||"earned")+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?" · versé le "+esc(date(x.paid_at)):"")+'</small></div><span class="pa-badge '+(x.status==="paid"?"ok":"warn")+'">'+(x.status==="paid"?"VERSÉ":"ACQUIS")+'</span></div>').join("");
  root.hidden=false;
  root.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PROGRAMME AMBASSADEUR</p><h2>Parrainage, récompenses et versements</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
  '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Qualification</span><strong>'+esc(data?.qualifying_payments||3)+' mensualités payées</strong></div><div><span>Recommandations</span><strong>'+esc(summary.claimed||0)+'</strong></div><div><span>Clients validés</span><strong>'+esc(summary.rewarded||0)+'</strong></div><div><span>Récompenses acquises</span><strong>'+money(summary.rewards_earned_minor,currency)+'</strong></div><div><span>À verser</span><strong>'+money(summary.rewards_due_minor,currency)+'</strong></div><div><span>Déjà versé</span><strong>'+money(summary.rewards_paid_minor,currency)+'</strong></div><div><span>Ambassadeurs prêts</span><strong>'+esc(summary.payout_ready_ambassadors||0)+'</strong></div></div>'+
  '<label class="pa-field">Activation du programme<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
  '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’activation</button></div>'+
  '<p class="pa-note"><strong>Barème verrouillé et non négociable.</strong> 10 € par client validé du 1er au 4e, 12 € du 5e au 9e, 15 € du 10e au 24e, puis 20 € par client validé à partir du 25e, sans exception. Le cockpit ne permet volontairement pas de modifier ces montants.</p>'+
  '<div class="pa-grid"><section class="pa-card"><h3>Barème fixe</h3><div class="pa-list">'+tiers(data)+'</div></section><section class="pa-card"><h3>Bonus automatiques</h3><div class="pa-list">'+bonusRows(data)+'</div><p class="pa-note">Seuil de versement : '+money(data?.payout_threshold_minor||2000,currency)+'. Les récompenses s’accumulent automatiquement jusqu’à ce seuil.</p></section></div>'+
  '<section class="pa-card pa-wide"><h3>Ambassadeurs</h3><p class="pa-note">Les soldes, paliers et clients validés sont calculés automatiquement. Un versement enregistré règle en une fois tout le solde acquis du client lorsque le seuil est atteint.</p><div class="pa-list">'+(leaderRows||'<p class="pa-note">Aucun ambassadeur actif.</p>')+'</div></section>'+
  '<section class="pa-card pa-wide"><h3>Historique des récompenses</h3><div class="pa-list">'+(rewardRows||'<p class="pa-note">Aucune récompense acquise.</p>')+'</div></section>'+
  '<p class="pa-note">Emails automatiques : activation Ambassadeur, nouvelle recommandation, récompense acquise, versement enregistré et bilan mensuel. Une recommandation est validée uniquement après trois mensualités réellement encaissées.</p>';
}
async function load(){if(!ctx?.root)return;ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du programme Ambassadeur...</p>';try{render(await referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Programme Ambassadeur indisponible : '+esc(err?.code||"erreur")+'</p>'}}
async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme Ambassadeur avec le barème fixe ?"))return;
    busy=true;feedback("Mise à jour du programme Ambassadeur...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme Ambassadeur mis à jour.","ok");await load()}catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}
    return;
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du versement déjà effectué à cet ambassadeur :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer le versement de tout le solde Ambassadeur acquis et enregistrer cette référence ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{const result=await settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré : "+money(result.amount_minor,result.currency||"EUR")+".","ok");await load()}catch(err){feedback(err?.code==="REFERRAL_PAYOUT_THRESHOLD_NOT_REACHED"?"Le seuil de 20 € n’est pas encore atteint.":(err?.code||"Enregistrement impossible"),"error")}finally{busy=false}
  }
}
export async function open(options={}){if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});ctx=options;if(!ctx.root.dataset.referralBound){ctx.root.dataset.referralBound="1";ctx.root.addEventListener("click",handle)}await load()}

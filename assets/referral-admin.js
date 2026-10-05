const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
const moneyHt=(value,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)}catch{return (Number(value)||0).toFixed(2)+" "+c}};
const date=v=>{if(!v)return"N/D";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d):"N/D"};
const shortDate=v=>{if(!v)return"N/D";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"N/D"};
let busy=false,ctx=null,lastData=null;

function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Object.assign(new Error("API_NOT_CONFIGURED"),{code:"API_NOT_CONFIGURED"});return b}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.indexOf(p)===0){try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}}return""}
async function request(path,method="GET",body=null,key=""){const headers={"Accept":"application/json"};if(body!==null)headers["Content-Type"]="application/json";const csrf=cookie("__Host-pgi_csrf");if(csrf&&method!=="GET")headers["X-CSRF-Token"]=csrf;if(key)headers["Idempotency-Key"]=key;const res=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:body===null?undefined:JSON.stringify(body)}),payload=await res.json().catch(()=>null);if(!res.ok){const e=new Error(payload?.error?.code||"API_HTTP_"+res.status);e.code=payload?.error?.code||"API_HTTP_"+res.status;e.status=res.status;throw e}return payload}
const referralProgram=()=>request("/platform/referral-program");
const updateReferralProgram=(payload,key)=>request("/platform/referral-program","POST",payload,key);
const settleReferralReward=(id,payload,key)=>request("/platform/referral-rewards/"+encodeURIComponent(id)+"/paid","POST",payload,key);
function feedback(msg,type=""){ctx?.feedback?.(msg,type)}
function statusLabel(v){return ({claimed:"EN COURS",qualified:"QUALIFIÉ",rewarded:"RÉCOMPENSÉ",rejected:"REFUSÉ",earned:"À VERSER",paid:"VERSÉ",active:"ACTIF",pending:"EN ATTENTE",suspended:"SUSPENDU",closed:"FERMÉ",payable:"À PAYER",reconciled:"RAPPROCHÉ",blocked_terms:"BLOQUÉ CONTRAT",blocked_compliance:"BLOQUÉ CONFORMITÉ",disputed:"LITIGE"}[String(v||"")]||String(v||"N/D").toUpperCase())}
function badgeClass(v){v=String(v||"");return /paid|rewarded|active|qualified/.test(v)?"ok":/pending|claimed|payable|reconciled/.test(v)?"warn":/blocked|rejected|suspended|disputed/.test(v)?"bad":""}

function tiersHtml(data){const tiers=Array.isArray(data?.tiers)?data.tiers:[];return tiers.map(t=>'<div class="pa-row"><div><strong>'+esc(t.label||((t.from||1)+" à "+(t.to||"+")))+' filleuls qualifiés : '+esc(money(t.reward_minor,data.currency||"EUR"))+' par filleul</strong><small>Barème fixe serveur. '+(t.to==null?'À partir du 25e filleul, ce montant reste permanent et non négociable.':'')+'</small></div><span class="pa-badge ok">FIXE</span></div>').join("")}
function milestonesHtml(data){const rows=Array.isArray(data?.milestones)?data.milestones:[];return rows.map(x=>'<div class="pa-row"><div><strong>'+esc(x.label||("Filleul n°"+x.ordinal))+' : bonus '+esc(money(x.bonus_minor,data.currency||"EUR"))+'</strong><small>Le bonus s’ajoute automatiquement à la prime de palier lors de la qualification.</small></div><span class="pa-badge ok">AUTO</span></div>').join("")}

function referralRow(x,currency){
  const required=Math.max(1,Number(x.qualification_paid_invoices||3)),paid=Math.max(0,Number(x.paid_invoice_count||0)),pct=Math.min(100,Math.max(0,Number(x.progress_percent)||Math.round((paid/required)*100)));
  const reward=x.reward||null,rc=reward?.currency||x.reward_currency||currency;
  const rewardText=reward?money(reward.amount_minor,rc):(Number(x.reward_minor||0)>0?money(x.reward_minor,rc):"En attente de qualification");
  const payAction=reward?.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(reward.id)+'">Enregistrer le versement</button>':"";
  return '<article class="pa-referral-item">'+
    '<div class="pa-referral-top"><div><strong>'+esc(x.referred?.name||"Client")+'</strong><small>'+esc(x.referred?.dossier_ref||"Dossier N/D")+' · '+esc(x.referred?.email||"email N/D")+'</small></div><span class="pa-badge '+badgeClass(x.status)+'">'+esc(statusLabel(x.status))+'</span></div>'+
    '<div class="pa-mini-grid"><div><span>Inscrit le</span><strong>'+esc(date(x.claimed_at))+'</strong></div><div><span>Statut client</span><strong>'+esc(statusLabel(x.referred?.status))+'</strong></div><div><span>Pays</span><strong>'+esc(x.referred?.country_code||"N/D")+'</strong></div><div><span>Prime prévue</span><strong>'+esc(rewardText)+'</strong></div></div>'+
    '<div class="pa-progress-line"><div><span>Qualification abonnement</span><strong>'+paid+' / '+required+' paiements</strong></div><div class="pa-progress" aria-label="'+paid+' paiements sur '+required+'"><i style="width:'+pct+'%"></i></div></div>'+
    (reward?'<div class="pa-reward-meta"><span>Prime : <strong>'+esc(statusLabel(reward.status))+'</strong></span><span>Acquise : <strong>'+esc(date(reward.earned_at))+'</strong></span><span>Versée : <strong>'+esc(date(reward.paid_at))+'</strong></span><span>Référence : <strong>'+esc(reward.paid_reference||"N/D")+'</strong></span></div>':"")+
    (payAction?'<div class="pa-actions">'+payAction+'</div>':"")+
  '</article>';
}

function svaRow(x){
  const c=x.currency||"EUR";
  return '<div class="pa-row"><div><strong>'+esc(shortDate(x.period_start))+' au '+esc(shortDate(x.period_end))+' : '+esc(moneyHt(x.net_payout_ht,c))+' net client HT</strong>'+
    '<small>Opérateur '+esc(moneyHt(x.upstream_payout_ht,c))+' · marge PGI '+esc(moneyHt(x.platform_fee_ht,c))+' · retenu '+esc(moneyHt(x.held_amount_ht,c))+' · statut '+esc(statusLabel(x.status))+'</small>'+
    '<small>Échéance '+esc(shortDate(x.payment_due_date))+' · payé '+esc(date(x.paid_at))+' · référence '+esc(x.payment_reference||"N/D")+' · relevé '+esc(x.statement_reference||"N/D")+'</small></div>'+
    '<span class="pa-badge '+badgeClass(x.status)+'">'+esc(statusLabel(x.status))+'</span></div>';
}

function ambassadorCard(a){
  const s=a.summary||{},sva=a.sva||{},c=a.currency||"EUR",referrals=Array.isArray(a.referrals)?a.referrals:[],recent=Array.isArray(sva.recent)?sva.recent:[];
  const search=[a.name,a.email,a.dossier_ref,a.code,a.public_id,...referrals.flatMap(x=>[x.referred?.name,x.referred?.email,x.referred?.dossier_ref])].filter(Boolean).join(" ").toLowerCase();
  const multiCurrency=Number(sva.currency_count||0)>1?'<p class="pa-note">Les totaux SVA ci-dessous sont calculés uniquement dans la devise principale '+esc(sva.currency||c)+'. Les lignes récentes conservent leur devise d’origine.</p>':"";
  return '<details class="pa-ambassador" data-ambassador-card data-search="'+esc(search)+'">'+
    '<summary><div class="pa-ambassador-title"><strong>'+esc(a.name||"Client")+'</strong><small>'+esc(a.dossier_ref||"Dossier N/D")+' · code '+esc(a.code||"N/D")+'</small></div>'+
    '<div class="pa-ambassador-summary"><span>'+Number(s.referrals||0)+' filleul(s)</span><span>'+Number(s.rewarded||0)+' qualifié(s)</span><span>'+esc(money(s.earned_unpaid_minor||0,c))+' à verser</span></div></summary>'+
    '<div class="pa-ambassador-body">'+
      '<section><h3>Identité et statut</h3><div class="pa-mini-grid"><div><span>Dossier</span><strong>'+esc(a.dossier_ref||"N/D")+'</strong></div><div><span>Identifiant interne public</span><strong class="pa-break">'+esc(a.public_id||"N/D")+'</strong></div><div><span>Email facturation</span><strong class="pa-break">'+esc(a.email||"N/D")+'</strong></div><div><span>Client</span><strong>'+esc(statusLabel(a.status))+'</strong></div><div><span>Pays</span><strong>'+esc(a.country_code||"N/D")+'</strong></div><div><span>Code ambassadeur</span><strong>'+esc(a.code||"N/D")+'</strong></div><div><span>Code actif</span><strong>'+esc(statusLabel(a.code_status))+'</strong></div><div><span>Créé le</span><strong>'+esc(date(a.code_created_at))+'</strong></div></div>'+
      '<div class="pa-actions"><button class="pa-btn" type="button" data-copy-referral="'+esc(a.code||"")+'">Copier le code</button></div></section>'+
      '<section><h3>Acquisition et parrainage</h3><div class="pa-mini-grid"><div><span>Visites du lien</span><strong>'+Number(s.visits||0)+'</strong></div><div><span>Demandes</span><strong>'+Number(s.prospects||0)+'</strong></div><div><span>Filleuls enregistrés</span><strong>'+Number(s.referrals||0)+'</strong></div><div><span>Filleuls qualifiés</span><strong>'+Number(s.rewarded||0)+'</strong></div><div><span>Primes acquises</span><strong>'+esc(money(s.reward_minor||0,c))+'</strong></div><div><span>Primes à verser</span><strong>'+esc(money(s.earned_unpaid_minor||0,c))+'</strong></div><div><span>Primes déjà versées</span><strong>'+esc(money(s.paid_minor||0,c))+'</strong></div></div></section>'+
      '<section><h3>Reversements SVA du client ambassadeur</h3><div class="pa-mini-grid"><div><span>Net client attribué HT</span><strong>'+esc(moneyHt(sva.net_payout_ht,sva.currency||c))+'</strong></div><div><span>Déjà payé HT</span><strong>'+esc(moneyHt(sva.paid_ht,sva.currency||c))+'</strong></div><div><span>À payer HT</span><strong>'+esc(moneyHt(sva.payable_ht,sva.currency||c))+'</strong></div><div><span>Montant retenu HT</span><strong>'+esc(moneyHt(sva.held_ht,sva.currency||c))+'</strong></div><div><span>Règlements payés</span><strong>'+Number(sva.paid_count||0)+'</strong></div><div><span>Règlements à payer</span><strong>'+Number(sva.payable_count||0)+'</strong></div><div><span>Dernier paiement</span><strong>'+esc(date(sva.last_paid_at))+'</strong></div></div>'+multiCurrency+
      '<div class="pa-list">'+(recent.length?recent.slice(0,20).map(svaRow).join(""):'<p class="pa-note">Aucune répartition SVA enregistrée pour cet ambassadeur.</p>')+'</div></section>'+
      '<section><h3>Filleuls et progression des 3 paiements</h3><div class="pa-referrals">'+(referrals.length?referrals.map(x=>referralRow(x,c)).join(""):'<p class="pa-note">Aucun filleul enregistré.</p>')+'</div></section>'+
    '</div></details>';
}

function globalRewards(data){
  const currency=data?.currency||"EUR",rewards=Array.isArray(data?.rewards)?data.rewards:[];
  const earned=rewards.filter(x=>x.status==="earned"),paid=rewards.filter(x=>x.status==="paid").slice(0,20);
  const row=x=>{const meta=x.referral_metadata&&typeof x.referral_metadata==="object"?x.referral_metadata:{},base=Number(meta.base_reward_minor||0),bonus=Number(meta.milestone_bonus_minor||0),ordinal=Number(meta.qualification_ordinal||0),detail=(ordinal?'Filleul qualifié n°'+ordinal+' · ':'')+(base?'prime '+money(base,x.currency||currency):'')+(bonus?' + bonus '+money(bonus,x.currency||currency):'');return '<div class="pa-row"><div><strong>'+esc(x.referrer_name||"Client")+' : '+esc(money(x.amount_minor,x.currency||currency))+'</strong><small>Filleul : '+esc(x.referred_name||"Client")+' · '+esc(detail||"barème automatique")+' · acquis le '+esc(date(x.earned_at))+(x.paid_at?' · versé le '+esc(date(x.paid_at)):"")+'</small><small>Référence : '+esc(x.paid_reference||"N/D")+'</small></div>'+(x.status==="earned"?'<button class="pa-btn success" type="button" data-referral-paid="'+esc(x.id)+'">Enregistrer comme versée</button>':'<span class="pa-badge ok">VERSÉE</span>')+'</div>'};
  return '<div class="pa-list"><div class="pa-head"><div><p>TRÉSORERIE PARRAINAGE</p><h2>Primes à traiter</h2></div><span class="pa-badge '+(earned.length?"warn":"ok")+'">'+earned.length+' en attente</span></div>'+(earned.length?earned.map(row).join(""):'<p class="pa-note">Aucune prime acquise en attente de versement.</p>')+(paid.length?'<div class="pa-head pa-subhead"><div><p>HISTORIQUE RÉCENT</p><h2>Derniers versements enregistrés</h2></div></div>'+paid.map(row).join(""):"")+'</div>';
}

function render(data){
  lastData=data;const root=ctx.root,summary=data?.summary||{},currency=data?.currency||"EUR",ambassadors=Array.isArray(data?.ambassadors)?data.ambassadors:[];
  root.hidden=false;
  root.innerHTML=
    '<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>PARRAINAGE CLIENTS</p><h2>Programme ambassadeur</h2></div><button class="pa-btn" type="button" data-referral-close>Fermer</button></div>'+
    '<div class="pa-state"><div><span>Programme</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Ambassadeurs</span><strong>'+ambassadors.length+'</strong></div><div><span>Visites liens</span><strong>'+Number(summary.visits||0)+'</strong></div><div><span>Demandes</span><strong>'+Number(summary.prospects||0)+'</strong></div><div><span>Qualification</span><strong>'+Number(data?.qualification_paid_invoices||3)+' PAIEMENTS</strong></div><div><span>Parrainages enregistrés</span><strong>'+Number(summary.claimed||0)+'</strong></div><div><span>Filleuls qualifiés</span><strong>'+Number(summary.rewarded||0)+'</strong></div><div><span>Primes à verser</span><strong>'+esc(money(summary.earned_unpaid_minor||0,currency))+'</strong></div><div><span>Primes versées</span><strong>'+esc(money(summary.paid_minor||0,currency))+'</strong></div></div>'+
    '<label class="pa-field">Activation<select id="pa-referral-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label>'+
    '<div class="pa-actions"><button class="pa-btn" type="button" data-referral-save>Enregistrer l’état du programme</button><button class="pa-btn" type="button" data-referral-refresh>Actualiser</button></div>'+
    '<p class="pa-note"><strong>Règle de qualification :</strong> une récompense devient acquise uniquement après 3 factures mensuelles distinctes réellement payées par le filleul. La désactivation bloque les nouveaux parrainages, sans supprimer l’historique ni les récompenses déjà acquises.</p>'+
    '<div class="pa-list"><div class="pa-head"><div><p>AMBASSADEURS</p><h2>Fiches complètes par client</h2></div><span class="pa-badge">'+ambassadors.length+' fiche(s)</span></div>'+
      '<label class="pa-field">Recherche ambassadeur ou filleul<input type="search" data-referral-search placeholder="Nom, email, dossier, code de parrainage"></label>'+
      '<p class="pa-note" data-referral-search-count>'+ambassadors.length+' ambassadeur(s) affiché(s).</p>'+
      '<div class="pa-ambassadors">'+(ambassadors.length?ambassadors.map(ambassadorCard).join(""):'<p class="pa-note">Aucun ambassadeur enregistré.</p>')+'</div>'+
    '</div>'+
    globalRewards(data)+
    '<div class="pa-list"><div class="pa-head"><div><p>BARÈME FIXE</p><h2>Prime par filleul qualifié</h2></div></div>'+tiersHtml(data)+'</div>'+
    '<div class="pa-list"><div class="pa-head"><div><p>BONUS FIXES</p><h2>Paliers ambassadeur</h2></div></div>'+milestonesHtml(data)+'</div>'+
    '<p class="pa-note">Barème fixe : 20,00 € par filleul dès le 25e, sans commission sur le chiffre d’affaires SVA.</p>';
}

async function load(){
  if(!ctx?.root)return;ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement du parrainage...</p>';
  try{render(await referralProgram())}catch(err){ctx.root.innerHTML='<p class="pa-note">Parrainage indisponible : '+esc(err?.code||"erreur")+'</p>'}
}

function filterAmbassadors(value){
  const q=String(value||"").trim().toLowerCase(),cards=[...ctx.root.querySelectorAll("[data-ambassador-card]")];let shown=0;
  cards.forEach(card=>{const ok=!q||String(card.dataset.search||"").includes(q);card.hidden=!ok;if(ok)shown++});
  const count=ctx.root.querySelector("[data-referral-search-count]");if(count)count.textContent=shown+" ambassadeur(s) affiché(s).";
}

async function handle(e){
  if(busy)return;
  if(e.target.closest("[data-referral-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
  if(e.target.closest("[data-referral-refresh]")){await load();return}
  const copy=e.target.closest("[data-copy-referral]");
  if(copy){const code=String(copy.dataset.copyReferral||"");if(!code)return;try{await navigator.clipboard.writeText(code);feedback("Code ambassadeur copié.","ok")}catch{feedback("Copie impossible sur cet appareil.","error")}return}
  if(e.target.closest("[data-referral-save]")){
    const enabled=document.getElementById("pa-referral-enabled")?.value==="true";
    if(!confirm((enabled?"Activer":"Désactiver")+" le programme de parrainage avec le barème fixe en vigueur ?"))return;
    busy=true;feedback("Mise à jour du parrainage...");
    try{await updateReferralProgram({enabled},window.PGIApi.newIdempotencyKey());feedback("Programme de parrainage mis à jour.","ok");await load()}catch(err){feedback(err?.code||"Mise à jour impossible","error")}finally{busy=false}return
  }
  const paid=e.target.closest("[data-referral-paid]");
  if(paid){
    const reference=prompt("Référence du paiement déjà effectué au parrain :");
    if(!reference||String(reference).trim().length<3)return;
    if(!confirm("Confirmer que cette prime a déjà été versée et enregistrer la référence ?"))return;
    busy=true;feedback("Enregistrement du versement...");
    try{await settleReferralReward(paid.dataset.referralPaid,{paid_reference:String(reference).trim()},window.PGIApi.newIdempotencyKey());feedback("Versement enregistré.","ok");await load()}catch(err){feedback(err?.code||"Enregistrement impossible","error")}finally{busy=false}
  }
}

export async function open(options={}){
  if(!options.root)throw Object.assign(new Error("REFERRAL_ADMIN_ROOT_MISSING"),{code:"REFERRAL_ADMIN_ROOT_MISSING"});
  ctx=options;
  if(!ctx.root.dataset.referralBound){
    ctx.root.dataset.referralBound="1";
    ctx.root.addEventListener("click",handle);
    ctx.root.addEventListener("input",e=>{if(e.target.matches("[data-referral-search]"))filterAmbassadors(e.target.value)});
  }
  await load();
}

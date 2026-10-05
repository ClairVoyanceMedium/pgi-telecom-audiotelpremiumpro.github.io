const e=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const m=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(v)||0)/100)}catch{return ((Number(v)||0)/100).toFixed(2)+" "+c}};
const url=code=>location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);
function pay(x){
  const s=String(x?.payout_status||"");
  if(s==="transferred"||x?.reward_status==="paid")return["VERSÉ","ok"];
  if(s==="processing")return["TRANSFERT EN COURS","ok"];
  if(s==="missing_payout_details")return["COORDONNÉES À COMPLÉTER",""];
  if(s==="failed")return["REPRISE AUTOMATIQUE",""];
  if(s==="queued")return["EN FILE",""];
  return null;
}
function recent(rows,c,required){
  if(!rows.length)return '<p class="cp-muted">Aucun filleul enregistré pour le moment.</p>';
  return '<div class="cp-stack">'+rows.map(x=>{
    const paid=Math.max(0,Math.min(required,Number(x.paid_invoice_count)||0)),q=x.status==="rewarded",p=pay(x);
    const label=p?p[0]:(q?"QUALIFIÉ":x.status==="rejected"?"REFUSÉ":paid+"/"+required+" PAIEMENTS");
    const reward=q&&Number(x.reward_minor)>0?" · "+m(x.reward_minor,c)+" acquis":"";
    const detail=q?(p?.[0]==="VERSÉ"?"Prime automatiquement transférée via Stripe.":"Les "+required+" factures mensuelles payées ont été validées. Le versement suit automatiquement son état."):"Progression : "+paid+" facture(s) mensuelle(s) payée(s) sur "+required+".";
    return '<div class="cp-row"><div><strong>Filleul '+e(String(x.public_id||"").slice(0,8).toUpperCase())+'</strong><span>'+e(detail+reward)+'</span></div><span class="cp-chip '+e(p?.[1]||(q&&!p?"ok":""))+'">'+e(label)+'</span></div>';
  }).join("")+'</div>';
}
function payout(p,c,manage){
  p=p||{};const totals='<div class="cp-row"><div><strong>'+e(m(p.payable_minor,c))+' à verser · '+e(m(p.paid_minor,c))+' déjà versé</strong><span>Les coordonnées bancaires sont recueillies et conservées par Stripe. Audiotel Premium Pro ne stocke pas votre IBAN.</span></div></div>';
  if(p.ready===true)return '<div class="cp-panel-head"><div><p class="cp-kicker">VERSEMENTS</p><h3>Primes automatiques</h3></div><span class="cp-chip ok">AUTOMATIQUES ACTIFS</span></div>'+totals+'<p class="cp-muted">Dès qu’une prime devient acquise, Audiotel Premium Pro déclenche automatiquement son transfert vers votre compte Stripe. Stripe effectue ensuite le virement bancaire selon le calendrier de votre compte.</p>';
  const action=manage?'<div class="cp-search-scopes"><button id="client-referral-payout-connect" class="cp-primary" type="button">'+e(p.configured?"Finaliser mes coordonnées de versement":"Activer mes versements automatiques")+'</button></div>':'<p class="cp-muted">Le propriétaire ou un administrateur du compte doit finaliser les coordonnées de versement.</p>';
  return '<div class="cp-panel-head"><div><p class="cp-kicker">VERSEMENTS</p><h3>Primes automatiques</h3></div><span class="cp-chip">'+(p.configured?"À FINALISER":"À ACTIVER")+'</span></div>'+totals+'<p class="cp-muted">Stripe collecte directement l’identité et les coordonnées bancaires requises. Une fois validées, les prochaines primes sont traitées automatiquement.</p>'+action;
}
export function renderReferral(box,s={}){
  const a=s.summary||{},code=String(s.code||""),c=s.currency||"EUR",required=Number(s.qualification_paid_invoices)||3,tiers=Array.isArray(s.tiers)?s.tiers:[],milestones=Array.isArray(s.milestones)?s.milestones:[],rows=Array.isArray(s.recent)?s.recent:[],next=s.next_reward||null,on=s.enabled===true;
  box.className="cp-panel cp-chart-card";box.hidden=false;
  let codeBlock="";
  if(on&&code)codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+e(code)+'</strong><span>Votre prochain filleul qualifié peut vous rapporter '+e(m(next?.total_minor||s.reward_minor,c))+'.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+e(url(code))+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
  else if(on&&s.can_manage===true&&s.eligible===true)codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
  else if(on)codeBlock='<p class="cp-muted">Le lien sera disponible après activation de votre compte et confirmation de votre abonnement actif et payé.</p>';
  else codeBlock='<div class="cp-row"><div><strong>Programme actuellement fermé</strong><span>Aucun nouveau parrainage ne peut être créé. Votre historique et vos récompenses acquises sont conservés et restent versables.</span></div><span class="cp-chip">FERMÉ</span></div>';
  const scale=tiers.length?'<div class="cp-stack">'+tiers.map(t=>'<div class="cp-row"><div><strong>'+e((t.to==null?"À partir du "+t.from+"e":t.from+" à "+t.to)+" : "+m(t.reward_minor,c)+" par filleul")+'</strong><span>'+(t.to==null?"Ce montant reste fixe et non négociable à partir du 25e filleul qualifié.":"Prime automatique selon votre nombre total de filleuls qualifiés.")+'</span></div></div>').join("")+'</div>':"";
  const bonus=milestones.length?'<p class="cp-muted">Bonus fixes : '+milestones.map(x=>e((x.ordinal===1?"1er":x.ordinal+"e")+" filleul +"+m(x.bonus_minor,c))).join(" · ")+'.</p>':"";
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Mon espace ambassadeur</h2></div><span>'+e(a.rewarded||0)+' qualifié(s)</span></div>'+
    '<p class="cp-muted">Une récompense devient acquise après <strong>3 factures mensuelles distinctes réellement payées</strong> par le filleul. Le barème est fixe, automatique et sans commission sur le chiffre d’affaires SVA.</p>'+codeBlock+
    '<div class="cp-row"><div><strong>'+e(a.visits||0)+' visite(s) · '+e(a.prospects||0)+' demande(s)</strong><span>'+e(a.claimed||0)+' filleul(s) enregistré(s) · '+e(a.rewarded||0)+' qualifié(s) · '+e(m(a.reward_minor,c))+' acquis.</span></div></div>'+
    payout(s.payout,c,s.can_manage===true)+
    '<div class="cp-panel-head"><div><p class="cp-kicker">BARÈME FIXE</p><h3>Prime par filleul qualifié</h3></div></div>'+scale+bonus+
    '<div class="cp-panel-head"><div><p class="cp-kicker">SUIVI</p><h3>Progression de mes filleuls</h3></div></div>'+recent(rows,c,required)+
    '<p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
}

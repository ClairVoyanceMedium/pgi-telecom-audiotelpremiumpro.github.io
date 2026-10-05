(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]})}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR")}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code)}
function progressLabel(x){if(x.status==="rewarded")return"VALIDÉ";if(x.status==="rejected")return"REFUSÉ";return Math.max(0,Number(x.paid_months||0))+"/3 PAIEMENTS"}
function progressClass(x){return x.status==="rewarded"?"ok":x.status==="rejected"?"bad":"neutral"}
function render(data){
  state=data||{};var box=$("client-referral-mount");if(!box)return;var summary=state.summary||{},currency=state.currency||"EUR",code=String(state.code||"");
  box.className="cp-panel cp-chart-card";box.hidden=false;
  var availability=state.enabled===true?"Programme actif":"Programme temporairement fermé";
  var eligibility=state.eligible===true?"Votre lien Ambassadeur peut être utilisé.":state.enabled!==true?"Les nouvelles recommandations sont suspendues. Votre historique et vos récompenses acquises restent visibles.":"Disponible après activation de votre compte et confirmation du premier paiement.";
  var codeBlock="";
  if(code&&state.enabled===true){
    var url=referralUrl(code);
    codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code Ambassadeur : '+esc(code)+'</strong><span>Partagez ce lien. Le suivi du filleul se fait automatiquement.</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien personnel</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button><a class="cp-ghost" href="/parrainage-audiotel/" target="_blank" rel="noopener">Voir les règles du programme</a></div></div>';
  }else if(state.can_manage===true&&state.eligible===true&&state.enabled===true){
    codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Activer mon lien Ambassadeur</button><a class="cp-ghost" href="/parrainage-audiotel/" target="_blank" rel="noopener">Voir le barème</a></div>';
  }else{
    codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p><div class="cp-search-scopes"><a class="cp-ghost" href="/parrainage-audiotel/" target="_blank" rel="noopener">Voir le barème Ambassadeur</a></div>';
  }
  var tiers=(state.tiers||[]).map(function(x){return '<div class="cp-row"><div><strong>'+esc(x.label||"Palier")+'</strong><span>Montant fixe par nouveau client validé</span></div><span class="cp-chip ok">'+esc(money(x.reward_minor,currency))+'</span></div>'}).join("");
  var bonus=(state.milestone_bonuses||[]).map(function(x){return '<span class="cp-chip neutral">Bonus '+esc(x.at)+'e : '+esc(money(x.amount_minor,currency))+'</span>'}).join(" ");
  var recent=(state.recent||[]).map(function(x){var reward=x.status==="rewarded"?money(x.reward_minor,currency):"En validation";var detail=x.status==="rewarded"?(x.qualified_sequence?"Client validé n°"+x.qualified_sequence:"Client validé"):"Validation après 3 mensualités réellement encaissées";return '<div class="cp-row"><div><strong>'+esc(detail)+'</strong><span>'+esc(reward)+(Number(x.milestone_bonus_minor||0)>0?" dont bonus "+esc(money(x.milestone_bonus_minor,currency)):"")+'</span></div><span class="cp-chip '+progressClass(x)+'">'+esc(progressLabel(x))+'</span></div>'}).join("");
  var nextTier=state.next_tier_at?'<p class="cp-muted">Encore <strong>'+esc(state.remaining_to_next_tier)+'</strong> client(s) validé(s) pour atteindre le prochain palier. Votre prochain taux de base est actuellement de <strong>'+esc(money(state.current_rate_minor,currency))+'</strong>.</p>':'<p class="cp-muted">Palier maximal atteint : <strong>20 € par nouveau client validé</strong>, montant fixe sans négociation.</p>';
  var milestone=state.next_milestone_at?'<p class="cp-muted">Prochain bonus : '+esc(money(state.next_milestone_bonus_minor,currency))+' au '+esc(state.next_milestone_at)+'e client validé.</p>':"";
  var payout=summary.payout_ready?'<span class="cp-chip ok">SEUIL DE VERSEMENT ATTEINT</span>':'<span class="cp-chip neutral">SEUIL 20 €</span>';
  box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">AMBASSADEUR</p><h2>Recommander et cumuler mes récompenses</h2></div><span>'+esc(availability)+'</span></div>'+
  '<p class="cp-muted">Barème automatique et identique pour tous : 10 € par client validé du 1er au 4e, 12 € du 5e au 9e, 15 € du 10e au 24e, puis 20 € par client validé à partir du 25e. Un filleul est validé après trois mensualités réellement encaissées.</p>'+
  codeBlock+
  '<div class="cp-comparison-grid" style="margin-top:14px"><div class="cp-compare-card"><span>Recommandations</span><strong>'+esc(summary.claimed||0)+'</strong><small>Enregistrées</small></div><div class="cp-compare-card"><span>Clients validés</span><strong>'+esc(summary.rewarded||0)+'</strong><small>Après 3 paiements</small></div><div class="cp-compare-card"><span>Total acquis</span><strong>'+esc(money(summary.earned_minor||0,currency))+'</strong><small>Récompenses cumulées</small></div><div class="cp-compare-card"><span>Solde à verser</span><strong>'+esc(money(summary.balance_minor||0,currency))+'</strong><small>Versement à partir de 20 €</small></div></div>'+
  '<div class="cp-row" style="margin-top:12px"><div><strong>Versement</strong><span>'+esc(money(summary.paid_minor||0,currency))+' déjà versé au total.</span></div>'+payout+'</div>'+
  nextTier+milestone+
  '<details style="margin-top:12px"><summary>Voir le barème fixe et les bonus</summary><div class="cp-stack" style="margin-top:10px">'+tiers+'<div class="cp-search-scopes">'+bonus+'</div></div></details>'+
  '<div class="cp-panel-head" style="margin-top:16px"><div><p class="cp-kicker">SUIVI</p><h3>Mes recommandations récentes</h3></div><span>'+esc((state.recent||[]).length)+'</span></div><div class="cp-stack">'+(recent||'<p class="cp-empty">Aucune recommandation enregistrée pour le moment.</p>')+'</div>'+
  '<p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
  bind();
}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true)}}
async function refresh(){if(!root.PGICustomerApi||typeof root.PGICustomerApi.referral!=="function")return;try{render(await root.PGICustomerApi.referral())}catch(e){if(e&&e.status===401)return;var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML=""}}}
async function createCode(){if(busy)return;busy=true;status("Création du lien Ambassadeur...");var b=$("client-referral-create");if(b)b.disabled=true;try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien Ambassadeur est prêt.")}catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme Ambassadeur est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le programme sera disponible après activation du compte et confirmation du premier paiement.",REFERRAL_CODE_UNAVAILABLE:"Le lien Ambassadeur est momentanément indisponible."};status(map[e&&e.code]||"Le lien Ambassadeur n’a pas pu être créé.",true)}finally{busy=false;if(b)b.disabled=false}}
async function copyLink(){var input=$("client-referral-link");if(!input)return;try{await navigator.clipboard.writeText(input.value);status("Lien copié.")}catch(_e){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.")}catch(_x){status("Copie impossible sur cet appareil.",true)}}}
function bind(){$("client-referral-create")?.addEventListener("click",createCode,{once:true});$("client-referral-copy")?.addEventListener("click",copyLink)}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",function(){var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML=""}});
})(window);

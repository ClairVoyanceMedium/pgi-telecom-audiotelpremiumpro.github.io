(function(root){"use strict";
var busy=false,state=null;
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100);}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR");}}
function referralUrl(code){return location.origin+"/demande-ouverture/?parrain="+encodeURIComponent(code);}
function tierLabel(data){
 var rank=Number(data.next_rank||1),base=Number(data.next_base_reward_minor||0),bonus=Number(data.next_bonus_minor||0),total=Number(data.next_reward_minor||0);
 if(data.ambassador===true)return "Statut Ambassadeur : 20 € fixes par nouveau filleul qualifié.";
 return "Prochain filleul validé n°"+rank+" : "+money(base,data.currency)+(bonus>0?" + bonus "+money(bonus,data.currency):"")+" = "+money(total,data.currency)+".";
}
function recentRows(data){
 var rows=Array.isArray(data.recent)?data.recent:[];
 if(!rows.length)return '<p class="cp-muted">Aucun filleul enregistré pour le moment.</p>';
 return '<div class="cp-stack">'+rows.map(function(x){
   var paid=Math.max(0,Number(x.qualification_paid_invoice_count||0)),required=Number(data.qualification_paid_invoices||3),status=String(x.status||"claimed");
   var text=status==="rewarded"?"Validé"+(x.qualified_rank?" au rang n°"+x.qualified_rank:"")+" : "+money(x.reward_minor,data.currency)+" acquis":paid+" / "+required+" mensualités encaissées";
   var badge=status==="rewarded"?"VALIDÉ":status==="rejected"?"REFUSÉ":"EN COURS";
   return '<div class="cp-row"><div><strong>'+esc(text)+'</strong><span>Référence '+esc(String(x.public_id||"").slice(0,8).toUpperCase())+'</span></div><span class="cp-chip '+(status==="rewarded"?"ok":"")+'">'+esc(badge)+'</span></div>';
 }).join("")+'</div>';
}
function render(data){
 state=data||{};var box=$("client-referral-mount");if(!box)return;
 if(state.enabled!==true){box.hidden=true;box.innerHTML="";return;}
 box.className="cp-panel cp-chart-card";box.hidden=false;
 var summary=state.summary||{},code=String(state.code||""),eligibility=state.eligible===true?"Votre parrainage est actif.":"Disponible après activation de votre compte et confirmation du premier paiement.";
 var codeBlock="";
 if(code){
   var url=referralUrl(code);
   codeBlock='<div class="cp-stack"><div class="cp-row"><div><strong>Votre code : '+esc(code)+'</strong><span>'+esc(tierLabel(state))+'</span></div><span class="cp-chip ok">ACTIF</span></div><label class="cp-field"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly value="'+esc(url)+'"></label><div class="cp-search-scopes"><button id="client-referral-copy" class="cp-ghost" type="button">Copier mon lien</button></div></div>';
 }else if(state.can_manage===true&&state.eligible===true){
   codeBlock='<div class="cp-search-scopes"><button id="client-referral-create" class="cp-primary" type="button">Créer mon lien de parrainage</button></div>';
 }else codeBlock='<p class="cp-muted">'+esc(eligibility)+'</p>';
 var milestone="";
 if(state.ambassador===true)milestone='<div class="cp-row"><div><strong>Statut Ambassadeur atteint</strong><span>Chaque nouveau filleul qualifié rapporte désormais 20 € fixes. Ce montant est permanent dans le barème.</span></div><span class="cp-chip ok">AMBASSADEUR</span></div>';
 else if(state.next_milestone)milestone='<div class="cp-row"><div><strong>Prochain palier : '+esc(state.next_milestone.rank)+' filleul(s) validé(s)</strong><span>Prime de base '+money(state.next_milestone.reward_minor,state.currency)+(Number(state.next_milestone.bonus_minor)>0?" + bonus "+money(state.next_milestone.bonus_minor,state.currency):"")+'</span></div></div>';
 box.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE ET AMBASSADEUR</p><h2>Recommander et cumuler mes récompenses</h2></div><span>'+esc(String(summary.rewarded||0))+' validé(s)</span></div>'+
 '<p class="cp-muted">Un filleul est validé après exactement '+esc(state.qualification_paid_invoices||3)+' mensualités Audiotel Premium Pro réellement encaissées. Le barème est automatique : 10 € du 1er au 4e, 12 € du 5e au 9e, 15 € du 10e au 24e, puis 20 € fixes à partir du 25e. Bonus : +5 € au 1er, +20 € au 5e et +50 € au 10e.</p>'+
 codeBlock+
 '<div class="cp-row"><div><strong>'+esc(String(summary.claimed||0))+' parrainage(s) enregistré(s)</strong><span>'+esc(String(summary.pending||0))+' en cours, '+esc(String(summary.rewarded||0))+' validé(s), '+esc(money(summary.reward_minor||0,state.currency))+' acquis au total.</span></div></div>'+
 milestone+'<div style="margin-top:14px"><strong>Suivi de mes filleuls</strong>'+recentRows(state)+'</div><p id="client-referral-status" class="cp-form-message" aria-live="polite"></p>';
 bind();
}
function status(message,bad){var e=$("client-referral-status");if(e){e.textContent=message||"";e.classList.toggle("bad",bad===true);}}
async function refresh(){
 if(!root.PGICustomerApi||typeof root.PGICustomerApi.referral!=="function")return;
 try{render(await root.PGICustomerApi.referral());}catch(e){if(e&&e.status===401)return;var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}}
}
async function createCode(){
 if(busy)return;busy=true;status("Création du lien sécurisé...");
 var b=$("client-referral-create");if(b)b.disabled=true;
 try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await refresh();status("Votre lien de parrainage est prêt.");}
 catch(e){var map={REFERRAL_PROGRAM_DISABLED:"Le programme de parrainage est actuellement désactivé.",REFERRAL_REFERRER_NOT_ELIGIBLE:"Le parrainage sera disponible après activation du compte et confirmation du premier paiement.",REFERRAL_CODE_UNAVAILABLE:"Le lien de parrainage est momentanément indisponible."};status(map[e&&e.code]||"Le lien de parrainage n'a pas pu être créé.",true);}
 finally{busy=false;if(b)b.disabled=false;}
}
async function copyLink(){
 var input=$("client-referral-link");if(!input)return;
 try{await navigator.clipboard.writeText(input.value);status("Lien copié.");}
 catch(_e){input.focus();input.select();try{document.execCommand("copy");status("Lien copié.");}catch(_x){status("Copie impossible sur cet appareil.",true);}}
}
function bind(){
 $("client-referral-create")?.addEventListener("click",createCode,{once:true});
 $("client-referral-copy")?.addEventListener("click",copyLink);
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pgi:auth-required",function(){var box=$("client-referral-mount");if(box){box.hidden=true;box.innerHTML="";}});
})(window);

(function(root){"use strict";
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR")}}
function style(){
 if($("client-referrals-css"))return;
 var s=document.createElement("style");s.id="client-referrals-css";s.textContent=".crf{margin:18px 0;padding:18px;border:1px solid rgba(207,179,128,.22);border-radius:18px;background:linear-gradient(135deg,rgba(29,24,20,.96),rgba(14,17,20,.96));color:#f3eee7}.crf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.crf-head p{margin:5px 0 0;color:#aaa29a;font-size:12px;line-height:1.5}.crf-head h2{margin:0;font-size:18px}.crf-badge{white-space:nowrap;padding:6px 9px;border:1px solid rgba(207,179,128,.26);border-radius:999px;color:#e4c991;font-size:10px;font-weight:800}.crf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:14px 0}.crf-grid div{padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.025)}.crf-grid span{display:block;color:#8f8982;font-size:9px;text-transform:uppercase}.crf-grid strong{display:block;margin-top:4px;font-size:15px}.crf-share{display:flex;gap:8px;align-items:center}.crf-share input{flex:1;min-width:0;height:42px;padding:0 11px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:#0b0d0f;color:#f4f0e9}.crf button{min-height:42px;padding:0 13px;border:1px solid rgba(207,179,128,.3);border-radius:10px;background:rgba(207,179,128,.1);color:#f1dfba;font-weight:800;cursor:pointer}.crf-note{margin:12px 0 0;color:#8f8982;font-size:11px;line-height:1.55}.crf-history{display:grid;gap:6px;margin-top:12px}.crf-row{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.055);border-radius:10px;font-size:11px}.crf-row span{color:#aaa29a}.crf-status{min-height:18px;margin-top:8px;color:#e4c991;font-size:11px}@media(max-width:680px){.crf{padding:14px}.crf-head{display:block}.crf-badge{display:inline-flex;margin-top:10px}.crf-grid{grid-template-columns:1fr}.crf-share{display:grid}.crf-share button{width:100%}}";
 document.head.appendChild(s)
}
function ensure(){
 var anchor=$("client-growth-suite")||$("client-activation-premium")||$("client-command-center");if(!anchor)return null;
 var el=$("client-referrals");if(el)return el;
 style();el=document.createElement("section");el.id="client-referrals";el.className="crf";el.hidden=true;anchor.insertAdjacentElement("afterend",el);return el
}
function abs(path){try{return new URL(path,location.origin).href}catch(_e){return path||""}}
function render(data){
 var el=ensure();if(!el)return;
 if(!data?.program?.enabled){el.hidden=true;el.innerHTML="";return}
 el.hidden=false;
 var reward=money(data.program.reward_amount_minor,data.program.currency),link=data.share_path?abs(data.share_path):"";
 var history=(data.history||[]).slice(0,5).map(function(x){var label=x.status==="qualified"?"Activation confirmée":"En attente d’activation réelle";var amount=x.amount_minor?money(x.amount_minor,x.currency):"";return '<div class="crf-row"><span>'+esc(label)+'</span><strong>'+esc(amount||"—")+'</strong></div>'}).join("");
 el.innerHTML='<div class="crf-head"><div><h2>Parrainage</h2><p>Invitez une personne à découvrir Audiotel Premium Pro. Votre récompense est acquise uniquement après activation réelle de son service.</p></div><span class="crf-badge">'+esc(reward)+' par activation qualifiée</span></div>'+
 '<div class="crf-grid"><div><span>En attente</span><strong>'+esc(data.stats?.captured||0)+'</strong></div><div><span>Activations qualifiées</span><strong>'+esc(data.stats?.qualified||0)+'</strong></div><div><span>Récompenses acquises</span><strong>'+esc(money(data.stats?.reward_amount_minor||0,data.program.currency))+'</strong></div></div>'+
 (link?'<div class="crf-share"><input id="crf-link" readonly value="'+esc(link)+'" aria-label="Lien de parrainage"><button id="crf-copy" type="button">Copier mon lien</button></div>':'<button id="crf-create" type="button">Créer mon lien de parrainage</button>')+
 '<p class="crf-note">Une création de compte ou une simple demande ne suffit pas. Le filleul doit devenir un client actif avec un service SVA effectivement activé. Si le programme est désactivé par Audiotel Premium Pro, aucun nouveau parrainage n’est accepté et ce module disparaît, sans effacer l’historique déjà enregistré.</p>'+
 (history?'<div class="crf-history">'+history+'</div>':"")+'<div id="crf-status" class="crf-status" role="status"></div>';
 $("crf-create")?.addEventListener("click",create);
 $("crf-copy")?.addEventListener("click",copy)
}
async function load(){
 if(!root.PGICustomerApi?.referrals)return;
 try{render(await root.PGICustomerApi.referrals())}catch(_e){var el=$("client-referrals");if(el){el.hidden=true;el.innerHTML=""}}
}
async function create(){
 var status=$("crf-status");if(status)status.textContent="Création du lien…";
 try{await root.PGICustomerApi.createReferralCode(root.PGICustomerApi.newIdempotencyKey());await load()}catch(e){if(status)status.textContent=e.code==="REFERRAL_PROGRAM_DISABLED"?"Le parrainage est actuellement désactivé.":"Impossible de créer le lien de parrainage."}
}
async function copy(){
 var input=$("crf-link"),status=$("crf-status");if(!input)return;
 try{if(navigator.clipboard&&root.isSecureContext)await navigator.clipboard.writeText(input.value);else{input.select();document.execCommand("copy")}if(status)status.textContent="Lien copié."}catch(_e){if(status)status.textContent="Copie automatique indisponible. Sélectionnez le lien manuellement."}
}
document.addEventListener("pgi:portal-loaded",load);
})(window);

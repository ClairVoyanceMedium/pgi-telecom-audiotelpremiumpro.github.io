(function(root){"use strict";
function $(id){return document.getElementById(id)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function money(minor,currency){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format((Number(minor)||0)/100)}catch(_e){return ((Number(minor)||0)/100).toFixed(2)+" "+(currency||"EUR")}}
function ensure(){
 var grid=document.querySelector("#view-settings .settings-grid");if(!grid)return null;
 var el=$("referral-admin-card");if(el)return el;
 el=document.createElement("article");el.id="referral-admin-card";el.className="panel";el.innerHTML='<p class="panel-kicker">ACQUISITION</p><h2>Programme de parrainage</h2><p id="referral-admin-summary" class="muted">Chargement…</p><div id="referral-admin-body"></div>';grid.appendChild(el);return el
}
async function load(){
 var el=ensure();if(!el||!root.PGIApi?.referralProgram)return;
 var summary=$("referral-admin-summary"),body=$("referral-admin-body");
 try{
   var pair=await Promise.all([root.PGIApi.referralProgram(),root.PGIApi.me()]),data=pair[0],me=pair[1],program=data.program||{},stats=data.stats||{},canEdit=String(me?.user?.role||"")==="admin";
   summary.textContent=program.enabled?"Actif : les nouveaux parrainages sont acceptés.":"Désactivé : aucun nouveau parrainage n’est accepté.";
   body.innerHTML='<div class="metric-row"><span>État</span><strong>'+(program.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div>'+
     '<div class="metric-row"><span>En attente d’activation</span><strong>'+esc(stats.captured||0)+'</strong></div>'+
     '<div class="metric-row"><span>Activations qualifiées</span><strong>'+esc(stats.qualified||0)+'</strong></div>'+
     '<div class="metric-row"><span>Récompenses acquises</span><strong>'+esc(money(stats.reward_amount_minor||0,program.currency||"EUR"))+'</strong></div>'+
     '<label class="auth-field" style="margin-top:12px">Disponibilité<select id="referral-admin-enabled" '+(canEdit?"":"disabled")+'><option value="false" '+(!program.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(program.enabled?"selected":"")+'>Activé</option></select></label>'+
     '<label class="auth-field">Récompense par activation qualifiée (€)<input id="referral-admin-amount" type="number" min="0.01" step="0.01" value="'+esc(program.reward_amount_minor==null?"":(Number(program.reward_amount_minor)/100).toFixed(2))+'" '+(canEdit?"":"disabled")+' placeholder="À définir"></label>'+
     '<p class="muted">Désactiver bloque immédiatement toute nouvelle attribution, y compris avec un ancien lien. L’historique déjà enregistré reste intact. Un parrainage déjà capturé peut encore être qualifié lorsque le service du filleul devient réellement actif.</p>'+
     (canEdit?'<button id="referral-admin-save" class="secondary-btn" type="button">Enregistrer le parrainage</button>':'<p class="muted">Modification réservée au rôle administrateur.</p>')+
     '<p id="referral-admin-status" class="muted" role="status"></p>';
   $("referral-admin-save")?.addEventListener("click",save);
 }catch(e){
   summary.textContent="Administration disponible lorsque l’API privée de production est connectée.";
   body.innerHTML='<p class="muted">'+esc(e.code||"")+'</p>';
 }
}
async function save(){
 var enabled=$("referral-admin-enabled")?.value==="true",amount=Number(String($("referral-admin-amount")?.value||"").replace(",",".")),status=$("referral-admin-status");
 if(enabled&&(!Number.isFinite(amount)||amount<=0)){if(status)status.textContent="Définissez une récompense positive avant d’activer le programme.";return}
 if(!confirm(enabled?"Activer le programme de parrainage avec ces conditions ?":"Désactiver maintenant les nouveaux parrainages ?"))return;
 if(status)status.textContent="Enregistrement…";
 try{
   await root.PGIApi.updateReferralProgram({
     enabled:enabled,
     reward_amount_minor:Number.isFinite(amount)&&amount>0?Math.round(amount*100):null,
     currency:"EUR",
     reward_label:"Crédit parrainage",
     terms_version:"2026-10-04-v1"
   },root.PGIApi.newIdempotencyKey());
   if(status)status.textContent=enabled?"Programme activé.":"Programme désactivé.";
   await load();
 }catch(e){
   if(status)status.textContent=e.code==="REFERRAL_REWARD_REQUIRED"?"Une récompense doit être définie avant activation.":"Enregistrement impossible : "+String(e.code||"erreur")+".";
 }
}
root.addEventListener("pgi:dashboard-loaded",load);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(load,0)},{once:true});else setTimeout(load,0);
})(window);

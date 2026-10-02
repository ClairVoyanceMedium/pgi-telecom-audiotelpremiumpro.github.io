(function(){
"use strict";
var api=window.PGICustomerApi,state=null,busy=false;
function $(id){return document.getElementById(id)}
function demo(){var c=window.PGI_CONFIG||{};try{return c.mode==="demo"||!c.apiBaseUrl||new URLSearchParams(location.search).get("demo")==="1"}catch(_e){return c.mode==="demo"||!c.apiBaseUrl}}
function moneyMinor(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format((Number(v)||0)/100)}catch(_e){return ((Number(v)||0)/100).toFixed(2)+" €"}}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function ensure(){
 if($("client-card-payments"))return;
 var anchor=$("client-growth-suite")||$("client-live-money");if(!anchor)return;
 var s=document.createElement("section");s.id="client-card-payments";s.className="ccp";
 s.innerHTML='<div class="ccp-head"><div><p class="cp-kicker">PAIEMENTS CB</p><h2>Encaissez vos consultations par carte bancaire</h2><p>Stripe encaisse directement pour votre activité. PGI applique une commission de plateforme de lancement de <strong>4,9 %</strong>, hors frais Stripe.</p></div><span id="ccp-status" class="ccp-badge">CHARGEMENT</span></div><div id="ccp-body"></div>';
 anchor.insertAdjacentElement("afterend",s);
 if(!$("client-card-payments-css")){var l=document.createElement("link");l.id="client-card-payments-css";l.rel="stylesheet";l.href="assets/client-card-payments.css";document.head.appendChild(l)}
}
function statusLabel(a){
 if(!a)return"NON ACTIVÉ";
 if(a.charges_enabled&&a.status==="active")return"ACTIF";
 if(a.status==="disabled")return"DÉSACTIVÉ";
 return"ACTIVATION";
}
function render(){
 ensure();var root=$("ccp-body"),badge=$("ccp-status");if(!root)return;
 if(demo()){
  badge.textContent="DÉMONSTRATION";
  root.innerHTML='<div class="ccp-demo"><strong>Module prêt à raccorder</strong><span>Le compte professionnel sera vérifié par Stripe avant le premier encaissement réel.</span></div>';
  return;
 }
 var p=state?.provider||{},a=state?.account||null,s=state?.summary||{},rows=state?.payments||[];
 badge.textContent=statusLabel(a);
 if(!a||!a.charges_enabled){
  root.innerHTML='<div class="ccp-activate"><div><strong>Activez les paiements CB</strong><p>Stripe collecte les informations nécessaires et vérifie votre compte. Aucun encaissement n’est possible avant validation.</p><small>Commission PGI : '+Number(p.application_fee_percent||4.9).toFixed(1).replace(".",",")+' % · frais Stripe facturés séparément par Stripe.</small></div><button id="ccp-activate" class="cp-primary" type="button">'+(a?"Continuer l’activation":"Activer les paiements CB")+'</button></div>';
  $("ccp-activate").onclick=activate;
  return;
 }
 root.innerHTML='<div class="ccp-kpis"><div><span>Paiements réussis</span><strong>'+Number(s.payments_paid||0)+'</strong></div><div><span>Volume CB</span><strong>'+moneyMinor(s.volume_paid_minor||0,"EUR")+'</strong></div><div><span>Commissions PGI</span><strong>'+moneyMinor(s.pgi_fee_paid_minor||0,"EUR")+'</strong></div><div><span>Commission</span><strong>'+Number((a.application_fee_bps||490)/100).toFixed(1).replace(".",",")+' %</strong></div></div>'+
 '<div class="ccp-grid"><article><h3>Créer un lien de paiement</h3><label>Montant TTC<input id="ccp-amount" type="number" min="5" max="1000000" step="0.01" value="30"></label><label>Description<input id="ccp-description" maxlength="120" value="Consultation"></label><label>Email du client <small>(optionnel)</small><input id="ccp-email" type="email" maxlength="320" placeholder="client@exemple.fr"></label><button id="ccp-create" class="cp-primary" type="button">Créer le lien CB</button><p id="ccp-feedback" class="ccp-feedback"></p><div id="ccp-linkbox" class="ccp-linkbox" hidden><input id="ccp-link" readonly><button id="ccp-copy" class="cp-ghost" type="button">Copier</button></div></article>'+
 '<article><h3>Derniers paiements</h3><div class="ccp-list">'+(rows.length?rows.slice(0,10).map(function(x){return'<div><span><strong>'+esc(x.description)+'</strong><small>'+esc(x.status)+'</small></span><b>'+moneyMinor(x.amount_minor,x.currency)+'</b></div>'}).join(""):'<p class="cp-empty">Aucun paiement CB pour le moment.</p>')+'</div></article></div>';
 $("ccp-create").onclick=createPayment;$("ccp-copy")?.addEventListener("click",copyLink);
}
async function load(){
 ensure();if(demo()){render();return}
 if(!api?.cardPaymentStatus)return;
 try{state=await api.cardPaymentStatus();render()}catch(_e){if($("ccp-status"))$("ccp-status").textContent="INDISPONIBLE";if($("ccp-body"))$("ccp-body").innerHTML='<p class="cp-empty">Le service de paiement CB est momentanément indisponible.</p>'}
}
async function activate(){
 if(busy||!api?.activateCardPayments)return;busy=true;var b=$("ccp-activate");if(b)b.disabled=true;
 try{var r=await api.activateCardPayments(api.newIdempotencyKey());if(r?.onboarding?.url)location.href=r.onboarding.url;else await load()}
 catch(e){var root=$("ccp-body");if(root)root.insertAdjacentHTML("beforeend",'<p class="ccp-feedback">Activation du paiement indisponible : '+esc(e?.code||"vérifiez la configuration du service")+'.</p>')}
 finally{busy=false;if(b)b.disabled=false}
}
async function createPayment(){
 if(busy||!api?.createCardPaymentCheckout)return;var amount=Math.round((Number($("ccp-amount")?.value)||0)*100),description=String($("ccp-description")?.value||"").trim(),email=String($("ccp-email")?.value||"").trim();
 var f=$("ccp-feedback");if(amount<500){if(f)f.textContent="Montant minimum : 5 €.";return}busy=true;var b=$("ccp-create");if(b)b.disabled=true;if(f)f.textContent="Création du lien sécurisé…";
 try{var r=await api.createCardPaymentCheckout({amount_minor:amount,currency:"EUR",description:description,customer_email:email||null},api.newIdempotencyKey());var box=$("ccp-linkbox"),inp=$("ccp-link");if(inp)inp.value=r?.checkout?.url||"";if(box)box.hidden=!inp?.value;if(f)f.textContent="Lien CB créé. Vous pouvez le transmettre à votre client.";await load()}
 catch(e){if(f)f.textContent="Impossible de créer le lien : "+String(e?.code||"erreur paiement")+".";
 }finally{busy=false;if(b)b.disabled=false}
}
async function copyLink(){var v=$("ccp-link")?.value;if(!v)return;try{await navigator.clipboard.writeText(v);var f=$("ccp-feedback");if(f)f.textContent="Lien copié."}catch(_e){}}
document.addEventListener("pgi:portal-loaded",load);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){ensure();load()},{once:true});else{ensure();load()}
})();
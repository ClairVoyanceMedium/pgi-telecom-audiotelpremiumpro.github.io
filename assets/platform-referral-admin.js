const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return((Number(minor)||0)/100).toFixed(2)+" "+c}};
let dialog=null,busy=false;
function ensure(){
  if(dialog)return dialog;
  dialog=document.createElement("dialog");
  dialog.id="referral-admin-dialog";
  dialog.className="pa-dialog";
  dialog.innerHTML='<header class="pa-head"><div><p>CROISSANCE CLIENT</p><h2>Programme de parrainage</h2></div><button class="pa-close" type="button" aria-label="Fermer">×</button></header><main id="referral-admin-body" class="pa-body"></main>';
  document.body.appendChild(dialog);
  dialog.querySelector(".pa-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
  return dialog;
}
function feedback(message,type=""){const e=$("referral-admin-feedback");if(e){e.textContent=message||"";e.className="pa-feedback "+type}}
function render(data){
  const body=$("referral-admin-body"),cfg=data?.configuration||{},sum=data?.summary||{},currency=cfg.currency||"EUR",reward=(Number(cfg.reward_minor||0)/100).toFixed(2);
  body.innerHTML='<p id="referral-admin-feedback" class="pa-feedback" role="status"></p><section class="pa-card"><div class="pa-state"><div><span>État global</span><strong>'+(data?.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Récompense courante</span><strong>'+esc(money(cfg.reward_minor||0,currency))+'</strong></div><div><span>Codes actifs</span><strong>'+esc(sum.active_codes||0)+'</strong></div><div><span>Parrainages</span><strong>'+esc(sum.referrals_total||0)+'</strong></div><div><span>En attente</span><strong>'+esc(sum.claimed||0)+'</strong></div><div><span>Qualifiés</span><strong>'+esc(sum.qualified||0)+'</strong></div><div><span>Récompenses acquises</span><strong>'+esc(money(sum.rewards_earned_minor||0,currency))+'</strong></div><div><span>Récompenses versées</span><strong>'+esc(money(sum.rewards_paid_minor||0,currency))+'</strong></div></div><label class="pa-field">Récompense par parrainage qualifié en EUR<input id="referral-admin-reward" type="number" min="0" max="100000" step="0.01" value="'+esc(reward)+'"></label><label class="pa-field">Ouverture du programme<select id="referral-admin-enabled"><option value="false" '+(!data?.enabled?"selected":"")+'>Désactivé</option><option value="true" '+(data?.enabled?"selected":"")+'>Activé</option></select></label><div class="pa-actions"><button id="referral-admin-save" class="pa-btn success" type="button">Enregistrer</button></div><p class="pa-note">La fermeture bloque les nouveaux codes et les nouvelles attributions. Elle ne supprime ni l’historique ni les récompenses acquises, et les attributions valides déjà enregistrées restent qualifiables après paiement réel du filleul.</p></section>';
  $("referral-admin-save").addEventListener("click",save);
}
async function load(){
  const body=$("referral-admin-body");
  body.innerHTML='<p class="pa-note">Chargement du programme…</p>';
  try{render(await window.PGIApi.referralProgram())}
  catch(error){body.innerHTML='<p class="pa-note">Programme indisponible. '+esc(error?.code||"")+'</p>'}
}
async function save(){
  if(busy)return;
  const enabled=$("referral-admin-enabled")?.value==="true",reward=Number($("referral-admin-reward")?.value);
  if(!Number.isFinite(reward)||reward<0)return feedback("Récompense invalide.","error");
  if(enabled&&reward<=0)return feedback("Une récompense strictement positive est obligatoire pour activer le programme.","error");
  if(!confirm((enabled?"Activer":"Désactiver")+" le programme avec une récompense de "+reward.toFixed(2)+" EUR ?"))return;
  busy=true;feedback("Enregistrement…");
  try{
    const data=await window.PGIApi.updateReferralProgram({enabled,reward_minor:Math.round(reward*100),currency:"EUR"});
    busy=false;render(data);feedback("Programme mis à jour.","ok");
  }catch(error){busy=false;feedback(error?.code||"Mise à jour impossible","error")}
}
export async function open(){const d=ensure();if(!d.open)d.showModal();await load();}

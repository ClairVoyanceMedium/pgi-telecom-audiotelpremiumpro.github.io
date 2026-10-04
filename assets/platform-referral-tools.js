const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

export function render(referral,mount){
  if(!mount)return;
  document.getElementById("pa-referral-program")?.remove();
  const state=referral||{},summary=state.summary||{},active=state.enabled===true,canManage=state.can_manage===true;
  const card=document.createElement("section");
  card.className="pa-card";card.id="pa-referral-program";
  card.innerHTML='<h3>Programme de parrainage</h3>'+
    '<div class="pa-state"><div><span>État</span><strong>'+(active?"ACTIVÉ":"DÉSACTIVÉ")+'</strong></div>'+
    '<div><span>Codes actifs</span><strong>'+esc(summary.active_codes||0)+'</strong></div>'+
    '<div><span>Demandes attribuées</span><strong>'+esc(summary.attributed_leads||0)+'</strong></div>'+
    '<div><span>Conversions</span><strong>'+esc(summary.converted||0)+'</strong></div></div>'+
    '<p class="pa-note">'+(active?"Les clients autorisés voient leur lien personnel. Les nouvelles attributions sont acceptées.":"Les liens clients sont masqués et aucun ancien code ne peut créer une nouvelle attribution. L’historique est conservé.")+'</p>'+
    (state.reward_label?'<p class="pa-note"><strong>Avantage actuel :</strong> '+esc(state.reward_label)+'</p>':'')+
    '<div class="pa-actions"><button class="pa-btn '+(active?"danger":"success")+'" type="button" data-referral-toggle="'+(active?"off":"on")+'" '+(canManage?"":"disabled")+'>'+(active?"Désactiver le parrainage":"Activer le parrainage")+'</button></div>'+
    (!canManage?'<p class="pa-note">Seul un administrateur peut modifier ce réglage.</p>':'');
  mount.insertAdjacentElement("beforebegin",card);
}

export async function toggle(button,{api,feedback,reload}){
  const enabled=button?.dataset?.referralToggle==="on";
  const question=enabled?"Activer le programme de parrainage maintenant ?":"Désactiver le programme de parrainage ? Les liens clients seront masqués et les anciens codes ne pourront plus créer de nouvelle attribution.";
  if(!confirm(question))return false;
  feedback(enabled?"Activation du parrainage…":"Désactivation du parrainage…");
  await api.setReferralProgram(enabled,api.newIdempotencyKey());
  feedback(enabled?"Parrainage activé.":"Parrainage désactivé. Historique conservé.","ok");
  await reload();
  return true;
}

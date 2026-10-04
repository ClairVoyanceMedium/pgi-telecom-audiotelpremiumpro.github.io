const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(n,c="EUR")=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(n)||0)/100);
const date=v=>v?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"N/D";

export async function mount(root,api,ctx={}){
  if(!root||!api?.requestRaw||!api?.idemRaw)return;
  root.querySelector("[data-referral-admin]")?.remove();
  let data;
  try{data=await api.requestRaw("/platform/commercial-features");}catch{return;}
  const r=data?.customer_referral||{},cfg=r.configuration||{},st=r.stats||{},rewards=r.pending_rewards||[];
  const card=document.createElement("section");card.className="pa-card";card.dataset.referralAdmin="";
  card.innerHTML='<h3>Parrainage client</h3><div class="pa-state"><div><span>Programme</span><strong>'+(r.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Récompense</span><strong>'+money(cfg.reward_minor||490,cfg.currency||"EUR")+'</strong></div><div><span>Parrainages</span><strong>'+esc(st.claims||0)+'</strong></div><div><span>À payer</span><strong>'+esc(st.pending_rewards||0)+'</strong></div></div><label class="pa-field">État<select data-ref-enabled><option value="true" '+(r.enabled?"selected":"")+'>Actif</option><option value="false" '+(!r.enabled?"selected":"")+'>Désactivé</option></select></label><label class="pa-field">Récompense par filleul qualifié en EUR<input data-ref-reward type="number" min="0.01" max="1000" step="0.01" value="'+(Number(cfg.reward_minor||490)/100).toFixed(2)+'"></label><div class="pa-actions"><button class="pa-btn" type="button" data-ref-save>Enregistrer</button></div><p class="pa-note">Qualification après abonnement actif réellement payé. La désactivation bloque les nouveaux parrainages sans supprimer l’historique acquis.</p><div class="pa-list">'+(rewards.map(x=>'<div class="pa-row"><div><strong>'+esc(x.display_name||"Client")+' : '+money(x.amount_minor,x.currency)+'</strong><small>Acquise '+esc(date(x.earned_at))+'</small></div><button class="pa-btn success" type="button" data-ref-paid="'+esc(x.id)+'">Marquer payée</button></div>').join("")||'<p class="pa-note">Aucune récompense en attente.</p>')+'</div>';
  const grid=root.querySelector(".pa-grid")||root;grid.insertBefore(card,grid.querySelector("#pa-compliance-editor")||null);
  card.addEventListener("click",async e=>{
    if(e.target.closest("[data-ref-save]")){
      const enabled=card.querySelector("[data-ref-enabled]").value==="true",amount=Number(card.querySelector("[data-ref-reward]").value);
      if(!Number.isFinite(amount)||amount<=0)return ctx.feedback?.("Récompense invalide.","error");
      if(!confirm((enabled?"Activer":"Désactiver")+" le parrainage avec "+amount.toFixed(2)+" EUR par filleul qualifié ?"))return;
      try{ctx.feedback?.("Mise à jour du parrainage...");await api.idemRaw("/platform/commercial-features/customer-referral",{enabled,reward_minor:Math.round(amount*100),currency:"EUR"},api.newIdempotencyKey());ctx.feedback?.("Programme de parrainage mis à jour.","ok");await ctx.reload?.();}catch(err){ctx.feedback?.(err.code||"Mise à jour impossible","error");}
      return;
    }
    const b=e.target.closest("[data-ref-paid]");if(!b)return;
    const reference=prompt("Référence du règlement :","");if(!reference)return;
    try{ctx.feedback?.("Enregistrement du règlement...");await api.idemRaw("/platform/referral-rewards/"+encodeURIComponent(b.dataset.refPaid)+"/paid",{reference},api.newIdempotencyKey());ctx.feedback?.("Récompense marquée comme payée.","ok");await ctx.reload?.();}catch(err){ctx.feedback?.(err.code||"Règlement impossible","error");}
  });
}

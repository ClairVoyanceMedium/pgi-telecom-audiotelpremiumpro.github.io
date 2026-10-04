const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function render(root,state){
  const enabled=state?.enabled===true,label=String(state?.benefit_label||"Avantage sur l’abonnement après activation effective du filleul");
  root.innerHTML='<h3>Programme de parrainage</h3>'+
    '<div class="pa-state"><div><span>État global</span><strong>'+(enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Qualification</span><strong>Après activation réelle</strong></div></div>'+
    '<p class="pa-note">'+esc(label)+'</p>'+
    '<p class="pa-note">La désactivation bloque immédiatement toute nouvelle attribution. Les codes et liens déjà diffusés deviennent inopérants pour les nouveaux filleuls, tandis que l’historique acquis reste conservé.</p>'+
    '<div class="pa-actions"><button class="pa-btn '+(enabled?"danger":"success")+'" type="button" data-referral-toggle="'+(enabled?"off":"on")+'">'+(enabled?"Désactiver le parrainage":"Activer le parrainage")+'</button></div>';
}

export async function mount({feedback,reload}={}){
  const root=document.getElementById("pa-referral-admin");if(!root)return;
  let state;
  try{state=await window.PGIApi.referralProgram();render(root,state);}
  catch(err){root.innerHTML='<h3>Programme de parrainage</h3><p class="pa-note">État indisponible. '+esc(err?.code||"")+'</p>';return;}
  root.addEventListener("click",async e=>{
    const button=e.target.closest("[data-referral-toggle]");if(!button)return;
    const enable=button.dataset.referralToggle==="on";
    if(!enable&&!confirm("Désactiver le parrainage ? Les nouvelles attributions seront bloquées immédiatement. L’historique existant sera conservé."))return;
    button.disabled=true;feedback?.(enable?"Activation du parrainage…":"Désactivation du parrainage…");
    try{
      await window.PGIApi.setReferralProgram(enable,window.PGIApi.newIdempotencyKey());
      feedback?.(enable?"Parrainage activé.":"Parrainage désactivé. Les nouvelles attributions sont bloquées.","ok");
      if(typeof reload==="function")await reload();
    }catch(err){
      button.disabled=false;feedback?.(err?.code||"Modification impossible","error");
    }
  });
}

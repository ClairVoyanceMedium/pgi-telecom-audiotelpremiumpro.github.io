const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const $=id=>document.getElementById(id);
const date=v=>{if(!v)return"—";const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium"}).format(d):"—";};
async function copyText(value){
  if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);return;}
  const ta=document.createElement("textarea");ta.value=value;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();if(!ok)throw new Error("COPY_FAILED");
}
export function createController({api,getDemo,toast}={}){
  let bound=false;
  function render(data){
    const mount=$("client-referrals-mount");if(!mount)return;
    if(!data){mount.innerHTML='<p class="cp-empty">Parrainage momentanément indisponible.</p>';return;}
    const shareUrl=new URL(String(data.share_path||"/demande-ouverture/"),location.origin).href;
    const summary=data.summary||{},reward=data.reward||{};
    const rows=Array.isArray(data.referrals)?data.referrals:[];
    const recent=rows.slice(0,5).map(x=>{
      const status=String(x.status||"pending");
      const label=status==="rewarded"?"Mois offert crédité":status==="qualified"?"Activation confirmée":status==="rejected"?"Non éligible":"En attente d’activation";
      const tone=status==="rewarded"?"ok":status==="qualified"?"warn":status==="rejected"?"bad":"neutral";
      return '<div class="cp-row"><div><strong>Parrainage du '+esc(date(x.created_at))+'</strong><span>'+esc(label)+(x.rewarded_at?" · crédité le "+esc(date(x.rewarded_at)):"")+'</span></div><span class="cp-chip '+tone+'">'+esc(status==="rewarded"?"OFFERT":status==="qualified"?"VALIDÉ":"EN COURS")+'</span></div>';
    }).join("");
    mount.innerHTML=
      '<div class="cp-stack">'+
      '<div class="cp-row"><div><strong>Votre code</strong><span>À partager avec un nouveau client Audiotel Premium Pro.</span></div><span class="cp-chip ok">'+esc(data.code||"—")+'</span></div>'+
      '<div class="cp-row"><div><strong>Votre récompense</strong><span>'+esc(reward.label||"1 mois offert")+' après activation réelle du service du filleul. Le crédit s’applique à votre prochaine facture.</span></div><span class="cp-chip ok">3 €</span></div>'+
      '</div>'+
      '<div class="cp-form" style="margin-top:14px"><label>Lien de parrainage<input id="client-referral-link" type="text" readonly value="'+esc(shareUrl)+'"></label><button id="client-referral-copy" class="cp-primary" type="button">Copier mon lien</button></div>'+
      '<div class="cp-stack" style="margin-top:14px"><div class="cp-row"><div><strong>'+esc(Number(summary.rewarded||0))+' récompense(s) obtenue(s)</strong><span>'+esc(Number(summary.pending||0)+Number(summary.qualified||0))+' parrainage(s) en cours · '+esc(Number(summary.total||0))+' au total</span></div></div>'+recent+'</div>';
    bind();
  }
  function bind(){
    if(bound)return;bound=true;
    document.addEventListener("click",async e=>{
      const button=e.target.closest("#client-referral-copy");if(!button)return;
      const input=$("client-referral-link");if(!input)return;
      try{await copyText(input.value);toast?.("Lien de parrainage copié.");}
      catch{toast?.("Copie impossible. Sélectionnez le lien manuellement.");}
    });
  }
  async function load(){
    const mount=$("client-referrals-mount");if(!mount)return;
    if(getDemo&&getDemo()){
      render({code:"PGI-DEMO2026",share_path:"/demande-ouverture/?ref=PGI-DEMO2026",reward:{label:"1 mois offert"},summary:{pending:1,qualified:0,rewarded:1,total:2},referrals:[]});
      return;
    }
    mount.innerHTML='<p class="cp-empty">Chargement du parrainage…</p>';
    try{render(await api.referrals());}catch{render(null);}
  }
  return {load,render};
}

(()=>{"use strict";
const money=(minor,currency)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR"}).format(Number(minor)/100)}catch(_e){return (Number(minor)/100).toFixed(2)+" "+(currency||"EUR")}};
async function boot(){
  const status=document.querySelector("[data-referral-status]"),main=document.querySelector("[data-referral-reward-main]"),copy=document.querySelector("[data-referral-reward-copy]"),note=document.querySelector("[data-referral-example-note]");
  try{
    const r=await fetch("/api/v1/public/referral-program",{headers:{"Accept":"application/json"},credentials:"same-origin",cache:"no-store"});
    const data=await r.json().catch(()=>({}));
    const reward=Number(data.reward_minor),currency=String(data.currency||"EUR").toUpperCase();
    if(!r.ok||data.enabled!==true||!Number.isFinite(reward)||reward<=0){
      if(status)status.textContent="Consultez votre espace client pour vérifier la disponibilité du programme et le montant de votre récompense.";
      return;
    }
    const one=money(reward,currency);
    if(status)status.textContent="Programme disponible : "+one+" par filleul qualifié selon les conditions en vigueur.";
    if(main)main.textContent=one+" par filleul qualifié";
    if(copy)copy.textContent="Récompense actuelle : "+one+" par filleul qualifié. Chaque nouveau filleul qui remplit les conditions du programme peut ajouter cette récompense à votre total.";
    if(note)note.textContent="Avec la récompense actuellement affichée de "+one+" par filleul qualifié, voici des exemples simples :";
    document.querySelectorAll("[data-referral-example]").forEach(el=>{
      const n=Math.max(1,Math.min(20,Number(el.getAttribute("data-referral-example"))||1));
      el.textContent=money(reward*n,currency);
    });
  }catch(_e){
    if(status)status.textContent="Le montant de votre récompense reste disponible depuis votre espace client.";
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
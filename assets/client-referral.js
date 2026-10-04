const $=id=>document.getElementById(id);
const money=(n,c)=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format((Number(n)||0)/100)}catch{return ((Number(n)||0)/100).toFixed(2)+" "+(c||"EUR")}};
function priorityControl(){if($("portability-processing"))return;const x=$("portability-service-family")?.closest("label");if(!x)return;const l=document.createElement("label");l.innerHTML='Traitement de la demande<select id="portability-processing"><option value="standard">Standard gratuit</option><option value="priority">Prioritaire PGI, 9,90 € TTC, sans délai opérateur garanti</option></select>';x.insertAdjacentElement("afterend",l)}
priorityControl();
function card(){
  let s=$("client-referral");if(s)return s;
  const anchor=document.querySelector(".cp-portability-card");if(!anchor)return null;
  s=document.createElement("article");s.id="client-referral";s.className="cp-panel cp-chart-card";
  s.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Recommander Audiotel Premium Pro</h2></div><span id="client-referral-reward"></span></div><p class="cp-muted">Récompense acquise après abonnement actif réellement payé du filleul.</p><div class="cp-row"><div><strong>Mon code</strong><span id="client-referral-code"></span></div></div><label class="cp-search-box"><span>Lien de parrainage</span><input id="client-referral-link" type="text" readonly></label><div class="cp-search-scopes"><button id="client-referral-copy" type="button">Copier mon lien</button></div><p id="client-referral-stats" class="cp-muted"></p>';
  anchor.insertAdjacentElement("afterend",s);return s;
}
async function load(){
  if(!window.PGICustomerApi?.referral)return;
  try{
    const d=await window.PGICustomerApi.referral();let s=$("client-referral");
    if(d?.enabled!==true){s?.remove();return}
    s=card();if(!s)return;
    const st=d.stats||{};$("client-referral-reward").textContent=money(d.reward_minor,d.currency)+" par filleul qualifié";
    $("client-referral-code").textContent=d.code||"";$("client-referral-link").value=d.share_url||"";
    $("client-referral-stats").textContent=Number(st.referrals||0)+" filleul(s), "+Number(st.rewarded||0)+" récompense(s), "+money(st.earned_minor||0,d.currency)+" acquis";
  }catch{$("client-referral")?.remove()}
}
async function copyLink(){const i=$("client-referral-link"),b=$("client-referral-copy");if(!i?.value)return;try{await navigator.clipboard.writeText(i.value);if(b){const x=b.textContent;b.textContent="Lien copié";setTimeout(()=>b.textContent=x,1600)}}catch{i.focus();i.select()}}
document.addEventListener("pgi:portal-loaded",load);
document.addEventListener("click",e=>{if(e.target.closest("#client-referral-copy"))copyLink()});

(function(root){
"use strict";
const $=id=>document.getElementById(id);
let loading=false;

function esc(value){
  return String(value==null?"":value).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];
  });
}
function removeUi(){
  $("client-referral")?.remove();
  document.querySelector('[data-client-referral-nav]')?.remove();
}
function copyText(value){
  if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(value);
  const area=document.createElement("textarea");
  area.value=value;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";
  document.body.appendChild(area);area.select();
  try{document.execCommand("copy");}finally{area.remove();}
  return Promise.resolve();
}
function ensureStyle(){
  if($("client-referral-style"))return;
  const style=document.createElement("style");
  style.id="client-referral-style";
  style.textContent=".cr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.cr-link{display:grid;gap:5px;margin-top:12px}.cr-link input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--border,rgba(128,158,192,.18));border-radius:10px;background:rgba(0,0,0,.14);color:inherit}.cr-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.cr-stat{padding:10px;border:1px solid var(--border,rgba(128,158,192,.12));border-radius:10px}.cr-stat span{display:block;opacity:.68;font-size:11px}.cr-stat strong{display:block;margin-top:4px;font-size:18px}@media(max-width:640px){.cr-stats{grid-template-columns:1fr}.cr-actions>*{flex:1 1 100%}}";
  document.head.appendChild(style);
}
function ensureNav(){
  if(document.querySelector("[data-client-referral-nav]"))return;
  const nav=document.querySelector(".cp-section-nav");
  if(!nav)return;
  const link=document.createElement("a");
  link.href="#client-referral";link.textContent="Parrainage";link.dataset.clientReferralNav="";
  const support=Array.from(nav.querySelectorAll("a")).find(a=>a.getAttribute("href")==="#client-service-center");
  if(support)nav.insertBefore(link,support);else nav.appendChild(link);
}
function mount(data){
  removeUi();
  if(!data||data.enabled!==true)return;
  ensureStyle();ensureNav();
  const anchor=$("client-service-center");if(!anchor)return;
  const section=document.createElement("section");
  section.id="client-referral";section.className="cp-panel cp-anchor-section";
  const link=new URL(String(data.share_path||"/demande-ouverture/?ref="+encodeURIComponent(data.code||"")),location.origin).href;
  const summary=data.summary||{};
  section.innerHTML='<div class="cp-panel-head"><div><p class="cp-kicker">PARRAINAGE</p><h2>Inviter un contact</h2></div><span class="cp-chip ok">ACTIF</span></div>'+
    '<p class="cp-muted">Partagez votre lien personnel avec une personne susceptible d\'être intéressée par Audiotel Premium Pro. Une attribution n\'est enregistrée que lorsque le programme de parrainage est actif.</p>'+
    '<div class="cr-link"><label for="client-referral-link">Mon lien de parrainage</label><input id="client-referral-link" type="text" readonly value="'+esc(link)+'"></div>'+
    '<div class="cr-actions"><button id="client-referral-copy" class="cp-primary" type="button">Copier mon lien</button><button id="client-referral-share" class="cp-ghost" type="button">Partager</button></div>'+
    '<div class="cr-stats"><div class="cr-stat"><span>Demandes attribuées</span><strong>'+esc(summary.attributed_leads||0)+'</strong></div><div class="cr-stat"><span>Code</span><strong>'+esc(data.code||"—")+'</strong></div></div>'+
    (data.reward_label?'<p class="cp-muted"><strong>Avantage :</strong> '+esc(data.reward_label)+'</p>':'')+
    '<p id="client-referral-feedback" class="cp-muted" role="status"></p>';
  anchor.insertAdjacentElement("beforebegin",section);
  $("client-referral-copy")?.addEventListener("click",async function(){
    const feedback=$("client-referral-feedback");
    try{await copyText(link);if(feedback)feedback.textContent="Lien copié.";}catch(_e){if(feedback)feedback.textContent="Copie indisponible sur cet appareil.";}
  });
  $("client-referral-share")?.addEventListener("click",async function(){
    const feedback=$("client-referral-feedback");
    if(typeof navigator.share!=="function"){
      try{await copyText(link);if(feedback)feedback.textContent="Lien copié.";}catch(_e){if(feedback)feedback.textContent="Partage indisponible sur cet appareil.";}
      return;
    }
    try{await navigator.share({title:"Audiotel Premium Pro",text:"Découvrez Audiotel Premium Pro",url:link});}
    catch(error){if(error&&error.name!=="AbortError"&&feedback)feedback.textContent="Partage indisponible sur cet appareil.";}
  });
}
async function refresh(){
  if(loading||!root.PGICustomerApi?.referral)return;
  loading=true;
  try{mount(await root.PGICustomerApi.referral());}
  catch(_e){removeUi();}
  finally{loading=false;}
}
document.addEventListener("pgi:portal-loaded",refresh);
root.addEventListener("pageshow",function(){if(!$("customer-app")?.hidden)refresh();});
})(window);

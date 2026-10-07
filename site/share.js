(()=>{"use strict";
const button=document.querySelector("[data-public-share]"),status=document.querySelector("[data-public-share-status]");
if(!button)return;
function canonicalUrl(){
  const raw=document.querySelector('link[rel="canonical"]')?.href||location.origin+location.pathname;
  try{const u=new URL(raw,location.href);u.search="";u.hash="";return u.href}catch(_e){return location.origin+location.pathname}
}
function sharedUrl(){
  const u=new URL(canonicalUrl(),location.href);
  u.searchParams.set("utm_source","site_share");
  u.searchParams.set("utm_medium","share");
  u.searchParams.set("utm_campaign","organic_referral");
  u.searchParams.set("utm_content",itemId());
  return u.href;
}
function itemId(){
  const p=(location.pathname||"/").replace(/^\/+|\/+$/g,"");
  return (p||"home").replace(/[^a-z0-9-]+/gi,"_").slice(0,80);
}
function track(method){try{window.PGIAnalytics?.track?.("share",{method,content_type:"page",item_id:itemId()})}catch(_e){}}
async function copy(url){
  try{await navigator.clipboard.writeText(url);return true}catch(_e){}
  try{const ta=document.createElement("textarea");ta.value=url;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();return ok}catch(_e){return false}
}
button.addEventListener("click",async()=>{
  const url=sharedUrl(),data={title:document.title,text:"Découvrez Audiotel Premium Pro par PGI Telecom.",url};
  if(navigator.share){
    try{await navigator.share(data);track("native");if(status)status.textContent="Partage effectué.";return}
    catch(error){if(error&&error.name==="AbortError")return}
  }
  const ok=await copy(url);
  if(status)status.textContent=ok?"Lien copié. Vous pouvez maintenant le partager.":"Copie automatique impossible. Utilisez le lien de cette page.";
  if(ok)track("copy_link");
});
})();
// Preparation-only SEO inventory. Never imported by scripts/build-static.mjs.
// Indexation and telecom business release must be approved separately.
const BASE="https://audiotel-premium-pro.com/distribution-sva/";
const LOCALES=Object.freeze(["fr","en","es","pt","de","it"]);
const FR_PATHS=Object.freeze(["","solutions/","business-live/","transition/","conformite/","espace-client/","reclamations/","conditions/","mentions-legales/","confidentialite/","architecture-reseau/","numerotation/","interconnexion-routage/","releves-reversements/","partenaires/","questions-frequentes/"]);
const TRANSLATED_TYPES=Object.freeze(["home","solutions","faq","partners"]);
function route(lang,type){
 if(lang==="fr")return ({home:"",solutions:"solutions/",faq:"questions-frequentes/",partners:"partenaires/"})[type];
 return lang+"/"+(type==="home"?"":type+"/");
}
function escapeXml(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/>/g,"&gt;");}
function inventory(){
 const pages=[];
 for(const suffix of FR_PATHS)pages.push(Object.freeze({lang:"fr",suffix,url:BASE+suffix,private:suffix==="espace-client/",type:Object.entries({home:"",solutions:"solutions/",faq:"questions-frequentes/",partners:"partenaires/"}).find(([,s])=>s===suffix)?.[0]??null}));
 for(const lang of LOCALES.filter(x=>x!=="fr"))for(const type of TRANSLATED_TYPES){
  const suffix=route(lang,type);pages.push(Object.freeze({lang,suffix,url:BASE+suffix,private:false,type}));
 }
 return Object.freeze(pages);
}
export const DIRECT_SVA_SEO_INVENTORY=inventory();
export const DIRECT_SVA_SEO_LANGUAGES=LOCALES;
const RELEASE_REQUIREMENTS=Object.freeze(["explicit_business_release","legal_publication_approved","telecom_contracts_verified","numbering_rights_verified","content_language_reviewed","technical_production_checks_passed","seo_indexation_authorized"]);
export function planDirectSvaIndexation(approvals={}){
 const missing=RELEASE_REQUIREMENTS.filter(key=>approvals[key]!==true);
 return Object.freeze({
  site_unit:"direct_sva",public_release_allowed:missing.length===0,
  indexation_allowed:missing.length===0,
  missing_approvals:missing,
  pages_prepared:DIRECT_SVA_SEO_INVENTORY.length,
  permanently_private_paths:DIRECT_SVA_SEO_INVENTORY.filter(p=>p.private).map(p=>p.suffix),
  sitemap_eligible_pages:missing.length===0?DIRECT_SVA_SEO_INVENTORY.filter(p=>!p.private).length:0
 });
}
export function renderDirectSvaSitemap(approvals={}){
 const readiness=planDirectSvaIndexation(approvals);
 if(!readiness.indexation_allowed)throw Error("DIRECT_SVA_SEO_RELEASE_NOT_AUTHORIZED");
 return renderDirectSvaEditorialSitemap(true);
}
// Editorial publication is explicitly approved by the owner from the cockpit.
// This is distinct from legal authorizations to operate telecom and payments.
export function renderDirectSvaEditorialSitemap(editorialAuthorized=false){
 if(editorialAuthorized!==true)throw Error("DIRECT_SVA_EDITORIAL_PUBLICATION_NOT_AUTHORIZED");
 const xml= ['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
 for(const page of DIRECT_SVA_SEO_INVENTORY.filter(p=>!p.private)){
  const alternates=page.type?LOCALES.map(lang=>'    <xhtml:link rel="alternate" hreflang="'+lang+'" href="'+escapeXml(BASE+route(lang,page.type))+'"/>').join("\n")+
   '\n    <xhtml:link rel="alternate" hreflang="x-default" href="'+escapeXml(BASE+route("fr",page.type))+'"/>':"";
  xml.push('  <url><loc>'+escapeXml(page.url)+'</loc>'+(alternates?"\n"+alternates:"")+'</url>');
 }
 xml.push("</urlset>");
 return xml.join("\n")+"\n";
}

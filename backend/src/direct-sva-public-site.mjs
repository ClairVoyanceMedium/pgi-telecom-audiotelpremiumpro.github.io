import {DIRECT_SVA_SEO_INVENTORY,renderDirectSvaSitemap} from "../../scripts/direct-sva-seo-plan.mjs";

const ROUTES=new Map(DIRECT_SVA_SEO_INVENTORY.filter(x=>!x.private).map(x=>[
 "/distribution-sva/"+x.suffix,
 "/site/distribution-sva/"+x.suffix+"index.html"
]));
const SITEMAP_REQUIREMENTS=Object.freeze([
 "explicit_business_release","legal_publication_approved","telecom_contracts_verified",
 "numbering_rights_verified","content_language_reviewed",
 "technical_production_checks_passed","seo_indexation_authorized"
]);
export function directSvaPublicPagePath(pathname){
 if(typeof pathname!=="string"||pathname.includes("%")||pathname.includes("\\")||pathname.includes(".."))return null;
 const p=pathname==="/distribution-sva"?"/distribution-sva/":pathname;
 return ROUTES.get(p)||null;
}
export function isDirectSvaPublicAsset(pathname){
 return /^\/site\/distribution-sva\/(?:style\.css|site\.js|measurement\.js|complaints-form\.js|client-portal\.js)$/.test(pathname);
}
export function isDirectSvaPath(pathname){
 return /^\/(?:distribution-sva(?:\/|$)|site\/distribution-sva(?:\/|$))/.test(String(pathname||""));
}
export function visibleDistributionMarketingHome(html,state){
 if(typeof html!=="string")return "";
 const visible=state?.publication_authorized===true&&state?.navigation_visible===true;
 return visible?html.replace(
  /(<a class="header-distribution-link" href="\/distribution-sva\/") hidden>/,
  "$1>"
 ):html;
}
export function publishedDistributionHtml(html,state){
 if(state?.publication_authorized!==true||typeof html!=="string")return null;
 // Publishing the information pages is a separate, approved operation.
 // Hiding the homepage link must NOT change published copy or metadata:
 // this avoids language mismatches, crawler-visible instability and SEO drift.
 const embargo='<meta name="robots" content="noindex,nofollow,noarchive">';
 if(!html.includes(embargo))return null;
 let out=html.replace(embargo,'<meta name="robots" content="index,follow,max-snippet:-1">');
 const loginLink=/<a\b([^>]*?)href="\/distribution-sva\/espace-client\/"([^>]*)>([^<]*)<\/a>/g;
 if(state.commercial_requests_enabled===true){
  // Once the client-side module is authorized, use the existing shared
  // PGI login; never publish a 404 private portal path.
  return out.replace(loginLink,(_whole,before,after)=>
   '<a'+before+'href="/client.html"'+after+'>Connexion à mon espace client PGI</a>');
 }
 // The private Distribution portal remains unavailable in this phase.
 // Informational pages can go live independently without exposing broken CTAs.
 return out.replace(loginLink,(_whole,before,after)=>{
  const lang=/<html\s+lang="([^"]+)"/i.exec(html)?.[1]||"fr";
  const labels={fr:"Espace client Distribution en préparation",en:"Distribution client area coming later",
   es:"Área de clientes de Distribución en preparación",
   pt:"Área de clientes da Distribuição em preparação",
   de:"Distribution-Kundenbereich in Vorbereitung",
   it:"Area clienti Distribution in preparazione"};
  return '<span class="ds-client-unavailable" aria-disabled="true">'+
   (labels[lang]||labels.fr)+'</span>';
 });
}
export function publishedDistributionSitemap(state){
 if(state?.publication_authorized!==true)return null;
 const approvals=Object.fromEntries(SITEMAP_REQUIREMENTS.map(k=>[k,true]));
 return renderDirectSvaSitemap(approvals);
}

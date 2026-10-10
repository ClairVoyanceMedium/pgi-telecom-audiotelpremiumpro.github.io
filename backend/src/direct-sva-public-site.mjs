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
 // The preparation sources all remain noindex; only a separately approved
 // published response can remove that embargo. Switching the menu OFF does NOT.
 let out=html.replace(
  /<meta name="robots" content="noindex,nofollow,noarchive">/,
  '<meta name="robots" content="index,follow,max-snippet:-1">'
 );
 if(state.navigation_visible!==true){
  out=out.replace("</main>",'<section class="section-space" role="status"><div class="wrap"><p class="notice">Le Pôle Télécom &amp; Réseau est temporairement indisponible pour de nouvelles demandes. Les informations techniques restent consultables.</p></div></section></main>');
 }
 return out;
}
export function publishedDistributionSitemap(state){
 if(state?.publication_authorized!==true)return null;
 const approvals=Object.fromEntries(SITEMAP_REQUIREMENTS.map(k=>[k,true]));
 return renderDirectSvaSitemap(approvals);
}

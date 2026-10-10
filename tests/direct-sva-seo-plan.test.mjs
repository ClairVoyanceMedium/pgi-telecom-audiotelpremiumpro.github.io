import test from "node:test";
import assert from "node:assert/strict";
import {DIRECT_SVA_SEO_INVENTORY,planDirectSvaIndexation,renderDirectSvaSitemap,renderDirectSvaEditorialSitemap} from "../scripts/direct-sva-seo-plan.mjs";

const requirements=["explicit_business_release","legal_publication_approved","telecom_contracts_verified","numbering_rights_verified","content_language_reviewed","technical_production_checks_passed","seo_indexation_authorized"];
test("thirty-six future telecom pages, one permanently private",()=>{
 assert.equal(DIRECT_SVA_SEO_INVENTORY.length,36);
 assert.equal(DIRECT_SVA_SEO_INVENTORY.filter(p=>p.private).length,1);
 assert.equal(DIRECT_SVA_SEO_INVENTORY.find(p=>p.private)?.suffix,"espace-client/");
 const urls=new Set(DIRECT_SVA_SEO_INVENTORY.map(p=>p.url));
 assert.equal(urls.size,36);
});
test("default sitemap publishing is impossible",()=>{
 const plan=planDirectSvaIndexation();
 assert.equal(plan.indexation_allowed,false);
 assert.equal(plan.sitemap_eligible_pages,0);
 assert.equal(plan.missing_approvals.length,7);
 assert.throws(()=>renderDirectSvaSitemap(),/DIRECT_SVA_SEO_RELEASE_NOT_AUTHORIZED/);
});
test("sitemap rejects every single missing release approval",()=>{
 for(const missing of requirements){
  const flags=Object.fromEntries(requirements.map(x=>[x,x!==missing]));
  assert.equal(planDirectSvaIndexation(flags).indexation_allowed,false);
  assert.throws(()=>renderDirectSvaSitemap(flags));
 }
});
test("fully authorized hypothetical sitemap has thirty-five public URLs and multilingual alternates",()=>{
 const flags=Object.fromEntries(requirements.map(x=>[x,true]));
 const plan=planDirectSvaIndexation(flags);
 assert.equal(plan.sitemap_eligible_pages,35);
 const xml=renderDirectSvaSitemap(flags);
 assert.equal((xml.match(/<url>/g)||[]).length,35);
 assert.doesNotMatch(xml,/\/distribution-sva\/espace-client\//);
 assert.match(xml,/href="https:\/\/audiotel-premium-pro\.com\/distribution-sva\/en\/faq\/"/);
 assert.match(xml,/hreflang="x-default"/);
 assert.match(xml,/hreflang="pt"/);
 assert.match(xml,/hreflang="it"/);
 assert.match(xml,/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
});

test("editorial-only sitemap is published by admin decision without impersonating telecom release",()=>{
 assert.throws(()=>renderDirectSvaEditorialSitemap(),/DIRECT_SVA_EDITORIAL_PUBLICATION_NOT_AUTHORIZED/);
 const xml=renderDirectSvaEditorialSitemap(true);
 assert.equal((xml.match(/<url>/g)||[]).length,35);
 assert.match(xml,/hreflang="en"/);
 assert.doesNotMatch(xml,/\/distribution-sva\/espace-client\//);
 // Operator launch continues to have its own checks, unaffected by editorial publication.
 assert.equal(planDirectSvaIndexation().public_release_allowed,false);
});

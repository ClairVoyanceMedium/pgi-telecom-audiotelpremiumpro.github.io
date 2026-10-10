import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createDirectSvaTracker} from "../site/direct-sva-tracking.js";
const good={enabled:true,measurementId:"G-ABC1234567",consentGranted:true,legalApproved:true,customDimensionRegistered:true,dedicatedPropertyConfirmed:true};
function setup(path="/distribution-sva/en/faq/",opts={}){
 const calls=[],scripts=[],gtag=(...items)=>calls.push(items);
 const tracker=createDirectSvaTracker({
   ga4:{...good,gtag,...opts.ga4},
   locationRef:{hostname:opts.hostname||"audiotel-premium-pro.com",pathname:path,
    search:"?email=secret%40test.invalid",hash:"#private-secret"},
   navigatorRef:{globalPrivacyControl:opts.gpc===true},documentRef:{},
   scriptLoader:url=>scripts.push(url)
 });
 return {calls,scripts,tracker};
}
test("one consented page view reaches only dedicated stream, without query string or fragment",()=>{
 const {calls,scripts,tracker}=setup();
 assert.equal(tracker.start().enabled,true);
 assert.equal(tracker.pageView().accepted,true);
 assert.equal(tracker.pageView().accepted,false);
 const views=calls.filter(x=>x[0]==="event"&&x[1]==="page_view");
 assert.equal(views.length,1);
 assert.deepEqual(views[0][2],{
  send_to:"G-ABC1234567",
  page_location:"https://audiotel-premium-pro.com/distribution-sva/en/faq/",
  pgi_business_unit:"direct_sva",
  pgi_funnel_stage:"interest",pgi_service_type:"distribution"
 });
 assert.equal(scripts.length,1);
 assert.ok(scripts[0].includes("G-ABC1234567"));
 assert.doesNotMatch(JSON.stringify(calls),/secret%40test|private-secret/);
 assert.ok(calls.find(x=>x[0]==="config")[2].cookie_prefix==="pgi_dsva");
 assert.equal(calls.find(x=>x[0]==="config")[2].send_page_view,false);
});
test("every custom event is routed to the future dedicated stream",()=>{
 const {calls,tracker}=setup("/distribution-sva/pt/partners/");
 tracker.start();
 assert.equal(tracker.event("dsva_language_switch","distribution").accepted,true);
 assert.equal(tracker.event("dsva_partner_interest","distribution").accepted,true);
 assert.equal(tracker.event("dsva_faq_open","distribution").accepted,true);
 const events=calls.filter(x=>x[0]==="event");
 assert.equal(events.length,3);
 for(const e of events){
  assert.equal(e[2].send_to,"G-ABC1234567");
  assert.equal(e[2].pgi_business_unit,"direct_sva");
  assert.deepEqual(Object.keys(e[2]).sort(),
   ["send_to","pgi_business_unit","pgi_funnel_stage","pgi_service_type"].sort());
 }
 assert.equal(tracker.event("purchase","distribution").accepted,false);
 assert.equal(tracker.event("dsva_language_switch","personal-email").accepted,false);
});
test("consent and wrong property always fail closed",()=>{
 for(const ga4 of [{enabled:false},{measurementId:"G-SZY50J75N7"},{consentGranted:false},{legalApproved:false},{customDimensionRegistered:false},{dedicatedPropertyConfirmed:false}]){
  const {tracker,scripts,calls}=setup("/distribution-sva/",{ga4});
  assert.equal(tracker.start().enabled,false);
  assert.equal(tracker.pageView().accepted,false);
  assert.equal(scripts.length,0);
  assert.equal(calls.length,0);
 }
});
test("all sensitive/private or foreign page paths are untracked",()=>{
 for(const path of ["/client.html","/distribution-sva/espace-client/","/distribution-sva/espace-client/mes-donnees/","/distribution-sva/conditions/","/distribution-sva/mentions-legales/","/distribution-sva/confidentialite/"]){
  assert.equal(setup(path).tracker.start().enabled,false,path);
 }
 assert.equal(setup("/distribution-sva/en/",{hostname:"example.com"}).tracker.start().enabled,false);
 assert.equal(setup("/distribution-sva/en/",{gpc:true}).tracker.start().enabled,false);
});
test("browser consent UI remains independent, multilingual and revocable",()=>{
 const html=fs.readFileSync("site/distribution-sva/measurement.js","utf8");
 const runner=fs.readFileSync("site/distribution-sva/site.js","utf8");
 for(const k of ["en","es","pt","de","it","fr"])assert.ok(html.includes(k+":{heading:"),"missing language "+k);
 assert.match(html,/const STORAGE_KEY="pgi_dsva_analytics_consent_v1"/);
 assert.match(html,/navigator\.globalPrivacyControl!==true/);
 assert.match(html,/window\["ga-disable-"\+MEASUREMENT_ID\]=true/);
 assert.match(html,/tracker\.pageView\(\)/);
 assert.match(html,/window\.gtag\?\.\("consent","update"/);
 assert.match(runner,/analytics\?\.dedicatedPropertyConfirmed===true/);
 assert.ok(runner.includes("!document.querySelector(\u0027script[src*=\u0022/site/distribution-sva/measurement.js\u0022]\u0027)"));
 assert.doesNotMatch(runner,/G-SZY50J75N7/);
});

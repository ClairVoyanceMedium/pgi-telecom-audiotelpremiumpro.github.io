import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const base="https://audiotel-premium-pro.com/distribution-sva/";
const frPaths=["","solutions/","business-live/","transition/","conformite/","espace-client/","reclamations/","conditions/","mentions-legales/","confidentialite/","architecture-reseau/","numerotation/","interconnexion-routage/","releves-reversements/","partenaires/","questions-frequentes/"];
const locales=["fr","en","es","pt","de","it"];
const comparable=["home","solutions","faq","partners"];
function route(lang,type){
  if(lang==="fr")return {home:"",solutions:"solutions/",faq:"questions-frequentes/",partners:"partenaires/"}[type];
  return lang+"/"+(type==="home"?"":type+"/");
}
function source(suffix){return fs.readFileSync("site/distribution-sva/"+suffix+"index.html","utf8");}
function linksFrom(html){return [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(x=>x[1]);}
function canonical(html){return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]??"";}

test("sixteen French distribution pages have their own canonical, embargo and heading",()=>{
  const titles=new Set();
  for(const suffix of frPaths){
    const html=source(suffix);
    assert.match(html,/<html lang="fr">/);
    assert.match(html,/<meta name="robots" content="noindex,nofollow,noarchive">/);
    if(suffix==="espace-client/")assert.equal(canonical(html),"","private customer portal must not advertise an indexable canonical");
    else assert.equal(canonical(html),base+suffix,"canonical mismatch "+suffix);
    assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,"h1 mismatch "+suffix);
    const title=html.match(/<title>(.*?)<\/title>/)?.[1];
    assert.ok(title&&!titles.has(title),"duplicate/missing title "+suffix);
    titles.add(title);
  }
});
test("twenty international pages are localized, independently identified and substantive",()=>{
  for(const lang of locales.filter(x=>x!=="fr"))for(const type of comparable){
    const suffix=route(lang,type),html=source(suffix);
    assert.ok(html.includes('<html lang="'+lang+'">'),"language "+suffix);
    assert.ok(html.includes('name="robots" content="noindex,nofollow,noarchive"'),"release embargo "+suffix);
    assert.equal(canonical(html),base+suffix);
    assert.match(html,/<meta name="description" content="[^"]{60,}">/);
    assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1);
    assert.match(html,/<details><summary>[^<]+<\/summary><p>[^<]+<\/p><\/details>/);
    const match=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match,"schema missing "+suffix);
    const schema=JSON.parse(match[1]);
    const page=schema["@graph"]?.find(x=>x["@type"]==="WebPage")||schema;
    assert.equal(page.url,base+suffix);
    assert.equal(page.inLanguage,lang);
    assert.ok(linksFrom(html).includes("/distribution-sva/"+lang+"/partners/"),"partner navigation "+suffix);
    assert.ok(type==="partners"||linksFrom(html).includes("/distribution-sva/confidentialite/"),"legal notice "+suffix);
  }
});
test("reciprocal hreflang references, self canonical and French x-default exist",()=>{
  for(const type of comparable)for(const lang of locales){
    const html=source(route(lang,type));
    for(const peer of locales){
      const expected='<link rel="alternate" hreflang="'+peer+'" href="'+base+route(peer,type)+'">';
      assert.ok(html.includes(expected),"missing alternate "+lang+"/"+type+" to "+peer);
    }
    assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="'+base+route("fr",type)+'">'));
    assert.equal(canonical(html),base+route(lang,type));
  }
});
test("French telecom landing page links six technical dossiers without merging Audiotel",()=>{
  const home=source("");
  for(const suffix of frPaths.slice(10)){
    assert.ok(linksFrom(home).includes("/distribution-sva/"+suffix),"missing internal link "+suffix);
  }
  assert.match(home,/<h1>Pôle Télécom &amp; Réseau<\/h1>/);
  assert.match(home,/Audiotel Premium Pro/);
  assert.match(home,/PGI Telecom Distribution/);
  assert.match(source("questions-frequentes/"),/assistants vocaux|moteurs de réponse/);
});
test("direct telecom SEO remains unpublished until distinct launch approval",()=>{
  const build=fs.readFileSync("scripts/build-static.mjs","utf8");
  const server=fs.readFileSync("backend/src/static-site.mjs","utf8");
  const sitemap=fs.readFileSync("sitemap.xml","utf8");
  const marketing=fs.readFileSync("site/index.html","utf8");
  assert.doesNotMatch(build,/["']site\/distribution-sva\/(?:en|es|pt|de|it|index\.html)/);
  assert.match(server,/distribution-sva/);
  assert.match(server,/res\.writeHead\(404/);
  assert.doesNotMatch(sitemap,/\/distribution-sva\//);
  assert.match(marketing,/class="header-distribution-link" href="\/distribution-sva\/" hidden>Pôle Télécom &amp; Réseau<\/a>/);
});

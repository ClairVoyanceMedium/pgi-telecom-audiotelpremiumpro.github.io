import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";

test("production static build publishes marketing root and private cockpit",()=>{
  fs.rmSync("dist",{recursive:true,force:true});
  try{
    execFileSync(process.execPath,["scripts/build-static.mjs"],{
      env:{
        ...process.env,
        PGI_RUNTIME_MODE:"production",
        PGI_API_BASE_URL:"/api/v1",
        PGI_RELEASE_ID:"c".repeat(40),
        VERCEL_PROJECT_PRODUCTION_URL:"pgi-test.vercel.app"
      },
      stdio:"pipe"
    });

    const root=fs.readFileSync("dist/index.html","utf8");
    const cockpit=fs.readFileSync("dist/cockpit.html","utf8");
    const legacy=fs.readFileSync("dist/site/index.html","utf8");
    const robots=fs.readFileSync("dist/robots.txt","utf8");
    const sitemap=fs.readFileSync("dist/sitemap.xml","utf8");
    const seoSlugs=["audiotel-voyance","audiotel-coaching","audiotel-professionnels","reversement-audiotel","numero-sva","comparateur-audiotel","guide-audiotel-sva","demande-ouverture","mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","cookies-traceurs","resilier-contrat","retractation"];
    const seoPages=seoSlugs.map(slug=>fs.readFileSync("dist/"+slug+"/index.html","utf8"));

    assert.match(root,/Pilotez votre activité/);
    assert.match(root,/Voyance &amp; astrologie/);
    assert.match(root,/Solution Audiotel et SVA/);
    assert.match(root,/max-snippet:-1/);
    assert.doesNotMatch(root,/Cockpit \/ PGI Telecom/);
    assert.match(root,/href="site\/site\.css"/);
    assert.match(root,/src="site\/site\.js"/);
    assert.doesNotMatch(root,/\.\.\/assets\//);
    assert.match(root,/rel="canonical" href="https:\/\/pgi-test\.vercel\.app\/"/);
    assert.match(root,/property="og:url" content="https:\/\/pgi-test\.vercel\.app\/"/);
    assert.match(root,/"@type":"Organization"/);
    assert.match(root,/"logo":"https:\/\/pgi-test\.vercel\.app\/assets\/audiotel-brand-logo-v33\.png"/);
    assert.match(root,/name="twitter:image" content="https:\/\/pgi-test\.vercel\.app\/assets\/audiotel-brand-logo-v33\.png"/);

    assert.match(cockpit,/Cockpit \/ PGI Telecom/);
    assert.match(cockpit,/noindex,nofollow,noarchive/);

    assert.match(legacy,/rel="canonical" href="https:\/\/pgi-test\.vercel\.app\/"/);
    assert.match(robots,/Disallow: \/cockpit/);
    assert.match(robots,/Sitemap: https:\/\/pgi-test\.vercel\.app\/sitemap\.xml/);
    assert.match(sitemap,/<loc>https:\/\/pgi-test\.vercel\.app\/<\/loc>/);
    for(const slug of seoSlugs)assert.match(sitemap,new RegExp("<loc>https:\\/\\/pgi-test\\.vercel\\.app\\/"+slug+"\\/<\\/loc>"));
    seoPages.forEach((page,index)=>{
      const slug=seoSlugs[index],legal=["mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","cookies-traceurs","resilier-contrat","retractation"].includes(slug);
      assert.match(page,new RegExp('rel="canonical" href="https:\\/\\/pgi-test\\.vercel\\.app\\/'+slug+'\\/"'));
      if(!legal){assert.match(page,/"@type":"WebPage"/);assert.match(page,/"@type":"Service"/);}
      assert.doesNotMatch(page,/__CANONICAL__|__BASE__|__LOGO__/);
      if(slug!=="demande-ouverture")assert.doesNotMatch(page,/<script[^>]+src=/i);
    });
    const comparator=seoPages[seoSlugs.indexOf("comparateur-audiotel")];
    assert.match(comparator,/1 800 € \/ mois/);
    assert.match(comparator,/0,10 € \/ min/);
    assert.match(comparator,/"@type":"FAQPage"/);
    assert.match(comparator,/"@type":"BreadcrumbList"/);
    const guide=seoPages[seoSlugs.indexOf("guide-audiotel-sva")];
    assert.match(guide,/Qu’est-ce qu’Audiotel/);
    assert.match(guide,/"@type":"FAQPage"/);
    assert.match(guide,/"@type":"BreadcrumbList"/);
    const application=seoPages[seoSlugs.indexOf("demande-ouverture")];
    assert.match(application,/id="order-form"/);
    assert.match(application,/src="\/site\/site\.js"/);
    assert.match(application,/Continuer vers l’espace sécurisé/);
    const privacy=seoPages[seoSlugs.indexOf("confidentialite")];
    const terms=seoPages[seoSlugs.indexOf("conditions-abonnement")];
    assert.match(privacy,/Paiements Stripe/);
    assert.match(privacy,/CNIL/);
    assert.match(terms,/3,00 € TTC par mois/);
    assert.match(terms,/opérateur → PGI → client/);
  }finally{
    fs.rmSync("dist",{recursive:true,force:true});
  }
});

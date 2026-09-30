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
        VERCEL_PROJECT_PRODUCTION_URL:"audiotel-premium-pro.com"
      },
      stdio:"pipe"
    });

    const root=fs.readFileSync("dist/index.html","utf8");
    const cockpit=fs.readFileSync("dist/cockpit.html","utf8");
    const legacy=fs.readFileSync("dist/site/index.html","utf8");
    const robots=fs.readFileSync("dist/robots.txt","utf8");
    const sitemap=fs.readFileSync("dist/sitemap.xml","utf8");
    const llms=fs.readFileSync("dist/llms.txt","utf8");
    const llmsFull=fs.readFileSync("dist/llms-full.txt","utf8");
    const hubspotTracking=fs.readFileSync("dist/site/hubspot-tracking.js","utf8");
    const indexNowKey=fs.readFileSync("dist/fa0a7deb5d60bdf1260c8174ad8c71db.txt","utf8").trim();
    const seoSlugs=["audiotel-voyance","audiotel-independants","audiotel-coaching","audiotel-professionnels","reversement-audiotel","numero-sva","tarif-numero-sva","numero-surtaxe-08","portabilite-numero-sva","comparateur-audiotel","guide-audiotel-sva","demande-ouverture","mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","accord-traitement-donnees","cookies-traceurs","resilier-contrat","retractation"];
    const seoPages=seoSlugs.map(slug=>fs.readFileSync("dist/"+slug+"/index.html","utf8"));

    assert.match(root,/Monétisez vos appels/);
    assert.match(root,/BESOIN D’UN NUMÉRO SURTAXÉ/);
    assert.match(root,/href="\/reversement-audiotel\//);
    assert.match(root,/href="\/numero-sva\//);
    assert.match(root,/max-snippet:-1/);
    assert.doesNotMatch(root,/Cockpit \/ PGI Telecom/);
    assert.match(root,/href="site\/site\.css"/);
    assert.match(root,/src="site\/site\.js"/);
    assert.match(root,/href="\/site\/contact-widget\.css"/);
    assert.match(root,/src="\/site\/contact-widget\.js"/);
    assert.doesNotMatch(root,/\.\.\/assets\//);
    assert.match(root,/rel="canonical" href="https:\/\/audiotel-premium-pro\.com\/"/);
    assert.match(root,/property="og:url" content="https:\/\/audiotel-premium-pro\.com\/"/);
    assert.match(root,/"@type":"WebSite"/);
    assert.match(root,/"@type":"Organization"/);
    assert.match(root,/"@type":"WebPage"/);
    assert.ok(root.includes('"@id":"https://audiotel-premium-pro.com/#service"'));
    assert.ok(root.includes('"@id":"https://audiotel-premium-pro.com/#logo"'));
    assert.ok(root.includes('"contentUrl":"https://audiotel-premium-pro.com/assets/audiotel-brand-logo-v33.png"'));
    assert.match(root,/name="twitter:image" content="https:\/\/audiotel-premium-pro\.com\/assets\/audiotel-brand-logo-v33\.png"/);

    assert.match(cockpit,/Cockpit \/ PGI Telecom/);
    assert.match(cockpit,/noindex,nofollow,noarchive/);

    assert.match(legacy,/rel="canonical" href="https:\/\/audiotel-premium-pro\.com\/"/);
    assert.match(robots,/Disallow: \/cockpit/);
    for(const agent of ["Bingbot","OAI-SearchBot","Claude-SearchBot","PerplexityBot","Applebot"])assert.ok(robots.includes("User-agent: "+agent),agent+" missing from robots.txt");
    assert.match(robots,/Sitemap: https:\/\/audiotel-premium-pro\.com\/sitemap\.xml/);
    assert.match(sitemap,/<loc>https:\/\/audiotel-premium-pro\.com\/<\/loc>/);
    for(const slug of seoSlugs.filter(x=>x!=="mentions-legales"))assert.match(sitemap,new RegExp("<loc>https:\\/\\/audiotel-premium-pro\\.com\\/"+slug+"\\/<\\/loc>"));
    assert.doesNotMatch(sitemap,/mentions-legales/);
    for(const forbidden of ["client.html","cockpit","backend/","docs/"])assert.ok(!sitemap.includes(forbidden));
    assert.doesNotMatch(sitemap,/<changefreq>|<priority>/);
    const reversementLastmod=execFileSync("git",["log","-1","--format=%cs","--","site/seo/reversement-audiotel.html"],{encoding:"utf8"}).trim();
    assert.match(reversementLastmod,/^\d{4}-\d{2}-\d{2}$/);
    assert.ok(sitemap.includes("<loc>https://audiotel-premium-pro.com/reversement-audiotel/</loc>\n    <lastmod>"+reversementLastmod+"</lastmod>"));
    assert.ok(llms.includes("Audiotel Premium Pro | PGI Telecom"));
    assert.match(llms,/guide-audiotel-sva/);
    assert.match(llmsFull,/Official French references/);
    assert.match(hubspotTracking,/PORTAL_ID="149417663"/);
    assert.match(hubspotTracking,/pgi_tracking_consent_v1/);
    assert.equal(indexNowKey,"fa0a7deb5d60bdf1260c8174ad8c71db");
    seoPages.forEach((page,index)=>{
      const slug=seoSlugs[index],legal=["mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","accord-traitement-donnees","cookies-traceurs","resilier-contrat","retractation"].includes(slug);
      assert.match(page,new RegExp('rel="canonical" href="https:\\/\\/audiotel-premium-pro\\.com\\/'+slug+'\\/"'));
      if(!legal){assert.match(page,/"@type":"WebPage"/);assert.match(page,/"@type":"Service"/);}
      assert.doesNotMatch(page,/__CANONICAL__|__BASE__|__LOGO__/);
      const scripts=[...page.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(x=>x[1]);
      const allowedScripts={
        "demande-ouverture":["/site/form-ux.js","/site/site.js","/site/hubspot-tracking.js","/site/contact-widget.js"],
        "retractation":["/site/hubspot-tracking.js","/assets/config.js","/assets/withdrawal.js","/site/contact-widget.js"]
      }[slug]||["/site/hubspot-tracking.js","/site/contact-widget.js"];
      for(const src of scripts)assert.ok(allowedScripts.includes(src),"unexpected public script on "+slug+": "+src);
      assert.ok(scripts.includes("/site/contact-widget.js"),"contact widget missing on "+slug);
      assert.match(page,/href="\/site\/contact-widget\.css"/);
    });
    const independants=seoPages[seoSlugs.indexOf("audiotel-independants")];
    assert.match(independants,/avec ou sans SIRET/i);
    assert.match(independants,/"@type":"FAQPage"/);
    assert.match(independants,/"@type":"BreadcrumbList"/);
    assert.match(independants,/src="\/site\/hubspot-tracking\.js"/);
    const comparator=seoPages[seoSlugs.indexOf("comparateur-audiotel")];
    assert.match(comparator,/1 800 € \/ mois/);
    assert.match(comparator,/0,10 € \/ min/);
    assert.match(comparator,/"@type":"FAQPage"/);
    assert.match(comparator,/"@type":"BreadcrumbList"/);
    const guide=seoPages[seoSlugs.indexOf("guide-audiotel-sva")];
    assert.match(guide,/Qu’est-ce qu’Audiotel/);
    assert.match(guide,/"@type":"FAQPage"/);
    assert.match(guide,/"@type":"BreadcrumbList"/);
    assert.match(guide,/"@type":"Article"/);
    assert.match(guide,/Arcep — numéros SVA/);
    assert.ok(guide.includes("economie.gouv.fr"));
    const application=seoPages[seoSlugs.indexOf("demande-ouverture")];
    assert.match(application,/id="order-form"/);
    assert.match(application,/src="\/site\/site\.js"/);
    assert.match(application,/Continuer vers l’espace sécurisé/);
    const privacy=seoPages[seoSlugs.indexOf("confidentialite")];
    const terms=seoPages[seoSlugs.indexOf("conditions-abonnement")];
    assert.match(privacy,/Données financières/);
    assert.match(privacy,/CNIL/);
    assert.match(terms,/3,00 € TTC par mois/);
    assert.match(terms,/Reversements/);
  }finally{
    fs.rmSync("dist",{recursive:true,force:true});
  }
});

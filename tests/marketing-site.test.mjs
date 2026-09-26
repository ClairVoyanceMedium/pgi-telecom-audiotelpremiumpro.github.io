import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("site/index.html","utf8");
const css=fs.readFileSync("site/site.css","utf8");
const js=fs.readFileSync("site/site.js","utf8");
const robots=fs.readFileSync("robots.txt","utf8");
const sitemap=fs.readFileSync("sitemap.xml","utf8");
const cockpit=fs.readFileSync("index.html","utf8");
const client=fs.readFileSync("client.html","utf8");
const application=fs.readFileSync("site/seo/demande-ouverture.html","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");

test("public site targets individuals, project holders and professionals without sector lock-in",()=>{
  assert.match(html,/AUDIOTEL · SVA · PARTICULIERS · PROFESSIONNELS/);
  assert.match(html,/SIRET FACULTATIF À LA DEMANDE/);
  assert.match(html,/Demander un compte particulier/);
  assert.match(html,/Demander un compte professionnel/);
  assert.match(html,/Vous pouvez commencer avec ou sans SIRET/);
  assert.match(html,/Le numéro SVA n’est pas réservé à un métier particulier/);
  assert.doesNotMatch(html,/Voyance &amp; astrologie|AUDIOTEL POUR VOYANCE/i);
});

test("public homepage links to focused SEO content without changing the signup flow",()=>{
  assert.match(html,/href="\/audiotel-independants\//);
  assert.match(html,/href="\/audiotel-coaching\//);
  assert.match(html,/href="\/audiotel-professionnels\//);
  assert.match(html,/href="\/reversement-audiotel\//);
  assert.match(html,/href="\/numero-sva\//);
  assert.match(html,/href="\/comparateur-audiotel\//);
  assert.match(html,/href="\/demande-ouverture\//);
  assert.match(html,/3 € TTC par mois pour la plateforme/);
  assert.doesNotMatch(html,/href="#commande"/);
});

test("public pricing and revenue example stay explicit and non-guaranteed",()=>{
  assert.match(html,/3 € TTC \/ mois/);
  assert.match(html,/Facturé mensuellement d’avance/);
  assert.match(html,/Contrat à durée indéterminée/);
  assert.match(html,/Résiliation possible à tout moment/);
  assert.match(html,/0,10 € HT \/ min/);
  assert.match(html,/1 800 € HT/);
  assert.match(html,/Simulation non contractuelle/);
  assert.match(html,/pas une promesse commerciale/);
  assert.match(html,/ne constituent pas une garantie de revenus/);
  assert.doesNotMatch(html,/revenu garanti|gains garantis/i);
});

test("homepage exposes a transparent fixed-fee savings comparison",()=>{
  assert.match(html,/ÉCONOMIES MESURABLES/);
  assert.match(html,/id="current-platform-fee"/);
  assert.match(html,/id="savings-month"/);
  assert.match(html,/id="savings-year"/);
  assert.match(html,/30 € TTC \/ mois/);
  assert.match(html,/27 € \/ mois/);
  assert.match(html,/324 € \/ an/);
  assert.match(js,/monthly=Math\.max\(0,current-3\)/);
  assert.match(js,/monthly\*12/);
  assert.match(html,/ne prétend pas représenter le tarif d’un concurrent déterminé/);
});

test("calculator uses transparent minutes times rate arithmetic",()=>{
  assert.match(js,/const minutes=h\*60\*d/);
  assert.match(js,/const perMonth=minutes\*r/);
  assert.match(js,/perMonth\*12/);
  assert.match(html,/id="rate"/);
  assert.match(html,/id="hours"/);
  assert.match(html,/id="days"/);
});

test("marketing surface is indexable while private surfaces remain noindex",()=>{
  assert.match(html,/name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"/);
  assert.match(cockpit,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(client,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(robots,/Allow: \/$/m);
  assert.match(robots,/Disallow: \/client\.html/);
  assert.match(sitemap,/audiotel-premium-pro\.com\//);
});

test("public site remains self-contained and mobile responsive",()=>{
  assert.doesNotMatch(html,/<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(css,/url\(["']?https?:\/\//i);
  assert.match(html,/name="viewport"/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(html,/href="\.\.\/client\.html"/);
});


test("public site provides a real registration handoff without leaking PII in the URL",()=>{
  assert.match(html,/id="order-form"/);
  assert.match(html,/order_account_type/);
  assert.match(html,/id="order-service-intent"/);
  assert.match(html,/Demander l’ouverture/);
  assert.match(js,/sessionStorage\.setItem\(KEY,JSON\.stringify\(intent\)\)/);
  assert.match(js,/location\.href="\.\.\/client\.html\?register=1"/);
  assert.doesNotMatch(js,/location\.href=.*email|URLSearchParams.*email/);
});

test("dedicated opening page preselects profiles and preserves an unfinished session draft",()=>{
  assert.match(application,/id="order-form"/);
  assert.match(application,/Continuer vers l’espace sécurisé/);
  assert.match(application,/Aucune donnée personnelle dans l’URL/);
  assert.match(js,/pgi_public_order_draft_v1/);
  assert.match(js,/new URLSearchParams\(location\.search\)\.get\("profil"\)/);
  assert.match(js,/sessionStorage\.removeItem\(DRAFT_KEY\)/);
});

test("marketing conversion uses trust and legitimate urgency without fabricated scarcity",()=>{
  assert.match(html,/Préparez votre dossier maintenant/);
  assert.match(html,/Aucun paiement à cette étape/);
  assert.match(html,/Validation avant mise en service/);
  assert.match(html,/audiotel-brand-logo-v33\.png/);
  assert.doesNotMatch(html,/places restantes|plus que \d+|compte à rebours|dernière chance|clients en ligne/i);
});


test("marketing page exposes structured service data without fabricated social proof",()=>{
  assert.match(html,/application\/ld\+json/);
  assert.match(html,/"@type":"Service"/);
  assert.match(html,/"price":"3\.00"/);
  assert.match(html,/"priceCurrency":"EUR"/);
  assert.match(html,/0,10 € par jour/);
  assert.doesNotMatch(html,/aggregateRating|"review"|bestRating|ratingValue/);
});

test("marketing metadata declares the canonical social URL",()=>{
  assert.match(html,/property="og:url" content="https:\/\/audiotel-premium-pro\.com\/"/);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
});


test("public SEO sources never expose the legacy GitHub identity",()=>{
  for(const value of [html,robots,sitemap,buildStatic])assert.doesNotMatch(value,/clairvoyancemedium\.github\.io/i);
  assert.match(buildStatic,/audiotel-premium-pro\.com/);
});

test("public funnels preserve legal customer qualification and non-promissory finance wording",()=>{
  const independants=fs.readFileSync("site/seo/audiotel-independants.html","utf8");
  const number=fs.readFileSync("site/seo/numero-sva.html","utf8");
  const comparator=fs.readFileSync("site/seo/comparateur-audiotel.html","utf8");
  const liveFinance=fs.readFileSync("assets/client-live-finance.js","utf8");
  assert.match(independants,/sans être limité à un secteur particulier/i);
  assert.match(independants,/avec ou sans SIRET/i);
  assert.doesNotMatch(independants,/voyance|astrologie/i);
  assert.match(number,/particuliers et professionnels/i);
  assert.match(comparator,/écart économique potentiel/i);
  assert.doesNotMatch(comparator,/<title>[^<]*gain potentiel/i);
  assert.match(liveFinance,/ESTIMATION PERSONNELLE/);
  assert.match(liveFinance,/reversements validés font foi/);
});

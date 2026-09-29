import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("site/index.html","utf8");
const css=fs.readFileSync("site/site.css","utf8");
const js=fs.readFileSync("site/site.js","utf8");
const tracking=fs.readFileSync("site/hubspot-tracking.js","utf8");
const contactWidget=fs.readFileSync("site/contact-widget.js","utf8");
const formUx=fs.readFileSync("site/form-ux.js","utf8");
const contactCss=fs.readFileSync("site/contact-widget.css","utf8");
const robots=fs.readFileSync("robots.txt","utf8");
const sitemap=fs.readFileSync("sitemap.xml","utf8");
const cockpit=fs.readFileSync("index.html","utf8");
const client=fs.readFileSync("client.html","utf8");
const application=fs.readFileSync("site/seo/demande-ouverture.html","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");
const llms=fs.readFileSync("llms.txt","utf8");
const llmsFull=fs.readFileSync("llms-full.txt","utf8");
const manifest=fs.readFileSync("site/manifest.webmanifest","utf8");
const guide=fs.readFileSync("site/seo/guide-audiotel-sva.html","utf8");

test("public site targets both individuals and professionals",()=>{
  assert.match(html,/AUDIOTEL · SVA · PARTICULIERS · INDÉPENDANTS · ENTREPRISES/);
  assert.match(html,/Demander un compte particulier/);
  assert.match(html,/Demander un compte professionnel/);
  assert.match(html,/PARTICULIERS, PORTEURS DE PROJET/);
  assert.match(html,/demande initiale.*sans SIRET/i);
});

test("public homepage links to focused SEO content without changing the signup flow",()=>{
  assert.match(html,/href="\/audiotel-voyance\//);
  assert.match(html,/href="\/audiotel-independants\//);
  assert.match(html,/href="\/audiotel-coaching\//);
  assert.match(html,/href="\/audiotel-professionnels\//);
  assert.match(html,/href="\/reversement-audiotel\//);
  assert.match(html,/href="\/numero-sva\//);
  assert.match(html,/href="\/comparateur-audiotel\//);
  assert.match(html,/href="\/demande-ouverture\//);
  assert.match(html,/Objectif PGI : une offre plus compétitive/);
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



test("floating contact stays low-friction and submits directly without opening an email client",()=>{
  assert.match(contactWidget,/contact-widget-button/);
  assert.match(contactWidget,/Votre adresse email/);
  assert.match(contactWidget,/Votre message/);
  assert.match(contactWidget,/\/api\/v1\/public\/contact/);
  assert.match(contactCss,/\.contact-widget-panel/);
  assert.match(contactCss,/\.contact-widget-backdrop/);
  assert.match(contactCss,/\.contact-widget-honeypot/);
  assert.match(contactWidget,/aria-modal="true"/);
  assert.match(contactWidget,/contact-widget-backdrop/);
  assert.match(contactWidget,/e\.key==="Tab"/);
  assert.match(contactWidget,/pointerdown/);
  assert.match(contactWidget,/pointermove/);
  assert.match(contactWidget,/setPointerCapture/);
  assert.match(contactWidget,/clampWidgetToViewport/);
  assert.match(contactCss,/touch-action:none/);
  assert.match(contactCss,/width:27px;height:27px/);
  assert.doesNotMatch(contactWidget,/mailto:/i);
  assert.doesNotMatch(contactWidget,/Votre téléphone|Votre prénom|Objet de votre demande/);
  assert.match(buildStatic,/site\/contact-widget\.js/);
  assert.match(buildStatic,/site\/form-ux\.js/);
  for(const event of ["contact_widget_open","contact_form_start","contact_message_submit","contact_message_success","contact_message_error"])assert.ok(contactWidget.includes(event),event+" missing");
  assert.match(contactWidget,/contact_context/);
  assert.match(contactWidget,/floating_email_widget/);
  assert.match(contactWidget,/crm_sync/);
  assert.doesNotMatch(contactWidget,/track\([^)]*\{[^}]*\b(email|message|page_title|page_path)\s*:/i);
});



test("GA4 measurement model groups content, classifies AI referrals and tracks the commercial funnel without PII",()=>{
  assert.match(tracking,/content_group/);
  assert.match(tracking,/traffic_origin/);
  for(const source of ["ai_chatgpt","ai_perplexity","ai_copilot","ai_gemini","ai_claude"])assert.ok(tracking.includes(source),source+" missing");
  assert.match(tracking,/paymentReferrer/);
  assert.match(tracking,/ignore_referrer:true/);
  for(const event of ["select_content","order_form_start","order_form_submit","order_form_error","order_form_abandon","registration_view","email_verification_required","page_performance"])assert.ok(tracking.includes(event),event+" missing");
  for(const metric of ["lcp_ms","cls_milli","ttfb_ms","interaction_latency_p98_ms"])assert.ok(tracking.includes(metric),metric+" missing");
  assert.match(js,/if\(r\.ok\)window\.PGIAnalytics\?\.track\("generate_lead"\)/);
  assert.doesNotMatch(tracking,/traffic_origin\s*:\s*document\.referrer/);
  assert.doesNotMatch(tracking,/track\([^\n]*(first_name|last_name|company_name|phone)/i);
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
  assert.match(html,/"@type":"WebSite"/);
  assert.match(html,/"@type":"Organization"/);
  assert.match(html,/"@type":"WebPage"/);
  assert.match(html,/"@type":"Service"/);
  assert.ok(html.includes("support@audiotel-premium-pro.com"));
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

test("independent and project-holder landing preserves broad eligibility without deleting niche SEO",()=>{
  const independants=fs.readFileSync("site/seo/audiotel-independants.html","utf8");
  const voyance=fs.readFileSync("site/seo/audiotel-voyance.html","utf8");
  assert.match(independants,/avec ou sans SIRET/i);
  assert.match(independants,/"@type":"FAQPage"/);
  assert.match(independants,/"@type":"BreadcrumbList"/);
  assert.match(independants,/hubspot-tracking\.js/);
  assert.match(voyance,/Audiotel/i);
  assert.match(sitemap,/audiotel-independants/);
  assert.match(sitemap,/audiotel-voyance/);
});

test("public funnels preserve legal customer qualification and non-promissory finance wording",()=>{
  const voyance=fs.readFileSync("site/seo/audiotel-voyance.html","utf8");
  const number=fs.readFileSync("site/seo/numero-sva.html","utf8");
  const comparator=fs.readFileSync("site/seo/comparateur-audiotel.html","utf8");
  const liveFinance=fs.readFileSync("assets/client-live-finance.js","utf8");
  assert.doesNotMatch(voyance,/demande-ouverture\/\?profil=particulier/);
  assert.match(number,/particuliers et professionnels/i);
  assert.match(comparator,/écart économique potentiel/i);
  assert.doesNotMatch(comparator,/<title>[^<]*gain potentiel/i);
  assert.match(liveFinance,/ESTIMATION PERSONNELLE/);
  assert.match(liveFinance,/reversements validés font foi/);
});

test("machine-readable discovery stays factual and public-only",()=>{
  assert.ok(llms.includes("Canonical: https://audiotel-premium-pro.com/"));
  assert.match(llms,/Do not treat \/client\.html, \/cockpit/);
  assert.match(llmsFull,/Never describe a simulated reversement as guaranteed income/);
  assert.match(llmsFull,/Arcep/);
  assert.match(manifest,/Audiotel Premium Pro \\| PGI Telecom/);
  assert.doesNotMatch(manifest,/Cockpit \/ PGI Telecom/);
});

test("guide cites current official sources for regulatory explanations",()=>{
  assert.match(guide,/"@type":"Article"/);
  assert.match(guide,/www\.arcep\.fr\/mes-demarches-et-services\/consommateurs/);
  assert.match(guide,/www\.economie\.gouv\.fr\/particuliers/);
  assert.match(guide,/Quels sont les principaux types de numéros en 08 \?/);
});


test("public forms keep validation inside the responsive layout instead of native mobile bubbles",()=>{
  assert.match(html,/site\/form-ux\.js/);
  assert.match(application,/site\/form-ux\.js/);
  assert.match(formUx,/form\.noValidate=true/);
  assert.match(formUx,/form\.checkValidity\(\)/);
  assert.match(formUx,/stopImmediatePropagation/);
  assert.match(formUx,/scrollIntoView\(\{block:"center",inline:"nearest"/);
  assert.doesNotMatch(contactWidget,/reportValidity\(\)/);
  assert.match(contactWidget,/checkValidity\(\)/);
  assert.match(contactCss,/font-size:16px/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("site/index.html","utf8");
const css=fs.readFileSync("site/site.css","utf8");
const paymentCardCss=fs.readFileSync("site/payment-card.css","utf8");
const js=fs.readFileSync("site/site.js","utf8");
const siteSearch=fs.readFileSync("site/site-search.js","utf8");
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
const terms=fs.readFileSync("site/seo/conditions-abonnement.html","utf8");
const cardPaymentsLanding=fs.readFileSync("site/seo/paiement-cb-audiotel.html","utf8");
const solutions=fs.readFileSync("site/seo/solutions-audiotel.html","utf8");
const switchOperator=fs.readFileSync("site/seo/changer-operateur-audiotel.html","utf8");
const portability=fs.readFileSync("site/seo/portabilite-numero-sva.html","utf8");
const priorityPortability=fs.readFileSync("site/seo/portabilite-prioritaire.html","utf8");
const referralLanding=fs.readFileSync("site/seo/parrainage-audiotel.html","utf8");
const clientReferral=fs.readFileSync("assets/client-referral.js","utf8");
const withoutSiret=fs.readFileSync("site/seo/audiotel-sans-siret.html","utf8");
const businessLive=fs.readFileSync("site/seo/business-live-audiotel.html","utf8");
const legalNotice=fs.readFileSync("site/seo/mentions-legales.html","utf8");

test("public site targets both individuals and professionals without overloading the homepage",()=>{
  assert.match(html,/Particulier ou professionnel/);
  assert.match(html,/particuliers et professionnels/i);
  assert.match(application,/Particulier \/ porteur de projet/);
  assert.match(application,/Professionnel \/ entreprise/);
});

test("focused SEO pages remain published without cluttering the homepage",()=>{
  assert.match(buildStatic,/LANDING_SEO_META/);
  assert.match(buildStatic,/Audiotel Premium Pro/);
  for(const slug of ["audiotel-voyance","audiotel-independants","audiotel-coaching","audiotel-professionnels","reversement-audiotel","numero-sva","comparateur-audiotel"]){
    assert.match(sitemap,new RegExp(slug));
    if(!["reversement-audiotel","numero-sva","comparateur-audiotel"].includes(slug))assert.ok(!html.includes('href="/'+slug+'/'),"homepage should not foreground "+slug);
  }
  assert.match(html,/href="\/demande-ouverture\//);
  assert.match(html,/id="simulateur"/);
  assert.ok(html.indexOf('id="simulateur"')<html.indexOf('class="proof-strip"'));
});

test("public pricing and savings simulation stay explicit and non-guaranteed",()=>{
  assert.match(html,/4,90€ TTC \/ mois/);
  assert.match(html,/Le mois en cours est offert/);
  assert.match(html,/Sans engagement de durée/);
  assert.match(html,/Résiliation possible à tout moment/);
  assert.match(html,/Écart de reversement entre les deux offres \/ minute/);
  assert.match(html,/Gain potentiel en plus \/ mois/);
  assert.match(html,/id="saving-month">\+132 €/);
  assert.match(js,/saving-month"\)\.textContent="\+"\+money\.format\(perMonth\)/);
  assert.match(html,/Simulation indicative et non contractuelle/);
  assert.match(html,/ne constituent pas une garantie d’économies/);
  assert.doesNotMatch(html,/revenu garanti|gains garantis|économies garanties/i);
});

test("homepage savings calculator uses transparent volume times favorable-gap arithmetic",()=>{
  assert.match(js,/const minutes=h\*60\*d/);
  assert.match(js,/const perMonth=minutes\*g/);
  assert.match(js,/perMonth\*12/);
  assert.match(html,/id="saving-gap"/);
  assert.match(html,/id="saving-hours"/);
  assert.match(html,/id="saving-days"/);
  assert.match(html,/data-savings-calculator/);
});

test("marketing surface is indexable while private surfaces remain noindex",()=>{
  assert.match(html,/name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"/);
  assert.match(cockpit,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(client,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(robots,/Allow: \/$/m);
  assert.match(robots,/Disallow: \/client\.html/);
  assert.match(sitemap,/audiotel-premium-pro\.com\//);
});

test("public search covers the complete published site with ranked, intent and fuzzy matching",()=>{
  assert.doesNotMatch(html,/data-site-search/);
  assert.match(buildStatic,/data-site-search/);
  assert.match(buildStatic,/Rechercher sur tout le site/);
  assert.match(buildStatic,/\/site\/site-search\.js/);
  assert.match(css,/\.site-header\{overflow:visible!important\}/);
  assert.match(siteSearch,/site-search-index\.json/);
  assert.match(siteSearch,/scoreEntry/);
  assert.match(siteSearch,/distance=/);
  assert.match(siteSearch,/aliases=/);
  assert.match(siteSearch,/intentBoost/);
  assert.match(siteSearch,/portabilite-numero-sva/);
  assert.match(siteSearch,/trackSearchQuery/);
  assert.match(siteSearch,/"search"/);
  assert.doesNotMatch(siteSearch,/\nloadIndex\(\);\n\}\)\(\);\s*$/);
  assert.match(siteSearch,/ArrowDown/);
  assert.match(siteSearch,/aria-activedescendant/);
  assert.match(buildStatic,/injectPublicSearch/);
  assert.match(buildStatic,/site-search-index\.json/);
  assert.match(buildStatic,/seoPages\.map\(slug=>searchEntry/);
  assert.match(buildStatic,/"site\/site-search\.js"/);
});

test("SEO opportunity pages are built, searchable and included in sitemap generation",()=>{
  assert.match(buildStatic,/"monetiser-ses-appels"/);
  assert.match(buildStatic,/"combien-rapporte-numero-surtaxe"/);
  assert.match(sitemap,/monetiser-ses-appels/);
  assert.match(sitemap,/combien-rapporte-numero-surtaxe/);
  assert.match(buildStatic,/slice\(0,5000\)/);
  assert.match(buildStatic,/version:2/);
});

test("page-specific CSS is split from the shared marketing bundle",()=>{
  assert.doesNotMatch(css,/payment-card-conversion-page-v166/);
  assert.match(application,/\/site\/application\.css/);
  assert.match(cardPaymentsLanding,/\/site\/payment-card\.css/);
  assert.match(buildStatic,/"site\/application\.css"/);
  assert.match(buildStatic,/"site\/payment-card\.css"/);
});

test("public assets receive release versioning for immutable browser caching",()=>{
  assert.match(buildStatic,/versionPublicAssets/);
  assert.match(buildStatic,/publicAssetVersion/);
  assert.match(buildStatic,/PGI_RELEASE_ID/);
});

test("public site remains self-contained and mobile responsive",()=>{
  assert.doesNotMatch(html,/<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(css,/url\(["']?https?:\/\//i);
  assert.match(html,/name="viewport"/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(html,/href="\.\.\/client\.html"/);
});


test("opening handoff creates a protected dossier flow without leaking PII in the URL",()=>{
  assert.doesNotMatch(html,/id="order-form"/);
  assert.match(application,/id="order-form"/);
  assert.match(application,/order_account_type/);
  assert.match(application,/id="order-service-intent"/);
  assert.match(js,/sessionStorage\.setItem\(KEY,JSON\.stringify\(intent\)\)/);
  assert.match(js,/client\.html\?opening=/);
  assert.match(js,/access-sent/);
  assert.match(js,/received/);
  assert.doesNotMatch(js,/client\.html\?register=1/);
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
  assert.match(contactWidget,/e\.key!=="Tab"/);
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
  assert.match(tracking,/search:\["search_term"\]/);
  assert.match(tracking,/content_group/);
  assert.match(tracking,/traffic_origin/);
  for(const source of ["ai_chatgpt","ai_perplexity","ai_copilot","ai_gemini","ai_claude"])assert.ok(tracking.includes(source),source+" missing");
  assert.match(tracking,/paymentReferrer/);
  assert.match(tracking,/ignore_referrer:true/);
  for(const event of ["select_content","order_form_start","order_form_submit","order_form_error","order_form_abandon","registration_view","email_verification_required","page_performance"])assert.ok(tracking.includes(event),event+" missing");
  for(const metric of ["lcp_ms","cls_milli","ttfb_ms","interaction_latency_p98_ms"])assert.ok(tracking.includes(metric),metric+" missing");
  assert.match(js,/if\(r\.ok&&data\.accepted\)window\.PGIAnalytics\?\.track\("generate_lead"\)/);
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

test("marketing conversion is simplified, product-led and non-manipulative",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/Calculez votre revenu potentiel supplémentaire/);
  assert.match(html,/Demander un nouveau numéro|Demander mon numéro/);
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
  assert.match(html,/"price":"4\.90"/);
  assert.match(html,/"priceCurrency":"EUR"/);
  assert.match(html,/"serviceType":\["Numéro surtaxé Audiotel"/);
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
  assert.match(liveFinance,/ESTIMATION EN COURS/);
  assert.match(liveFinance,/reversements validés font foi/);
});

test("incomplete legal notice stays public but out of search and AI discovery",()=>{
  assert.match(legalNotice,/name="robots" content="noindex,follow,noarchive"/);
  assert.match(legalNotice,/"@type":"WebPage"/);
  assert.doesNotMatch(sitemap,/mentions-legales/);
  assert.doesNotMatch(llms,/mentions-legales/);
  assert.doesNotMatch(llmsFull,/### Mentions légales/);
  assert.match(legalNotice,/À compléter avant ouverture commerciale/);
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
  assert.doesNotMatch(html,/site\/form-ux\.js/);
  assert.match(application,/site\/form-ux\.js/);
  assert.match(formUx,/form\.noValidate=true/);
  assert.match(formUx,/form\.checkValidity\(\)/);
  assert.match(formUx,/stopImmediatePropagation/);
  assert.match(formUx,/scrollIntoView\(\{block:"center",inline:"nearest"/);
  assert.doesNotMatch(contactWidget,/reportValidity\(\)/);
  assert.match(contactWidget,/checkValidity\(\)/);
  assert.match(contactCss,/font-size:16px/);
});

test("public footers stay readable and separated on mobile",()=>{
  assert.match(contactCss,/responsive-global-footer-v145/);
  assert.match(contactCss,/footer \.footer-legal/);
  assert.match(contactCss,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(contactCss,/overflow-wrap:normal;word-break:normal/);
  assert.match(buildStatic,/class="footer-legal"/);
  assert.match(buildStatic,/class="site-footer"/);
});

test("public navigation is intentionally reduced to clear product paths",()=>{
  assert.match(buildStatic,/function simplifyPublicShell/);
  assert.match(buildStatic,/solutions-audiotel/);
  assert.match(buildStatic,/portabilite-numero-sva/);
  assert.match(buildStatic,/\/#simulateur/);
  assert.match(buildStatic,/\/#tarif/);
  assert.match(buildStatic,/Une solution PGI Telecom/);
  assert.doesNotMatch(html,/id="avantages"|id="metiers"|id="commande"/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/Voir toutes les solutions/);
});

test("legal access blocks stay understandable on mobile",()=>{
  assert.match(buildStatic,/legal-access-section/);
  assert.match(buildStatic,/Besoin d’un document précis/);
  assert.match(buildStatic,/Conditions d’abonnement/);
  assert.match(buildStatic,/Résilier mon abonnement/);
  assert.match(contactCss,/legal-access-and-home-compact-v146/);
  assert.match(contactCss,/\.legal-access-links\{display:grid/);
  assert.match(contactCss,/grid-template-columns:1fr;gap:8px/);
});

test("homepage bottom quick navigation prioritizes the highest-value commercial journeys",()=>{
  assert.match(css,/font-size:10\.2px!important/);
  assert.match(css,/\.revenue-quick-nav\{position:fixed!important/);
  assert.match(css,/\.mobile-order-cta\{display:none!important/);
  assert.match(html,/DÉJÀ UN NUMÉRO SURTAXÉ \?/);
  assert.match(html,/class="revenue-quick-nav"/);
  assert.match(html,/Demander ma portabilité/);
  assert.match(html,/Demander mon numéro surtaxé/);
  assert.match(html,/Estimer mes revenus potentiels/);
  assert.match(html,/Encaisser par carte bancaire/);
  assert.match(html,/Créer et envoyer un lien de paiement sécurisé/);
  assert.ok(html.includes("<small>RÉCOMPENSES</small><strong>Parrainer Audiotel Premium Pro</strong>"));
  assert.match(html,/Parrainer Audiotel Premium Pro/);
  assert.match(html,/Partager mon lien et suivre mes récompenses/);
  assert.match(html,/href="\/portabilite-numero-sva\//);
  assert.match(html,/href="\/comparateur-audiotel\//);
  assert.match(html,/href="\/parrainage-audiotel\//);
  assert.match(css,/background:rgba\(42,45,49,\.985\)!important/);
  assert.match(buildStatic,/function injectRevenueQuickNav/);
  assert.match(buildStatic,/function normalizePublicBranding/);
});

test("homepage hero explains the 08 premium-rate number simply",()=>{
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/avec votre propre numéro surtaxé/);
  assert.match(html,/Avec un numéro surtaxé en 08/);
  assert.match(html,/vos reversements sont suivis en ligne/);
});

test("hero portability CTA uses the same primary style as the revenue CTA",()=>{
  assert.match(html,/class="btn hero-portability-cta" href="\/portabilite-numero-sva\/">Déjà un numéro surtaxé \? Demander ma portabilité<\/a>/);
});

test("homepage modules are compact and each carries a clear marketing promise",()=>{
  assert.match(html,/class="home-page"/);
  assert.match(html,/CALCULATEUR DE REVENU POTENTIEL/);
  assert.match(html,/Un numéro surtaxé et un espace client pour tout suivre/);
  assert.match(html,/Le mois en cours est offert, puis 4,90€ TTC \/ mois/);
  assert.match(html,/De la demande au suivi de vos appels, en quatre étapes/);
  assert.match(html,/Ce que vous achetez, comment ça fonctionne et ce que vous payez/);
  assert.match(html,/Demander mon numéro/);
  assert.equal((html.match(/<article>/g)||[]).filter(Boolean).length<10,true);
  assert.match(contactCss,/\.home-page \.section\{padding:64px 0\}/);
  assert.match(contactCss,/\.home-page \.tech-grid article\{padding:18px/);
});

test("hero replaces the fixed 1800 euro decoration with the real savings simulator",()=>{
  assert.doesNotMatch(html,/class="hero-card"/);
  assert.doesNotMatch(html,/1 800 € HT/);
  assert.match(html,/class="hero-savings"/);
  assert.match(html,/Gain potentiel en plus \/ mois/);
  assert.equal((html.match(/id="simulateur"/g)||[]).length,1);
});

test("existing customers get an explicit login entry in every public shell",()=>{
  assert.match(html,/header-login[^>]*href="\/client\.html"/);
  assert.match(html,/Déjà client \?/);
  assert.match(html,/Se connecter à mon espace client/);
  assert.match(buildStatic,/header-login/);
  assert.match(buildStatic,/Se connecter à mon espace client/);
  assert.match(contactCss,/hero-savings-and-client-login-v147/);
  assert.match(contactCss,/header-actions \.header-login\{display:inline-flex!important/);
});

test("future Pôle Télécom & Réseau link sits below customer login without a box and remains hidden before launch",()=>{
  assert.match(html,/<div class="header-account-entry">\s*<a class="header-login" href="\/client\.html">[\s\S]*?<\/a>\s*<a class="header-distribution-link" href="\/distribution-sva\/" hidden>Pôle Télécom &amp; Réseau<\/a><\/div>/);
  assert.equal((html.match(/class="header-distribution-link"/g)||[]).length,1);
  assert.match(css,/\.header-account-entry\{display:flex;flex-direction:column;align-items:flex-end/);
  assert.match(css,/\.header-distribution-link\{[^}]*text-decoration:underline/);
  assert.match(css,/\.header-distribution-link\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(html,/<a class="header-distribution-link"[^>]*style="[^"]*(?:background|border|padding)/);
  assert.doesNotMatch(buildStatic,/["']site\/distribution-sva\/index\.html["']/);
});

test("public commercial copy is concise while legal and machine-readable price stays precise",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Le mois en cours est offert/);
  assert.match(html,/4,90€ TTC \/ mois/i);
  assert.match(buildStatic,/Demander mon numéro/);
  assert.match(buildStatic,/Numéro surtaxé &amp; espace client/);
  assert.match(buildStatic,/Activation après validation/);
  assert.match(html,/4,90€ TTC par mois/);
});

test("fixed monthly subscription is never presented as a starting price",()=>{
  assert.match(html,/Mois en cours offert/);
  assert.doesNotMatch(html,/À partir de <strong>4,90€/);
});

test("mobile offer states the fixed subscription and frames competitive value as an objective",()=>{
  assert.match(html,/4,90€ TTC \/ mois/);
  assert.match(html,/Comparez vos revenus potentiels\./);
  assert.doesNotMatch(html,/À partir de <strong>4,90€/);
});

test("subscription is clearly marketed as no-commitment while keeping the period-end effect explicit",()=>{
  assert.match(html,/Sans engagement de durée/);
  assert.match(html,/Résiliation possible à tout moment/);
  assert.match(html,/prend normalement effet à la fin de la période déjà payée/);
  assert.match(application,/Sans engagement de durée/);
  assert.match(application,/Résiliable à tout moment/);
  assert.match(buildStatic,/Sans engagement de durée/);
});

test("current month is offered before the fixed monthly subscription starts",()=>{
  assert.match(html,/Mois en cours offert/);
  assert.match(html,/Puis 4,90€ TTC \/ mois/);
  assert.match(html,/à partir du mois suivant/i);
  assert.match(application,/Mois en cours offert/);
  assert.match(application,/Puis 4,90€ TTC \/ mois/);
});

test("homepage leads with business benefits while preserving technical SEO facts",()=>{
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/CE QUI EST INCLUS/);
  assert.match(html,/BUSINESS LIVE/);
  assert.match(html,/TARIF DE LA PLATEFORME/);
  assert.match(html,/COMMENT ÇA MARCHE/);
  assert.match(html,/Demander mon numéro/);
  assert.match(html,/<title>[^<]*Audiotel/i);
  assert.match(html,/"@type":"Service"/);
  assert.match(html,/SVA/i);
});

test("homepage explains the product before selling benefits",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/Avec un numéro surtaxé en 08/);
  assert.match(html,/COMMENCEZ PAR VOTRE SITUATION/);
  assert.match(html,/CE QUI EST INCLUS/);
  assert.match(html,/Numéro surtaxé et un espace client pour tout suivre/i);
  assert.match(html,/REVERSEMENTS/);
  assert.match(html,/NUMÉRO &amp; PORTABILITÉ/);
  assert.match(html,/Demander mon numéro/);
  assert.match(application,/DEMANDE DE NUMÉRO SURTAXÉ/);
  assert.match(application,/Demandez votre numéro surtaxé ou la portabilité/);
});

test("pricing and simulator use explicit TTC and current-offer comparison",()=>{
  assert.doesNotMatch(html,/>[^<]*3€ \/ mois[^<]*</);
  assert.doesNotMatch(html,/>[^<]*4,90€ par mois[^<]*</);
  assert.match(html,/4,90€ TTC \/ mois/);
  assert.match(html,/4,90€ TTC par mois/);
  assert.match(html,/Calculez votre revenu potentiel supplémentaire/);
  assert.match(html,/Comparez votre offre actuelle à Audiotel Premium Pro/);
  assert.match(html,/reversement par minute de votre offre actuelle et comparez-le à la proposition Audiotel Premium Pro/);
  assert.match(html,/Écart de reversement entre les deux offres \/ minute/);
  assert.match(html,/Gain potentiel en plus \/ mois/);
});
test("public login makes clear that access is for existing clients",()=>{
  assert.match(html,/Déjà client \?/);
  assert.match(html,/Se connecter à mon espace client/);
  assert.match(buildStatic,/Se connecter à mon espace client/);
});

test("homepage prioritizes portability, fast intake and clearer revenue comparison",()=>{
  assert.match(html,/Demander ma portabilité/i);
  assert.match(html,/Particulier ou professionnel/);
  assert.match(html,/Avec un numéro surtaxé en 08/);
  assert.match(html,/Calculez votre revenu potentiel supplémentaire/);
  assert.match(html,/CALCULATEUR DE REVENU POTENTIEL/);
  assert.match(html,/revenu potentiel supplémentaire par mois et sur 12 mois/);
  assert.match(html,/Business Live : suivez en direct, seconde après seconde, le montant estimé qui vous est attribué pendant chaque appel/);
});
test("public branding and client access wording are explicit",()=>{
  assert.match(html,/Se connecter à mon espace client/);
  assert.match(html,/AUDIOTEL PREMIUM PRO \| UNE SOLUTION PGI TELECOM/);
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(css,/brand-full img,.footer-brand-premium img/);
  assert.match(css,/width:238px!important/);
  assert.match(css,/\.home-page \.brand-full img\{width:238px!important;max-height:78px!important\}/);
  assert.match(css,/\.hero-visual \.hero-visual-brand\{position:absolute;[^}]*width:176px/);
  assert.match(css,/@media\(max-width:680px\)\{\.hero-visual \.hero-visual-brand\{top:10px;right:10px;width:135px/);
  assert.doesNotMatch(css,/\.hero-visual \.hero-visual-brand\{width:238px\}/);
});

test("hero copy is condensed and the primary potential gain is highlighted in green",()=>{
  assert.doesNotMatch(html,/hero-quick-paths/);
  assert.match(html,/Demander ma portabilité/);
  assert.match(html,/Demander un nouveau numéro/);
  assert.match(html,/Voir toutes les solutions/);
  assert.match(css,/hero-savings-results \.main span,.hero-savings-results \.main strong\{color:var\(--ok\)\}/);
  assert.match(html,/Business Live : suivez en direct, seconde après seconde, le montant estimé qui vous est attribué pendant chaque appel/);
});

test("homepage adds restrained lifecycle trust and retention messaging",()=>{
  assert.match(html,/Nous préférons une offre simple à une grille illisible/);
  assert.match(html,/alertes personnelles dans le portail/);
  assert.match(html,/projection de fin de mois non contractuelle/);
  assert.match(html,/Pourquoi comparer le reversement et pas seulement le prix de l’abonnement/);
  assert.match(html,/Que se passe-t-il après l’activation/);
});

test("opening flow uses progressive commitment without artificial urgency",()=>{
  assert.match(application,/Un seul choix suffit pour avancer/);
  assert.match(application,/Progression conservée/);
  assert.match(application,/Comparez avant de décider/);
});

test("hero carries PGI Telecom signature and explains the higher-revenue-at-same-activity benefit",()=>{
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(html,/À activité identique, un meilleur reversement peut vous permettre de gagner plus sans travailler davantage/);
});

test("hero brand signature uses the validated premium grey and portability keeps its contractual qualifier",()=>{
  assert.match(html,/hero-brand-signature/);
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE · PORTABILITÉ GRATUITE/);
  assert.match(css,/hero-brand-signature\{[\s\S]*font-size:18px/);
  assert.match(css,/color:#c9c9c7/);
  assert.match(css,/-webkit-text-fill-color:currentColor/);
  assert.match(terms,/PGI Telecom ne facture pas de frais de portabilité entrante au titre de la plateforme/);
});


test("reversement page targets the best-reversement query through technical metadata only",()=>{
  const payouts=fs.readFileSync("site/seo/reversement-audiotel.html","utf8");
  assert.match(payouts,/Meilleur reversement Audiotel : comparer taux et gains \| PGI Telecom/);
  assert.match(payouts,/"@type":"BreadcrumbList"/);
  assert.match(payouts,/"@type":"FAQPage"/);
  assert.doesNotMatch(payouts,/"dateModified"|"datePublished"/);
  assert.match(sitemap,/reversement-audiotel\/<\/loc><lastmod>2026-09-29<\/lastmod>/);
});

test("homepage hero uses the premium diagonal professional visual while the simulator gets its own section",()=>{
  assert.match(html,/audiotel-hero-professionnels-diagonal\.webp/);
  assert.match(html,/NUMÉRO SURTAXÉ · PORTABILITÉ · SUIVI/);
  assert.match(html,/Votre numéro, vos appels et vos reversements réunis dans un même espace/);
  assert.equal((html.match(/id="simulateur"/g)||[]).length,1);
  assert.match(html,/home-simulator-section/);
  assert.match(buildStatic,/audiotel-hero-professionnels-diagonal\.webp/);
});



test("premium hero visual is branded, fully clickable and routes to the core number offer",()=>{
  assert.match(html,/hero-visual-link" href="\/numero-sva\//);
  assert.match(html,/hero-visual-brand/);
  assert.match(html,/audiotel-brand-logo-v33\.png/);
});

test("homepage removes duplicated dynamic cards and keeps one simulator badge plus intent journeys",()=>{
  assert.doesNotMatch(js,/public-advanced-comparator/);
  assert.doesNotMatch(js,/Testez votre propre scénario/);
  assert.match(js,/SIMULATION · NON CONTRACTUELLE/);
  assert.doesNotMatch(js,/public-advantage-suite/);
  assert.doesNotMatch(js,/public-advantage-card/);
  assert.match(html,/home-choice-section/);
  assert.match(html,/solution-choice-grid/);
});

test("homepage explains the 4.9 percent CB fee without mixing it with Stripe fees or subscription",()=>{
  assert.match(html,/COMMISSION AUDIOTEL PREMIUM PRO · PAIEMENTS CB/);
  assert.match(html,/4,9 %/);
  assert.match(html,/Cette commission n’inclut ni les frais du prestataire de paiement/);
  assert.match(html,/ni l’abonnement Audiotel Premium Pro à 4,90€ TTC \/ mois/);
});

test("new complementary products are public, indexable and commercially explicit",()=>{
  assert.match(priorityPortability,/9,90€ TTC/);
  assert.match(priorityPortability,/portabilité standard reste gratuite/i);
  assert.match(priorityPortability,/Aucun délai opérateur garanti/i);
  assert.match(priorityPortability,/traitement administratif prioritaire/i);
  assert.match(referralLanding,/Pas besoin d’être client/i);
  assert.match(referralLanding,/Prime maximale par filleul qualifié/i);
  assert.match(referralLanding,/barème fixe et progressif/i);
  assert.match(referralLanding,/3 factures mensuelles distinctes réellement payées/i);
  assert.match(referralLanding,/25e/i);
  assert.match(referralLanding,/Devenir ambassadeur/i);
  assert.match(referralLanding,/Devenez ambassadeur Audiotel Premium Pro/i);
  assert.match(referralLanding,/Gagnez jusqu’à 20 € par nouveau client qualifié/i);
  assert.match(referralLanding,/0 € d’abonnement pour parrainer/i);
  assert.match(referralLanding,/data-referral-example="25">420 €/i);
  assert.match(referralLanding,/Créer ma demande ambassadeur/i);
  assert.doesNotMatch(referralLanding,/site\/referral-landing\.js/);
  assert.match(tracking,/\/api\/v1\/public\/referral-program/);
  assert.match(tracking,/data-referral-example/);
  assert.match(referralLanding,/id="ambassador-request-form"/);
  assert.match(tracking,/bindAmbassadorRequest/);
  assert.match(tracking,/\/api\/v1\/public\/ambassador\/apply/);
  assert.match(tracking,/const quickTab=link\.closest\("\.revenue-quick-tab"\)/);
  assert.match(tracking,/quickTab\.hidden=false/);
  assert.match(tracking,/Intl\.NumberFormat\("fr-FR"/);
  assert.match(clientReferral,/Mon espace ambassadeur/);
  assert.match(clientReferral,/paid_invoice_count/);
  assert.match(buildStatic,/"portabilite-prioritaire"/);
  assert.match(buildStatic,/"parrainage-audiotel"/);
  assert.match(sitemap,/portabilite-prioritaire/);
  assert.match(sitemap,/parrainage-audiotel/);
  assert.match(html,/data-current-period-badge/);
  assert.match(html,/En octobre 2026 \.\.\. Des reversements plus généreux/);
  assert.match(js,/Intl\.DateTimeFormat\("fr-FR"/);
  assert.match(js,/timeZone:"Europe\/Paris"/);
});

test("payment CB conversion landing is built, indexable and commercially explicit",()=>{
  assert.doesNotMatch(cardPaymentsLanding,/Stripe Connect/i);
  assert.match(cardPaymentsLanding,/Paiement CB sécurisé/);
  assert.match(cardPaymentsLanding,/Commission de service : 4,9 % par paiement CB/);
  assert.match(cardPaymentsLanding,/Frais de traitement distincts/);
  assert.match(cardPaymentsLanding,/Aucune carte complète stockée par Audiotel Premium Pro/);
  assert.match(cardPaymentsLanding,/Préparer mon activation CB/);
  assert.match(buildStatic,/"paiement-cb-audiotel"/);
  assert.match(sitemap,/paiement-cb-audiotel/);
});

test("homepage card-shaped product modules have real destinations",()=>{
  assert.match(html,/solution-choice featured" href="\/changer-operateur-audiotel\//);
  assert.match(html,/solution-choice" href="\/numero-sva\//);
  assert.match(html,/solution-choice" href="#simulateur"/);
  assert.match(html,/tech-card-link" href="\/reversement-audiotel\//);
  assert.match(html,/tech-card-link" href="\/business-live-audiotel\//);
  assert.match(html,/home-cb-compact[\s\S]*href="\/paiement-cb-audiotel\//);
});


test("homepage hierarchy keeps number and portability as the primary product and CB as a lower complementary service",()=>{
  const heroEnd=html.indexOf('</section>',html.indexOf('<section class="hero">'));
  const primary=html.indexOf('id="numero-portabilite"');
  const platform=html.indexOf('id="plateforme"');
  const pricing=html.indexOf('id="tarif"');
  const faq=html.indexOf('id="faq"');
  const cb=html.indexOf('home-cb-compact');
  assert.ok(heroEnd<primary);
  assert.ok(primary<platform);
  assert.ok(platform<pricing);
  assert.ok(pricing<faq);
  assert.ok(faq<cb);
  assert.match(html,/COMMENCEZ PAR VOTRE SITUATION/);
  assert.match(html,/Portabilité/);
  assert.match(html,/Créer un numéro surtaxé/);
  assert.match(html,/SERVICE COMPLÉMENTAIRE/);
  assert.match(html,/Paiement par carte bancaire/);
});

test("hero and upper-page links no longer over-route visitors to the CB landing page",()=>{
  const hero=html.slice(html.indexOf('<section class="hero">'),html.indexOf('</section>',html.indexOf('<section class="hero">'))+10);
  assert.match(hero,/hero-visual-link" href="\/numero-sva\//);
  assert.match(hero,/Demander ma portabilité/);
  assert.match(hero,/Demander un nouveau numéro/);
  assert.match(hero,/Voir toutes les solutions/);
  assert.doesNotMatch(hero,/href="\/paiement-cb-audiotel\//);
});

test("homepage provides differentiated destinations for number, portability, payouts and complementary CB",()=>{
  assert.match(html,/solution-choice-grid[\s\S]*href="\/numero-sva\//);
  assert.match(html,/solution-choice-grid[\s\S]*href="\/portabilite-numero-sva\//);
  assert.match(html,/tech-card-link" href="\/reversement-audiotel\//);
  assert.match(html,/home-cb-compact[\s\S]*href="\/paiement-cb-audiotel\//);
  assert.match(html,/href="\/solutions-audiotel\//);
});


test("solutions hub separates the four customer intents",()=>{
  assert.match(html,/COMMENCEZ PAR VOTRE SITUATION/);
  assert.match(html,/Trois chemins suffisent pour avancer/);
  assert.match(html,/href="\/solutions-audiotel\//);
  assert.match(solutions,/Conserver mon numéro surtaxé/);
  assert.match(solutions,/Obtenir un nouveau numéro/);
  assert.match(solutions,/Suivre mes appels et reversements/);
  assert.match(solutions,/Ajouter le paiement par carte/);
  assert.match(solutions,/Prioriser ma portabilité/);
  assert.match(solutions,/Gagner avec mes recommandations/);
  assert.match(solutions,/href="\/portabilite-numero-sva\//);
  assert.match(solutions,/href="\/numero-sva\//);
  assert.match(solutions,/href="\/reversement-audiotel\//);
  assert.match(solutions,/href="\/paiement-cb-audiotel\//);
  assert.match(solutions,/href="\/portabilite-prioritaire\//);
  assert.match(solutions,/href="\/parrainage-audiotel\//);
  assert.match(buildStatic,/"solutions-audiotel"/);
});

test("homepage removes duplicated hero tabs and preserves one clear product-choice section",()=>{
  assert.match(html,/hero-lead-simple/);
  assert.doesNotMatch(html,/hero-quick-paths/);
  assert.doesNotMatch(html,/hero-lead-cards/);
  assert.doesNotMatch(js,/public-advantage-suite/);
  assert.match(html,/COMMENCEZ PAR VOTRE SITUATION/);
  assert.match(html,/JE SUIS DÉJÀ CHEZ UN AUTRE OPÉRATEUR/);
  assert.match(html,/JE VEUX COMMENCER/);
  assert.match(html,/JE VEUX D’ABORD ESTIMER/);
  assert.match(html,/SERVICE COMPLÉMENTAIRE/);
  assert.ok(html.indexOf('id="simulateur"')>html.indexOf('COMMENCEZ PAR VOTRE SITUATION'));
});


test("homepage restores an explicit compact comparison table without inventing rates",()=>{
  assert.match(html,/id="comparatif-offre"/);
  assert.match(html,/TABLEAU COMPARATIF/);
  assert.match(html,/Votre offre actuelle/);
  assert.match(html,/Audiotel Premium Pro/);
  assert.match(html,/proposition Audiotel Premium Pro effectivement confirmée/);
  assert.match(html,/Ouvrir le comparateur détaillé/);
});

test("CB cards explain the service before asking for a click",()=>{
  assert.match(html,/lien de paiement CB sécurisé/);
  assert.match(html,/suivi dans votre espace client/);
  assert.match(html,/prestataire de paiement/);
  assert.match(html,/4,9 %/);
  assert.match(solutions,/Envoyez à votre client un lien de paiement sécurisé/);
  assert.match(solutions,/Audiotel Premium Pro ne conserve pas le numéro complet de la carte/);
  assert.match(solutions,/Commission de service actuelle : 4,9 %/);
});

test("solutions hub is discoverable by search engines and machine-readable guides",()=>{
  assert.match(sitemap,/solutions-audiotel/);
  assert.match(llms,/Solutions Audiotel/);
  assert.match(llms,/Paiement CB sécurisé/);
  assert.match(llmsFull,/### Solutions Audiotel/);
  assert.match(llmsFull,/### Paiement CB complémentaire/);
});


test("high-intent landing pages answer distinct conversion questions",()=>{
  for(const slug of ["changer-operateur-audiotel","audiotel-sans-siret","business-live-audiotel"]){
    assert.match(sitemap,new RegExp(slug));
    assert.match(buildStatic,new RegExp('"'+slug+'"'));
    assert.match(llms,new RegExp(slug));
  }
  assert.match(html,/href="\/changer-operateur-audiotel\//);
  assert.match(html,/href="\/business-live-audiotel\//);
  assert.match(solutions,/href="\/changer-operateur-audiotel\//);
  assert.match(solutions,/href="\/audiotel-sans-siret\//);
  assert.match(solutions,/href="\/business-live-audiotel\//);
  assert.match(switchOperator,/Changez de solution/);
  assert.match(switchOperator,/FAQPage/);
  assert.match(withoutSiret,/Dépôt ≠ activation/);
  assert.match(withoutSiret,/FAQPage/);
  assert.match(businessLive,/Moins de flou/);
  assert.match(businessLive,/estimés, confirmés et validés/i);
  assert.match(businessLive,/FAQPage/);
});

test("competitor customers get an explicit portability acquisition journey",()=>{
  assert.match(html,/JE SUIS DÉJÀ CHEZ UN AUTRE OPÉRATEUR/);
  assert.match(html,/Gardez votre numéro\. Changez la solution autour\./);
  assert.match(html,/Audiotel Premium Pro ne facture pas de frais de portabilité entrante au titre de la plateforme/);
  assert.match(switchOperator,/DÉJÀ CHEZ UN AUTRE OPÉRATEUR AUDIOTEL/);
  assert.match(switchOperator,/Portabilité entrante Audiotel Premium Pro : 0€ au titre de la plateforme/);
  assert.match(portability,/VOUS AVEZ DÉJÀ UN NUMÉRO SURTAXÉ/);
  assert.match(portability,/Ma portabilité/);
  assert.match(js,/applyRequestedIntent/);
  assert.match(js,/portabilite:"portability"/);
});

test("analytics classifies the new conversion intents",()=>{
  assert.match(tracking,/changer-operateur-audiotel/);
  assert.match(tracking,/business-live-audiotel/);
  assert.match(tracking,/audiotel-sans-siret/);
  assert.match(contactWidget,/changer-operateur-audiotel/);
  assert.match(contactWidget,/business-live-audiotel/);
  assert.match(contactWidget,/audiotel-sans-siret/);
});


test("current reversement badge is injected consistently on commercial public pages",()=>{
  const tracking=fs.readFileSync("site/hubspot-tracking.js","utf8");
  assert.match(tracking,/currentPeriodMarketingLabel/);
  assert.match(tracking,/\.hero \.hero-copy,\.application-hero \.application-copy/);
  assert.match(tracking,/data-current-period-badge/);
  assert.match(tracking,/En "\+month\+" "\+year\+" \.\.\. Des reversements plus généreux/);
  assert.match(tracking,/timeZone:"Europe\/Paris"/);
  for(const path of [
    "site/seo/parrainage-audiotel.html",
    "site/seo/portabilite-prioritaire.html",
    "site/seo/paiement-cb-audiotel.html",
    "site/seo/numero-sva.html",
    "site/seo/reversement-audiotel.html",
    "site/seo/tarif-numero-sva.html",
    "site/seo/comparateur-audiotel.html",
    "site/seo/demande-ouverture.html"
  ]){
    const page=fs.readFileSync(path,"utf8");
    assert.match(page,/\/site\/hubspot-tracking\.js/);
    assert.match(page,/class="(?:hero|application-hero)/);
  }
});


test("marketing badge spacing stays balanced below public search",()=>{
  const css=fs.readFileSync("site/site.css","utf8");
  const applicationCss=fs.readFileSync("site/application.css","utf8");
  assert.match(css,/hero-marketing-badge\{[\s\S]*margin:0 auto 34px/);
  assert.match(css,/site-header\+main>\.hero:first-child[^\{]*\{padding-top:40px\}/);
  assert.match(css,/home-page \.site-header\+main>\.hero:first-child\{padding-top:22px\}/);
  assert.match(applicationCss,/application-hero\{[^\}]*padding:40px 0 82px/);
});


test("opening page marketing badge keeps the same compact proportions as other pages",()=>{
  const applicationCss=fs.readFileSync("site/application.css","utf8");
  assert.match(applicationCss,/application-copy>p\.hero-marketing-badge\{[^\}]*margin:0 auto 34px[^\}]*font-size:12px/);
  assert.match(applicationCss,/@media\(max-width:680px\)\{[\s\S]*application-copy>p\.hero-marketing-badge\{[^\}]*margin:0 auto 28px[^\}]*font-size:11px/);
});

test("marketing badge keeps homepage oval but is rectangular elsewhere",()=>{
  const css=fs.readFileSync("site/site.css","utf8");
  assert.match(css,/\.hero-marketing-badge\{[\s\S]*border-radius:999px/);
  assert.match(css,/body:not\(\.home-page\) \.hero-marketing-badge\{border-radius:0\}/);
});


test("all public pages receive a professional copyright footer with an automatic year",()=>{
  assert.match(buildStatic,/site\/footer-year\.js/);
  assert.match(buildStatic,/data-current-year/);
  assert.match(buildStatic,/PGI Telecom \\| Audiotel Premium Pro\. Tous droits réservés\./);
  assert.match(css,/\.footer-rights/);
});


test("Google Preferred Sources is integrated without claiming Google certification",()=>{
  assert.match(buildStatic,/preferredSourceSlugs/);
  assert.match(buildStatic,/https:\/\/www\.google\.com\/preferences\/source\?q=audiotel-premium-pro\.com/);
  assert.match(buildStatic,/Ajoutez PGI Telecom à vos sources préférées sur Google/);
  assert.match(buildStatic,/sources que vous souhaitez privilégier/);
  assert.match(buildStatic,/Ajouter PGI Telecom sur Google/);
  assert.match(buildStatic,/Site officiel/);
  assert.match(buildStatic,/Tarifs clairs/);
  assert.match(buildStatic,/Portabilité accompagnée/);
  assert.match(buildStatic,/Support client/);
  assert.match(buildStatic,/Le réglage s’effectue directement sur Google/);
  assert.doesNotMatch(buildStatic,/Mode IA|Aperçus IA/);
  assert.match(buildStatic,/guide-audiotel-sva/);
  const preferredBlock=buildStatic.slice(buildStatic.indexOf("const preferredSourceSlugs"),buildStatic.indexOf("function injectPreferredSource"));
  assert.doesNotMatch(preferredBlock,/mentions-legales|conditions-utilisation|conditions-abonnement|confidentialite|accord-traitement-donnees|cookies-traceurs|demande-ouverture|resilier-contrat|retractation/);
  assert.match(css,/\.preferred-source-btn/);
});


test("public sharing is available on useful marketing pages and stays privacy safe",()=>{
  assert.match(buildStatic,/shareableSlugs/);
  assert.match(buildStatic,/function injectPublicShare/);
  assert.match(buildStatic,/site\/share\.js/);
  assert.match(buildStatic,/Partager cette page/);
  const shareable=buildStatic.slice(buildStatic.indexOf("const shareableSlugs"),buildStatic.indexOf("function injectPublicShare"));
  assert.doesNotMatch(shareable,/mentions-legales|conditions-utilisation|conditions-abonnement|confidentialite|demande-ouverture|resilier-contrat|retractation/);
});


test("internal linking graph is balanced, crawlable and conversion aware",()=>{
  assert.match(buildStatic,/const internalLinkGraph=Object\.freeze\(/);
  assert.match(buildStatic,/function injectInternalLinkGraph/);
  assert.match(buildStatic,/class="internal-link-card resource-link"/);
  assert.match(buildStatic,/href="'\+internalLinkHref\(target\)\+'"/);
  assert.doesNotMatch(buildStatic.slice(buildStatic.indexOf("const internalLinkGraph"),buildStatic.indexOf("const preferredSourceSlugs")),new RegExp(String.fromCodePoint(0x2014)));

  const graphSource=buildStatic.slice(buildStatic.indexOf("const internalLinkGraph="),buildStatic.indexOf("function internalLinkHref"));
  const graph=Function('"use strict";'+graphSource+';return internalLinkGraph;')();
  const contentPages=[
    "home","solutions-audiotel","business-live-audiotel","audiotel-sans-siret","changer-operateur-audiotel",
    "monetiser-ses-appels","combien-rapporte-numero-surtaxe","audiotel-voyance","audiotel-independants",
    "audiotel-coaching","audiotel-professionnels","reversement-audiotel","numero-sva","portabilite-numero-sva",
    "portabilite-prioritaire","parrainage-audiotel","numero-surtaxe-08","tarif-numero-sva","comparateur-audiotel",
    "paiement-cb-audiotel","guide-audiotel-sva"
  ];
  const validTargets=new Set([...contentPages,"demande-ouverture"]);
  const forbidden=/^(?:mentions-legales|conditions-utilisation|conditions-abonnement|confidentialite|accord-traitement-donnees|cookies-traceurs|resilier-contrat|retractation|client|cockpit|ambassadeur)$/;
  const inbound=Object.fromEntries([...validTargets].map(x=>[x,0]));
  for(const page of contentPages){
    assert.ok(Array.isArray(graph[page]),"missing internal graph for "+page);
    assert.ok(graph[page].length>=4&&graph[page].length<=5,page+" must expose 4 or 5 related resources");
    const targets=graph[page].map(x=>x[0]);
    assert.equal(new Set(targets).size,targets.length,page+" has duplicate targets");
    assert.ok(!targets.includes(page),page+" links to itself");
    for(const [target,anchor,description] of graph[page]){
      assert.ok(validTargets.has(target),"unknown internal target "+target+" from "+page);
      assert.ok(!forbidden.test(target),"forbidden target "+target);
      assert.ok(String(anchor).length>=14&&String(anchor).length<=70,page+" anchor quality");
      assert.ok(String(description).length>=35&&String(description).length<=140,page+" description quality");
      inbound[target]=(inbound[target]||0)+1;
    }
  }
  for(const hub of ["guide-audiotel-sva","numero-sva","portabilite-numero-sva","reversement-audiotel","solutions-audiotel","comparateur-audiotel"]){
    assert.ok(inbound[hub]>=4,hub+" should receive at least four contextual internal links");
  }
  for(const page of contentPages.filter(x=>x!=="home")){
    assert.ok(inbound[page]>=1,page+" should not be an internal orphan");
  }
});


test("public brand logos use the payment page reference size without breaking mobile headers",()=>{
  assert.match(css,/width:238px!important/);
  assert.match(css,/max-height:78px!important/);
  assert.match(css,/@media\(max-width:680px\)\{\.site-header \.brand-full img,[^}]*width:238px!important;max-height:78px!important\}/);
  assert.match(paymentCardCss,/conversion-offer-brand img\{width:238px/);
  assert.doesNotMatch(buildStatic,/feature-brand-signature|footer-brand-full/);
});


test("public footer uses the full brand logo without duplicating logos in content modules",()=>{
  assert.match(buildStatic,/footer-brand-premium/);
  assert.match(buildStatic,/audiotel-brand-logo-v33\.png/);
  assert.match(css,/footer-brand-premium img[\s\S]*width:238px/);
  const preferred=buildStatic.slice(buildStatic.indexOf("function injectPreferredSource"),buildStatic.indexOf("const shareableSlugs"));
  const sharing=buildStatic.slice(buildStatic.indexOf("function injectPublicShare"),buildStatic.indexOf("const publicBaseUrl"));
  const internal=buildStatic.slice(buildStatic.indexOf("function injectInternalLinkGraph"),buildStatic.indexOf("const preferredSourceSlugs"));
  assert.doesNotMatch(preferred,/audiotel-brand-logo-v33\.png/);
  assert.doesNotMatch(sharing,/audiotel-brand-logo-v33\.png/);
  assert.doesNotMatch(internal,/audiotel-brand-logo-v33\.png/);
});

// Production validation refresh.

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

test("public site targets both individuals and professionals without overloading the homepage",()=>{
  assert.match(html,/Particulier, porteur de projet ou professionnel/);
  assert.match(html,/Particulier, porteur de projet ou professionnel/);
  assert.match(application,/Particulier \/ porteur de projet/);
  assert.match(application,/Professionnel \/ entreprise/);
});

test("focused SEO pages remain published without cluttering the homepage",()=>{
  for(const slug of ["audiotel-voyance","audiotel-independants","audiotel-coaching","audiotel-professionnels","reversement-audiotel","numero-sva","comparateur-audiotel"]){
    assert.match(sitemap,new RegExp(slug));
    assert.ok(!html.includes('href="/'+slug+'/'),"homepage should not foreground "+slug);
  }
  assert.match(html,/href="\/demande-ouverture\//);
  assert.match(html,/id="simulateur"/);
  assert.ok(html.indexOf('id="simulateur"')<html.indexOf('class="proof-strip"'));
});

test("public pricing and savings simulation stay explicit and non-guaranteed",()=>{
  assert.match(html,/3 € TTC \/ mois/);
  assert.match(html,/Le mois en cours est offert/);
  assert.match(html,/Sans engagement de durée/);
  assert.match(html,/Résiliation possible à tout moment/);
  assert.match(html,/Écart de reversement estimé \/ minute/);
  assert.match(html,/Gain potentiel \/ mois/);
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

test("public site remains self-contained and mobile responsive",()=>{
  assert.doesNotMatch(html,/<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(css,/url\(["']?https?:\/\//i);
  assert.match(html,/name="viewport"/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(html,/href="\.\.\/client\.html"/);
});


test("registration handoff stays on the dedicated opening page without leaking PII in the URL",()=>{
  assert.doesNotMatch(html,/id="order-form"/);
  assert.match(application,/id="order-form"/);
  assert.match(application,/order_account_type/);
  assert.match(application,/id="order-service-intent"/);
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

test("marketing conversion is simplified, product-led and non-manipulative",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/Calculer votre revenu supplémentaire/);
  assert.match(html,/Demander mon numéro/);
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

test("public navigation is intentionally reduced to one clear conversion path",()=>{
  assert.match(buildStatic,/function simplifyPublicShell/);
  assert.match(buildStatic,/\/#simulateur/);
  assert.match(buildStatic,/\/#tarif/);
  assert.match(buildStatic,/\/#fonctionnement/);
  assert.match(buildStatic,/\/#faq/);
  assert.match(buildStatic,/Une solution PGI Telecom/);
  assert.doesNotMatch(html,/id="avantages"|id="metiers"|id="commande"/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/Une solution PGI Telecom/);
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

test("homepage modules are compact and each carries a clear marketing promise",()=>{
  assert.match(html,/class="home-page"/);
  assert.match(html,/SIMULATEUR D’ÉCONOMIES/);
  assert.match(html,/Un numéro surtaxé et un espace client pour tout suivre/);
  assert.match(html,/Le mois en cours est offert, puis 3 € \/ mois/);
  assert.match(html,/De la demande au suivi de vos appels, en quatre étapes/);
  assert.match(html,/Ce que vous achetez, comment ça fonctionne et ce que vous payez/);
  assert.match(html,/Demandez votre numéro surtaxé/);
  assert.equal((html.match(/<article>/g)||[]).filter(Boolean).length<10,true);
  assert.match(contactCss,/\.home-page \.section\{padding:64px 0\}/);
  assert.match(contactCss,/\.home-page \.tech-grid article\{padding:18px/);
});

test("hero replaces the fixed 1800 euro decoration with the real savings simulator",()=>{
  assert.doesNotMatch(html,/class="hero-card"/);
  assert.doesNotMatch(html,/1 800 € HT/);
  assert.match(html,/class="hero-savings"/);
  assert.match(html,/Gain potentiel \/ mois/);
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

test("public commercial copy is concise while legal and machine-readable price stays precise",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Le mois en cours est offert/);
  assert.match(html,/3 € TTC \/ mois/i);
  assert.match(buildStatic,/Demander mon numéro/);
  assert.match(buildStatic,/Numéro surtaxé &amp; espace client/);
  assert.match(buildStatic,/Activation après validation/);
  assert.match(html,/3 € TTC par mois/);
});

test("fixed monthly subscription is never presented as a starting price",()=>{
  assert.match(html,/Mois en cours offert/);
  assert.doesNotMatch(html,/À partir de <strong>3 €/);
});

test("mobile offer states the fixed subscription and frames competitive value as an objective",()=>{
  assert.match(html,/3 € TTC \/ mois/);
  assert.match(html,/Des reversements plus généreux\./);
  assert.doesNotMatch(html,/À partir de <strong>3 €/);
});

test("subscription is clearly marketed as no-commitment while keeping the period-end effect explicit",()=>{
  assert.match(html,/Sans engagement de durée/);
  assert.match(html,/Résiliable à tout moment/);
  assert.match(html,/prend normalement effet à la fin de la période déjà payée/);
  assert.match(application,/Sans engagement de durée/);
  assert.match(application,/Résiliable à tout moment/);
  assert.match(buildStatic,/Sans engagement de durée/);
});

test("current month is offered before the fixed monthly subscription starts",()=>{
  assert.match(html,/Mois en cours offert/);
  assert.match(html,/Puis 3 € TTC \/ mois/);
  assert.match(html,/à partir du mois suivant/i);
  assert.match(application,/Mois en cours offert/);
  assert.match(application,/Puis 3 € TTC \/ mois/);
});

test("homepage leads with business benefits while preserving technical SEO facts",()=>{
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/CE QUI EST INCLUS/);
  assert.match(html,/BUSINESS LIVE/);
  assert.match(html,/TARIF DE LA PLATEFORME/);
  assert.match(html,/COMMENT ÇA MARCHE/);
  assert.match(html,/Demandez votre numéro surtaxé/);
  assert.match(html,/<title>[^<]*Audiotel/i);
  assert.match(html,/"@type":"Service"/);
  assert.match(html,/SVA/i);
});

test("homepage explains the product before selling benefits",()=>{
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE/);
  assert.match(html,/Monétisez vos appels/);
  assert.match(html,/demander un numéro 08 surtaxé/i);
  assert.match(html,/suivez vos appels, vos minutes et vos reversements/i);
  assert.match(html,/CE QUI EST INCLUS/);
  assert.match(html,/Numéro surtaxé et un espace client pour tout suivre/i);
  assert.match(html,/REVERSEMENTS/);
  assert.match(html,/NUMÉRO &amp; PORTABILITÉ/);
  assert.match(html,/Demander mon numéro/);
  assert.match(application,/DEMANDE DE NUMÉRO SURTAXÉ/);
  assert.match(application,/Demandez votre numéro surtaxé ou la portabilité/);
});

test("pricing and simulator use explicit TTC and current-offer comparison",()=>{
  assert.doesNotMatch(html,/>[^<]*3 € \/ mois[^<]*</);
  assert.doesNotMatch(html,/>[^<]*3 € par mois[^<]*</);
  assert.match(html,/3 € TTC \/ mois/);
  assert.match(html,/3 € TTC par mois/);
  assert.match(html,/Calculer votre revenu supplémentaire/);
  assert.match(html,/Comparez votre offre actuelle à Audiotel Premium Pro/);
  assert.match(html,/reversement de votre offre actuelle avec la proposition Audiotel Premium Pro/);
  assert.match(html,/Écart de reversement entre les deux offres \/ minute/);
  assert.match(html,/Gain potentiel \/ mois/);
});
test("public login makes clear that access is for existing clients",()=>{
  assert.match(html,/Déjà client \?/);
  assert.match(html,/Se connecter à mon espace client/);
  assert.match(buildStatic,/Se connecter à mon espace client/);
});

test("homepage prioritizes portability, fast intake and clearer revenue comparison",()=>{
  assert.match(html,/demander la portabilité de votre numéro actuel/i);
  assert.match(html,/Demande rapide, possible sans SIRET au dépôt initial/);
  assert.match(html,/Conseil, expertise, coaching, voyance, assistance commerciale ou autre service/);
  assert.match(html,/Calculer votre revenu supplémentaire/);
  assert.match(html,/CALCULATEUR DE REVENU POTENTIEL/);
  assert.match(html,/revenu potentiel supplémentaire par mois et sur 12 mois/);
  assert.match(html,/Business Live : suivez en direct, seconde après seconde, le montant estimé qui vous est attribué pendant chaque appel/);
});
test("public branding and client access wording are explicit",()=>{
  assert.match(html,/Se connecter à mon espace client/);
  assert.match(html,/AUDIOTEL PREMIUM PRO \| UNE SOLUTION PGI TELECOM/);
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(css,/brand-full img\{width:276px/);
  assert.match(css,/@media\(max-width:980px\)\{\.brand-full img\{width:225px/);
  assert.match(css,/brand-full img\{width:180px;max-height:54px/);
});

test("hero copy is condensed and the primary potential gain is highlighted in green",()=>{
  assert.match(html,/Déjà un numéro surtaxé \?/);
  assert.match(html,/Demandez sa portabilité/);
  assert.match(html,/Besoin d’un nouveau numéro \?/);
  assert.match(html,/Conseil, expertise, coaching, voyance, assistance commerciale ou autre service/);
  assert.match(css,/hero-copy-and-green-potential-v153/);
  assert.match(css,/hero-savings-results \.main span,.hero-savings-results \.main strong\{color:var\(--ok\)\}/);
  assert.match(html,/Business Live : suivez en direct, seconde après seconde, le montant estimé qui vous est attribué pendant chaque appel/);
});

test("hero carries PGI Telecom signature and explains the higher-revenue-at-same-activity benefit",()=>{
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(html,/À activité identique, un meilleur reversement peut vous permettre de gagner plus sans travailler davantage/);
});

test("hero brand signature is metallic and portability is marketed as free with a contractual qualifier",()=>{
  assert.match(html,/hero-brand-signature/);
  assert.match(html,/Audiotel Premium Pro \| Une solution PGI Telecom/);
  assert.match(html,/NUMÉRO SURTAXÉ · AUDIOTEL · SUIVI EN LIGNE · PORTABILITÉ GRATUITE/);
  assert.match(css,/metallic-brand-signature-v154/);
  assert.match(css,/hero-brand-signature\{[\s\S]*font-size:15px/);
  assert.match(css,/linear-gradient\(180deg,#f8fafb/);
  assert.match(css,/-webkit-text-fill-color:transparent/);
  assert.match(terms,/PGI Telecom ne facture pas de frais de portabilité entrante au titre de la plateforme/);
});

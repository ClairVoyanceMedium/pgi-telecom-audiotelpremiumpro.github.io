# SEO / AEO / GEO operating standard

Last reviewed: 2026-09-26

## Objective

Make audiotel-premium-pro.com easy to crawl, understand, cite and use across classic search, generative search, voice-oriented answers and AI assistants without relying on unsupported “magic” markup.

## Principles

1. Canonical public host: https://audiotel-premium-pro.com/
2. One clear search intent per important landing page.
3. Visible content and structured data must agree.
4. No fabricated reviews, ratings, legal identifiers, operator relationships, tariffs or guarantees.
5. Public pages are indexable; client/admin/technical surfaces remain private or noindex.
6. Mobile UX, Core Web Vitals, HTTPS and accessibility are product requirements, not cosmetic SEO tasks.
7. Search/AI optimizations must preserve privacy and must not leak PII.

## Google generative search

Google Search documentation (May–June 2026) states that established SEO best practices remain relevant to generative AI features and that llms.txt is not required for Google Search. Maintaining llms.txt is therefore treated as an interoperability aid for third-party systems, not a ranking tactic.

Reference:
https://developers.google.com/search/updates

## Structured data

Homepage:
- WebSite
- Organization
- WebPage
- Service

Landing pages:
- WebPage where appropriate
- Service where appropriate
- BreadcrumbList
- FAQPage may remain for generic machine readability where it accurately mirrors visible Q&A, but Google stopped showing FAQ rich results in May 2026.

Organization data must use only verified facts. Do not add legalName, address, registration identifiers or tax identifiers until verified and publicly appropriate.

Google Organization guidance:
https://developers.google.com/search/docs/appearance/structured-data/organization

Google Breadcrumb guidance:
https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

## Content model for AI answers

Important educational pages should use answer-first prose:
- direct definition;
- short answer;
- conditions/limits;
- concrete example;
- link to the specialized page;
- authoritative external references for regulatory claims.

Avoid keyword stuffing and near-duplicate landing pages. Bing explicitly warns that duplicate/near-duplicate content can dilute signals for both search and AI-powered discovery.

## Sitemap

Only canonical, public, indexable URLs belong in sitemap.xml.

lastmod must represent a meaningful page modification. The build should use a source file's latest Git commit date when available and omit lastmod when it cannot be established reliably.

Do not treat changefreq or priority as ranking signals.

## IndexNow

IndexNow is used only for participating engines (not as a Google Search submission mechanism). Submission runs after a successful production deployment when GitHub receives a production deployment_status event, with a manual workflow fallback.

Key location:
https://audiotel-premium-pro.com/fa0a7deb5d60bdf1260c8174ad8c71db.txt

Bing guidance:
https://blogs.bing.com/webmaster/2025/7/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search/

## Machine-readable files

/llms.txt
Compact canonical map and factual guardrails.

/llms-full.txt
Extended factual summary for systems that choose to consume it.

Neither file should contain secrets, passwords, private customer data or unverified claims.

## Official subject-matter references

Arcep SVA:
https://www.arcep.fr/mes-demarches-et-services/consommateurs/fiches-pratiques/les-numeros-08-et-les-numeros-courts.html

Arcep numbering:
https://www.arcep.fr/la-regulation/grands-dossiers-thematiques-transverses/la-numerotation.html

French Ministry of Economy:
https://www.economie.gouv.fr/particuliers/eviter-les-arnaques/numeros-commencant-par-08-quels-sont-les-tarifs

## Monitoring

Google Search Console:
- indexing;
- canonical selection;
- Core Web Vitals;
- HTTPS;
- structured data;
- classic Search performance;
- generative AI features;
- multimodal Search performance.

Bing Webmaster Tools:
- crawl/indexing;
- IndexNow;
- AI Performance;
- cited pages;
- citation share/intents/topics when available.

GA4:
- organic landing pages;
- generate_lead;
- sign_up;
- qualified lead/client events when implemented;
- revenue tied to real transactions.

## Release checklist

Before merging a public SEO change:
- npm run verify passes;
- canonical host remains audiotel-premium-pro.com;
- sitemap has no private URLs;
- robots does not block public CSS/JS/content;
- schema matches visible content;
- no PII is added to analytics or structured data;
- no preview/Vercel/GitHub URL becomes canonical;
- no unsupported claim is introduced;
- production deployment is READY before IndexNow notification is considered complete.

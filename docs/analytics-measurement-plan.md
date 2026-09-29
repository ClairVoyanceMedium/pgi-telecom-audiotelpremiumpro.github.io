# Plan de mesure Analytics — PGI Telecom

Dernière mise à jour : 29 septembre 2026.

## Identifiants

| Composant | Nom | Identifiant |
|---|---|---|
| Compte Google Analytics | PGI Telecom | 409520461 |
| Propriété GA4 | Audiotel Premium Pro – Production | 556033345 |
| Flux Web | Audiotel Premium Pro – Web | 15850887152 |
| Mesure GA4 | Production | G-SZY50J75N7 |
| Compte Google Tag Manager | PGI Telecom | 6379126243 |
| Conteneur GTM Web | Audiotel Premium Pro – Production | GTM-5L6NW5JZ |
| HubSpot | Audiotel Premium Pro | 149417663 |
| Search Console | Propriété Domaine validée | audiotel-premium-pro.com |

Aucun identifiant ci-dessus n’est un secret. Aucun secret Analytics, Stripe, HubSpot, Resend, Neon ou Vercel ne doit être ajouté au dépôt.

## Architecture et consentement

Le contrôleur unique `site/hubspot-tracking.js` pilote Google Analytics et HubSpot.

- Avant consentement : `analytics_storage`, `ad_storage`, `ad_user_data` et `ad_personalization` sont `denied`.
- Après acceptation : seul `analytics_storage` passe à `granted`; GTM et HubSpot sont alors chargés.
- Après refus : aucun script facultatif n’est chargé, les cookies Analytics/HubSpot accessibles sont supprimés et les événements en attente sont abandonnés.
- Global Privacy Control impose le refus.
- Le bouton « Gérer mes préférences » rouvre le choix.
- `/cockpit`, `/cockpit.html`, `/admin` et `/admin.html` sont exclus.
- `/client.html` accepte uniquement les événements métier consentis ; le tag GTM correspondant a `send_page_view=false`.
- La balise GA4 directe est la voie primaire de collecte après consentement. GTM reste chargé pour les autres balises et ne doit pas contenir une seconde balise GA4 de page vue pour ce même flux, afin d’éviter les doublons.

## Événements actifs dans le code

| Événement | Déclenchement fiable | Paramètres autorisés |
|---|---|---|
| `generate_lead` | demande publique enregistrée avant passage à l’inscription | `account_type`, `service_intent`, `lead_source` |
| `sign_up` | création, activation ou vérification réelle du compte réussie | `method`, `account_type`, `service_intent`, `lead_source` |
| `login` | authentification email ou Google réussie | `method` |
| `begin_checkout` | URL HTTPS Stripe créée par le backend | `currency`, `value` |
| `contact_widget_open` | ouverture de la bulle de contact | `contact_context`, `contact_source` |
| `contact_form_start` | premier focus dans le mini-formulaire | `contact_context`, `contact_source` |
| `contact_message_submit` | tentative d’envoi du formulaire valide | `contact_context`, `contact_source` |
| `contact_message_success` | envoi accepté par le backend | `contact_context`, `contact_source`, `crm_sync` |
| `contact_message_error` | validation ou erreur réseau/serveur | `contact_context`, `contact_source`, `error_type` |

Valeurs stables :

- `account_type` : `business` ou `individual`.
- `service_intent` : `new_number`, `portability`, `commercial_information`, `technical_support`, `other`.
- `lead_source` : `public_marketing_site` pour le tunnel public.
- `contact_source` : `floating_email_widget`.
- `contact_context` : `home`, `pricing`, `portability`, `payouts`, `education`, `industry`, `opening`, `legal` ou `other`.
- `crm_sync` : `synced` ou `not_synced`.
- `error_type` : `validation` ou `network_or_server`.

## Mesure avancée du comportement et du contenu

La couche Analytics classe désormais chaque page dans le groupe de contenu natif GA4 `content_group` : Accueil, Tarifs et comparaison, Portabilité, Reversements, Guide et information SVA, Pages métiers, Demande d’ouverture, Espace client, Juridique et confidentialité ou Autres pages publiques. Cette dimension native doit être préférée à une dimension personnalisée supplémentaire.

Les principales interactions internes utilisent l’événement recommandé `select_content` avec des identifiants stables et à faible cardinalité : demande d’ouverture, espace client, comparateur, guide SVA, portabilité, reversements, numéro SVA, tarif et pages métiers. Les ouvertures de FAQ et le premier usage des simulateurs sont également mesurés sans transmettre le texte saisi par le visiteur.

Le tunnel public ajoute :
- `order_form_start` : première interaction avec la demande ;
- `order_form_submit` : soumission valide de l’étape publique ;
- `order_form_error` : friction de validation, avec uniquement une catégorie de champ ;
- `order_form_abandon` : sortie après démarrage sans soumission ;
- `registration_view` : arrivée à l’étape d’inscription sécurisée ;
- `email_verification_required` : compte créé nécessitant la vérification email ;
- `sign_up` : inscription/activation effectivement réussie.

`generate_lead` n’est plus émis avant le résultat du backend : il est envoyé seulement après une réponse HTTP réussie du point d’entrée CRM, afin d’éviter de comptabiliser artificiellement comme lead une demande non acceptée.

## SEO, GEO et provenance des assistants IA

Le paramètre personnalisé à faible cardinalité `traffic_origin` classe le référent sans transmettre l’URL référente complète dans ce paramètre : ChatGPT, Perplexity, Copilot, Gemini, Claude, Poe, You.com, Phind, Mistral, moteur de recherche, réseau social, referral, internal ou direct/unknown. Les dimensions natives Source / Support / Campagne de GA4 continuent d’assurer l’attribution officielle ; `traffic_origin` sert uniquement de couche d’analyse complémentaire pour isoler le trafic provenant des assistants IA.

Lorsqu’un retour provient directement d’un domaine Stripe, le tag applique `ignore_referrer` uniquement à ce cas pour éviter qu’un prestataire de paiement ne remplace artificiellement l’origine marketing réelle de la visite.

## Performance réelle des pages

L’événement `page_performance` collecte uniquement des mesures techniques agrégées et non personnelles :
- `lcp_ms` pour le Largest Contentful Paint ;
- `cls_milli` pour le Cumulative Layout Shift multiplié par 1 000 ;
- `ttfb_ms` pour le délai de première réponse ;
- `interaction_latency_p98_ms` comme indicateur terrain de latence des interactions observées.

Chaque mesure reçoit `metric_rating` = `good`, `needs_improvement` ou `poor`, ainsi qu’une valeur numérique `metric_value`. Ces données servent à relier directement performance technique, type de page et conversion. Elles complètent, sans les remplacer, Search Console et les données de terrain Chrome pour les Core Web Vitals.

## Définitions personnalisées à prévoir dans GA4

Créer uniquement les dimensions nécessaires au reporting, en évitant les dimensions à forte cardinalité. Google recommande d’utiliser les dimensions natives lorsqu’elles existent et rappelle qu’une propriété standard dispose notamment de 50 dimensions personnalisées de portée événement. 

Dimensions de portée événement prioritaires :
- `traffic_origin`
- `contact_context`
- `contact_source`
- `crm_sync`
- `form_context`
- `error_field`
- `registration_source`
- `metric_name`
- `metric_rating`

Métrique personnalisée :
- `metric_value`

Ne pas créer une dimension personnalisée pour `content_group`, la page, la source, le support, la campagne, le pays, l’appareil ou le navigateur : GA4 les fournit déjà nativement.

## Hygiène GA4 à maintenir dans l’interface

- conservation des données d’exploration réglée au maximum pertinent pour une propriété standard ;
- filtrage du trafic interne et développeur ;
- liste des référents indésirables comprenant les prestataires de paiement réellement utilisés ;
- mesures améliorées activées pour les interactions natives pertinentes, sans recréer en double les événements personnalisés du site ;
- liaison Search Console ↔ GA4 lorsqu’elle est disponible dans le compte ;
- vérification régulière de Temps réel et DebugView après changement de tracking ;
- ne jamais transformer des identifiants publicitaires ou des données personnelles en dimensions Analytics.

## Événements préparés, non émis artificiellement

`qualify_lead`, `working_lead`, `close_convert_lead`, `purchase` et `refund` figurent dans l’allowlist, mais aucun clic navigateur ne les simule.

`purchase` et `refund` sont émis depuis les webhooks Stripe confirmés via Measurement Protocol lorsque la configuration serveur GA4 est activée. La livraison est dédupliquée par identifiant de transaction et utilise le montant et la devise réellement confirmés par Stripe. Aucun secret API GA4 n’est créé ni stocké dans ce dépôt.

## Événements clés GA4

À marquer comme événements clés : `generate_lead`, `sign_up`, `close_convert_lead`, `purchase`.

`begin_checkout` reste une étape du tunnel et n’est pas assimilé à une vente. `contact_message_success` reste analysé séparément car un message peut être commercial, technique ou provenir d’un client existant ; le marquer systématiquement comme conversion commerciale fausserait le taux de conversion.

Le tunnel à analyser en exploration est : page d’entrée → CTA interne → `order_form_start` → `order_form_submit` → `generate_lead` → `registration_view` → `email_verification_required` le cas échéant → `sign_up` → `begin_checkout` → `purchase` lorsque la mesure serveur sera activée.

## Dimensions personnalisées

Portée événement :

- `account_type`
- `service_intent`
- `lead_source`

## Données interdites

Ne jamais envoyer à Google Analytics : nom, prénom, email, téléphone, adresse, société, contenu de message, mot de passe, jeton, secret, identifiant Stripe lisible ou toute autre donnée directement identifiante.

Pour la bulle de contact, GA4 reçoit uniquement des événements techniques et une catégorie de page déterministe. L’adresse email, le message, le titre exact saisi et les paramètres de formulaire ne sont jamais transmis à Analytics. La page exacte et le message restent dans le circuit support/HubSpot, où ils sont nécessaires au traitement de la demande.

Le User-ID, lorsqu’un utilisateur est authentifié et consentant, est construit uniquement depuis un identifiant interne opaque. Il ne doit jamais être dérivé d’un email ou d’un téléphone.

## Répartition des responsabilités

- GA4 : trafic, comportement agrégé, attribution et conversions.
- HubSpot : identité du prospect, société, pipeline, suivi commercial et support.
- Stripe : vérité du paiement et du remboursement.
- Backend PGI : déduplication et émission future des conversions serveur.

## Convention UTM

Utiliser uniquement des minuscules ASCII, sans accent ni espace.

| Champ | Règle | Exemples |
|---|---|---|
| `utm_source` | plateforme ou partenaire | `google`, `bing`, `linkedin`, `email`, `partner` |
| `utm_medium` | type de canal | `organic`, `cpc`, `social`, `email`, `referral` |
| `utm_campaign` | objectif-date-segment | `launch-2026-b2b` |
| `utm_content` | variante créative | `hero-cta-a` |
| `utm_term` | mot-clé payant normalisé | `numero-audiotel` |

Ne jamais ajouter d’email, téléphone ou identifiant client dans une UTM.

## Vérification

Les tests automatisés contrôlent le consentement par défaut, GPC, l’absence de double balise, les exclusions privées, les déclenchements métier et l’absence de PII. La production ne doit être déclarée active qu’après déploiement Vercel READY et observation réelle dans GA4 Temps réel ou DebugView.


## Fiabilisation de la collecte GA4

Le contrôleur de consentement charge désormais directement `gtag.js` avec le Measurement ID de production après acceptation, puis initialise `G-SZY50J75N7` avec un `page_view` automatique. Cette voie directe évite qu'une publication GTM absente ou incomplète bloque toute collecte GA4. GTM reste disponible pour les autres balises ; il ne doit pas contenir une seconde balise GA4 de page vue pour ce même flux afin d'éviter les doublons.


## Revenus Stripe confirmés côté serveur

Le raccordement serveur GA4 est préparé autour de Stripe comme source de vérité et reste désactivé tant que `PGI_GA4_MEASUREMENT_ENABLED` n'est pas activé avec un véritable `PGI_GA4_API_SECRET`.

Lorsqu'un utilisateur a accepté la mesure d'audience avant Checkout, le navigateur peut transmettre uniquement les identifiants techniques GA4 `client_id` et `session_id` au backend. Ces identifiants sont validés, associés aux métadonnées Stripe du Checkout et de l'abonnement, puis réutilisés uniquement après réception d'un webhook Stripe signé.

Flux achat :
`invoice.paid` signé → vérification Stripe → facture et abonnement normalisés → montant réellement payé + devise + identifiant de facture → événement GA4 `purchase`.

Flux remboursement :
`refund.created` ou `refund.updated` signé et réussi → résolution charge → facture d'origine → abonnement → montant du remboursement individuel → événement GA4 `refund` rattaché à l'identifiant de facture d'origine.

Les livraisons sont journalisées par clé stable pour empêcher un webhook Stripe répété de compter deux fois le même achat ou remboursement. Une indisponibilité GA4 ne modifie jamais le statut de paiement et ne bloque jamais le webhook métier Stripe.

Le secret Measurement Protocol reste exclusivement dans l'environnement serveur. Il ne doit jamais être injecté dans un fichier JavaScript public, une page HTML, Stripe Metadata ou HubSpot. Chaque envoi serveur force également `ad_user_data=DENIED` et `ad_personalization=DENIED` dans le bloc de consentement Measurement Protocol, afin qu’aucun usage publicitaire ne soit implicitement activé par ces conversions serveur.


## Couverture comportementale étendue — 29 septembre 2026

Le contrôleur GA4 mesure désormais, après consentement uniquement, les interactions suivantes sans envoyer de texte libre ni de données personnelles :

- `section_view` : première exposition réelle d’une section importante avec `section_id` à faible cardinalité ;
- `scroll_depth` : franchissement unique des seuils 25 %, 50 %, 75 % et 90 % avec `scroll_percent` ;
- `site_error` : erreur JavaScript ou promesse rejetée, avec uniquement `error_type=js_error` ou `promise_rejection` ;
- clics d’ancres internes majeures de l’accueil via `select_content` ;
- premier usage du calculateur d’accueil via le sélecteur réel `data-savings-calculator`.

Les valeurs de `section_id` sont limitées à : `hero`, `calculator`, `proof`, `platform`, `pricing`, `how_it_works`, `faq`, `audiences`, `opening`, `benefits`, `decision_strip`, `final_cta`.

La configuration GA4 fixe explicitement `page_location` à `origin + pathname`. Les paramètres de requête et fragments ne sont donc pas envoyés dans la page vue automatique, ce qui évite notamment de collecter des jetons, codes ou paramètres techniques présents dans certaines URL du parcours client.

Dimensions personnalisées de portée événement à enregistrer dans GA4 pour exploiter ces nouveaux événements dans les rapports :
- `section_id`
- `scroll_percent`
- `error_type`

Ces définitions complètent les dimensions déjà prévues et ne remplacent aucune dimension native GA4.

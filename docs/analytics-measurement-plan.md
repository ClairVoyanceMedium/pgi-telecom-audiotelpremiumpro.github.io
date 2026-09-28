# Plan de mesure Analytics — PGI Telecom

Dernière mise à jour : 28 septembre 2026.

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
- GTM est la couche centrale : aucune balise GA4 directe distincte ne doit être ajoutée.

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

## Événements préparés, non émis artificiellement

`qualify_lead`, `working_lead`, `close_convert_lead`, `purchase` et `refund` figurent dans l’allowlist, mais aucun clic navigateur ne les simule.

`purchase` et `refund` devront partir du webhook Stripe après confirmation serveur, via Measurement Protocol, avec déduplication par `transaction_id`, devise EUR et montant réellement encaissé ou remboursé. Aucun secret API GA4 n’est créé ni stocké dans ce dépôt.

## Événements clés GA4

À marquer comme événements clés : `generate_lead`, `sign_up`, `close_convert_lead`, `purchase`.

`begin_checkout` reste une étape du tunnel et n’est pas assimilé à une vente.

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

# PGI Telecom Distribution : audit des branchements GA4, Search Console et HubSpot

**10 octobre 2026 | Branche : `prep/pgi-direct-sva-operator-2026-10-10` | Aucun déploiement.**

## Périmètre et sécurité

- **Activité existante : Audiotel Premium Pro**, site, suivi GA4, Search Console, HubSpot, paiements et abonnements inchangés.
- **Future activité : PGI Telecom Distribution**, intitulé public « Pôle Télécom & Réseau ».
- Chemin réservé : `https://audiotel-premium-pro.com/distribution-sva/`.
- Les **36 pages** créées restent en `noindex,nofollow,noarchive` et hors bundle public ; le serveur continue de répondre 404 à la rubrique tant que le feu vert de publication n'est pas donné.
- Les flux externes Distribution restent fermés et sans client réel.

## 1. Google Search Console : vérification réelle

Contrôle via le compte GSC Wizard connecté :
- Propriété **`https://audiotel-premium-pro.com/distribution-sva/`** déjà présente dans Google Search Console.
- **Activation de son affichage dans GSC Wizard effectuée** le 10 octobre 2026 : il s'agit d'un réglage de tableau de bord, PAS d'une publication du site.
- Propriété principale **`sc-domain:audiotel-premium-pro.com`** inchangée.
- **6 groupes de contenu créés** : anglais, espagnol, portugais, allemand, italien et dossiers techniques français.
- **3 groupes de thèmes créés** : distribution/opérateur SVA, réseau/interconnexion/numérotation, reversements/traçabilité.
- **0 sitemap Distribution soumis** : attendu. Les nouveaux chemins ne sont pas encore publics, et le générateur préparatoire refuse tout sitemap sans sept validations.
- Données Search Console Distribution : aucune visibilité établie avant publication. Les jours sans données ne sont pas des preuves d'absence d'indexation.

## 2. GA4 : vérification réelle

Le compte Google connecté par GSC Wizard ne retourne qu'une propriété GA4 :
- **Audiotel Premium Pro – Production** : `properties/556033345`.
- Aucune **propriété GA4 dédiée PGI Telecom Distribution** visible dans ce compte.
- Les trois dimensions existantes d'Audiotel (**`service_intent`**, **`lead_source`**, **`account_type`**) ne sont pas les dimensions séparées recherchées pour Distribution.
- **Ne pas réutiliser** le flux Audiotel `G-SZY50J75N7` pour Distribution.

### Modifications réelles sur la branche de préparation

- `site/direct-sva-tracking.js` : cible `send_to` strictement dédiée, bloque le flux Audiotel, limite les événements à des valeurs autorisées, n'exporte pas de données personnelles et utilise le préfixe de cookie `pgi_dsva`.
- **Comptage explicite `page_view`** une seule fois après consentement, malgré `send_page_view:false`. L'URL envoyée exclut `?` et `#`.
- **Liste blanche des URL** : seules les pages publiques Distribution inventoriées sont suivies ; ni portail client, ni paramètres d'URL, ni parcours de dossier individuel.
- `site/distribution-sva/measurement.js` : bannière de consentement en FR, EN, ES, PT, DE, IT, choix persistés pendant au maximum 180 jours, retrait du consentement, arrêt des émissions, suppression des seuls cookies préfixés `pgi_dsva`, respect du signal GPC.
- `site/distribution-sva/site.js` : chargement du module seulement si **toutes les validations** de propriété, de définition personnalisée, de cadre légal et de lancement sont vraies.
- Parcours suivis après consentement : visite de page, navigation, changement de langue, consultation des partenaires, ouverture des FAQ, exploration des sections et erreurs de formulaires préalables. Aucun événement d'ouverture de ligne, de paiement ou de contrat ne doit être produit sans événement réel confirmé.

### Paramétrage GA4 externe restant

1. Créer la **nouvelle propriété GA4 Distribution** dans le compte choisi.
2. Créer un **flux Web** avec un identifiant `G-...` distinct de celui d'Audiotel.
3. Enregistrer **trois dimensions personnalisées événementielles** : `pgi_business_unit`, `pgi_funnel_stage`, `pgi_service_type`.
4. Identifier les conversions réelles et le consentement, puis seulement configurer `window.__PGI_DIRECT_SVA_MEASUREMENT__` avec ces valeurs et les vrais indicateurs de validation.
5. Contrôler le trafic depuis les six langues dans **DebugView/Temps réel**, avec consentement accepté et refusé, paramètres nettoyés et absence de double comptage.

Les connecteurs Google actuellement disponibles donnent accès à **des lectures** GA4 et non à la création de propriétés, de flux ou de définitions personnalisées. La nouvelle propriété **n'a donc pas été créée**.

## 3. HubSpot : vérification réelle

Portail HubSpot : **149417663**.
- Pipeline actuel des affaires **`default`**, « Pipeline commercial PGI Telecom », inchangé.
- Pipeline actuel des tickets **`0`**, « Support Pipeline », inchangé.
- Propriété de dossier **`pgi_dossier_ref`** présente sur contacts et affaires ; préférences linguistiques natives `hs_language` sur les contacts.
- Champs de segmentation Distribution comme **`pgi_business_unit`**, **`pgi_content_language`**, **`pgi_source_reference`** non confirmés dans les objets interrogés. Aucun formulaire, pipeline ou synchronisation Distribution n'est actuellement exploitable de bout en bout.

### Préparation CRM ajoutée

`config/pgi-direct-sva-hubspot-manifest.json` détaille :
- **11 propriétés proposées** pour contacts, affaires et tickets, avec types et valeurs autorisées ;
- **2 pipelines indépendants proposés** : partenaires Distribution et réclamations Distribution ;
- absence de valeur par défaut sur les anciens contacts ;
- garde-fous contre le mélange des dossiers Audiotel et Distribution ;
- aucun envoi de prospect non consenti et aucune création de faux clients.

Le connecteur HubSpot accessible ne propose pas l'administration des propriétés ou pipelines. **Le manifeste n'est pas une modification du CRM réel**. À la mise en place, contrôler les permissions, créer les champs manquants, créer les deux pipelines, vérifier les identifiants officiels et enregistrer une recette de synchronisation avant de libérer les formulaires.

## 4. Contrôles et tests de préparation

- `tests/direct-sva-ga4-isolation.test.mjs` : **5 tests** couvrant `page_view` non dupliquée, `send_to` dédié, blocage du flux Audiotel, refus et GPC, protection des chemins privés et multilinguisme du consentement.
- `tests/direct-sva-hubspot-manifest.test.mjs` : **4 tests** sur l'identité CRM, les champs, les langues et le blocage des écritures.
- `tests/direct-sva-integrations.test.mjs` adapté au ciblage des événements et aux URLs réellement prévues.
- `backend/src/direct-sva-integrations.mjs` a été mis à jour pour les événements de navigation internationale et de partenaires et pour la propriété Search Console dédiée.
- `package.json` intègre ces tests à `verify:vercel` et contrôle la syntaxe du tracker.

Les **5 tests GA4** et les **4 tests HubSpot** ont été exercés avec une exécution JavaScript isolée sur les sources GitHub. Les vérifications syntaxiques ciblées ont réussi. **Ce n'est ni un `npm test` complet, ni une exécution de CI, ni une recette depuis le navigateur connecté à une vraie propriété GA4**.

## 5. Liste ferme des étapes indisponibles sans branchement externe

- Identifiant réel et propriété GA4 dédiée.
- Création des dimensions personnalisées dans GA4 et validation DebugView.
- Pipelines et nouvelles propriétés HubSpot dans le portail réellement connecté.
- Formulaires et automatisations de création de dossiers/réclamations branchés au CRM réel, après consentement et homologation.
- Validation des mentions, de la capacité opérationnelle et des droits d'activité au lancement.
- Déploiement explicite des pages, puis publication de leur sitemap et vérification de leur indexation.
- Contrôle de qualité des traductions, de l'optimisation des images et des Core Web Vitals sur pages publiées.

## 6. État de protection de l'activité SVA

**Aucun déploiement Vercel, aucune fusion GitHub vers `main`, aucune modification Stripe, aucun mouvement bancaire, aucun changement de pipeline HubSpot existant, aucun formulaire Distribution actif.** L'activation GSC Wizard et la segmentation GSC concernent uniquement la nouvelle propriété de répertoire. Les flux de collecte et de paiement du service Audiotel restent inchangés.

**Rappel :** même après la création des services Google et HubSpot, la nouvelle activité commerciale ne doit pas se mettre en route automatiquement. Les autorisations techniques et le top départ de l'utilisateur restent nécessaires.

## Dual B2B/B2C Terms v2 — 2026-09-26

- conditions générales restructurées pour particuliers, non-professionnels et professionnels ;
- qualification juridique réelle prioritaire sur le simple profil sélectionné ;
- bloc B2C renforcé : information précontractuelle, obligation de paiement, support durable, prix, rétractation, conformité du service numérique, réclamations, médiation et clauses abusives ;
- bloc B2B renforcé : socle commercial, obligations professionnelles, responsabilité, fraude, reversements et application des protections légales exceptionnelles aux petites entreprises lorsqu’elles y ont droit ;
- bouton de souscription rendu explicite : « Souscrire avec obligation de paiement » ;
- nouvelle version probatoire : 2026-09-26-b2b-b2c-v2.

## Legal Shield — 2026-09-26

- refonte complète des CGU et conditions d’abonnement avec séparation B2B/B2C ;
- responsabilité éditoriale SVA, antifraude, trafic artificiel, suspension proportionnée et retenues de reversement justifiées ;
- confidentialité, propriété intellectuelle, preuve, dépendances opérateur et répartition RGPD renforcées ;
- responsabilité B2B limitée aux dommages directs et prévisibles avec plafond encadré et exceptions impératives ;
- retard de paiement B2B aligné sur le Code de commerce et indemnité forfaitaire de 40 € ;
- version contractuelle 2026-09-26 imposée côté inscription, Checkout, mémoire et PostgreSQL ;
- demande d’exécution immédiate et conséquences de rétractation rendues explicites ;
- exigence de fonctionnalité de rétractation en ligne applicable depuis le 19 juin 2026 verrouillée avant tout lancement B2C.

## 1.30.7 — Mobile-first sans dérive horizontale — 2026-09-24

- suppression du débordement horizontal global sur mobile sans casser les tableaux et onglets défilants ;
- confinement des SVG, cartes, grilles, en-têtes et panneaux dans la largeur réelle de l’écran ;
- prise en charge des safe areas et des très petits écrans ;
- correction des badges longs du portail client et du menu mobile plein écran ;
- cache PWA renouvelé pour livrer immédiatement les feuilles de style corrigées.

## 1.30.6 — Revenue Recovery Stripe & continuité SVA — 2026-09-24

- délai de grâce de 72 heures après le premier échec de renouvellement ;
- fenêtre de récupération de 14 jours alignée sur Stripe Smart Retries ;
- séparation entre maintien temporaire du routage existant et droit strict d’activer un nouveau service ;
- suivi du nombre de tentatives, de la prochaine tentative et de la facture concernée ;
- suspension automatique à l’échéance, avec rétablissement automatique après paiement ;
- régularisation depuis le Stripe Customer Portal et alertes administrateur progressives.

## 1.30.5 — Checkout Stripe : clarté contractuelle — 2026-09-24

- description d’abonnement transmise à Stripe sans tarif codé en dur ;
- mention explicite dans Checkout : l’abonnement concerne l’accès à la plateforme PGI Telecom ;
- distinction affichée entre abonnement plateforme et reversements SVA ;
- conservation de la collecte d’adresse et d’identifiant fiscal déjà configurée ;
- aucune donnée KYC, fiscale ou bancaire ajoutée au dépôt.

## 1.30.4 — Stripe Billing : renouvellements & impayés — 2026-09-24

- traitement serveur de `invoice.paid`, `invoice.payment_failed` et `invoice.payment_action_required` ;
- relecture de l’abonnement Stripe avant toute mise à jour issue d’une facture ;
- conservation du journal append-only avec l’identifiant d’événement facture Stripe ;
- paiement réussi : période et état actifs réconciliés ;
- paiement échoué ou authentification requise : accès externe placé en `past_due` sauf état terminal ou déjà suspendu ;
- tests dédiés aux renouvellements, impayés et factures sans abonnement ;
- aucune donnée KYC, fiscale ou bancaire ajoutée au dépôt.

## 1.30.3 — Identité publique PGI & SEO canonique — 2026-09-24

- suppression de l’ancien domaine GitHub ClairVoyanceMedium des métadonnées publiques ;
- URL Vercel PGI utilisée par défaut pour canonical, Open Graph et schema.org ;
- robots.txt aligné sur la racine publique et cockpit/client maintenus hors index ;
- sitemap public complet : accueil, pages métiers, comparateur, guides, demande d’ouverture et pages légales ;
- test automatique empêchant le retour de l’ancien domaine dans les sources SEO ;
- cache PWA incrémenté en v46 pour diffuser la nouvelle identité publique ;
- aucune donnée KYC, fiscale ou adresse légale inventée.

## 1.30.2 — Branding production & Stripe Billing — 2026-09-24

- logo officiel renforcé dans Paramètres, abonnement client, footer client et impressions/PDF ;
- branding PGI conservé dans les rapports imprimés via les en-têtes et pieds de page déjà présents ;
- identité PGI renforcée dans Paramètres sans alourdir le shell critique ;
- image officielle rattachée au produit Stripe Checkout ;
- palette Stripe premium brun/doré déjà configurée ;
- cache PWA incrémenté pour distribuer immédiatement le nouveau branding ;
- aucune identité KYC, adresse légale, immatriculation fiscale ou TVA inventée ;
- factures Stripe prêtes à reprendre le branding global du compte dès validation du fichier logo dans les paramètres Stripe.

## 1.30.0 — SVA Compliance Center multi-organismes — 2026-09-20

- nouveau SVA Compliance Center premium, lazy-loadé depuis le cockpit ;
- registre distinct ARCEP, APNF/RSVA, af2m 2026, DGCCRF, CNIL, 33700, médiation et évaluation ACPR/DSP2 ;
- 21 contrôles SVA avec applicabilité explicite, preuve et échéance ;
- profil SVA par numéro : catégorie, audience, facturation, plafonds, MGIT, privacy, contact consommateur et médiation ;
- garde-fous locaux AF2M 2026 : 24 EUR TTC/appel, plafond mensuel 300 EUR TTC, durée max 30 min au-delà de 0,20 EUR/min et MGIT 10–20 s avec règles de contenu ;
- planification tarifaire RSVA : premier jour du mois et délai local minimal de sept jours, sans déclaration externe automatique ;
- chaîne de preuves SVA écosystème append-only SHA-256 intégrée à l'Evidence Pack ;
- activation externe française fail-closed sur Trust Center + ARCEP 2026 + SVA Ecosystem Readiness ;
- aucune suspension automatique des lignes déjà actives ;
- aucune certification ou approbation d'organisme revendiquée ;
- aucun branchement opérateur, APNF/RSVA, AF2M, DGCCRF, CNIL, ACPR, Stripe ou PSP activé.

## 1.29.0 — Operational Assurance — 2026-09-20

- validation 4 yeux pour l'activation des bascules opérateur critiques ;
- identités staff PGI distinctes et second administrateur créable depuis la Control Tower ;
- historique d'approbation append-only chaîné SHA-256 et demandes critiques non supprimables ;
- rollback d'urgence conservé indépendamment du cycle d'approbation ;
- Risk Engine sur agrégats uniquement, sans scoring individuel ni PII appelant ;
- shadow billing par devise sur 30 jours avec distinction entre données externes absentes et véritable écart ;
- snapshot SLO opérationnel et cible API 99,9 % mesurée par Prometheus, jamais inventée ;
- Digital Twin 2 : panne base principale, backlog workers, écart de règlement et projection hyperscale en plus des scénarios existants ;
- projections de charge bornées et toujours `dry_run=true / mutates_state=false` ;
- aucun branchement Stripe, opérateur SVA, APNF/RSVA ou PSP activé.

## 1.28.0 — PGI Control Tower, Policy Engine & Digital Twin — 2026-09-20

- nouvelle PGI Control Tower premium, chargée à la demande depuis la palette de commandes ;
- score de readiness interne et priorités critiques agrégées depuis les données existantes ;
- Policy Engine centralisé avec décisions `ALLOWED`, `BLOCKED` et `ACTION_REQUIRED` ;
- intentions couvertes : activation numéro, portabilité, reversement client, bascule opérateur et accès client ;
- Digital Twin dry-run avec six scénarios : panne opérateur, pic de trafic, portabilité massive, expiration réglementaire, impayés et panne région/datacenter ;
- aucune simulation ne modifie les lignes, clients, preuves, paiements ou routes ;
- API privées dédiées, protégées par rôles et CSRF pour les POST ;
- module frontend lazy afin de préserver le budget du shell ;
- aucune connexion Stripe, opérateur, APNF/RSVA ou PSP activée.

## 1.27.0 — Surveillance réglementaire proactive — 2026-09-20

- file persistante `regulatory_review_alerts` pour les échéances et contrôles réglementaires à traiter ;
- classification cockpit : bloquant, aujourd'hui, bientôt et revue non planifiée ;
- anticipation automatique à 30 jours, avec priorité 24 heures et criticité après dépassement ;
- surveillance des profils Trust Center, des garde-fous ARCEP 2026 et des contrôles plateforme arrivant à expiration ;
- alertes dédupliquées, acquittables et réouvertes automatiquement lorsque la gravité augmente ;
- prochaine revue ARCEP programmable directement lors de l'ajout d'une preuve ;
- aucune suspension automatique d'une ligne déjà active par le moteur d'échéances ;
- worker distribué et API privée dédiés ;
- version portée à 1.27.0, sans connexion Stripe, opérateur, APNF ou PSP supplémentaire.

## 1.26.0 — Cockpit conformité ARCEP — 2026-09-20

- fiche « Conformité ARCEP 2026 » directement accessible pour chaque numéro externe ;
- affichage séparé des 8 garde-fous ARCEP 2026 et de leur statut courant ;
- saisie manuelle d'un nouvel événement de preuve avec statut, source et référence ;
- aucune validation automatique : une référence est obligatoire avant tout statut `verified` ;
- chaque saisie continue d'alimenter la chaîne SHA-256 append-only et l'audit existant ;
- export Evidence Pack conservé depuis la même fiche ;
- affichage du prix d'abonnement harmonisé à **3,00 EUR TTC/mois** dans le cockpit ;
- aucune connexion Stripe, opérateur, APNF ou PSP activée.

## 1.25.0 — Garde-fous ARCEP 2026 — 2026-09-20

- décision ARCEP 2025-2215 ajoutée aux références suivies pour le plan applicable au 1er janvier 2026 ;
- verrou fail-closed supplémentaire pour les numéros français 081, 082 et 089 ;
- preuves séparées pour affectataire exclusif et stable, service unique, portabilité offerte, plafond tarifaire, absence d’usage temporaire sans consentement et éligibilité secteur public ;
- contrôle spécifique 089 interdisant sa présentation comme identifiant de l’appelant ;
- contrôle spécifique 0895 pour la classification liée au contrôle parental ;
- activation concurrente du même numéro bloquée sous verrou transactionnel ;
- seconde chaîne de preuves SHA-256 append-only et intégration complète à l’Evidence Pack ;
- cockpit aligné sur la readiness combinée Trust Center + ARCEP 2026 ;
- abonnement externe fixé à 3,00 EUR TTC/mois, montant final client avec fiscalité incluse lorsqu’elle s’applique ;
- aucune connexion Stripe, opérateur, APNF ou PSP activée par cette version.

## Regulatory Trust & abonnement 3 EUR — 2026-09-20

- prix courant de l'abonnement externe porté à 3,00 EUR TTC/mois par nouvelle version tarifaire, avec `tax_behavior=inclusive` ;
- Regulatory Evidence Pack exportable par numéro depuis le cockpit ;
- pack horodaté avec KYC, profil réglementaire, preuves chaînées, portabilité, opérateurs, incidents, fraude et historique de routage ;
- empreinte SHA-256 du pack et contrôle de continuité de la chaîne de preuves ;
- chaque export est journalisé dans l'audit ;
- RIO brut, secrets de portabilité, numéros d'appelants et contenu des appels exclus de l'export.

## Sécurité client & graphiques avancés — 2026-09-20

- changement de mot de passe depuis l'espace client avec vérification de l'ancien mot de passe ;
- hachage scrypt conservé, nouveau sel et invalidation de session après changement ;
- trois graphiques clients supplémentaires : ASR/abandons, valeur moyenne par appel et durée moyenne ;
- portail client à huit visualisations principales sans requêtes API supplémentaires ;
- cockpit administrateur vérifié : graphiques avancés déjà présents, aucun doublon inutile ajouté.

## Analytique & exports — 2026-09-20

- portail client passé en noir et gris anthracite ;
- nom de la société mis au premier plan dans le bandeau ;
- graphiques appels/décrochés, minutes, montant TTC, statuts et reversements ;
- centre d’export client : rapport complet, appels, reversements, numéros, impression/PDF ;
- centre d’export administrateur chargé à la demande : appels, synthèse, finance et PDF ;
- aucune dépendance graphique externe et aucun ajout au cache critique du portail client.

## Portail client Audiotel — 2026-09-20

- nouvel espace client séparé du cockpit PGI ;
- trafic, minutes, numéros, appels, reversements, abonnement et routage en lecture seule ;
- activation par invitation à usage unique et mot de passe choisi par le client ;
- sessions client isolées des sessions administrateur ;
- lectures SQL strictement bornées au tenant et compatibles réplique de lecture ;
- historique paginé et export CSV borné ;
- fichiers du portail hors shell PWA critique du cockpit.

# Changelog

## 1.23.0 — 2026-09-19

Customer Fleet & Headroom :

- pilotage compact du parc clients depuis Plateforme SVA avec compteurs Clients, Actifs, KYC en attente, Impayés, Accès SVA bloqués et Lignes actives ;
- filtres directs par pays, statut, KYC et abonnement, plus recherche nom, société et numéro SVA ;
- filtre KYC exécuté côté PostgreSQL et index dédié `tenant_kyc_status_tenant_idx` pour rester sélectif à grande échelle ;
- aucun index statut+pays dupliqué : réutilisation de l’index hyperscale déjà présent ;
- endpoint résumé clients dédié et léger, sans charger l’aperçu wholesale complet ;
- administration clients conservée paginée par curseur à 50 lignes, sans chargement massif navigateur ;
- cartes de pilotage compactes et défilantes horizontalement sur mobile ;
- CSS de l’administration clients sorti du JavaScript et chargé uniquement lorsque le module est ouvert ;
- générateur de données démo retiré du shell critique et chargé uniquement en mode démo ;
- générateur démo retiré du précache PWA ; rotation du cache vers v27 pour purger l’ancien shell ;
- réserve CI minimale portée de 16 KiB à 20 KiB sous le plafond shell de 260 KiB ;
- shell critique ramené sous 238 Ko, avec plus de 27 KiB de marge pour les évolutions futures ;
- migration 021, tests backend, PostgreSQL, hyperscale et statiques renforcés ;
- version front, backend, Docker et manifests scale alignée sur 1.23.0.

## 1.22.0 — 2026-09-19

Cockpit d’administration totale :

- dossier client centralisé ouvert directement depuis Plateforme SVA ;
- recherche d’un client par nom, société, pays ou numéro SVA E.164 ;
- vue unifiée identité, pays, abonnement, paiement, KYC et accès SVA ;
- activité client agrégée sur 30 jours avec appels, durée, chiffre d’affaires et marge ;
- administration des lignes SVA directement dans le dossier ;
- administration du statut des experts du client ;
- alertes impayés et acquittement depuis le dossier ;
- reversements récents visibles sans changer d’écran ;
- historique des actions de contrôle et audit technique regroupés ;
- collections strictement bornées pour conserver une architecture compatible avec des millions de tenants ;
- module dossier chargé à la demande, hors shell critique ;
- budget lazy dédié de 20 KiB ;
- palette Actions / Ctrl K chargée uniquement à la première utilisation ;
- détail CDR et export CSV sortis du cœur `app.js` et chargés à la demande ;
- moteur analytique avancé `cockpit-pro.js` chargé après le premier rendu ;
- build statique complété pour embarquer explicitement tous les modules runtime ;
- shell critique ramené à environ 241 Ko, avec près de 25 Ko de marge sous le plafond ;
- `app.js` ramené à environ 83,5 Ko, avec plus de 8 Ko de marge ;
- CI renforcée : réserve minimale de 16 KiB obligatoire sous le plafond shell de 260 KiB ;
- cache PWA v26 ;
- création d’un client externe directement depuis le cockpit, toujours en état `pending` et sans accès SVA automatique ;
- initialisation KYC `pending`, placement data et profil marché onboarding lors de la création ;
- langue, devise et fuseau résolus automatiquement depuis le marché du pays lorsqu’ils ne sont pas fournis ;
- administration plateforme accessible depuis Plateforme SVA, Opérateurs et la palette d’actions ;
- publication d’un nouveau tarif d’abonnement par version immuable, avec confirmation ;
- découverte des seules connexions SIP éligibles à une bascule ;
- changement d’opérateur en deux temps : préparer puis activer explicitement ;
- rollback explicite dans la fenêtre configurée ;
- activation et rollback opérateur audités avec l’administrateur authentifié ;
- version front, backend, Docker et manifests scale alignée sur 1.22.0.


## 1.21.0 — 2026-09-19

Customer Control Center :

- administration des clients externes directement depuis Plateforme SVA ;
- recherche serveur indexée par nom, raison sociale, slug, pays, statut et état d’abonnement ;
- pagination par curseur, 50 clients par page dans le cockpit, sans chargement massif côté navigateur ;
- suspension/réactivation d’un client avec audit et idempotence ;
- suspension automatique de ses affectations SVA actives lors d’une suspension client ;
- réactivation client refusée sans abonnement SVA payé actif ;
- réactivation des lignes volontairement explicite, ligne par ligne ;
- suspension/réactivation d’une ligne SVA directement depuis le cockpit ;
- routage téléphonique bloqué si l’affectation externe n’est pas active ;
- détection distribuée des abonnements échus ou en échec de paiement ;
- alertes impayés persistantes et dédupliquées, visibles dans le cockpit ;
- une alerte marquée « vue » reste non résolue jusqu’au renouvellement payé correspondant ;
- tenant interne PGI protégé contre les suspensions externes et toujours exempté d’abonnement ;
- nom PGI • Telecom - Audiotel Premium Pro renforcé visuellement ;
- accès Paramètres volontairement moins proéminent ;
- module d’administration client chargé à la demande pour protéger le shell critique ;
- migration 020 et cache PWA v24 ;
- version front, backend, Docker et manifests scale alignée sur 1.21.0.

## 1.20.0 — 2026-09-19

External Subscription Gate :

- abonnement mensuel obligatoire pour l'accès SVA des tenants externes ;
- tenant interne PGI automatiquement exempté de toute facturation d'abonnement ;
- plan `external-sva-access` avec entitlement `premium_rate_calls` ;
- tarif initial versionné à 2,00 EUR par mois ;
- historique immuable des versions tarifaires pour permettre des hausses futures sans réécriture ;
- changement de prix administratif idempotent, avec date d'effet ;
- abonnements existants ancrés sur leur version de prix tant qu'une migration explicite n'est pas demandée ;
- routage téléphonique fail-closed avec `402 SVA_SUBSCRIPTION_REQUIRED` pour un client externe non payé ;
- activation des affectations SVA externes interdite sans abonnement payé actif ;
- événements de facturation append-only et dédupliqués par fournisseur / event ID ;
- endpoint machine-to-machine de synchronisation fournisseur protégé par token dédié ;
- external billing désactivé par défaut pour conserver l'usage personnel actuel inchangé ;
- nouveaux indicateurs Plateforme SVA : prix mensuel, abonnements actifs, accès autorisés/bloqués, exemption PGI ;
- cache PWA v23 ;
- version front, backend, Docker et manifests scale alignée sur 1.20.0.

## 1.19.0 — 2026-09-19

Performance Radar & Benchmark Intelligence :

- nouveau Radar de performance chargé à la demande ;
- détection statistique des dérives trafic, ASR, abandons, attente, chiffre d’affaires et MOS ;
- référence robuste basée sur la médiane des 12 périodes précédentes et dispersion MAD ;
- états stable, amélioration, écart notable et anomalie forte ;
- deux graphiques volume × ASR pour experts et opérateurs ;
- matrices de benchmark avec part trafic, appels, ASR, ACD, CA/appel et marge ;
- concentration Top 1 / Top 3 pour experts et réseaux ;
- marge dimensionnelle exacte exposée par les agrégats PostgreSQL ;
- module radar chargé paresseusement et exclu du shell critique initial ;
- budget indépendant de 16 KiB pour le module paresseux, shell principal maintenu à 260 KiB ;
- cache PWA v22 ;
- versions front, backend, Docker et manifests scale alignées sur 1.19.0.


## 1.18.0 — 2026-09-19

Caller Experience Intelligence :

- nouvelle couche Expérience appelant dans le Cockpit ;
- attente moyenne tous appels et attente moyenne avant abandon ;
- taux d'appels aboutis en 20 secondes ou moins ;
- taux d'abandons en 10 secondes ou moins ;
- temps SVI moyen et temps de file moyen ;
- distribution des attentes en six tranches jusqu'à plus de 120 secondes ;
- série temporelle attente moyenne / décroché rapide ;
- détection RTP dégradée selon perte de paquets, jitter ou latence ;
- suivi des échantillons MOS inférieurs à 3,5 ;
- agrégats horaires PostgreSQL dédiés pour rester scalable sans scanner l'historique brut ;
- backfill automatique des métriques d'expérience et qualité lors de la migration 018 ;
- tests PostgreSQL réels des temps d'attente, SVI, file et qualité ;
- cache PWA v21 et budgets front stricts conservés ;
- versions front, backend, Docker et manifests scale alignées sur 1.18.0.

## 1.17.0 — 2026-09-19

Command Center et temps réel distribué :

- Cockpit densifié avec 12 indicateurs de performance avancés ;
- tendances volume, conversion, finance, qualité voix et économie unitaire ;
- chaîne visuelle attendu → confirmé → encaissé ;
- séries financières et RTP temporelles calculées côté serveur ;
- indicateurs d’éligibilité reversement, marge, couverture et concordance financière ;
- suivi de concentration experts et opérateurs ;
- relais SSE multi-processus via PostgreSQL `LISTEN/NOTIFY`, sans Redis/Valkey ;
- supervision du relais, des souscripteurs SSE et du rôle des workers ;
- module graphique avancé séparé et cache PWA v20 ;
- budgets stricts conservés : `app.js` 90 KiB et shell 260 KiB ;
- versions front, backend, Docker et manifests scale alignées sur 1.17.0.

## 1.16.0 — 2026-09-19

Operator Efficiency et optimisation du temps de travail :

- endpoints consolidés `/api/v1/app/bootstrap` et `/api/v1/dashboard/bootstrap` ;
- chargement initial réduit à deux blocs principaux plus le détail CDR borné ;
- cache des métadonnées control-plane pendant 60 secondes ;
- synchronisation SSE différenciée : dashboard, incrémentale ou complète ;
- un nouvel appel ne recharge plus que la page CDR récente ;
- les événements expert/opérateur/alerte ne rechargent plus les CDR ;
- suspension SSE lorsque l'application passe en arrière-plan ;
- reprise incrémentale ou complète selon la durée d'absence ;
- file de synchronisation empêchant la perte d'un changement de période pendant une requête ;
- rendu limité à la vue active ;
- workspace persistant : vue, période, dates personnalisées, marché et mode mobile ;
- palette universelle Actions sur desktop et mobile avec raccourci Ctrl/⌘ + K ;
- centre d'alertes rendu actionnable : finance, ASR, RTP, API, CDR, queue et dead letters ;
- Experts, Opérateurs et Réconciliation basculés sur les agrégats exacts serveur ;
- runtime frontend découpé en modules cacheables ;
- nouveaux modules inclus dans le shell PWA ;
- cache PWA porté à v19 ;
- `app.js` maintenu sous le budget strict de 90 KiB sans relever la limite ;
- versions front, backend, Docker et manifests scale alignées sur 1.16.0.

## 1.15.0 — 2026-09-19

Cockpit Intelligence et supervision enrichie :

- navigation `Vue d’ensemble` renommée `Cockpit` ;
- navigation `Système` renommée `Supervision` ;
- en-tête `Tour de contrôle` pour éviter les libellés redondants ;
- nouvelle couche analytique serveur `/api/v1/dashboard/analytics` ;
- agrégats dimensionnels quotidiens experts, opérateurs et durées ;
- agrégats qualité RTP horaires pour MOS, perte paquets, jitter et latence ;
- heatmap jour × heure exacte côté serveur ;
- graphiques appels/minutes et ASR/abandons ;
- répartitions horaires et hebdomadaires ;
- donut statuts et histogramme de durées ;
- classements experts/opérateurs alimentés par les agrégats serveur ;
- économie unitaire : valeur/appel, CA/minute, marge/appel, durée moyenne ;
- anciens graphiques CA/reversement, experts et réseaux raccordés au même moteur analytique ;
- garde-fous multi-devises sur les graphiques financiers ;
- repli automatique sur les CDR récents pendant un déploiement si l'endpoint analytique n'est pas encore disponible ;
- cache PWA porté à v18 ;
- front, backend, Docker et exemples de scale alignés sur 1.15.0.

## 1.14.0 — 2026-09-19

Résilience hyperscale et isolation renforcée :

- frontière SQL tenant via contexte transactionnel et vues `security_barrier` ;
- work queue exécutable avec lease, reprise, retry exponentiel et dead-letter ;
- handlers de queue explicitement enregistrés ;
- politiques multi-région et résidence des données par tenant ;
- cibles RPO/RTO, exercices DR et événements de failover ;
- propagation W3C `traceparent` et trace ID ;
- histogrammes Prometheus de latence par route et compteurs HTTP par statut ;
- métriques queue, dead letters et fraîcheur des workers ;
- ledger d’usage append-only partitionné pour metered billing et quotas ;
- cycles de facturation auditable par tenant ;
- références de stockage objet avec checksum, chiffrement, rétention et legal hold ;
- politiques de conservation et demandes de confidentialité par tenant/marché ;
- règles d'alerte burn-rate, p95, CDR, outbox et jobs ;
- visibilité régions/DR dans le cockpit Wholesale et dans le NOC ;
- variables de queue configurables en production ;
- cache PWA porté à v17 ;
- versions front/backend/Docker alignées sur 1.14.0.

## 1.13.0 — 2026-09-18

Fondation hyperscale pour plusieurs millions de clients :

- 4 096 buckets stables de placement tenant et registre multi-clusters ;
- identifiants publics UUID et tiers de capacité par client ;
- plan analytique `call_facts` réparti sur 64 partitions physiques ;
- agrégats quotidiens et compteurs d'usage partitionnés ;
- API et workers séparables par `PGI_PROCESS_ROLE` ;
- leases distribués et file de travaux durable ;
- support d'une réplique PostgreSQL de lecture et pools séparés ;
- dual-write transactionnel vers le plan analytique des appels ;
- réconciliation et règlements synchronisés avec les faits analytiques ;
- identité externe des clients séparée des comptes staff PGI ;
- identité fédérée, adhésions tenant, sessions révocables et clients API ;
- plans de service, abonnements, entitlements et quotas ;
- manifests Kubernetes d'exemple avec HPA jusqu'à 100 instances API ;
- indicateurs de capacité hyperscale visibles dans le cockpit ;
- cache PWA porté à v16 ;
- versions front/backend/Docker alignées sur 1.13.0.

## 1.12.0 — 2026-09-18

Fondation internationale multi-marchés :

- séparation client, marché, numérotation, opérateur, devise, langue et fuseau horaire ;
- France conservée comme seul marché actif par défaut ;
- numéros canoniques E.164 avec alias opérateur explicites ;
- capacités opérateurs et connexions rattachables par marché ;
- CDR, contrats, règlements et ledger enrichis par marché et devise ;
- regroupement des reversements par devise sans consolidation artificielle ;
- profils client/marché pour locale, fiscalité, conformité et résidence des données ;
- profils de conformité paiement rattachables à chaque marché ;
- bootstrap PostgreSQL neuf rendu compatible avec les migrations immuables à checksum ;
- cockpit Wholesale enrichi avec marchés et devises ;
- sélecteur de marché global, automatique et mémorisé lorsque plusieurs marchés sont actifs ;
- documentation d'ouverture d'un nouveau pays ;
- cache PWA porté à v15 ;
- versions front/backend/Docker alignées sur 1.12.0.


## 1.11.1 — 2026-09-18

Durcissement mobile petits écrans :

- en-tête compact sans débordement sur Android/iPhone étroits ;
- statuts secondaires retirés de la barre supérieure mobile pour préserver l’espace utile ;
- périodes personnalisées réorganisées en grille tactile ;
- filtres et actions de tableaux adaptés aux largeurs 320–520 px ;
- cache PWA porté à v14 ;
- versions front/backend/Docker alignées sur 1.11.1.


## 1.11.0 — 2026-09-18

Optimisation mobile Android et iOS :

- zones sûres iPhone/iPad et navigation compatible encoche/Home Indicator ;
- hauteur dynamique `100dvh` ;
- cibles tactiles de 44 px minimum ;
- formulaires 16 px pour empêcher le zoom automatique Safari ;
- tableaux tactiles avec scroll inertiel et première colonne figée ;
- optimisation portrait/paysage ;
- responsive renforcé jusqu'à 320 px ;
- navigation et cartes recalibrées pour les doigts et non la souris ;
- métadonnées PWA Android/iOS renforcées ;
- cache PWA porté à v13 ;
- versions front/backend/Docker alignées sur 1.11.0.


## 1.10.2 — 2026-09-18

Identité mobile :

- affiche désormais **PGI • Telecom - Audiotel Premium Pro** directement dans l’en-tête mobile ;
- le nom reste visible même lorsque la sidebar desktop est masquée ;
- cache PWA porté à v12 et versions alignées sur 1.10.2.


## 1.10.1 — 2026-09-18

Ergonomie mobile et identité :

- nom officiel visible : **PGI • Telecom - Audiotel Premium Pro** ;
- mode mobile **Vue essentielle** par défaut pour réduire fortement la longueur de l'accueil ;
- analyses avancées accessibles par **Voir l’analyse complète** ;
- préférence mobile conservée localement ;
- priorité mobile donnée au lancement SVA, aux KPI, au temps réel et aux alertes ;
- cache PWA porté à v11 et versions alignées sur 1.10.1.


## 1.10.0 — 2026-09-18

Pilotage SVA orienté lancement et mobile :

- remplacement du simple bandeau Wholesale de l'accueil par un centre de lancement SVA ;
- séquence opérateur amont → numéro 089 → SIP/routage → multi-clients ;
- calcul automatique du nombre d'étapes prêtes ;
- barre de progression de préparation ;
- détection automatique de la prochaine action bloquante ;
- raccourci contextuel vers la vue concernée ;
- synthèse immédiate clients, 089 affectés, stock libre, KYC et net clients ;
- accès direct Plateforme SVA dans la barre mobile ;
- déplacement des Experts dans le menu Plus sur mobile ;
- cockpit exécutif compacté sur petit écran pour faire remonter les informations réellement actionnables ;
- aucun faux contrat, numéro, client, KYC, trunk ou paiement en mode démo ;
- cache PWA porté à v10 et versions front/backend/Docker alignées sur 1.10.0.


## 1.9.0 — 2026-09-18

Wholesale SVA Control Center et nouveau nom officiel :

- renommage du produit visible en **PGI • Telecom - Audiotel Premium Pro** ;
- nouvelle vue `Plateforme SVA` dans la navigation desktop et mobile ;
- synthèse wholesale directement sur la vue d'ensemble ;
- API read-only `GET /api/v1/platform/overview` ;
- suivi des éditeurs/tenants, statuts, KYC et volumes d'affectation ;
- vue des numéros SVA, tarifs, statuts, opérateur attributaire et KYC ;
- inventaire du parc SVA et compteur de numéros libres ;
- vue des règlements par éditeur : amont, frais plateforme et net client ;
- état de conformité des profils PSP/DSP2 ;
- totaux financiers calculés sur l'ensemble des règlements, indépendamment de la pagination d'affichage ;
- données wholesale nulles et explicitement non réelles en mode démo ;
- compatibilité front/backend tolérante pendant un déploiement légèrement décalé ;
- contrôles CI renforcés sur l'API wholesale et les fonctions de sécurité ;
- version front/backend/Docker/PWA alignée sur 1.9.0, cache PWA v9.


## 1.8.0 — 2026-09-18

Fondation Wholesale SVA / multi-clients :

- modèle `tenants` pour préparer plusieurs éditeurs et revendeurs ;
- droits utilisateurs par tenant ;
- affectations de numéros SVA par client avec opérateur attributaire explicitement identifié ;
- rattachement tenant des numéros, experts, appels, audits et écritures financières ;
- relevés de reversement client et justification appel par appel ;
- profils KYC éditeurs sans stockage des pièces sensibles dans Git ;
- profils de conformité des flux financiers / DSP2 ;
- documentation de la trajectoire éditeur → plateforme multi-éditeurs → opérateur SVA attributaire ;
- routage experts isolé par numéro SVA et tenant ;
- rejet des CDR qui associent un expert d'un autre tenant ;
- obligation du contexte `sva_number` sur les routes téléphonie internes en production ;
- contrat CI renforcé pour empêcher la suppression silencieuse des garde-fous wholesale ;
- cache PWA porté à v8 et versions front/backend/Docker alignées sur 1.8.0.

La release n'active pas un portail revendeur ni la circulation de fonds de tiers : ces fonctions restent volontairement bloquées jusqu'à validation des contrats opérateur, du KYC et du cadre de paiement.


## 1.7.0 — 2026-09-18

Refonte Executive Premium du cockpit :

- nouveau design system sombre haut de gamme, plus profond et plus lisible ;
- command deck exécutif avec état système, synchronisation, période et SHA de release ;
- hiérarchie visuelle renforcée des KPI financiers et opérationnels ;
- navigation latérale raffinée avec états actifs plus nets ;
- topbar sticky translucide et actions plus cohérentes ;
- cartes, panneaux, tableaux et filtres harmonisés dans un langage visuel unique ;
- amélioration des graphiques, jauges, badges et états live ;
- ergonomie mobile revue avec navigation flottante type application native ;
- conservation stricte des données réelles et des états honnêtes de production ;
- budget de performance conservé très largement sous les limites du projet ;
- cache PWA et couleurs système alignés sur la palette Premium 1.7.


## 1.6.0 — 2026-09-18

Déploiement et exploitation Premium 24/7 :

- déploiement front immuable par commit Git ;
- bascule atomique du symlink `current` et rollback automatique sur smoke test en échec ;
- conservation et purge contrôlée des anciennes releases ;
- Caddy sert uniquement la release atomique courante ;
- pipeline backend séparé, explicitement gated et utilisable avant choix opérateur ;
- sauvegarde PostgreSQL et exercice de restauration obligatoires avant mise à jour d’un backend existant ;
- migrations automatiques limitées aux changements expand-only compatibles rollback ;
- migrations bornées par `lock_timeout` et `statement_timeout` ;
- readiness stricte sur PostgreSQL et fraîcheur des workers critiques ;
- healthcheck Docker basé sur la readiness ;
- arrêt gracieux borné, avec drainage explicite des connexions SSE ;
- logs HTTP JSON corrélés par `request_id`, sans URL brute ni données client ;
- identité exacte de release par SHA Git injectée dans le front et le backend ;
- vérification publique de la version et du SHA après déploiement ;
- CI renforcée sur les scripts de déploiement, rollback, migrations et contrats production.
- audit hôte toutes les cinq minutes : readiness, releases, CDR, outbox, disque et sauvegardes ;
- rétention bornée des sauvegardes PostgreSQL et validation renforcée des CDR avant stockage.


## 1.5.0 — 2026-09-18

Durcissement Premium préproduction avant choix opérateur :

- correction définitive des cookies `__Host-` et protection CSRF en temps constant ;
- protection anti-bruteforce dédiée au login administrateur ;
- rejet des connexions navigateur cross-site sur l’authentification ;
- déconnexion explicite, expiration de session globale et purge des données affichées ;
- capacité SSE bornée et timeouts HTTP explicites ;
- validation JSON stricte, limite de corps anticipée et erreurs de chemin encodé en 400 ;
- baselines PostgreSQL autoritaires et synchronisées entre appareils ;
- suppression des taux de démonstration dans tous les calculs et graphiques production ;
- taux financiers réels dérivés des CDR dans les paramètres ;
- métriques Prometheus de santé des workers et dernières exécutions réussies ;
- endpoints téléphonie, readiness et ingestion CDR privés par défaut derrière Caddy ;
- prise en compte sûre de l’IP client uniquement depuis le proxy loopback ;
- migrations PostgreSQL transactionnelles, versionnées et protégées par checksum ;
- démarrage API bloqué tant que les migrations n’ont pas réussi ;
- sauvegardes PostgreSQL vérifiées par `pg_restore` et SHA-256 ;
- exercice de restauration dans une base isolée ;
- suppression de Valkey du socle 24/7 tant qu’il n’apporte aucune fonction utilisée ;
- séparation préflight infrastructure / go-live opérateur ;
- CI renforcée sur production, SQL, migrations, shell, sécurité et non-régression.


## 1.4.0 — 2026-09-18

Branchement du cockpit sur le backend privé :

- authentification production intégrée au front ;
- client API session + cookies sécurisés ;
- transmission automatique du jeton CSRF pour les écritures ;
- récupération paginée des CDR réels ;
- alimentation du cockpit avec experts et KPI live du backend ;
- aucune génération de faux CDR lorsque le mode production est actif ;
- rafraîchissement temps réel par Server-Sent Events ;
- baseline globale créée dans le backend avant remise à zéro visuelle ;
- erreurs 401 / 429 traitées proprement dans l’interface ;
- tests statiques anti-régression sur le chemin production.


## 1.3.0 — 2026-09-18

Cockpit dashboard Ultra Premium :

- indice opérationnel PGI calculé ;
- comparaison automatique période N / N-1 ;
- heatmap trafic jour × heure ;
- entonnoir de conversion appels ;
- qualité média MOS / packet loss / jitter / latence ;
- ranking experts sur la période ;
- donut de mix réseaux appelants ;
- waterfall financier CA → attendu → confirmé → encaissé → marge ;
- ratios financiers avancés ;
- résumé performance équipe ;
- bandeau NOC ;
- navigation mobile complète via bottom sheet ;
- états API/CDR/SIP rendus dynamiques et non trompeurs ;
- suppression des faux compteurs live en mode démo ;
- responsive renforcé desktop/tablette/mobile.

## 1.2.0 — 2026-09-18

Abstraction complète de l'opérateur SVA :

- numéro 089 découplé de l'opérateur hôte ;
- adaptateurs opérateur versionnés ;
- connexions SIP/CDR/règlement séparées ;
- route logique `sva-primary` ;
- opérateur actif + standby ;
- bascule atomique A→B ;
- rollback B→A testé ;
- événements de portabilité historisés ;
- identité du 089 protégée pendant activité/portage ;
- contrats opérateur conservés par période ;
- appels historiquement rattachés au vrai opérateur hôte ;
- API de préparation, activation et rollback de bascule ;
- dashboard opérateur actif/standby/portabilité ;
- validation automatique des profils opérateur.

## 1.1.0 — 2026-09-18

Durcissement technique avant branchement opérateur :

- moteur financier isolé et testable ;
- distinction stricte attendu / confirmé / payé ;
- calcul réel des tendances au lieu de pourcentages fictifs ;
- test de charge 100 000 appels ;
- réconciliation avec tolérance configurable ;
- ingestion CDR idempotente ;
- journal financier append-only ;
- idempotence API et outbox fiable ;
- prévention des contrats opérateurs chevauchants ;
- contraintes SQL de cohérence temporelle et financière ;
- agrégats horaires et index BRIN pour gros historiques ;
- smoke test PostgreSQL en CI ;
- autodiagnostic front sans fuite d'erreur ;
- health probe API ;
- budgets de taille et intégrité HTML ;
- artefact GitHub Pages minimal `dist/` ;
- workflow de déploiement production VPS gated ;
- architecture same-origin front/API derrière Caddy ;
- préflight, healthcheck, SLO et observabilité ;
- conteneurs Postgres/Valkey durcis.

## 1.0.0 — 2026-09-18

Première base PGI Telecom • Audiotel Premium Pro :

- dashboard premium mobile-first ;
- périodes jour / 7 jours / semaine / mois / année / personnalisée ;
- CA, reversement attendu, confirmé, marge et écarts ;
- CDR détaillés et filtres ;
- export CSV et impression/PDF ;
- fiche d'appel avec chronologie, SIP et qualité RTP ;
- experts et opérateurs ;
- baseline non destructive ;
- PWA et mode hors ligne pour le shell ;
- CSP et règles de sécurité dépôt public ;
- tests et scanner de secrets ;
- schéma PostgreSQL ;
- OpenAPI ;
- réconciliation financière ;
- infrastructure Postgres/Valkey ;
- documentation téléphonie, déploiement et exploitation.

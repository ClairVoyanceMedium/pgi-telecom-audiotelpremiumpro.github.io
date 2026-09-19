# Changelog


## Unreleased

- relais temps réel inter-processus via PostgreSQL `LISTEN/NOTIFY` pour les déploiements API/workers séparés ou multi-instance ;
- aucun Redis/Valkey requis pour ce fan-out ;
- déduplication de l’écho local et limite stricte de taille des notifications ;
- processus worker en publication seule afin d’éviter une connexion LISTEN inutile ;
- tests unitaires dédiés au bus distribué et fermeture propre de la souscription au shutdown.

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

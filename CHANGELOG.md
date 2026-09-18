# Changelog

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

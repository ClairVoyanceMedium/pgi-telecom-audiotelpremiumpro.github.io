# Changelog

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

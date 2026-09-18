# Changelog

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

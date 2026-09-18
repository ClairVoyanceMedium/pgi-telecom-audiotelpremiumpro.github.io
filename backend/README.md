# Backend privé

Ce dossier contient les contrats de la future API privée.

Le backend réel ne sera pas hébergé par GitHub Pages. Son code restera versionné dans GitHub, mais son exécution se fera sur l'infrastructure 24/7.

## Responsabilités

- authentification ;
- autorisation par rôle ;
- lecture/écriture PostgreSQL ;
- ingestion CDR ;
- événements temps réel ;
- réconciliation opérateur ;
- exports ;
- baselines ;
- audit ;
- métriques système.

## Règles obligatoires

- requêtes paramétrées ;
- migrations versionnées ;
- aucun secret hardcodé ;
- validation stricte des entrées ;
- limites de pagination ;
- rate limiting ;
- délais d'attente réseau ;
- logs structurés ;
- request ID ;
- health endpoints distincts liveness/readiness ;
- arrêt gracieux ;
- tests unitaires et d'intégration.

Le choix final du framework et des dépendances sera figé au moment du provisionnement du serveur afin d'utiliser des versions maintenues et vérifiées à cette date.

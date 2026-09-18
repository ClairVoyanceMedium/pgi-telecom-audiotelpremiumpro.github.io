# Déploiement hyperscale

Ces manifests sont des exemples de topologie, pas le déploiement compact par défaut.

Le principe est de séparer les instances HTTP stateless des workers :

- API : `PGI_PROCESS_ROLE=api`
- workers : `PGI_PROCESS_ROLE=worker`

Le writer PostgreSQL est fourni par `PGI_DATABASE_URL`. Une réplique de lecture facultative est fournie par `PGI_DATABASE_READ_URL`.

Les secrets ne sont jamais présents dans Git. Les exemples utilisent un Secret Kubernetes `pgi-secrets` et un ConfigMap `pgi-runtime` à créer dans l'environnement cible.

L'autoscaling API est basé ici sur CPU/mémoire. En production très chargée, ajouter des métriques applicatives comme requêtes/seconde, latence p95 et profondeur de file.

Voir `docs/HYPERSCALE.md`.

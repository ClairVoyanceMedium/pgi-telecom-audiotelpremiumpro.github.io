# Déploiement hyperscale

Ces manifests sont des exemples de topologie, pas le déploiement compact par défaut.

Le principe est de séparer les instances HTTP stateless des workers :

- API : `PGI_PROCESS_ROLE=api`
- workers : `PGI_PROCESS_ROLE=worker`

Le writer PostgreSQL est fourni par `PGI_DATABASE_URL`. Une réplique de lecture facultative est fournie par `PGI_DATABASE_READ_URL`.

Les secrets ne sont jamais présents dans Git. Les exemples utilisent un Secret Kubernetes `pgi-secrets` et un ConfigMap `pgi-runtime` à créer dans l'environnement cible.

Les exemples fournis comprennent :

- `api-deployment.example.yaml` : plusieurs API stateless ;
- `api-hpa.example.yaml` : autoscaling API de 3 à 100 pods ;
- `worker-deployment.example.yaml` : pool de workers séparé ;
- `worker-hpa.example.yaml` : autoscaling workers de 2 à 50 pods ;
- `pod-disruption-budgets.example.yaml` : disponibilité minimale pendant les maintenances.

L'autoscaling de départ utilise CPU/mémoire. En production très chargée, ajouter des métriques applicatives comme requêtes/seconde, latence p95 et profondeur de file.

Voir `docs/HYPERSCALE.md`.

# Déploiement sans Cloudflare

## Deux surfaces distinctes

### Démonstration publique

GitHub Pages reste adapté à la démonstration statique. Cette version utilise le mode `demo`, ne contient aucune donnée client réelle et ne porte aucun secret.

### Production authentifiée

Le cockpit réel doit être servi depuis le même domaine que l’API, derrière Caddy. Le build production utilise :

```
PGI_RUNTIME_MODE=production
PGI_API_BASE_URL=/api/v1
```

Cette architecture conserve les cookies de session en même origine et évite toute dépendance CORS inutile.

## Architecture production actuelle

```
Internet
   │
HTTPS 443
   ▼
Caddy
   ├── fichiers statiques du cockpit
   └── /api/* → API PGI Telecom sur 127.0.0.1:8080
                    │
                    ▼
               PostgreSQL
               réseau privé

FreeSWITCH / Kamailio
   │
   └── endpoints machine internes → 127.0.0.1:8080
```

Les endpoints `/api/v1/internal/*` et `/api/v1/ingest/freeswitch` sont volontairement bloqués par le proxy public. Les composants téléphonie locaux les appellent directement sur loopback.

Valkey n’est pas requis par le runtime actuel et n’est donc pas démarré en production. Il ne devra être ajouté que lorsqu’un besoin réel de cache, file distribuée ou multi-instance le justifiera.

## Préparation avant choix de l’opérateur

Le backend, PostgreSQL, l’authentification, le cockpit production, les CDR simulés de validation et les contrôles de sécurité peuvent être déployés avant la contractualisation SVA.

Utiliser `scripts/preflight.sh` avec `PGI_REQUIRE_OPERATOR=false`. Les variables de sécurité PGI et PostgreSQL restent obligatoires, mais aucun numéro 089, hôte SIP ou code tarifaire opérateur n’est requis à ce stade.

Un exemple sans secret réel est fourni dans `infra/production.env.example.txt`.

## Passage opérateur / go-live téléphonie

Au moment du branchement opérateur, définir `PGI_REQUIRE_OPERATOR=true` puis renseigner :

- `SVA_NUMBER` ;
- `SVA_TARIFF_CODE` ;
- `SVA_HOST_CARRIER` ;
- `SIP_PRIMARY_HOST` ;
- `SIP_TRANSPORT` ;
- `SIP_PORT`.

Le préflight devient alors bloquant sur ces paramètres.

## Migrations PostgreSQL

Le conteneur `migrate` s’exécute après le healthcheck PostgreSQL et avant l’API. Il applique les fichiers de `database/migrations/` dans l’ordre lexical et conserve, dans `schema_migrations`, le nom et le SHA-256 de chaque migration appliquée.

Règles :

- ne jamais modifier un fichier de migration déjà appliqué ;
- créer un nouveau fichier numéroté pour chaque évolution ;
- une divergence de checksum bloque le démarrage de l’API ;
- les migrations sont transactionnelles ;
- le CI exécute le runner deux fois pour vérifier l’idempotence.

Les scripts `database/schema.sql` et `database/views.sql` restent la référence pour la création d’une base neuve.

## DNS et TLS

Le domaine de production pointe directement vers le serveur par enregistrement A/AAAA. Caddy gère le certificat TLS. Aucune clé privée TLS ne doit être stockée dans Git.

Aucun Cloudflare n’est requis.

## Pare-feu

N’exposer publiquement que ce qui est nécessaire :

- 443/TCP pour le cockpit et l’API publique ;
- SIP uniquement selon les IP et ports fournis par l’opérateur ;
- RTP uniquement sur la plage configurée ;
- SSH selon la politique d’administration.

PostgreSQL reste sur le réseau Docker privé. L’API n’est publiée que sur `127.0.0.1:8080`.

## Déploiement front atomique

Le workflow `.github/workflows/deploy-production.yml` reste désactivé tant que `PGI_VPS_DEPLOY_ENABLED` n’est pas égal à `true`.

Variables GitHub requises :

- `PGI_VPS_HOST` ;
- `PGI_VPS_USER` ;
- `PGI_VPS_FRONT_PATH`, attendu typiquement à `/srv/pgi-dashboard` ;
- `PGI_PRODUCTION_URL`, obligatoirement en HTTPS.

Secrets GitHub requis :

- `PGI_VPS_SSH_KEY` ;
- `PGI_VPS_KNOWN_HOSTS`.

Chaque commit est copié dans `releases/<sha>`. Caddy sert uniquement `/srv/pgi-dashboard/current`. La bascule du symlink `current` est atomique. Le workflow contrôle ensuite le mode production, la version, le SHA Git et `/api/v1/health`. En cas d’échec du smoke test, il réactive automatiquement la release précédente.

## Déploiement backend gardé

Le workflow `.github/workflows/deploy-backend-production.yml` est indépendant et reste désactivé tant que `PGI_VPS_BACKEND_DEPLOY_ENABLED` n’est pas égal à `true`.

Variables supplémentaires :

- `PGI_VPS_APP_PATH`, par exemple `/srv/pgi-backend` ;
- `PGI_VPS_ENV_FILE`, chemin absolu d’un fichier d’environnement protégé, lisible mais non modifiable par l’utilisateur SSH de déploiement.

Séquence backend :

```
npm ci + npm run verify
→ upload release immuable par SHA
→ preflight
→ si PostgreSQL existe : pg_dump vérifié
→ restore drill dans une base temporaire
→ build Docker
→ migrations expand-only avec timeouts
→ démarrage API
→ /ready local
→ contrôle version + SHA
→ contrôle /health public
→ promotion de la release
```

Si la nouvelle API ne devient pas prête, le script redéploie automatiquement la release backend précédente. Cette stratégie est compatible avec le rollback parce que les migrations automatisées sont limitées aux changements additifs.

## Hébergement full-stack Railway avant branchement opérateur

Pour rendre le site public, le portail client, le cockpit et l’API réellement persistants avant le raccordement SVA, le dépôt peut être déployé comme un seul service web Railway relié à un PostgreSQL managé dans le même projet.

Le fichier `Dockerfile` à la racine est la voie canonique pour un nouveau service Railway. Il sert toutes les surfaces depuis le même processus Node et conserve `/api/v1` en même origine, ce qui évite les cookies cross-origin et CORS. `infra/Dockerfile.platform` reste la copie dédiée de l’image plateforme. Le fichier `railway.json` est conservé uniquement pour compatibilité avec les services Railway qui l’utilisent déjà ; un nouveau service ne doit pas dépendre de l’ancien mécanisme Config-as-Code.

Configuration minimale du service :

- PostgreSQL Railway non exposé publiquement ;
- `DATABASE_URL` défini par référence vers la variable `DATABASE_URL` du service PostgreSQL ;
- secrets PGI injectés par l’environnement, jamais dans Git ;
- `PGI_REQUIRE_OPERATOR=false` tant que le numéro SVA, le code tarifaire et le trunk SIP ne sont pas contractuellement disponibles ;
- domaine HTTPS Railway ou domaine personnalisé sur le même service web.

Le script `scripts/start-platform.sh` construit le front en mode production à partir du SHA Railway, initialise de façon fail-closed une base vide, applique les migrations puis lance l’API sur le port fourni par la plateforme.


## Déploiement

Les deux workflows de production restent explicitement gated. Aucun déploiement n’est activé uniquement parce qu’un commit arrive sur `main`.

Le cœur PGI peut donc être mis en place et validé avant l’opérateur. Seule la couche SIP/SVA réelle reste en attente des paramètres contractuels.

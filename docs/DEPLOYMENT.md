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

## Déploiement

Le workflow `.github/workflows/deploy-production.yml` est volontairement bloqué tant que la variable GitHub `PGI_VPS_DEPLOY_ENABLED` n’est pas égale à `true`.

Pipeline :

```
push GitHub
→ npm ci verrouillé
→ vérifications qualité/sécurité
→ build production
→ transfert VPS
→ contrôle des fichiers déployés
```

Le cœur PGI peut donc être mis en place et validé avant l’opérateur. Seule la couche SIP/SVA réelle reste en attente des paramètres contractuels.

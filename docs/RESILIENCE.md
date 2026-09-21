# Résilience et continuité de service — PGI • Telecom

## Principes

Le socle 1.14 sépare la disponibilité applicative, la durabilité des données et la reprise régionale.

Une panne de dashboard ne doit jamais interrompre la téléphonie. Une panne d'une instance API ne doit pas interrompre l'API. Une panne d'un worker ne doit pas perdre un job. Une panne régionale ne doit pas nécessiter de modifier l'identité d'un tenant.

## Niveaux de disponibilité

### API et workers

Les API sont stateless et peuvent être multipliées derrière un load balancer.

Les workers utilisent des leases, `FOR UPDATE SKIP LOCKED`, des jobs avec lease d'exécution et une dead-letter queue. Si un worker disparaît, un lease expiré peut être repris par un autre worker.

### PostgreSQL

Le writer reste l'autorité transactionnelle.

Les lectures tolérant un léger retard peuvent être dirigées vers `PGI_DATABASE_READ_URL`.

Le passage à plusieurs régions doit utiliser une technologie PostgreSQL/DB managée capable de fournir réplication, promotion et sauvegardes selon les objectifs RPO/RTO définis dans `disaster_recovery_targets`.

### Placement tenant

Chaque tenant conserve :

- un UUID public stable ;
- un bucket stable sur 4 096 valeurs ;
- une région primaire ;
- des régions autorisées ;
- des régions de failover ;
- une politique de résidence des données.

La reprise ne change donc pas l'identité externe du tenant.

## Frontière de sécurité tenant

Les futures API clients ne doivent pas lire les tables opérationnelles directement.

Le contexte tenant est fixé localement à une transaction avec `set_config('pgi.tenant_id', ..., true)`.

Les données client sont ensuite lues via les vues `tenant_scoped_*`, créées avec `security_barrier=true`.

Le `tenant_id` présenté par un navigateur ne doit jamais être utilisé comme preuve d'autorisation. Le tenant provient uniquement de l'identité authentifiée et de son membership.

En production, le rôle SQL utilisé par une API client devra recevoir uniquement les droits nécessaires sur ces vues et fonctions, jamais un accès générique aux tables du control plane.

## Work queue

Cycle d'un job :

1. insertion durable dans `work_queue` ;
2. réservation avec `FOR UPDATE SKIP LOCKED` ;
3. lease limité dans le temps ;
4. heartbeat automatique pendant les traitements longs, avec possibilité de heartbeat manuel ;
5. exécution par un handler explicitement enregistré ;
6. succès : `completed_at` ;
7. erreur : retry exponentiel ;
8. dépassement de `max_attempts` : dead-letter immuable.

Un handler absent n'est jamais remplacé par un traitement générique : le worker ne réclame que les queues qui possèdent un handler enregistré.

## Disaster Recovery

Les tables suivantes structurent la reprise :

- `platform_regions` ;
- `tenant_residency_policies` ;
- `disaster_recovery_targets` ;
- `disaster_recovery_drills` ;
- `region_failover_events`.

Les valeurs RPO/RTO du schéma sont des objectifs initiaux de conception, pas des performances garanties.

Avant une mise en production multi-région, chaque cible doit être validée par un exercice réel et l'artefact de preuve doit être conservé.

## Observabilité

Chaque requête API possède :

- un `request_id` local ;
- un `trace_id` compatible avec le format W3C `traceparent` ;
- une route logique ;
- un statut ;
- une durée.

Le backend expose des métriques Prometheus pour :

- requêtes et statuts HTTP ;
- histogrammes de latence par route ;
- retard CDR ;
- disponibilité experts ;
- outbox ;
- queue distribuée ;
- dead letters ;
- fraîcheur des workers.

Les règles d'alerte d'exemple sont dans `infra/observability/prometheus-alerts.example.yml`.

## SLO et error budget

Objectif initial API métier : 99,9 % mensuel.

L'error budget associé est de 0,1 %.

Deux niveaux de burn-rate sont fournis :

- burn rapide : détection d'une consommation très agressive du budget ;
- burn soutenu : détection d'une dérive moins brutale mais durable.

Les seuils doivent être recalibrés après mesures réelles et revus par route critique.

## Exercices obligatoires avant hyperscale réel

- perte d'une API pendant charge ;
- perte d'un worker avec job en cours ;
- expiration et reprise d'un lease ;
- création volontaire d'un dead letter ;
- restauration PostgreSQL sur environnement isolé ;
- promotion d'une réplique ;
- bascule régionale contrôlée ;
- retour arrière après bascule ;
- vérification des contraintes de résidence tenant ;
- saturation volontaire de la queue ;
- test de charge API et CDR avec mesure p50/p95/p99.

## Principe de prudence

La présence d'une structure multi-région dans le code ne signifie pas que plusieurs régions sont réellement actives.

Le cockpit doit refléter l'état réel : une seule région reste affichée tant qu'aucune seconde région n'a été réellement provisionnée, testée et déclarée prête.


## Durabilité de facturation

Les événements d'usage servant aux abonnements ou quotas sont append-only et idempotents.

Une fermeture de tenant ne supprime pas automatiquement les références de facturation historiques. La suppression ou anonymisation doit suivre les politiques de conservation applicables.

## Données volumineuses et documents

Les gros documents sont référencés dans `object_assets` et stockés hors PostgreSQL.

Chaque objet peut porter une classification, une région de stockage, un checksum SHA-256, une portée de chiffrement, une date de rétention et un legal hold.

Cette séparation limite la croissance de PostgreSQL et permet des politiques de cycle de vie propres au stockage objet.


## Performance & Resilience Lab

Le Control Tower expose un gate de préproduction fondé sur des preuves mesurées, jamais sur une capacité déclarative.

Le gate vérifie notamment :

- un test de charge réussi datant de moins de 30 jours ;
- une sonde synthétique health/readiness sur les dernières 24 heures ;
- un restore drill réussi datant de moins de 30 jours ;
- l'absence de dead letters ;
- l'âge maximal du backlog de work queue ;
- la réserve de connexions PostgreSQL ;
- les tables nécessitant une revue simple d'index/vacuum.

`npm run perf:load` exécute uniquement des requêtes GET. Toute cible distante nécessite `PGI_PERF_ALLOW_REMOTE=true`. Les seuils p95 et taux d'erreur sont configurables et le résultat peut être enregistré dans le Performance Lab.

`npm run perf:synthetic` vérifie health/readiness. Une cible distante doit être en HTTPS.

`npm run resilience:drill` utilise uniquement le store simulateur et vérifie la reprise d'un lease expiré, l'isolation en dead-letter et la reprise du traitement après incident.

Le débit affiché comme « PROUVÉ » correspond au dernier test réussi enregistré. Il ne constitue pas une garantie de capacité future : toute modification majeure d'infrastructure, de schéma ou de charge doit déclencher un nouveau test.

# Architecture hyperscale — PGI • Telecom

## Objectif

Le socle 1.14 est conçu pour évoluer d'un déploiement mono-cluster vers une plateforme accueillant des millions de tenants sans changer l'identité des clients, les contrats API ou le modèle télécom.

L'objectif n'est pas de payer aujourd'hui une infrastructure dimensionnée pour des millions d'utilisateurs. L'objectif est que la montée en charge soit un changement de capacité et de placement, pas une réécriture.

## Architecture cible

```
Internet / opérateurs / applications
              │
              ▼
     CDN + WAF + load balancer
              │
       ┌──────┴──────┐
       ▼             ▼
 API stateless    API stateless   ... N
       │             │
       └──────┬──────┘
              ▼
       Event / job plane
       ├─ outbox durable
       ├─ work queue
       └─ realtime gateway
              │
       ┌──────┴──────────┐
       ▼                 ▼
 Worker pool         Worker pool  ... N
              │
              ▼
        Data routing plane
     4096 tenant buckets stables
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
 cluster A cluster B cluster C ... N
 primary   primary   primary
 + replicas + replicas + replicas
```

## Control plane et data plane

### Control plane

Le control plane contient les données légères nécessaires pour savoir où se trouve un client et comment il doit être exploité :

- tenants ;
- identités publiques ;
- marchés ;
- KYC ;
- contrats ;
- capacités opérateurs ;
- `routing_buckets` ;
- `tenant_data_placement` ;
- état des clusters.

Cette couche reste petite relativement aux CDR et peut être fortement répliquée.

### Data plane

Le data plane contient les données volumineuses :

- appels ;
- faits analytiques ;
- événements CDR ;
- écritures financières ;
- métriques ;
- jobs ;
- exports et archives.

Les données volumineuses ne doivent jamais être routées en recherchant dynamiquement parmi des millions de clients. Le tenant détermine directement un bucket puis un cluster.

## 4096 buckets de placement

Chaque tenant possède un `placement_bucket` stable entre 0 et 4095.

Au départ, les 4096 buckets pointent vers `primary-eu`.

Quand un deuxième cluster est ajouté, il n'est pas nécessaire de modifier les millions de clients. Une partie des buckets est déplacée vers le nouveau cluster, puis les tenants concernés suivent une procédure de migration contrôlée.

Cette indirection permet :

- un cluster unique aujourd'hui ;
- plusieurs clusters demain ;
- rééquilibrage progressif ;
- isolation de très gros clients ;
- clusters dédiés à certains pays ou régions ;
- migration sans changer le `tenant_public_id`.

## Identifiants

Les `bigint` restent utilisés en interne pour l'efficacité PostgreSQL.

Les tenants disposent en plus d'un `public_id UUID`. Les identifiants internes séquentiels ne doivent pas devenir l'identité publique distribuée du client.

## Appels à très gros volume

La table transactionnelle `calls` reste la source métier détaillée.

La table `call_facts` est le plan analytique haute volumétrie. Elle est partitionnée par hash sur 64 partitions physiques selon le bucket tenant.

Avantages :

- écritures distribuées entre plusieurs partitions ;
- index plus petits ;
- contention réduite ;
- possibilité de déplacer ensuite les partitions ou buckets vers des clusters différents ;
- requêtes tenant fortement localisées ;
- BRIN temporel pour les grandes plages de dates.

Les appels sont écrits transactionnellement dans `calls` puis dans `call_facts`.

Les règlements opérateurs mettent à jour les deux représentations dans la même transaction.

## Agrégats

`metric_rollups_daily_v2` prépare des agrégats quotidiens tenant/marché/devise répartis sur 64 partitions.

À très gros volume, les dashboards de longue période doivent lire ces agrégats plutôt que recalculer des milliards de CDR.

Les données brutes restent disponibles pour les détails, audits et réconciliations.

## API stateless

Le backend supporte trois rôles :

- `PGI_PROCESS_ROLE=all` : déploiement compact actuel ;
- `PGI_PROCESS_ROLE=api` : instance HTTP stateless ;
- `PGI_PROCESS_ROLE=worker` : instance dédiée aux traitements asynchrones.

En mode hyperscale, les API et les workers sont déployés séparément.

Aucune session applicative critique ne doit dépendre de la mémoire d'une instance API.

## Workers distribués

Les traitements pouvant être exécutés sur plusieurs nœuds utilisent :

- `FOR UPDATE SKIP LOCKED` pour l'outbox ;
- `worker_leases` pour les tâches singleton ;
- `work_queue` pour les traitements durables et parallélisables ;
- idempotence obligatoire pour les effets externes.

Un redémarrage d'un worker ne doit pas perdre un travail.

## PostgreSQL

Le runtime accepte :

- `PGI_DATABASE_URL` pour le writer ;
- `PGI_DATABASE_READ_URL` pour une réplique de lecture ;
- pools writer et reader séparés.

Les écritures métier utilisent toujours le writer.

Les requêtes lourdes et non critiques en cohérence immédiate peuvent utiliser la réplique si elle est configurée.

À grande échelle, les connexions applicatives doivent passer par un pooler externe tel que PgBouncer ou l'équivalent managé afin que le nombre de pods ne crée pas des milliers de connexions directes vers PostgreSQL.

## Multi-cluster

`data_clusters` décrit les clusters disponibles.

Un cluster peut représenter :

- une base primaire régionale ;
- un cluster dédié à des clients à forte volumétrie ;
- une région imposée par résidence des données ;
- une destination d'archive.

Le code métier ne doit jamais coder en dur un nom de base de données client.

## Événements temps réel

L'EventBus mémoire reste acceptable pour le déploiement compact.

À plusieurs instances API, le temps réel doit être externalisé vers un bus ou une passerelle partagée. L'outbox durable est déjà la frontière de publication.

Le contrat à conserver est : transaction métier → outbox → transport d'événements.

Le fournisseur du transport peut changer sans modifier les producteurs métier.

## Rate limiting

Le limiteur local du backend reste un garde-fou de sécurité.

À grande échelle, le quota global doit être appliqué au niveau edge/API gateway avec un stockage distribué ou un service managé. Ne pas compter sur les compteurs mémoire de chaque pod pour faire respecter un quota global.

## Stockage objet

Les éléments volumineux ne doivent pas être stockés durablement dans PostgreSQL lorsque ce n'est pas nécessaire :

- exports CSV/PDF ;
- relevés opérateurs ;
- pièces KYC ;
- archives CDR ;
- backups ;
- fichiers d'audit volumineux.

Ils doivent aller dans un stockage objet privé avec chiffrement, politique de rétention et références dans PostgreSQL.

## Montée en charge sans réécriture

### Niveau compact

- 1 API avec rôle `all` ;
- PostgreSQL primaire ;
- aucun reader ;
- tous les buckets sur `primary-eu`.

### Niveau haute disponibilité

- 2+ API stateless ;
- 2+ workers ;
- load balancer ;
- PostgreSQL HA ;
- réplique de lecture ;
- pooler de connexions ;
- edge rate limiting.

### Niveau hyperscale

- autoscaling horizontal des API et workers ;
- plusieurs clusters de données ;
- répartition des 4096 buckets ;
- realtime externe ;
- stockage objet ;
- agrégats analytiques ;
- observabilité centralisée.

### Niveau très gros comptes

Un tenant `capacity_tier=dedicated` ou `strategic` peut recevoir un cluster dédié sans changer son identité publique ou son API.

## Règles de conception non négociables

1. Aucun scan de tous les tenants pour router une requête.
2. Aucun état de session critique uniquement en mémoire d'un pod.
3. Aucune somme entre devises différentes.
4. Aucune dépendance métier à un fournisseur de base, queue ou cloud.
5. Toute mutation externe importante doit être idempotente.
6. Les CDR et écritures financières restent auditables.
7. Les gros tableaux sont paginés par curseur, jamais chargés intégralement.
8. Les jobs longs sortent du chemin HTTP synchrone.
9. Les écritures vont au writer ; les reads éventuellement obsolètes peuvent aller aux replicas.
10. Les buckets sont déplacés, jamais les identités clients.
11. Les migrations restent expand-only tant que l'ancien runtime peut coexister.
12. La capacité doit pouvoir augmenter horizontalement avant d'augmenter verticalement.

## Seuils de bascule recommandés

Les seuils exacts dépendent du trafic réel, mais l'architecture doit déclencher une revue avant saturation lorsqu'un des signaux suivants apparaît :

- pool DB durablement > 70 % ;
- CPU DB durablement > 70 % ;
- p95 API > 300 ms sur les routes principales ;
- retard outbox > 30 s ;
- file de jobs croissante pendant plus de 10 minutes ;
- réplique de lecture avec retard incompatible avec l'usage ;
- partition ou index dont la croissance dégrade les temps de réponse ;
- un tenant représente une part disproportionnée du trafic total.

La décision de créer un nouveau cluster doit être prise sur métriques, pas sur un nombre arbitraire de clients.


## Identité client à grande échelle

Les comptes internes PGI et les comptes des entreprises clientes sont séparés.

- `app_users` : personnel et opérateurs du control plane PGI ;
- `customer_principals` : utilisateurs externes des tenants ;
- `customer_identities` : identités provenant d'un fournisseur OIDC/SAML ou autre ;
- `customer_tenant_memberships` : rôles et permissions dans une organisation cliente ;
- `customer_refresh_sessions` : sessions durables révocables ;
- `customer_api_clients` et `service_accounts` : accès machine-to-machine avec secrets stockés uniquement sous forme de hash.

Un utilisateur externe n'obtient jamais un rôle global PGI par simple appartenance à un tenant.

La colonne `authorization_version` du tenant permet d'invalider des claims ou caches d'autorisation lorsque les adhésions changent.

## Plans, droits et quotas

La plateforme peut accueillir des clients de tailles très différentes sans coder des limites dans l'application.

- `service_plans` décrit les offres ;
- `plan_entitlements` décrit les capacités incluses ;
- `tenant_subscriptions` rattache les clients à une offre par marché ;
- `tenant_entitlement_overrides` permet les contrats négociés ;
- `tenant_quota_policies` définit les limites souples et dures ;
- `tenant_usage_counters` conserve l'usage quotidien dans 64 partitions.

Un très gros client peut donc passer de `standard` à `high_volume`, `dedicated` ou `strategic` sans changer d'identité ni de modèle API.

## Limite volontaire du temps réel compact

Le bus mémoire actuel reste adapté au mode compact. Il ne constitue pas un bus temps réel distribué.

Avant de mettre plusieurs instances API derrière un load balancer avec SSE temps réel actif, le transport d'événements doit être branché sur une implémentation partagée à partir de l'outbox durable. Le contrat producteur reste inchangé : transaction métier → outbox → transport.

Cette séparation est volontaire afin de ne pas introduire aujourd'hui une dépendance Redis/Kafka coûteuse alors que le volume réel ne la justifie pas.


## Résilience multi-région 1.14

La croissance horizontale ne suffit pas si une région devient un point de panne unique.

Le socle 1.14 ajoute :

- `platform_regions` ;
- `tenant_residency_policies` ;
- `disaster_recovery_targets` ;
- `disaster_recovery_drills` ;
- `region_failover_events`.

Chaque tenant garde une identité publique et un bucket stables, même si son placement physique change.

Les objectifs RPO/RTO enregistrés sont des objectifs de conception. Ils doivent être validés par des exercices avant d'être considérés atteints.

## Isolation SQL tenant 1.14

Les futures API clients utilisent un contexte tenant fixé localement dans la transaction PostgreSQL et des vues `tenant_scoped_*` avec `security_barrier=true`.

Cette couche complète les contrôles applicatifs ; elle ne remplace pas l'authentification ni les memberships.

## Queue distribuée 1.14

La `work_queue` est désormais exécutable avec :

- réservation atomique ;
- lease expirant ;
- reprise par un autre worker ;
- retries exponentiels ;
- nombre maximal d'essais ;
- dead-letter auditable ;
- handlers explicitement enregistrés.

## Observabilité SLO 1.14

Les requêtes exposent une corrélation W3C `traceparent`, des histogrammes de latence par route et des compteurs HTTP.

Les règles Prometheus d'exemple surveillent notamment le burn-rate du budget d'erreur, le p95, le retard CDR, l'âge des jobs et les dead letters.


## Metered billing à très grande échelle

Les compteurs agrégés ne sont pas une preuve suffisante pour une facturation contractuelle.

Le socle conserve désormais `tenant_usage_events`, un ledger append-only partitionné sur 64 partitions, avec déduplication par source et identifiant d'événement.

`tenant_billing_cycles` matérialise ensuite les périodes de rating et de facturation sans modifier les événements d'usage historiques.

## Stockage objet et cycle de vie

Les pièces KYC, relevés opérateurs, factures, exports CDR, sauvegardes et gros artefacts ne doivent pas être stockés comme blobs dans PostgreSQL.

`object_assets` conserve uniquement les références, checksum, taille, classification, région, chiffrement, rétention et legal hold.

`data_retention_policies` et `data_subject_requests` préparent la gestion des durées de conservation et demandes de confidentialité par tenant et marché.


## Abonnement mensuel des tenants externes

La couche 1.20 ajoute un droit d'accès commercial distinct des reversements SVA. Elle s'applique uniquement aux tenants `customer` et `reseller`. Les tenants `internal` restent exemptés.

Le plan `external-sva-access` contient l'entitlement `premium_rate_calls=true`. La version historique initiale est de 200 unités mineures EUR ; le prix courant passe à **300 unités mineures EUR, soit 3,00 EUR TTC par mois, le 20 septembre 2026**. `service_plan_price_versions` conserve chaque version de prix et sa période d'effet. Le champ `tax_behavior` est `inclusive` : `amount_minor` représente le montant final TTC payé par le client. Un nouveau prix clôt la période de la version précédente et ajoute une nouvelle ligne ; il ne réécrit pas l'historique.

L'autorisation SVA est fail-closed. `pgi_tenant_has_premium_call_access` exige, pour un tenant externe actif, un abonnement actif, une période payée non expirée, le plan SVA externe et une version tarifaire valide. Cette vérification est appliquée au routage du numéro et à l'activation d'une affectation SVA.

Les notifications du futur prestataire de paiement sont normalisées dans `subscription_billing_events`, append-only et dédupliquées. Le backend n'impose pas Stripe ou un autre fournisseur : les références provider/customer/subscription sont abstraites. Cette séparation permet de changer de prestataire sans modifier les tables d'appels ou le routage télécom.

Le billing externe est désactivé par défaut. Tant que `PGI_EXTERNAL_BILLING_ENABLED=false`, le déploiement compact actuel continue de fonctionner uniquement pour PGI sans nécessiter de prestataire de paiement ni de token supplémentaire.


## Annuaire et contrôle clients 1.21

L’administration de plusieurs millions de tenants ne repose pas sur un chargement intégral en mémoire. `GET /platform/tenants` utilise une pagination par curseur, une limite bornée et des recherches préfixées indexées. Les filtres pays/statut utilisent des index composites ; les enrichissements abonnement et nombre de lignes sont évalués seulement sur la page sélectionnée.

Le centre de contrôle permet deux niveaux de suspension indépendants :

- suspension du tenant externe, qui suspend immédiatement toutes ses affectations SVA actives ;
- suspension d’une affectation SVA particulière, sans désactiver les autres lignes du même client.

Toutes les mutations sont idempotentes au niveau API, journalisées dans `audit_log` et `tenant_control_events`, puis relayées par l’outbox. Les tenants internes sont explicitement protégés contre ces actions.

Les impayés sont contrôlés par le worker distribué sous lease. La détection est bornée et s’appuie sur `tenant_subscriptions_due_idx`. Les alertes sont persistantes, dédupliquées par abonnement/période et ne sont résolues qu’après un événement de renouvellement payé correspondant.


## Dossier client borné 1.22

Le dossier client centralisé ne transforme pas le cockpit en requête globale coûteuse. L’annuaire sélectionne d’abord un tenant par curseur ou recherche indexée. Le détail est ensuite exécuté uniquement pour cet identifiant interne.

Chaque sous-collection est bornée : 100 lignes, 100 experts, 50 alertes, 24 reversements, 50 événements de contrôle et 50 entrées d’audit. L’activité d’appels est agrégée sur 30 jours côté PostgreSQL. Cette stratégie rend la profondeur fonctionnelle indépendante de la taille totale du parc clients.

La recherche par numéro réutilise l’index préfixe E.164 créé en 1.21. Les tables volumineuses ne sont jamais chargées intégralement dans le navigateur. Le module de fiche client est chargé à la demande et possède son propre budget, hors du shell critique initial.


## Portail client à grande échelle

Le portail client utilise un bootstrap HTTP consolidé et des agrégats journaliers tenant-scoped. Il évite de recalculer un historique complet d'appels à chaque affichage.

L'historique détaillé est paginé par curseur et l'export navigateur est borné. Les fichiers statiques du portail ne sont pas précachés dans le shell administrateur. En production, les lectures peuvent être dirigées vers `PGI_DATABASE_READ_URL`, tandis que l'authentification et les changements d'autorisation restent fortement cohérents sur la base principale.

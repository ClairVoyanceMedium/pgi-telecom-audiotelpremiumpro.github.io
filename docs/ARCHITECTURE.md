# Architecture — PGI Telecom • Audiotel Premium Pro



## Abonnement PGI et reversements SVA

La plateforme traite deux flux financiers indépendants.

- Abonnement PGI : le client paie son abonnement mensuel au prestataire de paiement, qui reverse ensuite le revenu de plateforme à PGI.
- Reversement SVA : l’opérateur SVA verse directement les sommes dues au client. PGI calcule, rapproche et affiche ces montants, sans encaisser les fonds pour le compte du client.

L’architecture de paiement est pré-câblée mais inactive. Les routes `/customer/billing/status`, `/customer/billing/checkout-session` et `/customer/billing/portal-session` sont présentes, protégées par la session client et le CSRF. Tant qu’aucun adaptateur de paiement n’est volontairement connecté, les actions financières répondent `PAYMENT_PROVIDER_NOT_CONNECTED`.

Le prestataire cible prévu est Stripe, mais aucun secret, appel API, compte ou webhook Stripe n’est nécessaire pour faire fonctionner l’application actuelle. Le branchement futur doit rester derrière ce contrat afin de ne pas coupler les appels, le routage SVA ou les reversements à un prestataire de paiement.

## Objectif

Séparer strictement le front public/versionné et les composants télécom/données privés.

```
Opérateur SVA
    │ SIP + CDR
    ▼
SBC / Kamailio
    │
    ▼
FreeSWITCH
    │
    ├── événements temps réel
    ├── CDR
    └── routage destinations clientes
            │
            ▼
API PGI Telecom
    │
    ├── PostgreSQL
    ├── Valkey/Redis
    ├── moteur de réconciliation
    └── moteur d'alertes
            │
            ▼
Dashboard Audiotel Premium Pro
```

## Front-end

GitHub Pages héberge uniquement :

- HTML/CSS/JS ;
- graphiques et navigation ;
- vues financières ;
- vues CDR ;
- vues expert/opérateur ;
- configuration publique non sensible.

## Backend privé

Le backend 24/7 devra fournir :

- authentification et rôles ;
- API REST/JSON ;
- WebSocket ou SSE pour le temps réel ;
- ingestion des CDR FreeSWITCH ;
- ingestion des CDR/relevés opérateur ;
- calcul des reversements ;
- réconciliation attendue/réelle ;
- export CSV/PDF ;
- journal d'audit ;
- métriques SIP/RTP.

## Modèle financier

Pour chaque appel abouti :

```
service_customer_amount = billable_minutes × service_rate
expected_payout = payout_eligible_minutes × carrier_rate
confirmed_payout = settlement-confirmed amount
expert_cost = expert_billable_minutes × expert_rate
margin = confirmed_payout - expert_cost - technical_costs
variance = expected_payout - confirmed_payout
```

Toutes les règles d'arrondi doivent être paramétrables par contrat opérateur.

## Baseline / remise à zéro

Une baseline possède :

- id ;
- created_at ;
- created_by ;
- scope ;
- optional expert_id ;
- optional number_id ;
- reason.

Les agrégats visibles filtrent les données antérieures à la baseline. Les données sources restent immuables.


## Abstraction opérateur

Le cœur PGI utilise une route logique `sva-primary` et ne dépend d'aucun nom de fournisseur.

```
Même 089
  │
  ▼
sva-primary
  ├── opérateur actif
  └── opérateur standby
        │
        ▼
adaptateur normalisé
        │
        ├── SIP
        ├── CDR
        └── règlement
```

Un changement d'opérateur ne modifie ni le numéro, ni les destinations des sociétés clientes, ni le modèle d'appel, ni le dashboard. L'ancien opérateur reste identifiable sur les appels historiques via `host_carrier_id`.


## Architecture multi-tenant / wholesale

PGI est désormais conçu pour pouvoir évoluer d'un éditeur unique vers une plateforme multi-clients.

```
Opérateurs SVA / collecteurs
          │
          ▼
   Carrier adapters PGI
          │
          ▼
   Route logique SVA
          │
          ▼
       Numéro 089
          │
          ▼
Tenant / éditeur final
          │
   ┌──────┼──────┐
   ▼      ▼      ▼
Destinations  CDR   Finance
```

### Isolation des clients

Le modèle introduit :

- `tenants` : organisation cliente ou interne ;
- `tenant_memberships` : droits par utilisateur ;
- `tenant_number_assignments` : relation commerciale et réglementaire entre client et numéro ;
- `tenant_kyc_profiles` : état de vérification de l'éditeur ;
- `tenant_settlements` : relevés de reversement client ;
- `tenant_call_destinations` : téléphones, SIP, standards et centres d’appels des sociétés clientes ;
- `tenant_settlement_calls` : traçabilité appel par appel ;
- `payment_compliance_profiles` : cadre de circulation des fonds.

Les tables `sva_numbers`, `experts`, `calls`, `metric_baselines`, `audit_log` et `financial_ledger` disposent d'un `tenant_id` additif pour préparer l'isolation sans casser le runtime actuel.

### Autorité d'affectation d'un numéro SVA

Tant que PGI n'est pas lui-même opérateur attributaire, l'opérateur amont reste l'autorité réglementaire qui affecte le numéro spécial à l'utilisateur final.

Le champ `regulatory_assignor_carrier_id` conserve cette distinction.

PGI peut orchestrer l'onboarding, le routage, le reporting et la facturation de plateforme, mais ne doit pas présenter une affectation comme provenant juridiquement de PGI tant que PGI ne détient pas lui-même la ressource correspondante.

### Séparation des fonds

La circulation des fonds SVA est indépendante du routage télécom.

Aucun reversement tiers ne doit passer en mode production sans un `payment_compliance_profile` actif correspondant au montage validé : paiement direct amont→éditeur, agent PSP ou autre rôle réglementaire approprié.

Voir `docs/WHOLESALE-SVA.md` pour la trajectoire complète.


## Architecture hyperscale

Le socle 1.14 sépare désormais le control plane client du data plane volumineux.

- identités publiques UUID ;
- 4 096 buckets stables de placement tenant ;
- clusters de données ajoutables sans changer l'identité client ;
- `call_facts` réparti sur 64 partitions ;
- agrégats quotidiens partitionnés ;
- API et workers séparables ;
- leases et file de travaux durables ;
- writer PostgreSQL et réplique de lecture séparables ;
- identité externe des clients isolée des comptes internes PGI ;
- plans, entitlements, abonnements et quotas configurables.

Le déploiement compact reste possible sur un seul serveur. À mesure que la charge augmente, les mêmes contrats peuvent être répartis sur plusieurs instances et clusters.

Voir `docs/HYPERSCALE.md`.


### Résilience 1.14

Le control plane hyperscale est complété par :

- vues SQL tenant à barrière de sécurité ;
- contexte tenant local à la transaction ;
- queue durable avec lease, retry et dead-letter ;
- régions et politiques de résidence des données ;
- objectifs RPO/RTO structurés et exercices DR ;
- corrélation distribuée `traceparent` ;
- métriques SLO et burn-rate Prometheus.

Les comptes internes PGI conservent l'accès control-plane. Une future API client doit utiliser un rôle SQL distinct limité aux vues tenant-scoped.

Voir `docs/RESILIENCE.md`.


## Routage B2B des appels

Le routage nominal n'impose plus un expert PGI. Le backend résout le tenant propriétaire du numéro puis sélectionne une `tenant_call_destination` active : d'abord une destination liée au numéro, puis une destination générale, ensuite la priorité, la capacité disponible et la charge active. Le module `experts` reste optionnel pour les clients qui veulent gérer des agents individuels.


## Portail client Audiotel

Le cockpit PGI et l'espace client sont deux plans d'interface distincts.

- le cockpit PGI conserve l'administration globale, la marge interne, les opérateurs et les fonctions de contrôle ;
- `client.html` expose uniquement les données de la société authentifiée ;
- les utilisateurs externes utilisent `customer_principals` et `customer_tenant_memberships`, jamais `app_users` ;
- les cookies client sont distincts des cookies administrateur ;
- les lectures client passent par des vues SQL `tenant_scoped_*` et un contexte de transaction obligatoire ;
- le portail privilégie la réplique PostgreSQL de lecture lorsque `PGI_DATABASE_READ_URL` est configurée ;
- l'interface client est hors du cache critique PWA du cockpit et ne consomme donc pas sa réserve de shell.

La première version est volontairement en lecture seule pour le routage. Une saturation, une erreur JavaScript ou une utilisation intensive du portail client ne participe pas au chemin média SIP/RTP.


### Analytique et exports du portail client

Le portail client reste noir/anthracite et indépendant du thème administrateur. Ses graphiques réutilisent le même bootstrap consolidé : appels/décrochés, minutes facturables, montant service TTC, issue des appels et reversements. Aucun appel API supplémentaire n'est nécessaire pour les graphiques.

Les exports client sont générés à la demande dans le navigateur à partir de données déjà autorisées pour le tenant. L'export détaillé des appels est borné à 1 000 CDR par action dans cette version. Pour des volumes supérieurs, la stratégie cible reste un export backend asynchrone vers stockage objet.

Le cockpit administrateur conserve son shell critique : le centre d'export PGI est ajouté dans `call-tools.js`, déjà chargé à la demande.


## Voice Intelligence 1.24

La couche Voice Intelligence reste entièrement auto-hébergée et n'impose aucun service tiers payant.

- `tenant_voice_daily_sharded` agrège quotidiennement la qualité voix par société pour préserver la rapidité du portail client.
- `voice_carrier_health_hourly_sharded` agrège la santé technique par marché, rôle opérateur et opérateur.
- `voice_sip_code_hourly_sharded` conserve une distribution bornée des réponses SIP sans rescanner l'historique complet.
- `telecom_incidents` conserve l'ouverture, l'actualisation et la résolution des incidents NOC.
- `tenant_scoped_voice_daily` et `tenant_scoped_portal_call_details` appliquent la frontière SQL de la société aux données techniques clientes.
- Les CDR FreeSWITCH normalisent PDD, côté de raccrochage, MOS, perte de paquets, jitter, latence, RTT et compteurs RTP lorsqu'ils sont disponibles.
- Le worker de supervision détecte les dégradations de connexion, réseau, PDD et SIP 5xx. Il crée des incidents et des recommandations, mais n'active jamais une bascule opérateur sans action administrateur.
- Le cockpit charge les composants Voice Intelligence à la demande afin de préserver le budget du shell critique.

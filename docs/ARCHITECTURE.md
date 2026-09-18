# Architecture — PGI Telecom • Audiotel Premium Pro

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
    └── routage experts
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

Un changement d'opérateur ne modifie ni le numéro, ni les experts, ni le modèle d'appel, ni le dashboard. L'ancien opérateur reste identifiable sur les appels historiques via `host_carrier_id`.


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
Experts  CDR   Finance
```

### Isolation des clients

Le modèle introduit :

- `tenants` : organisation cliente ou interne ;
- `tenant_memberships` : droits par utilisateur ;
- `tenant_number_assignments` : relation commerciale et réglementaire entre client et numéro ;
- `tenant_kyc_profiles` : état de vérification de l'éditeur ;
- `tenant_settlements` : relevés de reversement client ;
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

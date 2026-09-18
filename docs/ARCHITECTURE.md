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

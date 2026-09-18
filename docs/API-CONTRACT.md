# Contrat API cible

Préfixe recommandé : `/api/v1`

## GET /dashboard/summary

Retourne les KPI agrégés pour une période.

Champs principaux :

- generated_revenue_ttc
- expected_payout_ht
- confirmed_payout_ht
- estimated_margin_ht
- calls_total
- calls_connected
- calls_abandoned
- calls_failed
- billable_minutes
- payout_eligible_minutes
- acd_seconds
- asr_percent
- active_experts
- live_calls
- queue_depth

## GET /calls

Filtres :

- from
- to
- expert_id
- origin_carrier
- status
- sva_number
- limit
- cursor

Chaque CDR devra exposer au minimum :

- id
- started_at
- ivr_started_at
- queued_at
- bridged_at
- ended_at
- caller_masked
- caller_hash
- origin_carrier
- origin_type
- sva_number
- expert_id
- wait_seconds
- conversation_seconds
- billable_seconds
- payout_eligible_seconds
- service_rate
- expected_payout
- confirmed_payout
- expert_cost
- technical_cost
- margin
- sip_final_code
- hangup_cause
- reconciliation_status

## GET /finance/reconciliation

Regroupement par :

- jour
- opérateur
- numéro SVA
- expert

Expose attendu, confirmé, différence, taux de concordance et anomalies.

## GET /experts

Expose présence, statut, appels, minutes, ACD, ASR, reversement généré, coût expert et contribution de marge.

## GET /system/health

Expose :

- sip_trunk
- freeswitch
- kamailio
- database
- redis
- cdr_ingestion
- reconciliation
- websocket
- last_cdr_at
- packet_loss
- jitter_ms
- latency_ms

## POST /metrics/baselines

Crée une nouvelle baseline. Ne supprime aucune donnée.

Le backend doit journaliser l'utilisateur, la date, la portée et la raison.


## API wholesale / multi-tenant

La lecture de synthèse wholesale est maintenant implémentée. Les routes de mutation restent contractuelles et ne doivent pas être exposées comme fonctionnelles tant que leur implémentation backend, leur autorisation par rôle et le cadre opérateur/PSP ne sont pas terminés.

### GET /platform/overview

Implémenté en lecture seule pour les rôles `admin`, `finance` et `readonly`.

Expose sans données KYC sensibles :

- nombre d'éditeurs clients et actifs ;
- KYC vérifiés / en attente ;
- affectations SVA totales / actives ;
- affectations disposant d'un opérateur attributaire identifié ;
- reversement amont cumulé ;
- frais plateforme cumulés ;
- reversement net client cumulé ;
- état du profil de conformité paiements ;
- jusqu'à 50 tenants récents ;
- jusqu'à 50 affectations récentes ;
- jusqu'à 50 règlements récents.

Les totaux financiers sont calculés sur l'ensemble des règlements, indépendamment de la limite d'affichage.

### GET /platform/tenants

Réservé aux administrateurs PGI.

Filtres prévus :

- status
- tenant_type
- country_code
- limit
- cursor

Expose uniquement des métadonnées non sensibles et l'état KYC, jamais les pièces d'identité.

### POST /platform/tenants

Crée un client/éditeur dans l'état `pending`.

Aucune activation SVA n'est autorisée tant que :

- le KYC n'est pas vérifié ;
- l'opérateur réglementairement assignant n'est pas défini ;
- le contrat commercial n'est pas actif.

### GET /platform/numbers

Expose par numéro :

- tenant_id
- sva_number
- tariff_code
- commercial status
- regulatory_assignor_carrier_id
- upstream_assignment_reference
- kyc_status
- logical carrier route
- portability status

### POST /platform/number-assignments

Crée une demande interne d'affectation.

Cette route ne doit jamais être interprétée comme une attribution réglementaire automatique. Tant que PGI n'est pas attributaire, l'activation finale dépend de la confirmation de l'opérateur amont.

### GET /platform/settlements

Regroupe les reversements par tenant et période :

- gross_service_amount_ht
- upstream_payout_ht
- platform_fee_ht
- net_payout_ht
- payment status
- source settlement reference

### GET /platform/settlements/{id}/calls

Expose la justification appel par appel du reversement tenant.

### Principe d'autorisation

Toutes les routes `/platform/*` exigent un rôle plateforme PGI et ne sont jamais accessibles à un tenant ordinaire.

Les futures routes tenant utilisent le contexte authentifié ; aucun `tenant_id` fourni par le navigateur ne doit suffire à élargir le périmètre d'accès.

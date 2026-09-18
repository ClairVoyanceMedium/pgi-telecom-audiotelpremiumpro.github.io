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

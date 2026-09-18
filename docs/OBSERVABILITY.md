# Observabilité

## Principe

Les métriques techniques ne doivent contenir aucune donnée personnelle.

## Métriques backend recommandées

- pgi_http_requests_total
- pgi_http_request_duration_seconds
- pgi_http_errors_total
- pgi_cdr_ingested_total
- pgi_cdr_duplicate_total
- pgi_cdr_rejected_total
- pgi_cdr_processing_lag_seconds
- pgi_calls_active
- pgi_queue_depth
- pgi_experts_available
- pgi_reconciliation_variance_count
- pgi_reconciliation_variance_ht
- pgi_outbox_pending
- pgi_outbox_oldest_age_seconds
- pgi_db_pool_in_use
- pgi_db_query_duration_seconds
- pgi_sip_responses_total
- pgi_rtp_packet_loss_percent
- pgi_rtp_jitter_ms
- pgi_rtp_latency_ms

## Logs structurés

Champs minimum :

- timestamp
- level
- component
- event
- request_id
- call_id interne si applicable
- duration_ms
- status

Ne jamais écrire par défaut :

- numéro appelant complet
- token
- cookie
- mot de passe
- secret SIP
- contenu de consultation

## Corrélation

Le même call_id interne doit permettre de corréler :

SIP → FreeSWITCH → CDR → backend → réconciliation → règlement.

## Alertes

Les alertes doivent être dédupliquées et contenir :

- composant
- première occurrence
- dernière occurrence
- sévérité
- compteur
- lien vers la vue technique concernée.

Aucune alerte ne doit exposer le numéro complet d'un appelant.

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
- expert_id (optionnel)
- call_destination_id
- call_destination_label
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

La lecture de synthèse wholesale est implémentée. Les mutations explicitement documentées comme implémentées ci-dessous sont protégées par rôle et CSRF ; les mutations financières ou réglementaires qui nécessitent encore un prestataire externe restent fail-closed et ne sont pas simulées comme si elles étaient autorisées.

### GET /platform/overview

Implémenté en lecture seule pour les rôles `admin`, `finance` et `readonly`.

Expose sans données KYC sensibles :

- nombre d'éditeurs clients et actifs ;
- KYC vérifiés / en attente ;
- parc SVA total et stock libre ;
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

Implémenté pour le rôle `admin`, avec CSRF et clé d’idempotence. Crée un client ou revendeur externe dans l’état `pending`, initialise son KYC en `pending`, déclenche son placement data hyperscale et crée un profil marché `onboarding` si le pays dispose déjà d’un marché configuré.

Aucune activation SVA n'est accordée par cette création. Le KYC, l’abonnement payé et l’affectation SVA/opérateur restent des étapes distinctes.

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


## GET /platform/tenants/:id/control-center

Retourne un dossier opérationnel borné pour un tenant externe identifié par son UUID public. Accessible aux rôles plateforme admin, finance et readonly.

Le dossier regroupe l’identité et le statut du tenant, l’état KYC sans document d’identité, l’accès SVA effectif, les abonnements et la dernière situation de paiement, jusqu’à 100 affectations SVA, jusqu’à 100 experts, jusqu’à 50 alertes, jusqu’à 24 reversements, jusqu’à 50 événements de contrôle, jusqu’à 50 entrées d’audit et l’activité agrégée sur les 30 derniers jours.

GET /platform/tenants accepte aussi le filtre number, normalisé en E.164 sans signe +, afin de retrouver un client à partir d’un préfixe de numéro SVA. Cette recherche s’appuie sur l’index de préfixe du parc SVA.

La fiche n’accorde aucun droit supplémentaire : les mutations restent protégées par les endpoints dédiés, les rôles, CSRF et, lorsqu’exigé, une clé d’idempotence.


## GET /carrier-switches/options

Retourne la route `sva-primary`, les connexions SIP candidates dont l’état est `ready`, `active` ou `standby`, et les 20 dernières opérations de bascule. Cette route est utilisée par le panneau d’administration du cockpit.

## POST /carrier-switches

Rôle `admin`, CSRF et idempotence obligatoires. Prépare une bascule sans modifier la route active. La connexion cible doit être un trunk SIP entrant déjà prêt.

## POST /carrier-switches/:id/activate

Active atomiquement une bascule préparée. Une confirmation séparée est imposée dans le cockpit. L’action est journalisée avec l’administrateur authentifié.

## POST /carrier-switches/:id/rollback

Revient vers la route standby uniquement si l’opération est terminée et si la fenêtre de rollback n’est pas expirée. L’action est journalisée avec l’administrateur authentifié.

## POST /platform/subscription-prices

Publie une nouvelle version tarifaire de l’abonnement SVA externe. Les versions passées sont immuables ; la publication ferme la période de la version courante et ajoute une nouvelle version, sans réécrire l’historique.


## Routage B2B des destinations

`GET /internal/routing/next-destination?sva_number=...` est l'endpoint machine privé nominal pour FreeSWITCH. Il résout le numéro, le tenant, l'accès SVA, l'affectation et une destination active non saturée. Une destination spécifique au numéro est prioritaire sur une destination générale.

`GET /internal/routing/next-destination/text?sva_number=...` fournit la variante dialplan.

`POST /internal/call-destinations/:id/release` libère le compteur de concurrence.

`POST /platform/tenants/:id/call-destinations` crée une destination en état `testing`. Types : `pstn`, `sip`, `pbx`, `contact_center`.

`POST /platform/call-destinations/:id/status` active, remet en test ou désactive une destination.


## Espace client Audiotel Premium Pro

Les routes client utilisent une session distincte de la session administrateur PGI. La session est liée à un tenant et son autorisation est revérifiée côté base.

### POST /customer/auth/login
Connexion d'un utilisateur externe par e-mail et mot de passe. Si un même utilisateur appartient à plusieurs sociétés, la réponse demande explicitement de sélectionner le tenant.

### POST /customer/auth/activate
Activation à partir d'un lien d'invitation à usage unique. Le client choisit lui-même son mot de passe ; PGI ne conserve jamais le mot de passe en clair.

### GET /customer/auth/me
Retourne uniquement l'identité externe et la société de la session client.

### POST /customer/auth/logout
Ferme uniquement la session client, sans toucher à une éventuelle session administrateur PGI ouverte dans le même navigateur.

### GET /customer/portal?from=...&to=...
Appel consolidé du portail client : trafic, séries journalières, numéros, reversements, abonnement, destinations de routage et derniers appels. Les données sont lues dans le contexte SQL du tenant et peuvent utiliser la réplique de lecture.

### GET /customer/calls?from=...&to=...&cursor=...&limit=...
Historique paginé des appels du tenant. Le curseur évite les offsets coûteux.

### GET /platform/tenants/:id/customer-users
Lecture administrateur des utilisateurs externes d'une société.

### POST /platform/tenants/:id/customer-invitations
Crée une invitation à usage unique. Le backend ne stocke que le hash du jeton ; le jeton brut n'est renvoyé qu'une fois dans `activation_path`.

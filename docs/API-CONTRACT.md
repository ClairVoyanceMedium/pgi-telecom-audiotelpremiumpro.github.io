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

Nom technique historique conservé pour compatibilité. Dans l’interface produit, ces ressources sont présentées comme des **intervenants / postes**. La route expose présence, statut, appels, minutes, ACD, ASR, reversement généré, coût de l’intervenant et contribution de marge.

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

## Dossiers clients automatiques

Chaque tenant client possède une référence dossier déterministe de la forme `APP-AAAA-XXXXXXXXX`, calculée côté serveur à partir de son identité interne et de son année de création. Cette référence est stable, non séquentielle dans l'interface et n'est jamais une clé d'autorisation.

`GET /platform/tenants?q=...` accepte un champ de recherche universel : référence dossier exacte, nom, prénom, nom complet, société, e-mail, téléphone ou numéro SVA. L'accès reste réservé au staff autorisé. Le dossier Customer 360 agrège ensuite identité, abonnement, KYC, lignes SVA, portabilité, activité, reversements, incidents, historique d'audit et notes internes privées sans dupliquer les données sources.

La création manuelle d'un tenant comme l'inscription autonome retournent automatiquement `dossier_ref`. Le portail client peut afficher cette référence pour faciliter les échanges avec PGI.

## POST /metrics/baselines

Crée une nouvelle baseline. Ne supprime aucune donnée.

Le backend doit journaliser l'utilisateur, la date, la portée et la raison.


## API wholesale / multi-tenant

La lecture de synthèse wholesale est implémentée. Les mutations explicitement documentées comme implémentées ci-dessous sont protégées par rôle et CSRF ; les mutations financières ou réglementaires qui nécessitent encore un prestataire externe restent fail-closed et ne sont pas simulées comme si elles étaient autorisées.

### GET /platform/launch-readiness

Diagnostic pré-lancement en lecture seule, accessible aux rôles `admin`, `finance` et `readonly`.

Le résultat distingue explicitement `ready_for_b2b` et `ready_for_b2c`. Il agrège uniquement des preuves observables : stockage PostgreSQL, santé runtime, sécurité, emails, état réel du compte Stripe, identité juridique, prérequis B2C, opérateur/routage, conformité SVA, performance/résilience et reversements.

Les dépendances externes absentes restent `pending_external` ou `action_required`. L'endpoint ne renvoie jamais de clé API, secret, donnée KYC, coordonnées bancaires ou identité Stripe. Il expose l’identifiant de release et la version applicative afin qu’un export de preuve puisse être rattaché au code effectivement contrôlé.

La lecture Stripe réutilise le contrôle live durci de la plateforme : la présence d’une clé et d’un webhook ne suffit pas. Le compte doit être vérifié et signaler notamment `charges_enabled`, `payouts_enabled`, `details_submitted` et `fully_operational` avant que le domaine paiement soit déclaré prêt.

Une connexion opérateur explicitement marquée `down`, `failed`, `error`, `critical` ou `unhealthy` reste bloquante même si sa connexion est administrativement `active`.

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

Réservé aux administrateurs de la plateforme Audiotel Premium Pro.

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

Le dossier regroupe l’identité et le statut du tenant, l’état KYC sans document d’identité, l’accès SVA effectif, les abonnements et la dernière situation de paiement, jusqu’à 100 affectations SVA, jusqu’à 100 intervenants/postes, jusqu’à 50 alertes, jusqu’à 24 reversements, jusqu’à 50 événements de contrôle, jusqu’à 50 entrées d’audit et l’activité agrégée sur les 30 derniers jours.

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

### POST /customer/auth/register
Inscription autonome d’un nouveau client professionnel sans compte Google ni intervention administrateur initiale.

Le formulaire accepte prénom, nom, adresse e-mail, mot de passe, pays, téléphone facultatif, société/activité facultative et numéro d’immatriculation facultatif. En France, lorsqu’un SIRET est fourni, son format est limité à 14 chiffres. L’absence de SIRET n’empêche pas la création du compte.

La création est transactionnelle : principal client, identifiants par mot de passe, société `pending`, rattachement `owner`, profil KYC `pending`, profil marché `onboarding`, journal d’audit et événement outbox sont créés ensemble. Le client reçoit immédiatement une session d’onboarding. Un tenant `pending` n’obtient jamais l’accès SVA : l’activation télécom reste protégée par les contrôles d’abonnement, de KYC, d’opérateur et de statut existants.

L’adresse e-mail est enregistrée comme non vérifiée tant qu’aucun service de vérification d’e-mail n’est connecté. Cette vérification est un état distinct de l’ouverture du compte et de l’accès SVA.

Protection : même origine, mot de passe d’au moins 12 caractères, champ anti-robot, validation serveur et limite dédiée de cinq créations par fenêtre d’authentification et par adresse IP.

### POST /customer/auth/login
Connexion d'un utilisateur externe par e-mail et mot de passe. Si un même utilisateur appartient à plusieurs sociétés, la réponse demande explicitement de sélectionner le tenant.

### POST /customer/auth/activate
Activation à partir d'un lien d'invitation à usage unique. Le client choisit lui-même son mot de passe ; PGI ne conserve jamais le mot de passe en clair.

### GET /customer/auth/me
Retourne uniquement l'identité externe et la société de la session client.

### POST /customer/auth/logout
Ferme uniquement la session client, sans toucher à une éventuelle session administrateur PGI ouverte dans le même navigateur.

### GET /dashboard/voice-intelligence?from=...&to=...&market=...
Diagnostic voix agrégé et borné pour le cockpit administrateur : taux de connexion, PDD, MOS, perte de paquets, jitter, latence, RTT, réponses SIP, origine des raccrochages, santé par opérateur et historique d'incidents. Les périodes complètes utilisent des agrégats pré-calculés et seules les bordures de période relisent les appels bruts.

Le contexte de facturation calculé côté serveur comprend la devise automatiquement résolue depuis le pays, l’offre tarifaire active applicable au pays et à cette devise, les données de préremplissage non sensibles et les chemins de retour. Il sert de contrat stable au futur adaptateur de paiement sans exposer ni stocker de données de carte. Si aucun prix local n’est configuré, `pricing_state=local_conversion_required` et l’ouverture du paiement reste bloquée jusqu’à ce qu’un prix dans la devise locale ou une conversion sûre du prix de référence soit disponible.

La future intégration publique du prestataire ne devra jamais appeler directement l’ingress normalisé interne. L’adaptateur devra d’abord valider la signature native du prestataire, normaliser l’événement, puis l’envoyer au backend PGI avec son authentification interne. Les doublons identiques sont acceptés de manière idempotente ; une réutilisation du même identifiant avec un contenu différent est rejetée.

### GET /customer/billing/status
Retourne l’état de préparation du prestataire de paiement pour le tenant authentifié. Tant que le prestataire n’est pas connecté, `connection_state=not_connected` et les actions de paiement restent indisponibles.

Chaque tentative de création de session de paiement doit porter une clé `Idempotency-Key` unique et stable pendant la tentative. Le client web en génère une avant l’appel. Le futur adaptateur devra réutiliser cette même clé jusqu’au prestataire afin qu’un double clic, un délai réseau ou une répétition HTTP ne crée jamais deux sessions de souscription.

### POST /customer/billing/checkout-session
Crée une session Stripe Checkout hébergée pour l’offre active du tenant authentifié. Le serveur exige une `Idempotency-Key`, résout le prix Stripe par `lookup_key`, puis vérifie montant, devise, périodicité et comportement fiscal contre la version tarifaire PGI avant de créer Checkout. Les métadonnées de tenant et de version tarifaire sont posées côté serveur sur la session et l’abonnement. Checkout affiche aussi une mention explicite indiquant que l’abonnement concerne l’accès à la plateforme PGI Telecom et que les reversements SVA restent un flux contractuel distinct. Un abonnement déjà `active` ou `past_due` bloque la création d’un doublon. Sans configuration Stripe, la route répond `503 PAYMENT_PROVIDER_NOT_CONNECTED`.

### Webhook Stripe de renouvellement\n`invoice.paid`, `invoice.payment_failed` et `invoice.payment_action_required` déclenchent une relecture serveur de l’abonnement Stripe référencé. PGI journalise ensuite l’événement de facture avec la période et le statut d’abonnement vérifiés ; un paiement échoué ou une authentification requise bascule l’accès externe en `past_due` sauf si l’abonnement est déjà dans un état terminal ou suspendu.\n\n### POST /customer/billing/portal-session
Crée une session Stripe Customer Portal pour le customer Stripe déjà lié au tenant. Le portail permet la gestion du moyen de paiement, l’historique des factures et la résiliation en fin de période selon sa configuration. Sans configuration Stripe, la route répond `503 PAYMENT_PROVIDER_NOT_CONNECTED`.

### POST /billing/stripe/webhook
Webhook public Stripe. Le backend lit le corps brut, vérifie `Stripe-Signature` par HMAC avec tolérance temporelle, ignore proprement les événements non utiles et normalise les événements `customer.subscription.*` utiles. L’événement normalisé reste soumis aux contrôles d’idempotence, collision d’identifiant, liaison tenant, version de prix et cohérence du prix. Le retour navigateur Checkout n’active jamais l’abonnement à lui seul.

La facturation d’abonnement et les reversements SVA restent deux flux séparés. L’abonnement suit `client → prestataire de paiement → PGI`. Le modèle SVA nominal suit `opérateur SVA → PGI → marge PGI → net client`. Le règlement opérateur est rapproché appel par appel, puis PGI matérialise sa marge contractuelle et la dette nette envers le client. Le net client ne devient `payable` qu’après encaissement amont et validation des garde-fous KYC, bancaires et de conformité du flux de fonds.

### GET /dashboard/live-finance
Retourne le Business Live du cockpit PGI. Le montant principal est cumulatif depuis la dernière baseline plateforme et inclut les appels terminés comme les appels encore actifs. La réponse expose aussi le direct courant et le classement des clients actifs. Ce compteur n'altère jamais les bilans officiels.

### POST /dashboard/live-finance/reset
Crée une nouvelle baseline Business Live plateforme. Réservé au rôle administrateur, idempotent et audité. La remise à zéro ne modifie ni CDR, ni statistiques jour/semaine/mois/année, ni règlements, ni distributions de revenus.

### POST /dashboard/live-finance/reset-schedule
Crée ou remplace la programmation automatique de remise à zéro du Business Live plateforme. Réservé au rôle administrateur et idempotent. Les fréquences prises en charge sont quotidienne, hebdomadaire, mensuelle sur un jour choisi et intervalle libre en jours. Le fuseau horaire et l'heure locale sont persistés. Pour un jour 29, 30 ou 31 absent d'un mois, l'exécution est ramenée au dernier jour du mois.

### GET /customer/jackpot
Retourne le jackpot motivant du tenant, indépendant des métriques officielles. Le montant est une estimation opérationnelle calculée à la seconde depuis la dernière baseline jackpot, y compris lorsqu'une remise à zéro intervient pendant un appel actif. Les CDR et rapprochements restent l'autorité comptable.

### POST /customer/jackpot/reset
Crée une nouvelle baseline `jackpot` pour le tenant authentifié. L'opération est idempotente, auditée et non destructive : elle ne modifie ni CDR, ni règlement, ni distribution de revenus, ni statistique officielle.

### POST /customer/jackpot/reset-schedule
Crée, modifie ou désactive la programmation automatique propre au tenant authentifié. Réservé aux rôles client `owner` et `admin`. Une programmation peut être quotidienne, hebdomadaire, mensuelle ou répétée tous les N jours à partir d'une date choisie. L'exécution crée exclusivement une nouvelle baseline Business Live ; les données sources et les bilans officiels restent intacts.

### GET /internal/business-live/reset-schedules/run
Route machine protégée par `CRON_SECRET`. Le déclencheur central recherche uniquement les échéances dues dans la `work_queue` persistante existante, verrouille chaque planification avant exécution et journalise chaque passage dans `audit_log`. Aucun cron individuel n'est créé par client et aucune migration Neon supplémentaire n'est requise.

### GET /customer/portal?from=...&to=...
Appel consolidé du portail client : trafic, séries journalières, numéros, reversements, abonnement, destinations de routage, qualité voix agrégée et derniers appels avec diagnostic technique. Les données sont lues dans le contexte SQL du tenant et peuvent utiliser la réplique de lecture.

### GET /customer/comparison?from=...&to=...
Comparaison financière légère et isolée par tenant. Retourne uniquement les agrégats d'appels, de minutes et de montant généré pour une période, afin de comparer deux périodes sans recharger tout le portail.

### GET /customer/calls?from=...&to=...&cursor=...&limit=...&status=...&number_id=...&min_duration=...&max_duration=...&min_amount=...&max_amount=...
Historique paginé des appels du tenant. Le curseur évite les offsets coûteux. Les filtres sont appliqués côté PostgreSQL afin de rester efficaces sur de gros volumes.

### GET /platform/tenants/:id/customer-users
Lecture administrateur des utilisateurs externes d'une société.

### POST /platform/tenants/:id/customer-invitations
Crée une invitation à usage unique. Le backend ne stocke que le hash du jeton ; le jeton brut n'est renvoyé qu'une fois dans `activation_path`.


### POST /customer/auth/change-password
Permet au client authentifié de remplacer son mot de passe. L'ancien mot de passe est vérifié côté serveur, le nouveau est haché avec scrypt et un nouveau sel aléatoire, puis toutes les sessions client existantes sont invalidées par changement de version. Une reconnexion est obligatoire.
## Portabilité entrante d'un numéro existant

`GET /customer/portability` retourne uniquement les dossiers du tenant authentifié. `POST /customer/portability` ouvre une demande sans modifier le routage ni couper la ligne existante. `POST /customer/portability/:id/cancel` reste disponible avant la planification opérateur.

Le dossier conserve l'E.164 existant, le tarif TTC/minute déclaré, sa devise et son état de vérification. La route administrateur `POST /platform/portability/:id/status` permet de vérifier titularité, tarif, référence opérateur, opérateur cible et date de bascule. Elle ne peut pas produire l'état `ported`.

`POST /platform/portability/:id/complete` est l'unique finalisation. Elle exige un dossier `scheduled`, titularité et tarif vérifiés, KYC validé, client et abonnement SVA actifs, opérateur cible égal à la route `sva-primary` active et connexion prête. La création du numéro, de l'affectation client, du rattachement opérateur, de l'événement de portabilité, de l'audit et du passage à `ported` est atomique.

Voir `docs/PORTABILITY.md`.

### POST /platform/tenants/:id/payout-terms
Définit les conditions commerciales de reversement d’un client : pourcentage de marge PGI, éventuel montant HT/minute et délai de paiement. Une affectation SVA externe ne peut pas devenir active sans conditions de reversement applicables.

Les relevés clients sont produits par `tenant_revenue_distributions`. Pour chaque règlement opérateur rapproché, le moteur impose l’identité `reversement opérateur attribué à PGI = marge PGI + net client + montant non alloué`. Un montant non alloué bloque le reversement au lieu d’accorder implicitement 100 % au client.


### POST /platform/tenant-number-assignments/:id/regulatory-evidence-pack

Génère un Evidence Pack réglementaire privé pour une affectation SVA externe. L'opération exige une session autorisée, un jeton CSRF et une clé d'idempotence. Le pack contient un instantané horodaté du KYC, du profil réglementaire, de la chaîne de preuves, de la portabilité, des affectations opérateur, des incidents, des signalements fraude, des contrôles plateforme et de l'historique de routage.

La réponse expose `integrity.pack_sha256`, `integrity.evidence_chain_head` et `integrity.evidence_links_valid`. L'export est journalisé dans `audit_log`. Le RIO brut, les secrets de portabilité, les numéros d'appelants et le contenu des appels ne sont jamais inclus.



### GET /platform/regulatory-review-alerts

Liste paginée des alertes réglementaires de revue. Le filtre `state` accepte `open`, `acknowledged`, `resolved`, `unresolved` ou `all`. Chaque entrée expose notamment `framework`, `alert_kind`, `severity`, `attention_bucket`, `due_at`, le numéro concerné lorsqu'il existe et un diagnostic minimisé.

Les buckets d'attention visibles dans le cockpit sont `blocking`, `today` et `soon`. Une revue non planifiée est classée dans `soon` tant qu'elle n'est pas par ailleurs bloquante.

### POST /platform/regulatory-review-alerts/:id/acknowledge

Acquitte une alerte réglementaire ouverte. L'opération exige le rôle administrateur, CSRF et idempotence. Elle ne modifie aucune preuve réglementaire, aucun statut de contrôle et aucun routage.

### POST /platform/tenant-number-assignments/:id/regulatory-evidence — next_review_at

Le payload de preuve accepte désormais un `next_review_at` futur. Lorsqu'il est fourni, la prochaine revue du profil concerné est mise à jour dans la même transaction que l'ajout de preuve, puis les anciennes alertes de ce framework sont résolues avant le prochain recalcul.


## Control Tower 1.28

### GET /platform/control-tower

Lecture privée agrégée pour `admin`, `finance` et `readonly`. Retourne le statut opérationnel, le score interne de readiness, les KPI critiques, les priorités, le routage opérateur, la work queue, la conformité et la résilience.

### POST /platform/policy/evaluate

Évalue une intention opérationnelle sans mutation. Les intentions prises en charge sont `activate_number`, `port_in`, `payout_customer`, `carrier_switch` et `customer_access`.

La réponse vaut `ALLOWED`, `BLOCKED` ou `ACTION_REQUIRED` et expose les raisons. Cette route n'active aucun numéro, ne paie aucun client et ne bascule aucun opérateur.

### POST /platform/digital-twin/simulate

Exécute un scénario `carrier_outage`, `traffic_spike`, `mass_portability`, `regulatory_expiry`, `billing_failure` ou `region_failure`.

La réponse contient l'impact projeté, la sévérité, des recommandations et les hypothèses de base. `dry_run=true` et `mutates_state=false` sont contractuels.


## Operational Assurance 1.29

### GET /platform/staff-users

Rôle `admin`. Liste les identités staff internes sans exposer de hash de mot de passe.

### POST /platform/staff-users

Rôle `admin`, CSRF et idempotence obligatoires. Crée une identité staff `admin`, `finance` ou `readonly`. Le mot de passe initial doit contenir au moins 12 caractères et n'est stocké que sous forme hashée.

### GET /platform/change-requests

Lecture privée des changements critiques en attente, approuvés ou historiques.

### POST /platform/change-requests/:id/approve

Rôle `admin`, CSRF et idempotence obligatoires. Le demandeur original ne peut pas approuver sa propre demande.

### POST /platform/change-requests/:id/reject

Rôle `admin`, CSRF et idempotence obligatoires. Un motif de refus est requis et le demandeur ne peut pas refuser sa propre demande.

L'activation d'une bascule opérateur exige une demande `carrier_switch_activation` approuvée et non expirée. Le rollback d'une bascule exécutée reste une action de récupération indépendante.

La réponse Control Tower `audiotel-control-tower/2` contient `assurance.risk`, `assurance.slo`, `assurance.shadow_billing` et `assurance.change_requests`.

Le Digital Twin `audiotel-digital-twin/2` ajoute `database_failure`, `worker_backlog`, `settlement_mismatch` et `hyperscale_growth`.


## SVA Compliance Center 1.30

### GET /platform/sva-compliance

Lecture privée `admin / finance / readonly`. Retourne les référentiels suivis, la matrice de readiness par organisme, le catalogue de contrôles, les profils SVA, les états de preuve et les changements tarifaires planifiés. La réponse indique explicitement `external_connections_active=false` et `certification_claimed=false`.

### POST /platform/tenant-number-assignments/:id/sva-compliance-profile

Rôle `admin`, CSRF et idempotence. Met à jour le profil SVA par numéro : catégorie, audience, mode tarifaire, limites, MGIT, information vie privée, contact consommateur, médiation et échéance de revue.

### POST /platform/tenant-number-assignments/:id/sva-compliance-evidence

Rôle `admin`, CSRF et idempotence. Ajoute un événement de preuve append-only SHA-256 pour un contrôle APNF/RSVA, af2m, DGCCRF, CNIL, 33700 ou conditionnel. Un contrôle `verified` exige une référence ; un `not_applicable` est refusé lorsque le catalogue ne l'autorise pas et exige une justification lorsqu'il est permis.

### POST /platform/tenant-number-assignments/:id/sva-tariff-change

Rôle `admin`, CSRF et idempotence. Planifie localement un changement tarifaire. La date d'effet doit être le premier jour d'un mois et respecter un délai minimal de sept jours. Cette route ne transmet aucune déclaration au RSVA.

L'`activation_ready` du cockpit exige désormais Trust Center + ARCEP 2026 lorsque applicable + SVA Ecosystem Readiness.


## Consumption control receipts

`POST /customer/consumption-receipts` creates an immutable aggregate receipt for the exact dashboard period currently displayed by the authenticated tenant. The receipt records the effective metric baselines, aggregate calls/minutes/revenue/validated payout, tenant timezone and a SHA-256 digest. It never stores raw caller identity, card data or a full CDR payload.

`GET /customer/consumption-receipts` returns the tenant's recent receipts.

`GET /platform/tenants/:id/consumption-receipts` lets authorized staff inspect the same receipts. `GET /platform/tenants/:id/consumption-receipts/:receipt/reconcile` recomputes the receipt using the authoritative call facts and validated tenant distributions with the original period and metric baselines, then returns `match` or `difference` with metric-level differences.

A receipt is evidence of what the dashboard aggregate represented when it was created. A later reconciliation can legitimately report a difference if authoritative source data for the frozen period changed later, for example because a late CDR arrived or a validated settlement state changed.


### Activation sécurisée de l’accès client après validation

Lorsqu’un tenant passe à l’état `active` et qu’aucun utilisateur client actif n’est encore rattaché, le backend crée automatiquement une invitation `owner` vers l’adresse de facturation disponible et tente l’envoi d’un email transactionnel d’activation.

L’email ne contient **jamais de mot de passe en clair ni de mot de passe temporaire**. Il contient un lien temporaire et à usage unique vers `client.html?invite=...` afin que le client choisisse lui-même un mot de passe d’au moins 12 caractères. Le serveur ne conserve que le hash du jeton d’invitation puis le hash scrypt du mot de passe choisi.

Après activation, le client peut modifier son mot de passe dans les réglages de sécurité. Le flux « Mot de passe oublié ? » envoie déjà un lien de réinitialisation temporaire et à usage unique.


### Option « Rester connecté »

La connexion client accepte le booléen `remember_me`. Lorsqu’il vaut `true`, la session client est signée pour 30 jours par défaut (`PGI_CUSTOMER_REMEMBER_TTL_SECONDS=2592000`, borne maximale 90 jours). Sans cette option, la durée normale `PGI_SESSION_TTL_SECONDS` reste utilisée.

Les cookies restent `__Host-`, `Secure`, `SameSite=Strict`; le cookie de session reste `HttpOnly`. Le choix ne stocke jamais le mot de passe dans le navigateur. Une déconnexion, un changement de mot de passe ou une réinitialisation invalide l’accès selon les règles de session existantes.


## Rattachement automatique des emails entrants

Les emails reçus sont corrélés au dossier client sans utiliser la référence `APP-...` comme moyen d'authentification. L'ordre de confiance est : réponse à un email transactionnel déjà émis (Message-ID / In-Reply-To / References), puis adresse email exacte déjà rattachée au tenant, puis combinaison adresse + référence dossier. Une référence dossier citée seule par une adresse inconnue reste un indice non vérifié et ne déclenche pas de rattachement client fiable.

Le système ne crée aucune table client parallèle et ne nécessite aucune migration Neon pour ce mécanisme. Le Message-ID technique des emails sortants est conservé dans le champ metadata déjà existant du journal de livraison. Lorsqu'un email entrant est rattaché de façon fiable, la résolution est inscrite dans le journal d'audit existant sans copier le corps du message ni l'adresse de l'expéditeur. Les emails vérifiés sont ensuite journalisés dans HubSpot sur le contact et, lorsqu'il existe, sur la transaction associée.


## Bulle de contact publique

`POST /api/v1/public/contact` est un flux de support, distinct de l'ouverture commerciale.

- Chaque soumission acceptée crée un ticket HubSpot dans `Support Pipeline`, statut `New`, source `Form`, catégorie `General inquiry`.
- Si l'adresse email existe déjà dans HubSpot, le ticket est associé à ce contact.
- Si l'adresse est inconnue, un contact minimal est créé uniquement avec l'email et le propriétaire HubSpot afin de permettre le suivi et la réponse.
- Ce flux ne crée aucun deal, aucun dossier client `APP-...`, aucun statut commercial et n'inscrit pas automatiquement le visiteur dans le pipeline prospects.
- Le ticket contient le message, la page d'origine et sa catégorie fonctionnelle.


## Consentement marketing public

Les formulaires publics de contact et de demande d’ouverture proposent une case marketing facultative, non précochée et indépendante du traitement de la demande. La version de preuve actuelle est `2026-10-01-v1`.

Lorsqu’elle est cochée, le backend tente d’inscrire l’adresse e-mail au type d’abonnement HubSpot `Marketing Information` (`3728444113`) via Communication Preferences v4 avec la base `CONSENT_WITH_NOTICE`. Une note HubSpot horodatée conserve aussi le texte accepté, la source et la version afin de garder une preuve exploitable. Une défaillance de synchronisation marketing ne doit jamais empêcher l’envoi d’un ticket ou la création d’une demande commerciale.

Une case non cochée signifie uniquement qu’aucun nouveau consentement marketing n’est donné. Elle ne désabonne pas automatiquement une personne qui aurait déjà consenti ; la désinscription reste gérée par les mécanismes de préférences/désabonnement.

## Contact et support client authentifié

L’espace client expose un onglet `Contact / Support` qui s’appuie sur le centre de service tenant-scopé existant. Le client peut ouvrir une question générale ou un incident, suivre son statut et ajouter des messages. Le cockpit administrateur peut consulter l’historique, prendre en charge la demande, changer son statut et envoyer des réponses visibles dans l’espace client. Ce flux ne crée pas un second dossier commercial ni un nouveau client.


## Support omnicanal unifié

Les demandes authentifiées de l’espace client utilisent l’identifiant public du ticket interne dans l’objet e-mail sous la forme `[Ticket <uuid>]`. La création du ticket et chaque nouveau message client déclenchent une notification vers la boîte interne avec `Reply-To` positionné sur l’adresse du client. La création et les messages sont également synchronisés vers un ticket HubSpot de support dédupliqué par contact et sujet.

Les réponses visibles envoyées depuis le cockpit administrateur sont envoyées au client par e-mail et ajoutées au même ticket HubSpot. Pour les réponses opérées depuis Gmail par l’automatisation, une copie BCC vers `support-journal@audiotel-premium-pro.com` permet au webhook Resend de journaliser la réponse comme note staff dans le ticket interne sans la retransférer vers Gmail.

Une réponse client à un objet contenant `[Ticket <uuid>]` est reconnue par le webhook Resend, vérifiée par le mécanisme de résolution d’identité existant, enregistrée dans l’historique du ticket interne et synchronisée vers le ticket HubSpot correspondant. Les identifiants de messages déjà traités sont conservés dans `tenant_service_incidents.metadata` afin d’éviter les doublons sans nouvelle migration Neon.

Les transferts Resend vers la boîte interne utilisent l’expéditeur d’origine en `Reply-To`, conservent les informations de fil `In-Reply-To` / `References` lorsqu’elles existent et transfèrent jusqu’à dix pièces jointes via les URLs temporaires fournies par l’API Receiving.

Les demandes de support ne créent jamais automatiquement un deal commercial. Un dossier APP existant peut être affiché comme contexte, mais le support reste porté par un ticket.

Les objectifs de première réponse et de résolution des tickets internes sont calculés en minutes ouvrées Europe/Paris, du lundi au vendredi de 08:30 à 19:00. Les niveaux exposés au client sont formulés en termes d’impact plutôt qu’en priorité technique brute.

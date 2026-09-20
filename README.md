# Audiotel Premium Pro

Plateforme Audiotel professionnelle. Le cockpit interne conserve l’identité « PGI • Telecom - Audiotel Premium Pro ».

> Convention produit : **Audiotel Premium Pro** est le nom public/client. **PGI • Telecom - Audiotel Premium Pro** désigne uniquement le cockpit interne. Les termes publics sont « services », « intervenants » et « postes » ; le nom technique historique `experts` reste conservé dans le code pour compatibilité.

## État actuel

Le dépôt contient deux surfaces strictement séparées : une démonstration statique GitHub Pages sans données réelles, et une architecture de production 1.25.0 same-origin prête à être déployée sur un serveur privé 24/7 avant même le choix de l’opérateur SVA.

Fonctions déjà présentes :

- dashboard mobile-first premium sombre ;
- CA généré par jour / 7 jours / semaine / mois / année / période personnalisée ;
- reversement attendu, confirmé et écart ;
- marge estimée ;
- appels, minutes, ACD, ASR, abandons ;
- vues CDR, intervenants/services et opérateurs ;
- contrôle financier et rapprochement ;
- santé SIP / CDR préparée pour le futur backend ;
- remise à zéro non destructive des métriques avec historique local ;
- architecture prête à recevoir une API privée.

## Cockpit production 1.10

Le front exploite directement l’API privée lorsque `PGI_CONFIG.mode` vaut `production` et que `apiBaseUrl` pointe vers `/api/v1` : authentification par session, cookies `__Host-`, protection CSRF, anti-bruteforce, CDR paginés, experts, KPI live, routage opérateur et rafraîchissement SSE. En production, aucune donnée CDR ni aucun taux financier de démonstration n’est injecté.

Le fichier public `assets/config.js` reste volontairement en mode `demo`. La bascule production doit être effectuée au déploiement, jamais avec des secrets dans le dépôt.

## Sécurité

Le dépôt est public. Ne jamais ajouter ici :

- identifiants SIP ;
- mots de passe ;
- clés API ;
- secrets GitHub ;
- CDR réels contenant des données personnelles ;
- numéros complets de clients ;
- données financières sensibles non agrégées.

Les secrets de production seront injectés via GitHub Actions / environnement serveur et conservés hors du front GitHub Pages.

## Architecture cible

```
GitHub
├── front dashboard
├── configuration versionnée
├── tests
├── documentation
└── CI/CD
        │
        ▼
Backend privé 24/7
├── API sécurisée
├── PostgreSQL
├── Kamailio/OpenSIPS
├── FreeSWITCH
├── CDR / réconciliation
└── monitoring
```

GitHub reste le centre de contrôle du code. Les services SIP, RTP, base de données et données privées tournent sur un serveur 24/7.

## Données de démonstration

Les valeurs visibles dans la V1 sont générées localement dans le navigateur. Les hypothèses financières de démonstration sont :

- service D080 : 0,80 € TTC/min ;
- reversement cible : 0,46 € HT/min ;
- coût intervenant démo : 0,18 €/min.

Ces hypothèses seront remplacées par les paramètres contractuels réels de l'opérateur retenu.


## Durcissement technique 1.1

Le projet possède désormais des garde-fous de préproduction :

- moteur financier testé indépendamment du DOM ;
- tests de calcul, réconciliation et charge ;
- validation PostgreSQL réelle prévue dans GitHub Actions ;
- ingestion CDR et commandes API idempotentes ;
- journal financier immuable ;
- artefact statique minimal : seule l'application est publiée ;
- budgets de performance ;
- autodiagnostic du runtime ;
- architecture production same-origin sans Cloudflare ;
- workflow VPS désactivé tant que les variables/secrets ne sont pas configurés.

La version GitHub Pages reste une démonstration. Les statuts SIP/API affichent explicitement qu'ils ne sont pas connectés tant que l'infrastructure réelle n'existe pas.

## Validation release 1.12.0

La release 1.12.0 transforme la fondation Wholesale SVA en véritable centre de contrôle : vue Plateforme SVA, synthèse wholesale sur l'accueil, clients/tenants, affectations 089, stock libre, KYC, opérateur attributaire, conformité PSP/DSP2 et reversements par éditeur alimentés par PostgreSQL en production.






## Fondation Wholesale SVA

PGI est désormais conçu pour pouvoir évoluer sans réécriture majeure vers trois niveaux :

1. éditeur Audiotel exploitant ses propres 089 ;
2. plateforme multi-éditeurs en marque blanche avec un opérateur SVA attributaire amont ;
3. futur opérateur SVA attributaire de ses propres ressources, sous réserve des obligations ARCEP, AF2M/APNF et du cadre de paiement applicable.

La couche 1.8.0 ajoute notamment :

- tenants et droits d'accès par organisation ;
- rattachement des numéros, intervenants/services, appels, audits et écritures financières à un tenant ;
- affectations commerciales/réglementaires de numéros ;
- profils KYC ;
- profils de conformité des flux financiers ;
- relevés de reversement par client et justification appel par appel ;
- routage FreeSWITCH fail-closed par numéro SVA en production ;
- rejet explicite des associations intervenant/numéro appartenant à deux tenants différents.

Aucun portail client ni flux de fonds tiers n'est activé automatiquement par cette fondation. Ces fonctions resteront fermées tant que l'isolation d'authentification, le contrat opérateur amont et le montage de paiement ne seront pas validés.

Voir `docs/WHOLESALE-SVA.md` pour la trajectoire réglementaire, commerciale et technique.


### Dashboard Wholesale 1.10

Le cockpit comporte maintenant une vue dédiée `Plateforme SVA` et un résumé sur l'accueil.

En production, la vue consomme `GET /api/v1/platform/overview` et expose uniquement des données administratives non sensibles :

- nombre d'éditeurs et d'éditeurs actifs ;
- état des KYC ;
- parc SVA total et stock libre ;
- affectations 089 par éditeur ;
- opérateur réglementairement assignant ;
- reversements amont, frais plateforme et net client ;
- état du profil de conformité des paiements.

En démo, aucun faux client, faux KYC ou faux reversement n'est généré : les compteurs wholesale restent à zéro et l'interface indique explicitement qu'il s'agit d'une fondation prête architecturalement.


### Centre de lancement SVA 1.10

L'accueil mobile et desktop donne désormais la priorité au passage réel en production.

Le centre de lancement calcule quatre prérequis :

1. opérateur SVA amont configuré ;
2. au moins un numéro SVA réel présent ;
3. route SIP opérateur active vers PGI ;
4. fondation multi-clients conforme, avec KYC et profil de paiement lorsqu'ils deviennent nécessaires.

Le cockpit affiche automatiquement la prochaine action bloquante et envoie vers la bonne vue : Opérateurs, Plateforme SVA ou Système.

Sur mobile, la Plateforme SVA est maintenant accessible directement depuis la barre de navigation principale au lieu d'être cachée dans le menu Plus.

En mode démo, le cockpit n'invente aucun contrat, numéro, trunk SIP, client ou paiement réel.


### Mobile Android / iOS 1.11

Le cockpit est optimisé comme une application mobile responsive sans modifier la version desktop.

Points verrouillés :

- zones sûres iPhone via `env(safe-area-inset-*)` ;
- hauteur dynamique `100dvh` pour Safari/Chrome mobile ;
- barre de navigation fixe compatible encoche et indicateur Home ;
- cibles tactiles de 44 px minimum ;
- champs de formulaire à 16 px pour éviter le zoom automatique Safari ;
- tableaux à défilement inertiel avec première colonne visible ;
- vue essentielle mobile par défaut et analyses avancées à la demande ;
- mise en page dédiée portrait et paysage ;
- adaptation petits écrans jusqu'à 320 px ;
- support `pointer: coarse` et réduction des effets hover non pertinents au tactile ;
- métadonnées PWA Android/iOS et `display_override` pour l'installation.

Le nom visible reste **PGI • Telecom - Audiotel Premium Pro**.


### Durcissement petits écrans 1.12.0

La couche mobile est renforcée pour les écrans Android et iPhone les plus étroits : l’en-tête conserve le nom du produit sans débordement, les statuts secondaires sont retirés de la barre supérieure sur petit écran car ils restent disponibles dans les vues de santé, les filtres et périodes personnalisées se réorganisent automatiquement, et les actions de tableaux restent utilisables au doigt sans compression horizontale.


### Internationalisation 1.12

Le socle est désormais France-first mais nativement multi-marchés. Un tenant peut exploiter plusieurs pays sans duplication du backend : marché, langue/locale, fuseau horaire, devise, conformité, numérotation, capacité opérateur et reversements sont découplés.

France reste le seul marché activé automatiquement. Les futurs pays doivent être créés en préparation puis activés uniquement après validation contractuelle, télécom, réglementaire et financière.

Les numéros utilisent E.164 comme identité canonique avec alias opérateur explicites. Les CDR et écritures financières transportent leur marché et leur devise, et le cockpit Wholesale n'additionne jamais des monnaies différentes.

Voir `docs/INTERNATIONAL.md` pour la procédure d'ouverture d'un nouveau marché.


## Hyperscale 1.16

Le socle est préparé pour une croissance jusqu'à plusieurs millions de tenants sans dupliquer l'application :

- 4 096 buckets de placement client ;
- clusters de données extensibles ;
- 64 partitions physiques pour le plan analytique des appels ;
- API stateless et workers séparables ;
- workers distribués avec leases et `SKIP LOCKED` ;
- réplique PostgreSQL de lecture optionnelle ;
- identité externe client séparée du back-office PGI ;
- abonnements, entitlements, quotas et compteurs d'usage ;
- exemples Kubernetes avec autoscaling horizontal ;
- capacité visible directement dans le cockpit Wholesale.

Le déploiement courant reste volontairement compact et économique. Le passage multi-instance ou multi-cluster se fait par configuration et capacité, pas par changement d'identité client ni refonte du modèle métier.

Voir `docs/HYPERSCALE.md`.


## Résilience 1.14

La plateforme ajoute une couche d'exploitation destinée aux très grandes volumétries :

- frontière SQL tenant via contexte transactionnel et vues `security_barrier` ;
- work queue distribuée avec lease, reprise après crash, retry exponentiel et dead-letter ;
- handlers de queue explicitement enregistrés afin qu'un job inconnu ne soit jamais consommé ;
- régions, politiques de résidence, cibles RPO/RTO et exercices de Disaster Recovery ;
- propagation W3C `traceparent` et `trace_id` dans les logs ;
- histogrammes Prometheus de latence par route ;
- métriques queue/dead-letter et règles d'alerte burn-rate SLO ;
- NOC affichant régions prêtes, jobs en attente, ancienneté et cibles DR.

La présence de ces structures ne simule jamais une capacité réellement provisionnée : le cockpit reste à une région tant qu'une seconde région n'a pas été déployée et validée.

Voir `docs/RESILIENCE.md`.


## Cockpit Intelligence 1.15

La page principale est désormais le **Cockpit** et la vue technique est nommée **Supervision**.

Le Cockpit ajoute une couche analytique dense pilotée par le backend :

- CA et reversement ;
- appels et minutes ;
- ASR et abandons ;
- heatmap jour × heure ;
- répartition horaire ;
- répartition hebdomadaire ;
- statuts d'appels ;
- distribution des durées ;
- contribution intervenants ;
- contribution opérateurs ;
- économie unitaire par appel et par minute ;
- qualité voix MOS, perte de paquets, jitter et latence ;
- entonnoir d'appels ;
- comparaison à la période précédente ;
- activité temps réel, alertes, NOC et résilience.

En production, les graphiques principaux lisent des agrégats PostgreSQL bornés plutôt que de télécharger l'historique CDR complet dans le navigateur. Le détail des appels reste volontairement limité et paginé.

Voir `docs/COCKPIT.md`.


## Operator Efficiency 1.16

La couche 1.16 vise directement le temps gagné au quotidien et la réduction de charge :

- démarrage consolidé via `/app/bootstrap` et `/dashboard/bootstrap` ;
- métadonnées applicatives mises en cache 60 secondes ;
- événements temps réel traités selon leur coût ;
- nouvel appel : une seule page récente de CDR est fusionnée ;
- changements intervenant/opérateur : aucun rechargement CDR ;
- suspension des SSE lorsque l'application passe en arrière-plan ;
- resynchronisation complète après une absence prolongée ;
- rendu limité à l'espace de travail actuellement ouvert ;
- dernière vue, période, marché et mode mobile mémorisés ;
- palette universelle Actions avec `Ctrl/⌘ + K` et bouton mobile ;
- alertes regroupées comme centre de décision ;
- Intervenants, Opérateurs et Réconciliation alimentés par les données exactes serveur ;
- runtime frontend modularisé sans augmenter les budgets : `app.js` reste limité à 90 KiB et le shell à 260 KiB.

Voir `docs/EFFICIENCY.md`.


### Temps réel distribué

Le bus SSE de production peut maintenant être relayé entre plusieurs processus Node via PostgreSQL `LISTEN/NOTIFY`, sans dépendance Redis/Valkey supplémentaire. Les événements restent volontairement petits et servent à déclencher la resynchronisation du cockpit. Un processus worker publie sans ouvrir de connexion LISTEN inutile ; les processus API écoutent le canal partagé et ignorent leur propre écho.


## Command Center 1.17

Le Cockpit devient une tour de contrôle métier et télécom dense : 12 indicateurs avancés, tendances finance/volume/conversion/qualité, économie unitaire, chaîne de paiement, concentration intervenants/opérateurs et supervision du bus temps réel distribué. Les graphiques de production utilisent des agrégats PostgreSQL exacts et n’inventent jamais les métriques absentes.

Le temps réel multi-processus s’appuie sur PostgreSQL `LISTEN/NOTIFY`, sans Redis/Valkey supplémentaire. Le moteur graphique avancé est séparé du runtime principal afin de conserver les budgets de performance du shell.


## Caller Experience 1.18

Le Cockpit exploite désormais les timestamps déjà collectés dans les CDR pour mesurer l'expérience appelant : attente moyenne, attente avant abandon, décroché en 20 secondes ou moins, abandon en 10 secondes ou moins, temps SVI, temps de file et distribution des attentes. Ces métriques sont alimentées par des agrégats horaires PostgreSQL dédiés afin de rester rapides sur de gros volumes.

La qualité RTP ajoute deux indicateurs de dégradation : sessions affectées lorsque la perte de paquets atteint 5 %, le jitter dépasse 5 ms ou la latence dépasse 150 ms, et part des échantillons avec MOS inférieur à 3,5. Ces seuils sont affichés comme seuils techniques, pas comme SLA contractuel.


## Performance Radar 1.19

Le Cockpit ajoute un radar de dérive adaptatif et des benchmarks experts/opérateurs. Les signaux comparent la dernière période à la médiane des périodes précédentes avec une dispersion robuste basée sur la MAD, afin de limiter les alertes provoquées par quelques valeurs extrêmes. Les signaux sont descriptifs et ne constituent ni prévision ni SLA.

Le radar est chargé à la demande. Il reste donc hors du shell critique initial, possède son propre budget de taille et bénéficie ensuite du cache runtime du service worker. Les matrices utilisent les agrégats PostgreSQL existants et n’exigent pas de télécharger l’historique complet des CDR.


## Abonnements externes 1.20

PGI peut rester aujourd'hui un outil strictement interne tout en ayant un modèle d'abonnement prêt pour les futurs clients externes. Le tenant `pgi-internal` et, plus généralement, tout tenant de type `internal`, sont exemptés de l'abonnement.

Le plan `external-sva-access` conserve son tarif historique initial de 2,00 EUR, puis passe à **3,00 EUR TTC par mois à compter du 20 septembre 2026**. Pour un tenant externe, l'accès aux appels premium n'est autorisé que si un abonnement `active` possède une période payée dont la date de fin est encore future. Les statuts `past_due`, `suspended`, `cancelled` et `ended` ne donnent pas accès au routage SVA.

Le prix est versionné : le passage à 3,00 EUR TTC crée une nouvelle version avec sa date d'effet sans modifier la version historique à 2,00 EUR. Les abonnements existants restent reliés à leur version de prix jusqu'à une migration explicite, ce qui évite de modifier silencieusement un contrat en cours.

Le fournisseur de paiement reste volontairement découplé. `PGI_EXTERNAL_BILLING_ENABLED=false` est la valeur par défaut. Lors d'une ouverture commerciale, un adaptateur de paiement peut envoyer des événements normalisés vers l'endpoint interne protégé par `PGI_BILLING_INGEST_TOKEN` sans modifier le modèle télécom.


## Contrôle clients et impayés 1.21

La vue Plateforme SVA contient un centre d’administration clients chargé à la demande. L’annuaire reste paginé par curseur et la recherche est exécutée côté PostgreSQL avec des index dédiés : nom, slug, raison sociale, pays, statut et état de facturation. Le navigateur ne tente donc jamais de charger des millions de clients.

Un administrateur peut suspendre un client externe depuis le cockpit. La suspension bloque le tenant et suspend ses affectations SVA actives. La réactivation du tenant exige un abonnement SVA payé actif ; les lignes précédemment suspendues restent volontairement suspendues jusqu’à une réactivation explicite ligne par ligne.

Le worker distribué détecte les abonnements échus ou en échec de paiement et crée une alerte persistante et dédupliquée. Une alerte peut être marquée comme vue, mais elle reste non résolue jusqu’à la réception d’un renouvellement payé valide. Le tenant interne PGI reste protégé et exempté de cette facturation.


## Dossier client centralisé 1.22

La vue Plateforme SVA dispose maintenant d’un dossier opérationnel unifié pour chaque client externe. Depuis une seule fiche, un administrateur peut voir le statut du client, son pays, son abonnement et son échéance, l’état de paiement, le KYC, l’accès SVA, l’activité des 30 derniers jours, les lignes, les experts, les alertes, les reversements récents et l’historique d’audit.

Les actions disponibles depuis cette fiche réutilisent les contrôles de sécurité existants : suspension/réactivation du client, suspension/réactivation de chaque ligne, changement de présence des experts et acquittement des alertes. Les actions sensibles restent soumises aux rôles serveur et à la protection CSRF ; les mutations idempotentes conservent leur clé d’idempotence.

L’annuaire reconnaît aussi un numéro SVA comme critère de recherche. La recherche ne charge jamais le parc complet : le client est retrouvé côté PostgreSQL via le préfixe E.164 indexé, puis la fiche détaillée ne charge que des collections bornées.

Les opérations réglementaires qui nécessitent une autorité externe ne sont pas artificiellement automatisées : la validation KYC, l’attribution réglementaire initiale d’un numéro et les confirmations opérateur restent exposées comme états à contrôler jusqu’au branchement des fournisseurs compétents.

Le portail client propose également une inscription autonome par e-mail. Un nouveau client peut saisir son prénom, son nom, son activité ou société, son pays, son téléphone facultatif et son numéro d’immatriculation facultatif. Pour la France, le SIRET n’est jamais obligatoire pour ouvrir le compte. Le client devient propriétaire de son espace et accède immédiatement à un environnement d’onboarding, tandis que la société reste `pending` et que le routage SVA demeure fail-closed jusqu’aux validations requises.

Le cockpit peut aussi créer un nouveau client externe. La création est volontairement fail-closed : le tenant est `pending`, son KYC est `pending`, son profil de marché est `onboarding` lorsqu’un marché correspondant existe, et aucun accès SVA n’est accordé. Si langue, devise ou fuseau ne sont pas saisis, ils sont repris automatiquement depuis la configuration du marché du pays ; à défaut de marché configuré, des valeurs neutres permettent de conserver le client en attente sans bloquer l’onboarding.

Le panneau Administration plateforme centralise les deux opérations transverses déjà protégées côté serveur : publication d’un nouveau tarif mensuel versionné et bascule de l’opérateur SVA. Une bascule est d’abord préparée vers une connexion SIP déjà `ready`, `active` ou `standby`, puis activée par une seconde confirmation. Le rollback reste disponible uniquement dans la fenêtre prévue et les actions d’activation/rollback sont auditées avec l’administrateur authentifié.


## Discipline de performance 1.23

Le cockpit conserve un plafond de shell critique à 260 KiB et la CI impose désormais une réserve minimale de 20 KiB sous ce plafond. Une évolution qui consommerait cette réserve doit être déplacée dans un module chargé à la demande plutôt que d’augmenter le budget.

Les fonctions non indispensables au premier affichage sont séparées du shell : palette Actions / Ctrl K, analyse avancée, Performance Radar, administration clients, dossier client, administration plateforme, détails CDR, export CSV et générateur de données de démonstration. Les styles de l’administration clients sont eux aussi chargés uniquement à l’ouverture du module.

Le centre clients reste borné et serveur-first : pagination par curseur, recherche indexée, filtres statut/pays/KYC/abonnement et endpoint de synthèse dédié. Le navigateur n’a jamais besoin de charger le parc complet, même lorsque le nombre de tenants devient très important.

Après cette passe, le shell critique reste sous 238 Ko et conserve plus de 27 KiB de marge sous le plafond. Ces valeurs sont surveillées automatiquement par la CI ; les plafonds et la réserve obligatoire ne doivent pas être relevés pour ajouter des fonctions ordinaires.


## Surveillance réglementaire 1.27

Le Regulatory Trust Center surveille désormais les prochaines revues et les preuves plateforme arrivant à échéance. Le cockpit distingue les éléments **bloquants**, **à traiter aujourd'hui** et **bientôt**, avec une file persistante et acquittable.

Une revue peut être planifiée directement lors de l'ajout d'une preuve ARCEP 2026. Le worker d'alertes anticipe les échéances jusqu'à 30 jours et signale les revues non planifiées sur les profils déjà prêts. Il ne suspend jamais automatiquement une ligne active : l'activation reste fail-closed, tandis qu'une interruption de production exige une décision explicite.


## Control Tower 1.28

Audiotel Premium Pro possède désormais une **PGI Control Tower** chargée à la demande depuis la palette de commandes. Elle regroupe les priorités d'exploitation, la readiness interne, la capacité, la conformité, les incidents, la portabilité et la résilience.

Deux moteurs complètent cette vue :
- **Policy Engine** : décision explicable `ALLOWED / BLOCKED / ACTION_REQUIRED` avant une opération sensible ;
- **Digital Twin** : simulation sans mutation des pannes opérateur/région, pics de trafic, portabilités massives, expirations réglementaires et impayés.

Aucun de ces modules n'active une connexion externe. Stripe, opérateurs, APNF/RSVA et PSP restent non connectés.


## Operational Assurance 1.29

La Control Tower inclut désormais un niveau d'assurance supplémentaire : **validation 4 yeux**, comptes staff PGI distincts, **Risk Engine agrégé**, **shadow billing**, SLO opérationnels et scénarios Digital Twin avancés (base principale, workers, règlements et hyperscale).

Une bascule opérateur préparée ne peut plus être activée sans approbation d'un second administrateur distinct. Le rollback d'urgence reste disponible dans sa fenêtre. Les simulations restent sans mutation et aucun fournisseur externe n'est connecté.


## SVA Compliance Center 1.30

Le cockpit possède désormais un centre SVA dédié, lazy-loadé, qui complète le Trust Center et les garde-fous ARCEP 2026. Il suit séparément APNF/RSVA, af2m 2026, DGCCRF, CNIL, 33700, médiation consommation et l'évaluation conditionnelle ACPR/DSP2.

Les nouvelles activations SVA externes françaises sont fail-closed tant que le profil commercial/MGIT et les preuves requises ne sont pas prêts. Les lignes déjà actives ne sont pas suspendues automatiquement. Les changements tarifaires peuvent être préparés localement avec contrôle premier jour du mois + préavis minimal de sept jours, sans envoyer de déclaration au RSVA.

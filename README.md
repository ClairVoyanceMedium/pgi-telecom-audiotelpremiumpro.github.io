# PGI Telecom • Audiotel Premium Pro

Cockpit Audiotel, financier et télécom de PGI Telecom.

## État actuel

Le dépôt contient deux surfaces strictement séparées : une démonstration statique GitHub Pages sans données réelles, et une architecture de production 1.8.0 same-origin prête à être déployée sur un serveur privé 24/7 avant même le choix de l’opérateur SVA.

Fonctions déjà présentes :

- dashboard mobile-first premium sombre ;
- CA généré par jour / 7 jours / semaine / mois / année / période personnalisée ;
- reversement attendu, confirmé et écart ;
- marge estimée ;
- appels, minutes, ACD, ASR, abandons ;
- vues CDR, experts et opérateurs ;
- contrôle financier et rapprochement ;
- santé SIP / CDR préparée pour le futur backend ;
- remise à zéro non destructive des métriques avec historique local ;
- architecture prête à recevoir une API privée.

## Cockpit production 1.8

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
- coût expert démo : 0,18 €/min.

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

## Validation release 1.8.0

La release 1.8.0 conserve le design Executive Premium 1.7 et ajoute la fondation Wholesale SVA : modèle multi-clients, affectation de numéros par éditeur, KYC, séparation des reversements, autorité réglementaire de l'opérateur attributaire et routage téléphonique isolé par numéro/tenant.






## Fondation Wholesale SVA

PGI est désormais conçu pour pouvoir évoluer sans réécriture majeure vers trois niveaux :

1. éditeur Audiotel exploitant ses propres 089 ;
2. plateforme multi-éditeurs en marque blanche avec un opérateur SVA attributaire amont ;
3. futur opérateur SVA attributaire de ses propres ressources, sous réserve des obligations ARCEP, AF2M/APNF et du cadre de paiement applicable.

La couche 1.8.0 ajoute notamment :

- tenants et droits d'accès par organisation ;
- rattachement des numéros, experts, appels, audits et écritures financières à un tenant ;
- affectations commerciales/réglementaires de numéros ;
- profils KYC ;
- profils de conformité des flux financiers ;
- relevés de reversement par client et justification appel par appel ;
- routage FreeSWITCH fail-closed par numéro SVA en production ;
- rejet explicite des associations expert/numéro appartenant à deux tenants différents.

Aucun portail client ni flux de fonds tiers n'est activé automatiquement par cette fondation. Ces fonctions resteront fermées tant que l'isolation d'authentification, le contrat opérateur amont et le montage de paiement ne seront pas validés.

Voir `docs/WHOLESALE-SVA.md` pour la trajectoire réglementaire, commerciale et technique.

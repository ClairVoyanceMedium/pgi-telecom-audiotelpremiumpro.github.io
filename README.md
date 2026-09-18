# PGI Telecom • Audiotel Premium Pro

Cockpit Audiotel, financier et télécom de PGI Telecom.

## État actuel

Cette première version est un **front-end de démonstration** publié sur GitHub Pages. Elle n'utilise aucune donnée client réelle et ne contient aucun secret.

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

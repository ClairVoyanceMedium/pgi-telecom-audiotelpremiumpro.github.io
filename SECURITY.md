# Security Policy

## Principe

Ce dépôt GitHub Pages est public. Il ne doit contenir que le front-end et des données de démonstration.

## Interdit dans le dépôt

Ne jamais committer :

- identifiants ou mots de passe SIP ;
- secret de trunk ou mot de passe FreeSWITCH/Kamailio ;
- token opérateur ;
- clé API ;
- secret JWT ;
- mot de passe PostgreSQL/Redis ;
- fichier .env réel ;
- CDR réels ;
- numéro appelant complet ;
- IBAN, KYC ou documents contractuels ;
- exports financiers confidentiels.

## Production

Les secrets seront placés dans GitHub Environments/Secrets et injectés au déploiement du backend privé.

Le navigateur ne recevra jamais de secret opérateur. Il ne communiquera qu'avec une API authentifiée.

## Données personnelles

Les numéros clients devront être masqués par défaut dans l'interface. L'accès au numéro complet, s'il est réellement nécessaire, devra être journalisé et réservé à un rôle autorisé.

## Remise à zéro

La fonction de remise à zéro des métriques ne doit jamais supprimer les CDR sources. En production elle créera un marqueur de baseline audité en base de données.

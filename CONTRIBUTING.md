# Contribution

## Règles

- toute modification doit être versionnée ;
- aucun secret dans Git ;
- ne jamais modifier les données financières pour masquer un écart ;
- les CDR sources sont immuables ;
- les changements de contrat opérateur doivent être historisés avec une date d'effet ;
- la remise à zéro des métriques est une baseline, jamais une suppression.

## Validation minimale

Avant intégration :

```
npm run verify
```

## Commits

Préfixes recommandés :

- feat
- fix
- security
- data
- api
- infra
- docs
- test
- ci
- chore

## Production

Un changement téléphonie, facturation ou réconciliation doit être testé sur un environnement de préproduction avant bascule réelle.

# Matrice des rôles

## Admin

Accès :

- tous les KPI ;
- tous les CDR masqués ;
- configuration experts ;
- configuration opérateur ;
- baselines ;
- exports ;
- audit ;
- système ;
- finance.

Actions sensibles à journaliser :

- affichage éventuel d'un numéro complet ;
- export ;
- changement de taux ;
- changement de contrat ;
- baseline ;
- modification de rôle.

## Finance

Accès :

- reversements ;
- règlements ;
- réconciliation ;
- factures ;
- exports financiers ;
- statistiques agrégées.

Pas d'accès par défaut :

- configuration SIP ;
- secrets ;
- numéros complets.

## Expert

Accès :

- ses appels ;
- ses minutes ;
- son ACD ;
- son statut ;
- ses statistiques ;
- sa rémunération si cette fonction est activée.

Aucun accès :

- autres experts ;
- contrats opérateur ;
- réglages télécom ;
- données financières globales.

## Readonly

Accès uniquement aux tableaux et KPI explicitement autorisés.

Aucune mutation.

## Règle générale

Le backend, et non le JavaScript du navigateur, doit appliquer les autorisations.

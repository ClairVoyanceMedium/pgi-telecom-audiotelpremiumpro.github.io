# Réconciliation financière

## Objectif

Déterminer, appel par appel puis période par période, la différence entre ce que PGI Telecom calcule et ce que l'opérateur reconnaît.

## Étapes

1. Identifier le contrat applicable à la date de l'appel.
2. Déterminer la durée éligible.
3. Appliquer durée minimale et incrément.
4. Appliquer le taux de reversement.
5. Appliquer les déductions prévues au contrat, par exemple origine mobile si elle existe.
6. Appliquer la règle d'arrondi contractuelle.
7. Calculer le reversement attendu.
8. Importer le relevé opérateur sans le modifier.
9. Rapprocher par identifiant opérateur ou clé composite fiable.
10. Calculer l'écart.
11. Classer : matched, variance, excluded, manual_review.

## Tolérance

La tolérance de rapprochement ne doit jamais être codée en dur. Elle dépend du contrat et doit être configurable.

## Cas à isoler

- appel sous durée minimale ;
- appel mobile avec déduction ;
- appel absent du relevé ;
- doublon ;
- appel présent chez l'opérateur mais absent en interne ;
- changement de contrat en cours de période ;
- portabilité ou bascule de route ;
- correction opérateur sur une période antérieure.

## Règlement

Distinguer systématiquement :

- attendu ;
- confirmé par l'opérateur ;
- facturé ;
- payé ;
- contesté.

Le statut paid ne doit être activé qu'à partir d'une preuve de règlement.

# SLO et objectifs techniques

Ces valeurs sont des **objectifs de conception**, pas des performances déjà mesurées.

## Disponibilité

- API métier : objectif mensuel >= 99,9 % après mise en production.
- Ingestion CDR : aucune perte acceptée ; reprise idempotente obligatoire.
- Dashboard : une panne du dashboard ne doit jamais interrompre un appel.

## Latence

- API summary p95 : cible < 500 ms.
- API calls paginée p95 : cible < 700 ms.
- health endpoint p95 : cible < 200 ms.
- actualisation dashboard : cible < 2 s après disponibilité des données backend.

## CDR

- CDR interne disponible : cible < 10 s après fin d'appel.
- CDR opérateur : dépend du fournisseur ; horodatage de réception obligatoire.
- duplication acceptée à l'entrée mais neutralisée par idempotence.

## Finance

- aucun écart silencieux ;
- toute variance supérieure à la tolérance contractuelle produit une anomalie ;
- confirmé et payé sont deux états distincts ;
- aucune correction financière sans trace d'audit.

## Capacité

Avant go-live, tester au minimum :

- 100 000 CDR dans le moteur de calcul ;
- concurrence téléphonique au niveau contractuel ;
- import d'un relevé opérateur représentatif ;
- pagination sur historique volumineux.

## Seuils d'alerte initiaux

À ajuster après observation réelle :

- API health en échec : immédiat ;
- absence de CDR alors que des appels sont actifs : critique ;
- disque < 20 % libre : warning ;
- disque < 10 % libre : critique ;
- croissance file d'attente outbox : warning ;
- variance financière non résolue : warning puis critique selon montant/ancienneté.

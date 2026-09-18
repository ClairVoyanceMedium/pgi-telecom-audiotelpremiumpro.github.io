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


## Error budget et burn-rate

Pour un objectif mensuel de disponibilité API de 99,9 %, le budget d'erreur théorique est de 0,1 %.

Le fichier `infra/observability/prometheus-alerts.example.yml` fournit deux signaux :

- burn rapide pour une dégradation brutale ;
- burn soutenu pour une consommation durable du budget.

Ces seuils sont des valeurs initiales de conception et doivent être recalibrés avec les métriques réelles.

## Queue distribuée

Objectifs initiaux :

- aucun dead letter non expliqué ;
- ancienneté du plus vieux job < 120 s en régime normal ;
- reprise automatique après expiration d'un lease ;
- aucun job perdu lors de l'arrêt d'un worker.

## Résilience

Les RPO/RTO sont suivis par composant dans `disaster_recovery_targets`.

Aucun objectif de reprise ne doit être considéré atteint sans exercice réel enregistré dans `disaster_recovery_drills`.

## Capacité hyperscale

Les tests de capacité doivent être progressifs et reproductibles :

- jeu de données 100 000 CDR ;
- jeu de données 1 000 000 CDR ;
- croissance multi-tenant simulée ;
- montée en charge API par paliers ;
- workers interrompus puis repris ;
- test d'une queue saturée ;
- mesure p50, p95 et p99 ;
- vérification du writer, des replicas et des partitions.

Le chiffre de clients n'est pas utilisé seul comme preuve de capacité : le dimensionnement dépend du nombre de requêtes, d'appels, de CDR, de jobs et de données par tenant.

# Operational Assurance 1.29

Audiotel Premium Pro ajoute une couche d'assurance opérationnelle au-dessus des fondations existantes. Cette couche ne connecte aucun opérateur, PSP, Stripe ou organisme externe.

## Validation 4 yeux

Les bascules opérateur critiques suivent désormais un contrôle à deux personnes :

1. un administrateur prépare la bascule ;
2. une demande `platform_change_requests` est créée avec une empreinte SHA-256 du changement ;
3. un second administrateur distinct doit approuver ;
4. l'activation vérifie l'approbation non expirée avant de modifier la route ;
5. les événements `requested / approved / executed` sont chaînés en SHA-256 dans `platform_change_approval_events`.

Le demandeur ne peut pas approuver ou rejeter sa propre demande. Les demandes critiques ne peuvent pas être supprimées. L'historique d'approbation est append-only.

Le rollback d'une bascule déjà exécutée reste volontairement indépendant de cette approbation : en situation d'incident, le mécanisme de récupération ne doit pas être ralenti par un nouveau cycle de validation.

## Identités staff PGI

Le cockpit supporte plusieurs identités staff distinctes.

- le compte administrateur historique reste compatible et est rattaché à une identité interne ;
- de nouveaux comptes `admin`, `finance` ou `readonly` peuvent être créés depuis la Control Tower ;
- les mots de passe sont hashés avec le mécanisme de sécurité du backend et ne sont jamais stockés en clair ;
- l'authentification des comptes staff est lue sur PostgreSQL primaire, pas sur une réplique potentiellement en retard ;
- les comptes clients restent séparés dans le plan d'identité client.

## Risk Engine

Le Risk Engine travaille uniquement sur des agrégats. Il ne consomme ni numéro d'appelant brut, ni contenu d'appel, ni donnée personnelle destinée à produire un score individuel.

Les signaux incluent :
- taux d'échec d'appels ;
- pic de trafic par rapport à la moyenne 7 jours ;
- écart de rapprochement financier ;
- incidents critiques ;
- blocages réglementaires ;
- dead letters de la work queue.

Le score est un indicateur opérationnel interne et non une certification.

## Shadow Billing

Le shadow billing compare, par devise et sur 30 jours :
- reversement attendu ;
- reversement confirmé ;
- montant payé ;
- écart de rapprochement.

Seuils internes :
- moins de 0,5 % : état normal ;
- à partir de 0,5 % : attention ;
- à partir de 2 % : critique.

Lorsqu'un montant attendu existe mais qu'aucun règlement externe n'est encore confirmé, l'état est `waiting_external`, pas `critical`. Cela évite de transformer l'absence de données opérateur en faux incident.

## SLO et error budget

Le snapshot Control Tower mesure des objectifs internes instantanés :
- fraîcheur CDR <= 300 secondes ;
- ancienneté de la work queue <= 120 secondes ;
- zéro dead-letter ;
- zéro incident critique ouvert ;
- zéro résolution SLA dépassée ;
- résilience régionale disponible.

La cible de disponibilité API est 99,9 %, mais la Control Tower ne fabrique pas de mesure. La disponibilité réelle reste issue de Prometheus et de ses règles de burn-rate.

## Digital Twin / chaos

Le Digital Twin 2 couvre :
- panne opérateur ;
- pic de trafic ;
- portabilité massive ;
- expiration réglementaire ;
- impayés ;
- panne région/datacenter ;
- perte de la base principale ;
- backlog workers ;
- écart de règlement ;
- projection hyperscale jusqu'à 10 millions de clients.

Les entrées de charge sont bornées. Toutes les réponses restent `dry_run=true` et `mutates_state=false`.

Une projection hyperscale aide à dimensionner les futurs tests de charge ; elle ne prouve pas qu'une infrastructure non déployée peut réellement absorber ce volume.

## Ce qui reste externe

Cette version n'active toujours aucune connexion réelle à :
- Stripe ou autre PSP ;
- opérateur SVA ;
- APNF / RSVA ;
- infrastructure de paiement ou de règlement externe.

Les contrôles sont donc prêts à recevoir ces données et actions plus tard, sans les simuler comme si elles existaient déjà.

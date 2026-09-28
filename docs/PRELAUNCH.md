# Préparation au lancement — PGI Telecom / Audiotel Premium Pro

## Principe

Aucun lancement commercial ne doit reposer sur un indicateur décoratif ou sur une configuration supposée.

Le gate `GET /api/v1/platform/launch-readiness` agrège des preuves réellement observables et sépare la disponibilité B2B de la disponibilité B2C. Il est réservé au personnel authentifié.

## Gate automatique

Les domaines suivants sont évalués séparément :

- base PostgreSQL persistante en production ;
- santé opérationnelle, dead letters, incidents critiques et régions ;
- authentification de production et protection des endpoints machine ;
- emails transactionnels et webhook Resend ;
- Stripe réellement connecté en mode live ;
- identité juridique de l’exploitant ;
- prérequis consommateurs : médiateur, rétractation en ligne et activation commerciale B2C ;
- opérateur/routage SVA réellement actif ;
- numéros et contrôles réglementaires ;
- preuves performance/résilience ;
- conformité des reversements.

Un état `pending_external` signifie qu’une dépendance externe n’est pas réellement branchée. Il ne doit jamais être converti manuellement en `ready` pour faire monter le score.

## Critères B2B

Avant d’accepter un paiement B2B réel :

1. identité juridique publiée et exacte ;
2. Stripe live opérationnel ;
3. emails transactionnels opérationnels ;
4. PostgreSQL et sauvegardes opérationnels ;
5. sécurité de production active ;
6. opérateur, routage et numéros réellement disponibles pour toute offre qui les promet ;
7. conformité SVA sans blocage ;
8. performance/resilience gate validé par preuves fraîches ;
9. reversements activés uniquement lorsque la conformité financière associée est prête.

## Critères B2C supplémentaires

Avant tout paiement consommateur :

1. tous les critères B2B applicables ;
2. médiateur de la consommation réellement conventionné ;
3. coordonnées du médiateur publiées ;
4. identité légale complète ;
5. rétractation électronique réellement disponible ;
6. accusé de réception durable opérationnel ;
7. parcours de résiliation disponible ;
8. affichage du prix, périodicité, durée et obligation de paiement ;
9. version juridique acceptée et horodatée.

Le serveur reste fail-closed tant que ces prérequis ne sont pas réunis.

## Dépendances externes non simulables

Ces éléments doivent être contrôlés depuis leurs systèmes d’autorité :

- statut KYC et capacité d’encaissement Stripe ;
- contrat et état technique opérateur ;
- disponibilité réelle des numéros ;
- DNS et domaines ;
- capacité du Container Registry Vercel ;
- adhésion au médiateur ;
- informations légales officielles de l’exploitant.

Aucune valeur de démonstration ne peut remplacer ces preuves.

## Procédure avant fusion vers main

1. `npm run verify` entièrement vert ;
2. aucune migration destructive non approuvée ;
3. aucune donnée réelle ou secret dans le dépôt ;
4. revue des changements touchant paiement, routage, identité, permissions ou données ;
5. VCR suffisamment libre pour accepter la nouvelle image ;
6. fusion ;
7. attendre le déploiement READY ;
8. vérifier `/api/v1/health` et l’identité exacte de release ;
9. vérifier la rétractation publique ;
10. vérifier les erreurs runtime ;
11. exécuter le smoke de production.

## Critère de sortie

Le produit peut être qualifié « prêt » uniquement lorsque le gate correspondant vaut réellement `ready_for_b2b=true` ou `ready_for_b2c=true`, et que les contrôles externes non accessibles à l’application ont été vérifiés le même jour.

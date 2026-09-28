# Disaster Recovery — runbook opérationnel

## Objectif

Ce document décrit la reprise après incident sans présumer qu’une architecture multi-région, une réplication ou une sauvegarde externe existe tant qu’elle n’a pas été réellement provisionnée et testée.

Les objectifs RPO/RTO enregistrés dans la plateforme sont des cibles. Ils ne deviennent des engagements qu’après preuve par exercice réel.

## Avant incident

Doivent exister et être vérifiés périodiquement :

- sauvegarde PostgreSQL lisible par `pg_restore` ;
- checksum SHA-256 vérifié ;
- conservation bornée des sauvegardes ;
- procédure de restauration isolée ;
- release Git exacte actuellement en production ;
- possibilité de rollback applicatif ;
- inventaire des variables d’environnement nécessaires ;
- liste des domaines et DNS ;
- état des webhooks Stripe et Resend ;
- état du routage opérateur ;
- contact d’escalade opérateur ;
- historique des bascules et changements quatre yeux.

## Classification

### DR-1 — corruption/perte de données
Priorité maximale. Toute écriture non indispensable est stoppée avant de modifier la base.

### DR-2 — indisponibilité base principale
L’application peut être indisponible ou partiellement indisponible. Ne jamais promouvoir une base non vérifiée uniquement pour rétablir l’interface.

### DR-3 — mauvais déploiement applicatif
Utiliser d’abord le rollback de release. Ne pas restaurer la base si les données sont saines.

### DR-4 — panne opérateur
Le trafic téléphonique doit être traité séparément de l’interface. Utiliser la bascule opérateur uniquement si la destination standby est réellement prête et validée.

### DR-5 — compromission
Préserver les preuves, révoquer les secrets concernés, isoler l’accès et ne pas restaurer un environnement compromis sans comprendre le vecteur initial.

## Procédure base PostgreSQL

1. geler les changements non essentiels ;
2. horodater l’incident ;
3. identifier la dernière sauvegarde vérifiée ;
4. vérifier son checksum ;
5. restaurer dans une base isolée ;
6. lancer migrations/contrôles de schéma sans écriture métier ;
7. vérifier contraintes, comptes critiques et journaux ;
8. mesurer le RPO observé ;
9. seulement après validation, décider de la promotion ;
10. conserver l’ancienne base en lecture seule tant que l’analyse n’est pas close.

Ne jamais écraser directement la base de production avec une sauvegarde non restaurée/testée dans un environnement isolé.

## Procédure mauvais déploiement

1. relever le SHA de release attendu et le SHA servi ;
2. confirmer que la base n’a pas subi de migration destructive ;
3. repasser vers la dernière release READY ;
4. vérifier health, readiness, authentification, facturation, emails et routage ;
5. conserver les logs du déploiement défaillant ;
6. documenter la cause racine.

## Procédure panne opérateur

1. confirmer la panne par plusieurs signaux ;
2. contrôler que la cible standby est en état `ready/active` ;
3. préparer la bascule ;
4. obtenir la validation quatre yeux ;
5. activer ;
6. effectuer des appels de contrôle ;
7. vérifier CDR et métriques ;
8. contrôler le rapprochement financier ;
9. conserver la fenêtre de rollback ;
10. fermer l’incident uniquement après stabilité.

## Procédure Stripe/Resend

Une panne Stripe ou Resend ne justifie jamais une falsification locale du statut externe.

Stripe :
- continuer à faire confiance aux événements authentifiés et aux relectures serveur ;
- ne pas marquer un abonnement payé sans preuve fournisseur ;
- différer les nouvelles souscriptions si le provider est indisponible.

Resend :
- conserver les événements transactionnels à délivrer ;
- ne pas annoncer un accusé envoyé s’il n’a pas été remis au fournisseur ;
- pour la rétractation B2C, conserver le mode fail-closed lorsque l’accusé durable ne peut pas être garanti.

## Validation après reprise

Le service n’est réouvert que si :

- health = OK ;
- readiness = READY ;
- release attendue = release servie ;
- PostgreSQL cohérent ;
- aucune dead letter critique ;
- aucun incident critique non traité ;
- Stripe et Resend sont dans un état cohérent avec les fonctions ouvertes ;
- le routage réel correspond au routage attendu ;
- les contrôles B2B/B2C du Launch Readiness sont recalculés.

## Exercice périodique

Un exercice réel doit mesurer :

- heure de début ;
- heure de détection ;
- heure de décision ;
- heure de restauration ;
- RPO observé ;
- RTO observé ;
- erreurs rencontrées ;
- preuve de restauration ;
- actions correctives.

Une réussite ancienne de plus de 30 jours ne suffit pas au gate préproduction actuel.

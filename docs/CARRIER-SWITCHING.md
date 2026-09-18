# Changer d'opérateur SVA sans modifier le cœur PGI

## Principe

Le 089 appartient au domaine métier PGI. L'opérateur SVA est une dépendance interchangeable.

Aucune bascule ne doit nécessiter de modifier :

- le numéro dans le dashboard ;
- les experts ;
- le modèle CDR ;
- le moteur financier ;
- les KPI ;
- les exports ;
- les API métier ;
- l'historique.

## États

### Ancien opérateur

`active` → `standby` → `draining` → `disabled`

### Nouvel opérateur

`configured` → `testing` → `ready` → `active`

La route `sva-primary` ne peut être activée que vers une connexion SIP `ready`, `active` ou `standby`.

## Préparation

1. Créer le nouvel opérateur dans `carriers`.
2. Ajouter son adaptateur.
3. Ajouter ses connexions SIP/CDR/règlement.
4. Créer son contrat avec une date d'effet.
5. Tester les mappings CDR.
6. Tester l'import de règlement.
7. Tester le SIP sur une route/numéro de test si l'opérateur le permet.
8. Vérifier la portabilité du même 089.
9. Passer la connexion en `ready`.

## Portabilité

La portabilité externe du 089 reste une opération opérateur/numérotation.

Dans PGI :

- le `sva_number_id` ne change pas ;
- le `e164` ne change pas ;
- un `number_portability_event` est créé ;
- une nouvelle `number_carrier_assignment` est préparée.

## Bascule

Au moment convenu :

1. confirmer que le nouveau carrier est READY ;
2. lancer la portabilité/routage externe ;
3. activer `sva-primary` vers le nouvel opérateur ;
4. l'ancien devient automatiquement standby ;
5. vérifier appels entrants ;
6. vérifier CDR ;
7. vérifier DNIS/CLI/DTMF ;
8. vérifier qualité RTP ;
9. vérifier calcul de reversement.

L'activation est atomique côté base via `activate_logical_carrier_route()`.

## Rollback

Pendant la fenêtre de rollback :

1. réactiver la connexion standby ;
2. repasser `sva-primary` vers l'ancien opérateur ;
3. conserver tous les CDR déjà reçus avec leur `host_carrier_id` réel ;
4. ne jamais réécrire l'historique.

## Après stabilisation

- ancien opérateur en `draining` ;
- réconcilier ses derniers CDR ;
- attendre ses derniers règlements ;
- fermer son contrat à sa vraie date de fin ;
- conserver définitivement l'historique ;
- désactiver ses connexions seulement lorsque plus aucun flux n'est attendu.

## Règle de sécurité

Aucun bouton du dashboard ne doit pouvoir changer d'opérateur sans :

- rôle Admin ;
- connexion cible READY ;
- validation préalable ;
- clé d'idempotence ;
- journal d'audit ;
- fenêtre de rollback.

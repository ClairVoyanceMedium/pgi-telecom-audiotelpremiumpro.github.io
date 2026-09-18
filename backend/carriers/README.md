# Carrier adapters

Le cœur PGI Telecom ne contient aucune logique spécifique à un opérateur.

Chaque opérateur est branché par un **adaptateur versionné** qui décrit uniquement :

- ses capacités ;
- son transport SIP ;
- son format DNIS/CLI/DTMF ;
- le mapping de ses CDR vers le modèle PGI ;
- le mapping de ses relevés de règlement.

## Invariants

Un adaptateur ne doit jamais modifier :

- le modèle d'appel PGI ;
- les KPI du dashboard ;
- la logique de présence expert ;
- la structure des API publiques internes ;
- l'historique des anciens opérateurs.

Les données sont normalisées avant d'entrer dans le cœur.

## Canonical model

Tous les opérateurs doivent converger vers les mêmes champs PGI, notamment :

- external_call_id
- started_at
- ended_at
- conversation_seconds
- payout_eligible_seconds
- expected_payout_ht
- confirmed_payout_ht
- paid_payout_ht
- reconciliation_status

## Secrets

Un profil peut contenir `secretRef`, mais jamais la valeur du secret.

Les valeurs réelles sont injectées depuis GitHub Secrets / le gestionnaire de secrets du serveur.

## Ajout d'un nouvel opérateur

1. Copier `config/carriers/_template.json`.
2. Créer un nouvel `adapterKey`.
3. Remplir capacités et mappings.
4. Valider le profil.
5. Créer les connexions dans la base.
6. Tester SIP/CDR/règlements sans activer la route.
7. Passer la connexion en `ready`.
8. Exécuter le plan de bascule.
9. Garder l'ancien opérateur en standby pendant la fenêtre de rollback.

Aucun changement du dashboard n'est requis.

# Portabilité entrante SVA

La portabilité entrante permet à un client professionnel de conserver son numéro de service existant lorsqu'il rejoint PGI Telecom. L'identité canonique du numéro est son E.164 ; elle n'est jamais remplacée par un nouveau numéro pendant le workflow.

## Invariants

- la création d'une demande ne modifie jamais le routage actif ;
- un même E.164 ne peut avoir qu'une demande ouverte ;
- la titularité ou le mandat doit être vérifié avant la phase opérateur ;
- le tarif public existant est stocké séparément puis vérifié avant la planification ;
- la finalisation recopie exactement le tarif vérifié dans `sva_numbers.service_rate_ttc_per_min` et conserve la devise ;
- la finalisation est impossible sans KYC vérifié, tenant actif, accès SVA actif, opérateur SVA cible actif et liaison de routage prête ;
- le passage à `ported` ne peut pas être effectué par la route générique de changement d'état ;
- toutes les écritures de finalisation appartiennent à une seule transaction PostgreSQL.

## États

`submitted` → `awaiting_documents` → `eligibility_check` → `operator_pending` → `scheduled` → `ported`.

`rejected` et `cancelled` couvrent les sorties avant finalisation. Le client peut annuler tant que la demande n'est pas planifiée.

## Finalisation atomique

Après confirmation de la bascule réelle par l'opérateur, `completePortabilityRequest` verrouille le dossier et la route `sva-primary`, puis contrôle tous les prérequis. La même transaction :

1. crée ou verrouille le `sva_number` avec le même E.164 et le tarif vérifié ;
2. active l'affectation `tenant_number_assignment` ;
3. rattache le numéro à l'opérateur SVA actif dans `number_carrier_assignments` ;
4. journalise `number_portability_events` ;
5. passe la demande à `ported` ;
6. écrit audit, contrôle et événement outbox.

Une erreur sur une étape annule toute la transaction.

## Retour arrière

Avant la bascule opérateur, PGI peut annuler le dossier sans toucher à la ligne existante. Une fois la portabilité réseau effectivement réalisée par l'opérateur, un simple rollback de base de données ne peut pas annuler la portabilité télécom. Un retour chez l'ancien opérateur doit suivre une nouvelle opération opérateur. PGI ne présente donc jamais un rollback applicatif comme un rollback réseau.

## Performance

Les contrôles client et administrateur sont chargés dans des modules séparés (`client-portability.js` et `tenant-portability-admin.js`). Ils ne consomment pas la réserve du shell critique du cockpit.

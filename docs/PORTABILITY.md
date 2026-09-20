# Portabilité entrante SVA

La portabilité entrante permet à un client professionnel de conserver son numéro de service existant lorsqu'il rejoint PGI Telecom. L'identité canonique du numéro est son E.164 ; elle n'est jamais remplacée par un nouveau numéro pendant le workflow.

## Invariants

- la création d'une demande ne modifie jamais le routage actif ;
- un même E.164 ne peut avoir qu'une demande ouverte ;
- la titularité ou le mandat doit être vérifié avant la phase opérateur ;
- pour un numéro SVA français, le RIO est obligatoire, contrôlé avec sa clé de contrôle puis chiffré avant stockage ;
- le RIO en clair n’est exposé ni au portail client ni au cockpit ;
- la portabilité transfère le numéro vers le service PGI, jamais le contrat donneur, ses dettes, ses pénalités ou sa durée d’engagement ;
- le client confirme explicitement que ses obligations antérieures éventuelles restent à sa charge ;
- le tarif public existant est stocké séparément puis vérifié avant la planification ;
- la finalisation recopie exactement le tarif vérifié dans `sva_numbers.service_rate_ttc_per_min` et conserve la devise ;
- la finalisation est impossible sans KYC vérifié, tenant actif, accès SVA actif, opérateur SVA cible actif et liaison de routage prête ;
- le passage à `ported` ne peut pas être effectué par la route générique de changement d'état ;
- toutes les écritures de finalisation appartiennent à une seule transaction PostgreSQL.

## Frontière contractuelle

Le parcours distingue strictement deux relations. La relation historique avec l’opérateur donneur n’est jamais cédée à PGI. Le client ne transmet à PGI ni dette, ni pénalité, ni engagement restant. La portabilité effective met fin, chez le donneur, au service fourni depuis l’accès associé au numéro porté, sous réserve des obligations contractuelles qui peuvent encore incomber au client.

Le service fourni après portabilité relève exclusivement de la nouvelle relation PGI. Techniquement, `source_contract_transfer_mode` est verrouillé à `none` et la bascule opérateur est impossible sans `source_contract_liability_acknowledged=true`.

Pour les numéros SVA français, le workflow exige un RIO valide avant de passer en `operator_pending`. Le RIO est validé par son format et sa clé de contrôle, chiffré en AES-256-GCM au repos, puis uniquement représenté dans les interfaces par son statut de validation et ses quatre derniers caractères.

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

## Modèle économique après portabilité

Une fois le numéro porté, il entre dans le même modèle financier que tout numéro SVA géré par PGI : `opérateur SVA → PGI → marge PGI → net client`. La portabilité ne crée donc aucune exception de reversement direct au client.

La finalisation d’une portabilité externe exige des `tenant_payout_terms` applicables au client et au marché. Sans conditions commerciales PGI, la bascule est refusée. En production, un `carrier_contract` réel est également obligatoire : aucune valeur générique de reversement opérateur ne sert de secours. Le tarif contractuel permet l’estimation, puis les relevés opérateur alimentent le montant amont confirmé. Ce montant est réparti dans `tenant_revenue_distributions` selon la règle `opérateur → PGI → marge PGI → net client`, avec justification appel par appel.

Références réglementaires françaises suivies par l’implémentation : article D.406-18 du CPCE et décision Arcep n° 2022-2148 modifiée, notamment les règles de portabilité et de RIO des numéros spéciaux.

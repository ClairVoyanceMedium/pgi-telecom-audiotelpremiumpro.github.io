# Centre de service et excellence opérationnelle PGI

PGI Telecom conserve un dossier unique lorsqu’un client signale un problème ou lorsqu’un incident technique susceptible d’affecter ses lignes est détecté automatiquement.

## Objectifs

Le centre de service évite qu’un client doive réexpliquer plusieurs fois la même situation. Le même dossier regroupe :

- la catégorie et la priorité ;
- la ligne éventuellement concernée ;
- l’état actuel ;
- l’équipe PGI responsable ;
- la chronologie des changements ;
- les messages du client et de PGI ;
- un diagnostic technique non sensible capturé à l’ouverture ;
- une cible de première prise en charge ;
- une cible de résolution ;
- les alertes opérationnelles liées au dossier.

Les incidents techniques globaux restent enregistrés dans `telecom_incidents`. Le centre de service ne les duplique pas : il crée une relation client dans `tenant_service_incidents` quand une affectation de numéro montre qu’un client est réellement concerné.

## Détection automatique

Le scanner `scanVoiceIncidents` reste la source de vérité pour les anomalies voix opérateur. `scanTenantServiceIncidents` :

1. récupère les incidents opérateur ouverts ;
2. identifie les clients réellement rattachés à l’opérateur concerné ;
3. ouvre ou actualise un seul dossier par incident et client ;
4. publie une alerte visible du client lorsque cela est pertinent ;
5. résout automatiquement le dossier lorsque la source NOC est résolue ;
6. crée des alertes internes lorsque les objectifs de prise en charge approchent ou sont dépassés.

## Objectifs internes de traitement

Les délais enregistrés servent au pilotage interne PGI :

| Priorité | Première prise en charge | Cible de résolution |
| --- | ---: | ---: |
| Critique | 15 min | 2 h |
| Haute | 30 min | 4 h |
| Normale | 2 h | 24 h |
| Faible | 4 h | 48 h |

Ces valeurs ne constituent **pas une GTR, un SLA ou une garantie contractuelle**. Une garantie client ne doit être affichée ou contractualisée que si l’infrastructure et les contrats opérateurs correspondants la permettent réellement.

## Diagnostic respectueux de la confidentialité

Le diagnostic automatique conserve uniquement des éléments opérationnels utiles :

- nombre d’appels récents ;
- nombre d’appels connectés ;
- dernier appel observé ;
- nombre de destinations configurées, actives et disponibles ;
- état de la portabilité en cours et de son automatisation.

Il ne doit jamais inclure RIO en clair, secret opérateur, jeton d’authentification, mot de passe, données de carte bancaire ou identité brute d’un appelant.

## Simulation de routage

`simulateTenantRoutingById` applique les règles de sélection sur les destinations existantes sans réserver de destination et sans modifier :

- `active_calls` ;
- `last_assigned_at` ;
- le statut d’une destination ;
- une route opérateur ;
- un appel réel.

La réponse indique la destination qui serait choisie, les candidats, leur capacité et les avertissements. Cette fonction sert à contrôler une configuration avant activation ou à diagnostiquer une indisponibilité.

## Frontières client / PGI

Le client voit uniquement ses dossiers, événements, notes et alertes marqués comme visibles, via les vues SQL à barrière de sécurité. Les éléments purement internes peuvent rester masqués.

PGI peut ouvrir un dossier, modifier sa priorité ou son état et ajouter des notes. Les opérations sont auditées et les mutations exposées par API utilisent l’authentification, la protection CSRF et l’idempotence déjà présentes dans la plateforme.

## Principe d’exploitation

Le fonctionnement normal doit être proactif :

`détection → diagnostic → dossier unique → suivi → résolution → historique`

Le support manuel reste disponible pour les exceptions, mais la plateforme doit fournir le maximum de contexte avant qu’un opérateur PGI ou un client ait besoin d’intervenir.

# Distribution SVA directe : automatisations et laboratoire de recette

Date : 10 octobre 2026. Travail de préparation sur branche GitHub, sans déploiement.

## Développer maintenant, raccorder plus tard

Les pages du site, les espaces clients, les cockpits et les workflows peuvent être développés sans attendre la fin des démarches contractuelles ou réglementaires. Ces dernières concernent uniquement le lancement des opérations réelles, notamment les numéros et les reversements.

La société conserve deux activités distinctes sur un même profil comptable légal : Audiotel Premium Pro et Distribution SVA directe.

## Laboratoire administratif ajouté

Un nouveau laboratoire est préparé dans le cockpit distributeur, rubrique Automatisations. Il peut :
- tester les 13 processus avec des données fictives ;
- simuler un manque de prérequis ;
- simuler les incidents de délai et de limite fournisseur ;
- proposer une nouvelle tentative avec attente progressive ;
- renvoyer les erreurs définitives ou incidents répétés en examen humain ;
- empêcher les doublons grâce à une clé d'idempotence ;
- conserver un historique immuable et un tableau de bord des résultats.

Boutons prévus : « Tester ce processus », « Tester automatiquement les 13 scénarios fictifs » et « Actualiser l'historique ».

Les conditions cochées dans le laboratoire sont purement hypothétiques : elles ne prouvent ni la disponibilité d'un opérateur, ni un droit d'attribution, ni un mandat de paiement.

## Fichiers ajoutés

- database/migrations/079_direct_sva_automation_rehearsals.sql : table d'historique en insertion seule.
- backend/src/direct-sva-automation-rehearsal.mjs : règles, idempotence, politique de reprise, refus des données personnelles arbitraires.
- assets/direct-sva-automation-lab.js : interface de simulation chargée à la demande.
- tests/direct-sva-automation-rehearsal.test.mjs : 12 tests des cas majeurs.
- backend/server.mjs : deux points API réservés à l'administrateur, protégés par la session, l'interrupteur d'aperçu et CSRF.
- scripts/build-static.mjs, scripts/check-size.mjs et package.json : intégration aux contrôles de qualité.

Le moteur se base sur les règles déjà présentes dans backend/src/direct-sva-customer.mjs : une seule définition des 13 processus.

## Principe de sécurité

Les simulations n'envoient pas de mail, n'ouvrent aucun numéro, n'émettent aucun événement GA4, n'écrivent aucun contact HubSpot et ne réalisent aucun virement. Les anciennes données Audiotel ne sont pas consultées ni modifiées.

Le module traite seulement des booléens de conditions fictives, des références de test et des types d'incidents. Il refuse les champs libres contenant des coordonnées de clients. Le tableau récapitulatif liste les 50 dernières simulations, indique qu'il peut exister un historique plus ancien et ne représente pas ces simulations comme des opérations exécutées.

## Étapes d'automatisation à raccorder ultérieurement

1. Collecte et contrôles des CDR de l'opérateur.
2. Acheminement des dossiers et des réclamations dans le pipeline HubSpot dédié.
3. Mesure GA4 propre au distributeur et consentement associé.
4. Calculs et rapprochements financiers à partir de données reçues et vérifiées.
5. Comptabilité en partie double, exports et ventilation dans le FEC légal unique.
6. Déclenchement des paiements lorsque le cadre PSP et la trésorerie confirmée le permettent.
7. Notifications et reprises réelles à l'aide d'une file durable avec supervision et seuils de sécurité.
8. Contrôles de continuité Business Live pour les clients existants lors du changement de prestataire.

Le logiciel peut être préparé entièrement à l'avance, mais un test de simulation n'est pas un branchement fournisseur réel. La mise en production et les migrations Neon nécessitent toujours le top départ de PGI Telecom.

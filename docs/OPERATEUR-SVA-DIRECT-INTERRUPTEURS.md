# Deux interrupteurs administrateur : distribution SVA directe

Version préparatoire du 10 octobre 2026, sans déploiement.

## Emplacement prévu

Dans le cockpit administrateur existant, rubrique Comptabilité, une zone "Commandes de distribution SVA directe" contient deux interrupteurs persistants. Cette zone s'affiche uniquement pour un administrateur connecté, après réponse positive du serveur. Les profils finance et lecture seule n'ont pas accès aux commandes.

### Interrupteur 1 : Interface distributeur

- OFF par défaut.
- Lorsque l'administrateur l'active, la valeur est enregistrée dans la table direct_sva_admin_switches.
- Le cockpit autorise alors l'ouverture d'un espace interne de prévisualisation séparé de la comptabilité Audiotel.
- Les données restent en tables direct_sva_*.
- L'espace client public, les numéros, les paiements, le CRM, GA4 et les URL commerciales restent inactifs.
- La désactivation retire immédiatement l'onglet et rétablit la vue Audiotel.
- L'historique indique la date, l'empreinte du compte administrateur, l'état précédent, l'état demandé et une référence de décision.
- Les requêtes concurrentes signalent un conflit au lieu de remplacer silencieusement une modification plus récente.

### Interrupteur 2 : Exploitation commerciale SVA directe

- OFF par défaut, interrupteur visible mais indisponible pendant la préparation.
- La base refuse la valeur true au moyen d'une contrainte commerciale explicite.
- Le serveur refuse également toute demande d'activation, même venant de l'administrateur.
- L'interface explique les conditions encore bloquantes.
- Un futur déverrouillage nécessitera une évolution de schéma examinée et des preuves externes réellement vérifiées.
- Aucun paramètre local ni aucune URL ne peuvent seuls attribuer un numéro, autoriser des fonds de tiers ou publier les pages.

## Implantation technique

- database/migrations/076_direct_sva_admin_switches.sql
- backend/src/direct-sva-admin-switches.mjs
- assets/direct-sva-switches.js
- assets/accounting-cockpit.js
- backend/server.mjs
- scripts/build-static.mjs
- tests/direct-sva-admin-switches.test.mjs

Points API administrateur :
- GET /api/v1/platform/direct-sva-switches
- POST /api/v1/platform/direct-sva-switches/interface
- POST /api/v1/platform/direct-sva-switches/commercial

L'API exige une session valide avec rôle admin. Les commandes POST requièrent le jeton CSRF de la session. Le premier changement utilise une transaction SQL et un contrôle optimiste de la valeur précédente. L'audit est non modifiable depuis les commandes applicatives.

Les API de prévisualisation direct_sva restent indisponibles quand le premier interrupteur est OFF. Le chemin customer/direct-sva reste toujours inaccessible durant la préparation.

Le module navigateur des interrupteurs est chargé à la demande depuis le cockpit. Il ne modifie pas le chargement initial du site commercial.

## Une société, deux activités

Cette activation n'a aucun impact sur les abonnements Audiotel, les dossiers clients, les paiements Stripe existants ou la comptabilité légale. Les données du distributeur restent regroupées dans un sous-journal analytique spécifique. Le rattachement au FEC commun est une étape distincte qui nécessite une validation d'expert-comptable.

## Ce qui est réellement fait et ce qui reste à faire

Le code des deux interrupteurs, la migration et les tests unitaires ont été préparés sur GitHub. Ils ne sont pas encore présents dans le cockpit de production.

Avant mise à disposition de la prévisualisation, exécuter les migrations 073 à 076 dans une base de recette isolée, vérifier les tests SQL et API réels, examiner les permissions et déployer sur autorisation du propriétaire de PGI Telecom.

L'exploitation commerciale demandera ensuite son propre top départ ainsi que les autorisations et contrats requis. L'interrupteur 2 ne pourra jamais être activé par la seule migration 076.

## Protection contre une activation incoherente

Le registre PostgreSQL reste la source de verite. En preparation, la supervision de la nouvelle activite refuse explicitement les controles operateur dont le mode n'est pas `preparation`, ou dont l'activation des numeros ou des versements n'est pas `false`. Le code retourne une erreur `DIRECT_SVA_OPERATOR_CONTROL_DRIFT` (503), au lieu d'afficher des interrupteurs rassurants mais contredits par la base.

La supervision des integrations attend exactement six connexions distinctes (`ga4`, `gsc`, `hubspot`, `statutory_accounting`, `network`, `payment_psp`). Si une connexion manque, est dupliquee, apparait autorisee ou peut transmettre des donnees, l'API retourne `DIRECT_SVA_INTEGRATION_CONTROL_DRIFT` (503). Elle ne declare pas une infrastructure conforme lorsque l'etat reel est anormal.

Ces protections viennent completer les contraintes SQL, sans attribuer de licence, sans reconnecter les systemes et sans toucher a la production. Des tests de non-regression ont ete ajoutes sur la branche ; aucun resultat d'execution CI n'est revendique.


# PGI Telecom Distribution | Renforcement métier et contrôles financiers

Date du chantier : 10 octobre 2026.
Branche unique de travail : `prep/pgi-direct-sva-operator-2026-10-10`.
Société existante : PGI Telecom. Première activité **Audiotel Premium Pro** strictement inchangée.

## Modifications réelles du chantier

### A. Business Live, conservation des appels et des compteurs

Module : `backend/src/direct-sva-business-live-continuity.mjs`

Avant la mise à jour, un appel dont le début précédait le transfert d'exploitation pouvait être attribué en totalité à l'ancien opérateur même si son heure de fin se situait après la bascule. Dans cette situation, les règles contractuelles de facturation peuvent différer de part et d'autre.

Le contrat de continuité impose désormais :

- rejet d'une date de fin antérieure au début ;
- rejet d'un appel simultanément indiqué actif et terminé ;
- rejet des appels chevauchant la **bascule d'opérateur** tant que des segments CDR vérifiés et rattachés au prestataire correspondant ne sont pas fournis ;
- conservation de la protection existante pour la remise à zéro Business Live : aucun prorata inventé ;
- préservation du `tenant_id`, du numéro, de la référence d'appel et de l'historique comptable ;
- aucune portabilité réelle, aucun routage, aucun appel télécom déclenché par ce correctif.

Les états prévisionnel, confirmé et payé restent distincts. L'identité de l'ancien opérateur ne figure pas dans la vue client.

### B. Comptabilité, contrôle des exports

Module : `backend/src/direct-sva-business.mjs`

Le sous-journal mensuel non fiscal :

- inclut les entêtes d'écritures dans la recherche SQL même lorsqu'une écriture n'a aucune ligne ; cette anomalie est **refusée** au lieu d'être silencieusement omise ;
- refuse les écritures sans au moins deux lignes, les sommes non équilibrées, les séquences manquantes ou dupliquées et les dépassements du plafond de volume existant ;
- refuse un résultat mensuel dont la soustraction produits moins charges déborde la précision entière de JavaScript ;
- ne déclenche ni mouvement bancaire ni FEC légal, n'utilise aucune écriture d'Audiotel Premium Pro et ne remplace pas la validation comptable ;
- conserve le contrôle de séparation entre saisisseur et approbateur.

Important : les tables et comptes demeurent des structures **préparatoires**. Leur présence ne transforme pas un montant estimé en encaissement prouvé.

### C. Cockpit administrateur, contrôle des réponses

Module : `assets/direct-sva-cockpit.js`

Avant tout affichage, les réponses sont maintenant vérifiées :

- centre de profit `direct_sva`, origine technique des tables directes et non Audiotel ;
- montants comptables entiers, sûrs, et résultat produits moins charges exact ;
- refus des états prétendant que numéros, versements ou exploitation directe sont activés ;
- pré-rapprochement de relevé : totaux à l'eurocent, nombres de lignes cohérents, aucun virement autorisé ;
- connexions externes : six registres, zéro émission CRM/GA4/recherche/PSP en préparation ;
- automatisations : treize processus tous non exécutables ;
- réclamations : aucun envoi Gmail/HubSpot ni acte opérateur ou paiement autorisé.

Une réponse invalide provoque un affichage d'erreur à l'administrateur plutôt que de convertir silencieusement des valeurs absentes en zéro.

## Vérifications réalisées

- **16 scénarios fonctionnels** de finances, Business Live, bascule, export, reprise simulée et sécurité ont été exécutés avec succès (16/16) via les fonctions du véritable dépôt chargées dans un moteur JavaScript isolé.
- **9 scénarios supplémentaires** portant sur les réponses du cockpit ont été exécutés avec succès (9/9).
- Les deux nouvelles suites sont conservées dans le dépôt :
  - `tests/direct-sva-financial-integrity.test.mjs`, 16 cas ;
  - `tests/direct-sva-cockpit-integrity.test.mjs`, 9 cas.
- Les contrôles sont **simulés, sans trafic ni données personnelles réelles**. La suite Node.js `npm run verify`, le passage de migrations sur une base vide, les tests sur navigateur authentifié et les webhooks Stripe signés **n'ont pas été exécutés** pendant ce chantier.

La vérification GitHub CI complète n'est pas déclenchée automatiquement par une simple modification de cette branche : le flux `.github/workflows/quality.yml` est déclaré sur `main`, les demandes de fusion et un déclenchement manuel. La branche n'a pas été fusionnée ni publiée ; ne pas interpréter l'absence de nouveau résultat CI comme un succès.

## Actions restantes, sans inventer de prérequis remplis

1. **Télécom** : choix du collecteur/interconnexion, contrat, grille tarifaire, CDR horodatés et signés, traitement des appels traversant les fenêtres de portage et preuves de remise en service.
2. **Paiements** : confirmer contractuellement l'encaisseur, l'établissement habilité et le schéma autorisé de fonds de tiers. Les versements par Stripe Connect, s'ils sont applicables, nécessitent habilitations des destinataires, moyens de financement et tests en mode test ; le mécanisme de parrainage ou de CB existant n'en tient pas lieu.
3. **Comptabilité** : identité fiscale et régime de TVA, rapprochement banque/collecte/éditeurs, analyse par coût `DSVA`, préparation puis contrôle du FEC unique avec l'expert-comptable.
4. **Automatisation** : brancher de vrais déclencheurs sur les 13 processus après autorisation, avec traçabilité, idempotence et reprises contrôlées. Les processus ne sont pour l'instant que simulables et verrouillés.
5. **Espace client / cockpit** : essai avec profils factices sur infrastructure de recette, session/cookies/CSRF, rétablissement après panne, permissions et validation des données des deux unités.
6. **HubSpot / GA4 / GSC / support** : pipeline et propriétés de distribution séparés, propriété GA4 dédiée, préfixe SEO propre, boîte e-mail et tickets distincts, flux automatisés testés.
7. **Dernier contrôle** : `npm run verify` sur la branche, essais SQL sous PostgreSQL réel et répétition du parcours E2E avec les contrats et paiements test applicables.

## Règle permanente de non-déploiement

**Audiotel Premium Pro** conserve ses noms, tarifs, données et circuits déjà en production. **PGI Telecom Distribution** conserve son nom propre et ses identifiants `direct_sva` et `DSVA`. Aucune migration de production, aucune fusion GitHub, aucun changement de configuration Stripe réel, aucun transfert bancaire et aucun déploiement Vercel ne sont autorisés par les vérifications ci-dessus. Attendre le top départ explicite après recette et autorisations.

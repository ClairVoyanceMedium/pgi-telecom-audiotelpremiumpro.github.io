# PGI Telecom | Recette sans clients et sans transactions réelles

Date : 10 octobre 2026. Branche : `prep/pgi-direct-sva-operator-2026-10-10`.
But : rendre testables les deux activités, sans toucher aux clients, aux numéros, à Stripe live ni à la production.

## 1. Périmètre protégé

- **Audiotel Premium Pro** : activité et nom actuels inchangés, abonnement 4,90 EUR/mois, portabilité prioritaire 9,90 EUR ponctuels, dossiers client et Business Live existants.
- **PGI Telecom Distribution** : future deuxième activité, centre `DSVA`, tables `direct_sva_*`, Business Live inter-opérateurs, nouveaux contrats, rémunération distributeur, espace client et cockpit préparés mais commercialisation verrouillée.
- Le compte de la société peut être partagé juridiquement, mais aucun chiffre d'affaires, numérotation, transaction, dossier, propriété GA4, opération Stripe ou pipeline CRM ne doit passer d'une activité à l'autre par accident.

## 2. Résultats d'exécution fictive

**55 scénarios fonctionnels réussis sur 55 dans un moteur JavaScript isolé**, sans utiliser d'identifiants de clients, sans appel réseau et sans transfert de fonds.

| Sous-ensemble | Scénarios exécutés | Résultat |
| --- | ---: | --- |
| Identité des deux activités, Business Live multi-opérateurs, espace client, garde-fous HubSpot/GA4 et prérequis de lancement | 18 | 18 succès |
| Faux comptes Stripe, tarif Audiotel, frais Connect, portabilité 9,90 EUR et mécanismes de comptabilité, rapprochement et remise à zéro | 24 | 24 succès après adaptation du faux `URLSearchParams` |
| Événements de webhooks Stripe, interdiction d'ouverture commerciale, transition entre opérateurs et gestion des réclamations | 13 | 13 succès |

Un défaut temporaire de l'outil simulant `URLSearchParams` a interrompu un essai de portabilité. Après ajout d'un substitut compatible **dans le simulateur**, ce scénario a réussi. Il ne s'agissait pas d'une erreur de paiement ni d'une modification de la production.

**Note méthodologique :** ces exécutions ont chargé les fonctions source du dépôt dans un moteur V8 autonome. Elles ne représentent ni une exécution intégrale du serveur Node.js, ni une vraie recette navigateur, ni un résultat du pipeline CI.

## 3. Suites de non-régression enregistrées

Les fichiers sont enregistrés dans la branche GitHub et sont sélectionnés automatiquement par `npm test` :

- `tests/pgi-no-client-acceptance.test.mjs` : 34 cas Node.js couvrant les deux marques, l'historique des appels, les droits client, les calculs financiers, les contrôles Stripe simulés, la comptabilité, les remises à zéro, les intégrations et les verrous de lancement.
- `tests/pgi-no-client-webhook-security.test.mjs` : 12 cas Node.js couvrant les événements Stripe, les interrupteurs, le changement d'opérateur et les réclamations.
- Les tests existants sur les migrations 073 à 080 et l'intégrité des pages restent conservés.

**Les 34 premiers tests ont aussi été évalués directement à partir du fichier GitHub dans le moteur V8 avec des adaptations légères des assertions Node : 34/34 succès.** La suite Node native `npm test` et le pipeline complet `npm run verify` ne sont pas attestés comme exécutés dans cette séance, faute de copie de dépôt exécutable dans l'environnement local et sans solliciter de déploiement. Ne pas les présenter comme validés.

## 4. Vérifications de base de données

Branche Neon isolée `br-wild-meadow-auuv4k65` : 25 tables du distributeur, deux unités `APP` et `DSVA`, aucun client/numéro/transition/tâche fictive conservé.

Contrôle sur les **contraintes SQL réellement inscrites en base** : 80 contraintes d'intégrité consultées sur les tables de verrouillage, **9 protections déterminantes retrouvées**, notamment :
- `commercial_operation_enabled=false` ;
- `number_activation_enabled=false` ;
- `payouts_enabled=false` ;
- `dashboard_enabled=false` ;
- `external_execution_enabled=false` et `financial_transfer_enabled=false` ;
- `external_execution_allowed=false` pour les e-mails de réclamation ;
- `can_send_data=false` pour les connecteurs ;
- numéros directs `active`, `testing`, `assigned` exclus pendant la préparation.

Il s'agit d'une vérification **en lecture seule** des contraintes SQL. Aucun test de mutation de base en conditions de concurrence ni des transactions de versement n'a été réalisé.

## 5. Scénarios concrets vérifiés avec données fictives

1. Avant/après changement d'opérateur, mêmes identifiants client et numéro. Les 2 appels font 180 s facturées ; 4,20 EUR estimés ; 4,00 EUR confirmés ; 1,00 EUR payé. Un replay identique ne compte qu'une seule fois.
2. Un autre `tenant_id`, un opérateur inadéquat, des appels contradictoires ou une preuve de bascule manquante sont rejetés.
3. Un compte client non inscrit ou non autorisé est refusé ; toutes les requêtes aux tables directes sont limitées au locataire fictif.
4. Les 13 workflows distributeur affichent des prérequis et ne peuvent transférer de fonds.
5. Deux lignes de sous-journal à 15,00 EUR sont acceptées en mémoire ; déséquilibre, date impossible et devise non EUR rejetés.
6. Relevé de collecte fictif de 10 EUR : 2 EUR de marge et 8 EUR dus à l'éditeur ; doublons, mauvais numéros et répartition déséquilibrée rejetés. Aucun paiement n'est déclenché.
7. Faux comptes Stripe : charges désactivées ou panne réseau provoquent un blocage, l'absence de capacité de versement n'est pas camouflée.
8. Un faux paiement de portabilité prioritaire génère une requête Stripe **interceptée localement** à 990 centimes TTC, avec métadonnées, compte et clé d'idempotence, sans transaction.
9. Webhooks fictifs de paiement réussi/échoué/expiré et événements Stripe Connect sont séparés ; un événement sans bénéficiaire ou portant la mauvaise activité est ignoré.
10. Réclamations fictives frauduleuses : priorité interne, aucune habilitation de répondre, rembourser, porter ou verser ; le consentement est vérifié.
11. Business Live classique : programmation quotidienne et remise à zéro tous les 120 jours fonctionnent dans le moteur isolé.

## 6. Ce qu'il reste obligatoirement à tester avant le jour J

| Niveau | Recette nécessaire | Statut |
| --- | --- | --- |
| Node.js CI | `npm run verify` intégral sur la branche de préparation et rapport de couverture | Non exécutée dans cette séance |
| Navigateur | Connexion client fictif dans environnement de recette, rôles, cookies, CSRF, expirations, appareils mobiles | Non testée E2E |
| PostgreSQL | Migrations via le lanceur officiel, rollback de sauvegarde, transactions en concurrence, cycle du journal et export | Migrations en base isolée, charge réelle non testée |
| Stripe | Compte de test, cartes de test, webhooks signés, échecs, duplications, remboursements, litiges | Tests de fonctions avec faux événements uniquement |
| Finance SVA | Collecte opérateur, compensation, KYC/KYB, rapprochement de règlement bancaire et prestataire de versement autorisé | Prestataire et contrat absents |
| Opérateur | Numéros et contrats, interconnexion, CDR signés, portabilité, bascule et remise en état | Partenaire non raccordé |
| CRM / SEO | Pipeline et champs HubSpot de Distribution, propriété GA4 et consentement, recette Search Console | Réglages à compléter |
| Client / support | Support Gmail de chaque activité, HubSpot, traitement automatique sans fuite de données, notification et suivi | Préparation uniquement |

## 7. Critères de sortie sans exception

Aucune ouverture de PGI Telecom Distribution avant que la recette intégrale Node, PostgreSQL et navigateur n'ait réussi, que les habilitations Stripe/PSP et les sources opérateurs soient prouvées, et que la direction donne explicitement son top départ. Il faut garder les deux opérations indépendantes et préserver définitivement **Audiotel Premium Pro**.

Le déploiement Vercel de production consulté est toujours basé sur la branche `main`, commit `70d3bd89726ae17c60157290a99a7f7084c25345`. Aucun déploiement, paiement, création de client réel ni envoi de courrier n'a été effectué dans cette recette.

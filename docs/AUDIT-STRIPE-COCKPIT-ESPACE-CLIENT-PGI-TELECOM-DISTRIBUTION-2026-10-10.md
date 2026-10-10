# Audit de compatibilité : PGI Telecom Distribution

Date du contrôle : 10 octobre 2026.
Périmètre : **deuxième activité uniquement**, branche `prep/pgi-direct-sva-operator-2026-10-10`, base Neon de recette `br-wild-meadow-auuv4k65`. Première activité **Audiotel Premium Pro inchangée**.

## Synthèse et légende

- **Contrôlé** : propriété, ligne SQL, configuration Stripe ou code effectivement consultés.
- **Préparé** : code présent dans GitHub, mais pas déployé.
- **Non testé** : aucune preuve d'appel réseau, d'opération bancaire ou de transaction réelle.
- **Bloqué** : prérequis de production non satisfaits, ou verrou volontaire dans le code / SQL.

**Verdict : base de préparation cohérente, distribution non prête à l'exploitation. Aucun système ne doit afficher le statut « totalement automatique » ou « prêt pour l'encaissement et les reversements » sans les preuves externes.**

## 1. Compatibilité Stripe

| Contrôle | Observation | État |
| --- | --- | --- |
| Compte Stripe PGI | Mode réel, compte commun identifié | Contrôlé |
| Prix 4,90 EUR mensuel Audiotel | Présent, actif | Contrôlé, **ne pas réutiliser pour Distribution** |
| Deux webhooks Audiotel | `/api/v1/billing/stripe/webhook` et `/api/v1/billing/stripe/connect-webhook` activés | Contrôlé, pas une recette DSVA |
| Webhook Connect supplémentaire | Désactivé | Contrôlé |
| Checkout Sessions, PaymentIntents, transferts, virements | Aucune entrée retournée dans les listes consultées | Contrôlé, sans opération de test |
| Balance Stripe | EUR 0 disponible, EUR 0 en attente | Contrôlé |
| Comptes connectés | **0 en API Accounts v1** ; la liste Accounts **v2** n'a pas été disponible via les opérations de lecture exposées | **Inventaire v2 non vérifié**, ne pas revendiquer zéro compte v2 |
| Distribution, transferts aux éditeurs | Aucun adaptateur direct SVA capable d'exécuter le paiement ; les modules directs interdisent `payout` | Bloqué |
| Activation et habilitations Stripe du compte principal | `charges_enabled`, `payouts_enabled`, responsabilités et droits d'usage de Connect non validés dans cet audit | À vérifier auprès du compte Stripe et du PSP |

Les API Stripe utilisées par la première activité ou les ambassadeurs **ne doivent pas être réaffectées silencieusement à la distribution SVA**. Des fonds télécom provenant d'un opérateur ne sont pas nécessairement des paiements CB captés par Stripe. Avant une mise en œuvre Connect : documenter qui encaisse, d'où proviennent les fonds, les obligations réglementaires, le mode d'approvisionnement du solde, les bénéficiaires, les attestations KYC/KYB, la gestion de litiges et remboursements, et les autorisations du PSP.

## 2. Cockpit administrateur

- Le cockpit PGI Telecom Distribution est isolé en modules `assets/direct-sva-cockpit.js` et `assets/direct-sva-switches.js`.
- Le premier interrupteur commande un aperçu privé administrateur avec CSRF, traçabilité et contrôle de concurrence ; il est **OFF** sur la base de recette.
- Le second interrupteur d'exploitation commerciale est **OFF**, désactivé par l'interface, bloqué par l'API et par contrainte SQL.
- Le sous-journal, la simulation de rapprochement et le CSV sont disponibles dans le code. Le CSV est expressément **non FEC** et aucune sortie de fonds n'est déclenchée.
- Contrôle d'accès : `admin` pour la préparation et les bascules, `admin`/`finance`/`readonly` pour certaines vues comptables ; écriture avec CSRF et idempotence.
- Aucune séance de navigation authentifiée ni recette de sécurité indépendante effectuée ; les écrans ne sont pas déployés.

## 3. Espace client

- Page préparée à `/distribution-sva/espace-client/`, compte PGI existant, sans inscription libre.
- Route `/api/v1/customer/direct-sva/overview` explicitement bloquée avant lancement et protégée par authentification, permission client et `tenant_id`.
- Modèle de base `direct_sva_customer_accounts` : `dashboard_enabled=false` et `access_state='preparation'` par contrainte. Pour ouvrir le portail à l'avenir, il faudra une **migration de libération revue**, des droits testés et le top départ.
- Correctif GitHub : réponse incohérente avec `business_unit='direct_sva'`, `source='direct_sva_only'`, `tenant_scope='authenticated_customer_only'`, ou listes mal formées => état client réinitialisé, écran fermé, message explicite. Test de régression ajouté.
- Aucun compte direct SVA réellement créé, donc pas de recette client sur un dossier réel. Aucune donnée Audiotel n'est recopiée automatiquement.

## 4. Business Live

- Le calcul de continuité `direct-sva-business-live-continuity.mjs` refuse les CDR non vérifiés, les doublons conflictuels, les données d'un autre client, les changements de prestataire contradictoires et les paiements supérieurs aux montants confirmés.
- Le moteur maintient séparément **prévisionnel**, **confirmé** et **effectivement payé**, en protégeant la date de remise à zéro.
- Il n'existe pas encore de raccordement CDR authentifié ni de preuve de bascule opérateur : **continuité modélisée mais non testée sur trafic réel**.
- Le raccordement final exige un adaptateur par opérateur, des horodatages canoniques, une procédure de reprise et des validations d'appels avant/après bascule.

## 5. Base Neon et sécurité

- Base isolée : 25 tables `direct_sva_*`, deux centres analytiques, six connecteurs prêts à paramétrer mais tous `disabled` et `can_send_data=false`.
- Nombre de clients DSVA : 0 ; numéros : 0 ; transactions de simulation : 0 lors du contrôle.
- Aucun apport de ces migrations au schéma de production. Les droits administrateur et client doivent subir une recette E2E en environnement isolé.
- Les demandes de remboursement, l'affectation réelle des numéros et les transferts à des tiers demeurent verrouillés.
- Comptabilité légale : profil actuel sans dénomination ni SIREN renseignés, régime TVA `unconfigured`, FEC désactivé lors de la précédente vérification.

## 6. HubSpot, GA4, SEO, support

- HubSpot : seul pipeline `default` trouvé, destiné au service historique ; propriétés DSVA `pgi_business_unit`, `pgi_source_reference`, `pgi_sva_product_type` absentes. Aucun envoi CRM DSVA autorisé.
- GA4 : propriété dédiée non créée et émissions directes bloquées. Les nouvelles pages ne doivent pas réutiliser `G-SZY50J75N7`.
- GSC : propriété URL-prefix `/distribution-sva/` créée à titre préparatoire, non activée dans GSC Wizard ; aucun sitemap ni indexation à demander en amont.
- Support : réception Resend du domaine et webhook général présents ; dépôt de réclamation DSVA et acheminement propre à cette activité restent bloqués et non testés de bout en bout.

## 7. Priorités avant un vrai lancement

1. Formaliser le circuit **opérateur -> preuve des recettes -> règlement bancaire -> créance éditeur -> règlement habilité**, distinct des paiements CB Audiotel et du programme de parrainage.
2. Construire un **registre financier source** par contrat, période, numéro et opérateur : traçabilité du CDR, montant payé par le collecteur, litige, retenue, solde, compensation, commission, idempotence, rapprochement bancaire.
3. Déterminer si Stripe Connect est admissible pour **ce flux SVA** ; ne pas ajouter artificiellement un produit/abonnement Stripe pour simuler des revenus opérateur. Si un autre PSP ou circuit bancaire est requis, le brancher au même sous-journal.
4. Réaliser les adapters de recette pour Stripe/PSP, les webhooks signés, les contrôles de bénéficiaires, les erreurs et les tentatives d'envoi idempotentes. Aucun paiement automatique avant validation contractuelle et tests indépendants.
5. Créer le pipeline HubSpot et ses propriétés séparées ; propriété GA4 dédiée et dimensions après confirmation.
6. Recetter en environnement isolé les rôles, dossiers et transitions client, les numéros, le Business Live, les relevés, le support et les exports.
7. Réaliser `npm run verify` et des essais end-to-end. **Aucune exécution de cette suite complète ni paiement réel n'est attesté par cet audit.**
8. Attendre explicitement le top départ pour toute fusion vers `main`, toute mise en production et tout déverrouillage.

## 8. Non-régression de la première activité

- Nom **Audiotel Premium Pro** inchangé.
- Abonnement et portabilité prioritaire conservés exclusivement dans le périmètre existant.
- Identifiants `audiotel_platform` et `direct_sva` stables, comptabilité analytique indépendante.
- Aucune modification de Stripe réel, Neon production ou Vercel dans le cadre du présent audit.

Documentation Stripe de référence : https://docs.stripe.com/connect/separate-charges-and-transfers et https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.

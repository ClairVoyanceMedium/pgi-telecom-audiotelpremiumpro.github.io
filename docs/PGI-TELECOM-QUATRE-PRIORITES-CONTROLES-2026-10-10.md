# PGI Telecom : 4 priorités, interventions du 10 octobre 2026

**Statut : PREPARATION ET TESTS, PAS DE MISE EN PRODUCTION.**

**Périmètre de séparation**
- Audiotel Premium Pro : aucune mutation des clients, de Stripe, du CRM, des relevés, de la base de production ou du site.
- Pôle Télécom & Réseau : branche GitHub `prep/pgi-direct-sva-operator-2026-10-10`.
- Pas de déploiement Vercel, pas d'autorisation d'exploitation directe.

## 1. Protection de la base

### Preuve réelle sur Neon

- La base de préparation utilise `pgi_telecom_owner`, rôle disposant de `BYPASSRLS`.
- Il serait trompeur de déclarer PostgreSQL RLS efficace tant que l'application conserve ce rôle.
- Une branche Neon **jetable et distincte** a été créée : `br-young-thunder-autqs2g6` (parent : `br-wild-meadow-auuv4k65`).
- Sur cette copie seulement, le rôle de test `pgi_dsva_tenant_probe` a été créé avec `NOBYPASSRLS`, avec politiques `FORCE ROW LEVEL SECURITY` sur comptes, dossiers et numéros Distribution.
- La requête SQL réelle avec `SET LOCAL ROLE` puis `SET LOCAL app.pgi_dsva_tenant_id` a démontré : **aucune donnée sans identité**, client fictif 101 voyant uniquement 101, client fictif 202 voyant uniquement 202.
- La simulation a été faite sur des lignes de test de la copie Neon. Aucun client réel n'a été inséré.
- Le compute de la branche jetable a été **suspendu** après les essais. La branche reste stockée, aucune suppression n'a été effectuée.

### Sources livrées

- `database/security/rls-distribution-prototype.sql` : prototype explicitement **hors des migrations automatiques**, avec verrou d'exécution `pgi.isolated_rls_test`.
- `backend/src/direct-sva-tenant-rls-reader.mjs` : futur lecteur transactionnel, qui exige le rôle sans contournement et rejette les identifiants de compte ambigus.
- `tests/direct-sva-tenant-rls-reader.test.mjs` : **5 tests ciblés exécutés avec succès** sur les sources.

**Non réalisé :** modification des identifiants/rôles de l'application déployée. Le lecteur est préparé mais **non branché** pour ne pas casser les consultations actuelles. Les politiques devront être revues pour les fonctions administrateur, finance, les accès aux écritures et les pools lecture, puis intégrées dans une migration dédiée après recette globale.

## 2. Fiabilité financière

- Nouveau module `backend/src/direct-sva-financial-evidence-audit.mjs`.
- Identification obligatoire `business_unit=direct_sva` et origine fournisseur bornée ; devise EUR, sommes en centimes entiers, `paid <= confirmed <= expected`.
- Référence et empreinte source contrôlées ; répétition identique comptée une fois, répétition contradictoire rejetée, données de source non vérifiées exclues des totaux de contrôle.
- Les montants sont explicitement `totals_for_review`, **pas des montants bancaires autorisés**.
- Le module ne peut appeler ni Stripe, ni une banque, ni un opérateur ; `posting_authorized=false`, `customer_payout_authorized=false`, `external_payment_executed=false`.
- `tests/direct-sva-financial-evidence-audit.test.mjs` : **6 tests ciblés réussis**, dont **1 000 enregistrements aléatoires déterministes et 1 000 rejoués**.

**Non réalisé :** aucun paiement ou remboursement test Stripe, aucun webhook authentique livré à un système Distribution, aucun rapprochement de virement réel et aucune création d'écriture comptable en banque. Le module financier est préparé mais **non relié aux flux réels**.

## 3. HubSpot, GA4, Search Console et autres connecteurs

### État vérifié le jour du contrôle, en lecture seule

- **Google Analytics 4 :** une seule propriété visible, `properties/556033345`, « Audiotel Premium Pro – Production ». **Aucune propriété Distribution distincte** vérifiée.
- **HubSpot :** portail `149417663`, pipeline d'affaires existant `default`. Aucune pipeline Distribution distincte ; les définitions `pgi_business_unit`, `pgi_content_language` et `pgi_source_reference` sont absentes des inventaires exacts des contacts/affaires/tickets (contrairement à `pgi_dossier_ref`, déjà présent sur les contacts et affaires).
- **Search Console :** propriété de répertoire Distribution connue, pages et sitemap non publiés.
- **Neon :** `ga4`, `gsc`, `hubspot`, `network`, `payment_psp`, `statutory_accounting` portent `activation_status=disabled` et `can_send_data=false`.

### Sources livrées

- `config/pgi-direct-sva-integrations-audit-2026-10-10.json` : inventaire vérifié des manques, sans identifiants secrets.
- `backend/src/direct-sva-integration-acceptance.mjs` : contrôle de conformité fonctionnelle **sans aucun transfert** ; empêche de réutiliser la propriété GA4 et les pipelines Audiotel pour Distribution.
- `tests/direct-sva-integration-acceptance.test.mjs` : **5 tests ciblés réussis**, incluant la simulation d'un dossier entièrement conforme sans autoriser automatiquement un lancement.

**Non réalisé :** création de la propriété GA4, enregistrement des dimensions, création des champs/pipelines HubSpot, livraison d'un webhook, collecte réelle ou soumission du sitemap. Les connecteurs administratifs accessibles ne permettent pas d'effectuer ces opérations sans vérifications et autorisations supplémentaires. L'état reste **non connecté en exploitation**.

## 4. Recette automatique globale

- Nouveau workflow GitHub Actions `.github/workflows/pgi-direct-sva-prelaunch.yml`.
- Déclenchement prévu sur les modifications de la branche de préparation et manuellement si GitHub Actions est accessible.
- Actions Checkout et Setup Node épinglées ; `npm ci --ignore-scripts`.
- Commandes : `npm run verify`, `npm run verify:vercel`, `npm run build:static`, contrôles de la configuration de blocage.
- **Aucun déploiement**, aucun jeton de production transmis, aucune migration SQL, aucun appel à un PSP, aucun changement de données clients.
- `package.json` inclut les 3 nouveaux fichiers de tests à `verify:vercel` ainsi que la vérification syntaxique des nouveaux modules dans `check:backend`.
- **Preuves ciblées** : 5 RLS + 6 finance + 5 acceptation des intégrations = **16 tests passés** dans un environnement JavaScript isolé ; essais PostgreSQL multi-client réels effectués sur la copie Neon.

**État GitHub :** au dernier contrôle, les outils ne retournaient **aucun statut CI, aucun workflow exécuté** pour le commit alors vérifié. La configuration écrite **n'est pas la preuve que `npm run verify` s'est exécuté ou a réussi**. Aucun déploiement de prévisualisation Vercel Distribution n'est disponible pour une recette HTTPS complète.

## Prochaines étapes encore indispensables

1. Vérifier les rôles SQL effectifs, donner à l'application un rôle non privilégié et brancher les transactions `SET LOCAL ROLE` / identité client après essais de toutes les requêtes ; ne jamais activer globalement RLS avec le rôle propriétaire `BYPASSRLS`.
2. Propriétés et pipelines HubSpot, nouvelle propriété et définitions GA4, connecteurs opérateurs/PSP et collecte authentique des pièces de rapprochement.
3. Vérifier les résultats GitHub Actions ; corriger toutes les défaillances de `verify` et `build:static` avant de figer un candidat de livraison.
4. Exécuter une recette de bout en bout dans un environnement **réellement isolé** : 4 profils clients, HTTP/CSRF/sessions, facturation test, CDR vérifiés et Business Live, droits CRM, sauvegarde et restauration.
5. Aucun feu vert commercial ou juridique n'est déduit des seuls tests techniques.

## Invariants à ne jamais casser

**PGI Telecom | Audiotel Premium Pro est la première activité SVA** et conserve le nom et l'infrastructure. **PGI Telecom Distribution** est le nom interne de la seconde activité, dont le libellé public est **Pôle Télécom & Réseau**. Les comptes restent rattachés à la même société, mais chaque activité garde ses autorisations, statistiques, circuits financiers et dossiers séparés.

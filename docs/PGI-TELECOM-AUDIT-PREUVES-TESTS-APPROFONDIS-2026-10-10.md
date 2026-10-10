# PGI Telecom : audit de preuves de fonctionnement, tests adversariaux

**Date : 10 octobre 2026.**

**Périmètre :** site existant Audiotel Premium Pro en lecture seule, Stripe PGI en lecture seule, Neon de préparation en lecture seule, sources et tests GitHub uniquement sur `prep/pgi-direct-sva-operator-2026-10-10`. Aucun paiement, aucune attribution de numéro, aucun déploiement, aucune commande sur un client réel.

## 1. Preuves réellement observées

### Vercel et Audiotel Premium Pro, service existant

- Projet Vercel lié au dépôt GitHub, déploiement de production **READY** sur `main`, commit `70d3bd89726ae17c60157290a99a7f7084c25345`, id de déploiement `dpl_2dtQwVaGGE7sgAgFhE72ZigycT34`.
- Aucun groupe d'erreur d'exécution dans les dernières 24 heures sur le projet d'après l'agrégat Vercel ; sur 7 jours, **12 occurrences « Application exited with code 1 »** et **2 timeouts**, signalées sur d'autres déploiements antérieurs. **Pas une preuve de zéro risque**, ni une observation des tests Distribution.
- Des requêtes réelles `GET /api/v1/internal/business-live/reset-schedules/run` renvoient `200` dans les journaux de production. Le code `main` exige `authorizeCron()` et un jeton constant-time avant de lancer le traitement.
- Ce `200` prouve que la route HTTP a répondu, pas qu'un compteur client a été remis à zéro ni qu'un opérateur a transmis des données.
- **Aucun déploiement Vercel de la branche `prep/pgi-direct-sva-operator-2026-10-10`** n'a été trouvé. Les tests navigateur et API de cette version ne peuvent donc pas être considérés comme effectués.
- Pas de CI GitHub prouvée pour les derniers commits de préparation ; l'absence de checks ne vaut pas leur réussite.

### Stripe PGI Telecom, mode réel : lecture seule

- Compte connecté identifié comme **PGI Telecom - Audiotel Premium Pro**.
- Prix d'abonnement **4,90 EUR par mois**, actif ; ancien prix **3,00 EUR**, désactivé.
- **Deux webhooks activés** sur le domaine Audiotel, un webhook ancien désactivé.
- Les **9,90 EUR de portabilité prioritaire** sont générés à la demande en `price_data.unit_amount=990` dans `backend/src/stripe-billing.mjs` sur `main`, et n'exigent donc pas de prix permanent visible dans `GET /prices`.
- Les 30 événements Stripe les plus récents récupérés correspondent à des opérations de configuration des produits, prix et compte. Il n'y a **aucune preuve de paiement client réel, de reversement ou de webhook traité de bout en bout** dans cet échantillon. `pending_webhooks=0` ne certifie pas la bonne livraison de chaque événement.

### Neon, branche de préparation

- **84 migrations** enregistrées.
- Tables client, numéros, dossiers, comptabilité, automation et interrupteurs spécifiques à Distribution présentes.
- **0 compte Distribution, 0 dossier, 0 numéro, 0 écriture financière, 0 justificatif bancaire, 0 rapprochement réel, 0 tâche automatisée.**
- **0 dossier orphelin, 0 ligne comptable orpheline, 0 numéro sans bloc correspondant** dans l'état actuel ; résultat partiellement trivial puisque la base est vide.
- Contrôles réels : `operator_mode=preparation`, `number_activation_enabled=false`, `payouts_enabled=false`, `commercial_operation_enabled=false`, `public_content_authorized=false`, `navigation_enabled=false`.
- Contraintes SQL existantes : `business_unit='direct_sva'`, comptes clients non activables, numéros non activables, clés étrangères, unicité des numéros et des références.
- Fonctions et triggers PostgreSQL inspectés : empêchent la modification d'écritures déjà `posted`, exigent des lignes comptables équilibrées, bloquent l'approbation par le créateur et la validation dans une période fermée.
- **Défense en profondeur manquante :** `relrowsecurity=false` et `relforcerowsecurity=false` sur les tables `direct_sva_customer_accounts`, `direct_sva_customer_cases`, `direct_sva_number_inventory`, `direct_sva_journal_entries` et `direct_sva_journal_lines`. Les filtres par locataire de l'application et les clés étrangères existent, mais **l'isolation SQL native par politiques RLS n'est pas configurée**. Avant ouverture, étudier le rôle réellement utilisé par le serveur, l'identité transactionnelle, la prévention de contournement et l'activation de politiques RLS testées, sur une copie jetable et non directement en production.
- Le diagnostic du cockpit `direct-sva-access-readiness.mjs` indique désormais cette lacune distinctement, sans affirmer qu'elle est corrigée.

## 2. Anomalies réelles découvertes et corrigées sur la branche de préparation

**A. Relevés d'appels contradictoires :**
Le consolidateur Business Live traitait un même identifiant d'appel avec des heures de fin différentes comme un doublon valide, et ignorait la différence de référence contractuelle.
**Correction :** empreinte de déduplication incluant `ended_at` et `contract_epoch_reference`; toute contradiction interrompt la réconciliation.

**B. Identifiants convertis implicitement :**
`true` pouvait être converti en identifiant numérique `1` si une couche externe transmettait un booléen.
**Correction :** identifiants strictement numériques positifs ou chaînes décimales sans ambiguïté, avec rejet du reste.

**C. Montants comptables mal typés :**
`true` pouvait devenir `1` centime et `"1e3"` pouvait devenir `1000` centimes.
**Correction :** saisie monétaire en unités mineures strictement entières, rejet des booléens, chaînes scientifiques, hexadécimales ou comportant des espaces.

Ces trois corrections n'ont **pas** été publiées en production.

## 3. Tests de résistance exécutés sur les sources GitHub

- `tests/direct-sva-business-live-adversarial.test.mjs` : **11 tests ciblés réussis**, incluant **1000 essais de totaux et de déduplication**, **500 injections d'un autre locataire**, **500 faux doublons d'appel**.
- `tests/direct-sva-accounting-adversarial.test.mjs` : **6 tests réussis**, dont **1000 écritures comptables équilibrées** à valeurs différentes et contrôles de rejets.
- `tests/direct-sva-access-readiness.test.mjs` : **6 tests réussis**, y compris l'exposition du déficit de RLS.
- Des contrôles multi-profils antérieurs sur `tests/direct-sva-tenant-isolation.test.mjs` : **10 tests réussis** en exécution JavaScript isolée, avant ces modifications.
- Les tests ont été exercés via une exécution V8 **des sources exactes lues sur GitHub**, avec doubles de test des fonctions de stockage. Ils **ne remplacent pas** une exécution `node --test`, une vraie requête HTTPS vers une préproduction du dernier commit, ou des écritures temporaires dans PostgreSQL.
- Les nouveaux fichiers sont ajoutés à `verify:vercel` de la branche de préparation. La validation CI du projet entier reste non prouvée.

## 4. Risques restant ouverts

1. **Priorité 1 :** déployer une préproduction isolée uniquement après autorisation distincte du propriétaire, jamais sur le site Audiotel. Effectuer des essais HTTPS et navigateur, authentification, ACL, sessions, CSRF, expiration, quatre profils clients et tentatives de traversée de comptes.
2. **Priorité 1 :** appliquer des politiques PostgreSQL de cloisonnement approfondi après revue des rôles, des transactions et des impacts sur les requêtes administrateur. Vérifier aussi la compatibilité du mode « même compte PGI, deux activités séparées ».
3. **Priorité 1 :** brancher des CDR signés et contractuellement vérifiés puis tester reprise, doublons, correction, coupure et bascule opérateur avec preuves reproductibles.
4. **Priorité 1 :** rapprocher des flux financiers réellement autorisés, vérifier modes d'échec du prestataire, intégrité bancaire, imputation comptable et non-double paiement.
5. **Priorité 2 :** vérifier de bout en bout HubSpot, GA4 dédié, consentement, CRM, formulaires, langues, gestion des réclamations et courrier.
6. **Priorité 2 :** jouer une vraie recette de bascule de navigation après publication autorisée, conserver les `200` et `canonical` pour les pages publiées quand le lien disparaît.
7. **Priorité 2 :** exécuter la totalité de la suite Node, la construction Vercel, les vérifications de sécurité et des tests de charge dans un environnement isolé. Ne pas considérer le message d'un commit déclarant des tests réussis comme une certification du dernier code.

## 5. Verdict

**Infrastructure existante Audiotel :** déploiement réel `READY`, activité de routes internes observée, Stripe tarif/webhooks effectivement configurés. Cela ne démontre pas tout le cycle commercial.

**PGI Telecom Distribution :** architecture très avancée et davantage protégée grâce aux trois corrections. Résistance algorithmique vérifiée en conditions simulées, base Neon sécurisée contre une ouverture accidentelle. **Aucun test de bout en bout réel n'est encore possible sans environnement Distribution déployé et connecteurs réels.**

**Aucune migration, aucun paiement, aucun changement de paramètres Stripe/production, aucun déploiement, aucune activation commerciale.**

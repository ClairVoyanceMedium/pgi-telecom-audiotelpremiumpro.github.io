# PGI Telecom Distribution | Architecture du circuit financier automatisable

**Date : 10 octobre 2026.** Deuxième activité uniquement, dans `prep/pgi-direct-sva-operator-2026-10-10`. Première activité **Audiotel Premium Pro** intégralement séparée, sans changement d'abonnement, Stripe, numéros, données ni Business Live.

## 1. Positionnement actuel

Le parcours financier Distribution est **préparé, contrôlable et non déployé**, et non « entièrement automatique ». Les sources télécoms, bancaires, de conformité des éditeurs et de règlement ne sont pas encore authentifiées. Le système ne peut donc ni reconnaître légalement les recettes déclarées par un opérateur, ni affecter des fonds réels, ni payer des tiers.

Sources réglementaires et techniques :
- ACPR, encaissement pour compte de tiers : https://acpr.banque-france.fr/en/node/26817
- Stripe Connect, `separate charges and transfers` : https://docs.stripe.com/connect/separate-charges-and-transfers
- DGFiP, fichier des écritures comptables : https://www.impots.gouv.fr/fichiers-standards-des-ecritures-comptables

**Point fondamental :** une licence et un contrat Stripe autorisant certains paiements CB n'autorisent pas automatiquement la circulation de recettes télécoms destinées à des éditeurs tiers. Il faut distinguer le statut juridique PGI (vendeur, agent commercial, mandataire, établissement partenaire), l'origine des fonds, l'habilitation bancaire, le bénéficiaire et le cadre applicable.

## 2. Flux cible, sans saisie manuelle quotidienne après raccordement

1. **Opérateur / collecteur SVA** : réception automatique des CDR, horodatés et authentifiés, et des relevés de rémunération contractuels. Conservation de l'empreinte de la livraison, des dates de service, des références de contrats et du numéro appelé.
2. **Attribution contractuelle** : rapprochement du CDR avec la titularité historique du numéro, la période tarifaire et le dossier éditeur. Refus des numéros sans attribution certaine ou des appels chevauchant une bascule sans segmentation opérateur certifiée.
3. **Banque / partenaire PSP habilité** : réception d'un événement signé ou d'un relevé bancaire certifié, sans donner à un formulaire client le pouvoir de confirmer un encaissement. Une référence de mouvement bancaire ne doit pas être affectée à deux relevés.
4. **Moteur de correspondance** : contrôles devise, période, montant au centime, doublons, remboursements, compensation, litiges, échéances et écarts. Aucun calcul en virgule flottante pour l'argent.
5. **Sous-journal analytique** : ventilation PGI / éditeurs selon contrats vérifiés ; écritures équilibrées, traçables, datées, révisables par contrepassation. Journal légal unique et traitement TVA/FEC après définition du rôle juridique et validation comptable.
6. **Business Live** : vue prévisionnelle distincte des sommes certifiées, réellement encaissées et effectivement versées. Historique client conservé lors des changements de prestataire, sans annoncer un règlement avant preuve.
7. **Contrôle des bénéficiaires** : contrat éditeur, vérification KYC/KYB, compte bancaire ou compte PSP authentifié, blocages litiges et fraude, retenues justifiées et délais contractuels.
8. **Instruction et exécution** : seulement via un prestataire et un circuit autorisés, avec clé d'idempotence persistante, plafond par montant/période/bénéficiaire, contrôles de concurrence, double approbation des opérations exceptionnelles et absence de nouvelle exécution après une réponse réseau incertaine sans rapprochement.
9. **Rapprochement sortant** : le débit annoncé n'est pas « payé » avant un événement bancaire ou PSP authentifié. Les rejets, retours de fonds et corrections sont inscrits dans l'audit.
10. **Exceptions** : incident détecté et porté à la bonne file de traitement sans couper les autres clients ; notification interne factuelle, délais suivis, aucune décision juridique ou mouvement bancaire à partir d'un courriel entrant.

Une orchestration durable utilisera à terme une file transactionnelle, une table d'envois externe avec statut et identifiant fournisseur, des délais de reprise bornés, des événements signés avec refus de rejeu et une machine à états par dossier/versement. **Ces exécuteurs réels ne sont pas branchés aujourd'hui.**

## 3. Livrables techniques enregistrés

| Fichier | Fonction actuelle |
| --- | --- |
| `backend/src/direct-sva-financial-cycle.mjs` | Simulation déterministe de répartition par éditeur, encaissements déclarés et retenues ; tous versements verrouillés |
| `backend/src/direct-sva-financial-readiness.mjs` | Inspection en lecture seule des tables et des connexions ; ne revendique aucune habilitation de banque |
| `backend/server.mjs` | Route de prévisualisation protégée admin/finance + lecture des prérequis admin/finance/readonly |
| `assets/direct-sva-cockpit.js` | Onglet « Cycle financier », indicateurs automatiques de préparation et vue des montants indicatifs |
| `database/migrations/082_direct_sva_financial_cycle_fences.sql` | Tables des cycles, bénéficiaires, étapes et événements d'audit ; verrouillage SQL explicite |
| `database/migrations/083_direct_sva_bank_event_deduplication.sql` | Unicité globale du mouvement bancaire par adaptateur, registre d'exceptions indépendant |
| `tests/direct-sva-financial-cycle.test.mjs` | Cas multi-éditeurs, sécurité, retenues, sources falsifiées et idempotence |
| `tests/direct-sva-financial-integration.test.mjs` | Contrôles du cockpit, des droits, de l'état des connecteurs et des verrous SQL |

Deux migrations sont exécutées **uniquement sur la branche Neon** `br-wild-meadow-auuv4k65` et inscrites dans `schema_migrations` avec checksum SHA-256 ; 33 tables `direct_sva_*` sont présentes sur la base de préparation après ce chantier. Les nouvelles tables n'ont pas reçu de transaction simulée durable ; elles sont prêtes à recevoir de futurs enregistrements de préparation contrôlés.

## 4. Paramétrage futur, une fois par fournisseur

Pour un nouvel opérateur : contrat, identifiant fournisseur, format du CDR, schéma de tarif, fuseau horaire, preuves cryptographiques, séquence de rattrapage, code de règlement et calendrier de remise.

Pour la banque ou le PSP : source officielle, privilèges API limités, webhook signé ou API de relevés, unicité des mouvements, compte de cantonnement le cas échéant, rapprochement quotidien et gestion des débits retour.

Pour chaque éditeur : dossier existant, numéro, contrat, mandat et part de recettes, identité vérifiée, coordonnées de paiement validées chez le partenaire habilité. Les secrets, IBAN et données personnelles sensibles ne doivent jamais circuler dans les journaux publics ni dans les événements GA4.

**Objectif opérationnel :** après ces branchements et leur vérification, les opérations ordinaires doivent s'exécuter sans recopie manuelle ni validation répétitive ; seuls les litiges, écarts, changement de compte destinataire, anomalies de conformité ou paiements sortant des plafonds doivent être présentés à l'administrateur.

## 5. Acceptation de production

Avant une activation commerciale : preuve contractuelle opérateur + CDR vérifiés, règles de numérotation et portabilité, cadre PSP confirmé, KYC des premiers bénéficiaires, mode principal/agent et comptabilité fiscale validés, droits d'accès en vraie session, signatures et protection contre les rejouements, reprise sur incident, absence de double paiement sous concurrence, rapprochement bancaire réel, tests E2E sur environnement isolé, puis **top départ explicite**.

**Situation au terme du chantier :** composants créés, migration en recette appliquée, scénarios de logique exécutés en moteur JS isolé ; `npm run verify`, intégration opérateur/bancaire et transactions réelles non attestés. Production, Stripe réel et première activité inchangés.

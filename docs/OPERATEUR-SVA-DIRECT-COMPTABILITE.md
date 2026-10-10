# PGI Telecom : comptabilite du distributeur direct SVA

Version de preparation du 10 octobre 2026.

## Principe de separation

PGI Telecom porte deux activites commerciales : Audiotel Premium Pro avec les partenaires SVA, et sa future activite d'operateur distributeur direct.

Les numerotations, contrats, recettes, charges, commissions, marges et statistiques sont suivis de facon distincte, sans addition automatique.

**Attention** : si les deux activites appartiennent a la meme personne morale, il ne faut pas creer deux comptabilites legales contradictoires. La separation des tableaux est analytique et operationnelle. Les ecritures devront etre rapprochees dans une seule comptabilite generale de l'entite et un seul FEC legal, avec axes analytiques distincts, apres validation par l'expert-comptable.

La couche presente est un sous-journal metier independant. Elle ne genere pas de FEC et n'alimente pas automatiquement la comptabilite legale existante.

## Composants techniques

- Migration SQL 073 : tables direct_sva_* pour blocs, inventaire, interconnexions, journaux, lignes et audit.
- Backend direct-sva-business.mjs : resultat mensuel, brouillon comptable et approbation a deux personnes.
- Backend direct-sva-reconciliation.mjs : controle documentaire des releves, sans ecriture ni virement.
- Frontend direct-sva-cockpit.js : onglets de numérotation, comptabilite, rapprochement et conformite.
- Frontend accounting-cockpit.js : bascule entre les deux activites, chargee a la demande.
- Tests : isolation des flux, integrite financiere, protection contre les doublons et interfaces.

## Comptes du sous-journal

| Compte | Utilisation indicative |
| --- | --- |
| 411100 | Creances operateurs SVA directs |
| 512100 | Tresorerie activite SVA directe |
| 467200 | Reversements dus aux editeurs |
| 471290 | Flux en attente de qualification |
| 706100 | Produits SVA directs a qualifier |
| 622610 | Collecte et interconnexion |
| 622620 | Transit, SIP et supervision |
| 635810 | Redevances de numerotation |
| 658100 | Corrections, impayes et fraude |

Les comptes sont provisoires et necessitent une revue du plan comptable et des bases fiscales. Les flux encaisses pour le compte des editeurs ne sont pas automatiquement du chiffre d'affaires propre de PGI. Ne jamais inventer de taux de TVA.

## Controls debit et credit

1. Source et reference uniques pour chaque document.
2. Devise EUR et montants en centimes entiers.
3. Au moins deux lignes, debit = credit et somme positive.
4. Justificatif reference avant creation du brouillon.
5. Auteur et approbateur distincts.
6. Verification de l'equilibre et de l'etat de periode a la validation.
7. Journal valide et lignes verrouilles, correction par nouvelle contrepassation documentee.
8. Historique des creations et approbations non modifiable depuis l'application.
9. Aucun lien automatique entre validation comptable et virement bancaire.
10. Aucun rapprochement avec des flux Audiotel dans le calcul direct.

## Lecture du tableau

- Produits enregistres : credits moins debits des comptes de produits, seulement pour les ecritures publiees.
- Charges : debits moins credits des comptes de charges.
- Resultat operationnel provisoire : produits moins charges du sous-journal.
- Creances operateurs : variation comptable du mois, pas montant confirme en banque.
- Dettes editeurs : variation du montant du, pas paiement autorise.
- Compte d'attente : sommes a ventiler et justifier.
- Brouillons : exclus du resultat tant qu'ils ne sont pas approuves.

Les montants ne remplacent pas le rapprochement bancaire, une verification du chiffre d'affaires, les impots ni la liasse fiscale.

## Pre-rapprochement operateur

Le moteur accepte un releve JSON interne avec : identite de l'operateur, reference du releve, periode, EUR et lignes de CDR comprenant numero SVA appele, duree facturable, net amont, marge PGI et net du a l'editeur.

Il detecte les references en doublon, les numerotations invalides, les durees impossibles, les montants negatifs et les repartitions desequilibrees.

Invariance de calcul previsionnelle : net amont = marge PGI + net du aux editeurs. Ce controle n'etablit pas le droit d'encaissement et ne prouve pas l'existence du paiement operateur.

Les donnees personnelles de l'appelant ne sont pas necessaires a cette analyse. Aucune ligne n'est automatiquement integree au journal depuis une simple previsualisation.

## Garde-fous de la phase preparation

- Aucun changement dans les tables de l'offre Audiotel actuelle.
- Activation et paiement direct bloques dans le registre de controles SQL.
- Statuts assigned, testing et active du registre de numerotation directe refuses en base.
- Aucun prestataire de collecte ni operateur attribue fictivement.
- Aucune migration productive ou nouvelle route active dans Vercel.
- Aucun champ KYC sensible ni secret dans GitHub.
- Aucune operation autorisee sur les fonds de tiers sans dispositif juridique et PSP verifie.

## Etapes restant conditionnees aux partenaires externes

1. Confirmer le statut juridique exact de PGI et les demarches Arcep.
2. Recevoir une decision d'attribution, les exigences APNF et les contrats AF2M.
3. Negocier interconnexion et collecte avec des fournisseurs techniques.
4. Obtenir specifications CDR, relevés, grilles de remuneration et delais de reglement.
5. Valider les flux des fonds de tiers avec un PSP et un conseil specialise.
6. Valider le mapping comptable, la TVA, la reconnaissance du chiffre d'affaires et la piste FEC avec l'expert-comptable.
7. Brancher les adaptateurs de collecte de facon isolee en recette.
8. Tester des scenarios reels d'appel, correction, fraude, divergence, coupure et retour arriere.
9. Ne mettre en production qu'apres preuves, validation juridique et ton top depart.


## Renforcement des controles du 10 octobre 2026

La migration 073 a ete reparee avant tout essai sur une base de donnees : une definition SQL dupliquee et une expression reguliere E164 incomplete ont ete supprimees. Le nouveau test de migration tests/direct-sva-migration-integrity.test.mjs interdit notamment la duplication de definitions et la perte des verrous de preparation.

Le sous-journal dispose d'un endpoint admin GET /api/v1/platform/direct-sva/accounting/export?month=AAAA-MM qui retourne toutes les lignes du mois, et pas seulement les 100 derniers enregistrements affiches. L'export borne a 20 000 lignes echoue si le plafond est depasse, au lieu de tronquer les donnees. L'interface fournit un CSV avec neutralisation des formules de tableur et la mention NON-FEC. Les lignes sont verifiees pour assurer debit = credit.

Les mois et dates proposes dans le cockpit sont determines dans le fuseau Europe/Paris, afin d'eviter les erreurs aux limites de mois en heure UTC.

Verification documentaire en lecture seule sur la base Neon existante : la fiche legale du profil comptable commun n'a pas de denomination renseignee, pas de SIREN confirme, un regime TVA unconfigured, aucun mapping des comptes et fec_enabled=false. Aucun parametre n'a ete invente ni modifie. Un diagnostic binaire et non sensible est ajoute a l'onglet Integrations, sous shared_legal_accounting.

L'API et l'interface de distribution directe restent bloquees par defaut. Ce renforcement n'autorise ni decaissement de fonds, ni activation de numero, ni FEC. Les migrations 073 a 075 restent non appliquees en production.

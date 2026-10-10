# PGI Telecom : changement de distributeur sans rupture de l'expérience client

Date : 10 octobre 2026. Préparation sur branche GitHub isolée. Aucune migration opérateur, aucun routage ni aucun paiement déclenchés.

## Objectif opérationnel

Un client acquis sous Audiotel Premium Pro doit rester le même client de PGI Telecom si PGI passe d'un hébergement SVA chez un partenaire à une distribution directe, ou si PGI change de partenaire.

Les identifiants `tenants.id`, `tenant_number_assignments.id`, `sva_numbers.id`, le numéro E.164, le dossier client, les accès, les destinations, les contrats non modifiés, les abonnements, les justificatifs et les remises à zéro Business Live doivent demeurer stables. Un nouveau fournisseur n'est pas un nouveau client.

Il faut distinguer l'opérateur attributaire réglementaire du bloc, l'opérateur exploitant du numéro, l'opérateur de collecte, le fournisseur d'interconnexion et PGI en tant que cocontractant de l'éditeur. Changer un prestataire technique ne suffit pas à opérer un portage de numéro ni à transférer des obligations contractuelles.

## Application préparée

- `database/migrations/077_existing_customer_provider_transition_preparation.sql` : enregistre un plan immuable, lié aux identifiants historiques, avec contraintes de non-activation ; vérifie aussi en base la cohérence client-numéro-prestataire.
- `backend/src/direct-sva-customer-transition.mjs` : lecture des lignes clientes, sélection d'un opérateur cible ou de la future distribution PGI, préparation documentaire et liste de contrôle.
- `backend/src/direct-sva-business-live-continuity.mjs` : contrat de consolidation future des CDR authentifiés des deux hébergeurs, unique par identité canonique d'appel, avec frontière temporelle effective et montants estimés, confirmés et payés séparés.
- `assets/direct-sva-transitions.js` : onglet administrateur `Changer de distributeur` dans le cockpit direct, chargé à la demande.
- `assets/client-live-finance.js` et `assets/live-finance.js` : signalent les données trop anciennes comme une synchronisation en attente plutôt que comme un direct fiable. Les cumuls ne sont pas effacés.
- `tests/direct-sva-customer-transition.test.mjs` : assertions préparatoires de non-régression.

Toutes ces ressources restent hors production. Les opérations d'écriture créent uniquement des plans privés. Les routes d'exécution télécom et financière n'existent pas dans ce module.

## Hébergeur technique identique, contrat de distribution différent

PGI peut changer de rôle économique et contractuel sans remplacer le transporteur SIP sous-jacent. La continuité ne doit donc pas être identifiée uniquement par `host_carrier_id`.

Le contrat de consolidation Business Live peut distinguer deux `contract_epoch_reference` validées, chacune avec sa grille financière et sa date d'effet, même si le prestataire d'hébergement technique est identique avant et après la bascule. Un CDR doit être attribué à la bonne période contractuelle. Le moteur refuse une référence d'époque manquante ou contradictoire.

Les préparations peuvent être révisées : une nouvelle version crée une entrée supplémentaire non modifiable, sans écraser la décision antérieure. L'opération commerciale n'est autorisée par aucune version de préparation.

## Contrat de continuité Business Live

1. Le compteur est lié au `tenant_id` et à sa date persistante de remise à zéro, jamais à la date de changement de prestataire.
2. Les appels du fournisseur sortant continuent de lui être attribués jusqu'à la frontière réseau réellement confirmée, en tenant compte des appels déjà en cours.
3. Les nouveaux appels utilisent la version de tarification contractuelle applicable au fournisseur entrant. On ne réévalue pas rétroactivement les anciens appels avec la nouvelle grille.
4. Les lignes CDR doivent porter une référence d'appel canonique réellement fiable pour éviter un double comptage lors des imports simultanés. Un conflit est bloquant.
5. Les chiffres estimés, confirmés, comptabilisés et effectivement payés restent des catégories distinctes. Le montant estimé ne devient jamais une dette exigible par le seul effet de l'animation Business Live.
6. Un appel traversant une remise à zéro doit être ventilé à partir des segments d'appel authentifiés. Sans données fiables, aucun prorata n'est inventé.
7. Les données privées des hébergeurs et les paramètres de routage ne sont pas exposés au client. Les informations légalement dues au client demeurent communiquées.
8. Les jours/mois, les anciens reçus, les factures et les reversements confirmés restent consultables : jamais de table neuve qui remplace l'historique.

La consolidation `consolidateProviderNeutralBusinessLive` est actuellement un moteur de validation isolé. Elle n'est pas encore reliée aux véritables adaptateurs CDR et ne saurait garantir un Business Live interopérable sans contrat et flux techniques réels.

## Séquence de migration future, individuelle ou par lots

1. **Inventaire** : identifier les clients, les numéros SVA et l'hébergeur réel. Interdire les lignes dont l'opérateur actif est manquant ou ambigu.
2. **Préparation** : enregistrer un plan interne immuable pour chaque ligne, sans toucher à `tenant_number_assignments`, aux utilisateurs ni aux données financières.
3. **Droits** : vérifier l'affectation, le titulaire, le mandat ou RIO selon la procédure applicable, le droit de PGI à exploiter le service, le contrat opérateur et les exigences AF2M/RSVA.
4. **Consentement et transparence** : comparer les contrats et tarifs existants avec la cible, informer ou obtenir l'accord des clients lorsque requis et conserver les justificatifs. L'objectif est l'absence d'effort technique pour le client, jamais la dissimulation de droits ou modifications contractuelles.
5. **Recette** : valider en environnement isolé le routage, les appels entrants, les CDR, le message tarifaire, l'antifraude, les retours SIP et la résilience. Un interrupteur préparatoire ne peut pas remplacer cette acceptation.
6. **Bascule opérateur** : par ordre explicite et avec preuve de confirmation réelle par les acteurs concernés, selon un calendrier contrôlé ; une simple modification SQL n'effectue pas un portage réseau.
7. **Continuité** : conserver les appels engagés chez l'ancien opérateur, ne rattacher les nouveaux CDR au suivant qu'avec la preuve d'effet du changement et dédupliquer les deux collectes.
8. **Comptabilité** : conserver les créances, impayés, appels contestés et dettes envers les éditeurs par source et période. Ne jamais créditer deux fois un CDR ou redistribuer un montant amont non encaissé.
9. **Supervision** : contrôler les appels, la qualité, la disponibilité, les reversements, les anomalies et les réclamations après bascule. Une migration réseau effective peut nécessiter une nouvelle opération pour revenir en arrière.

## Frontières techniques non négociables

- Aucune création automatique d'un nouveau compte PGI pour un ancien client.
- Aucun changement tacite de numéro SVA ou de tarif.
- Aucun double relevé d'appels ni double paiement au client.
- Aucun changement de distributeur depuis l'interface client.
- Aucune migration de masse par simple activation du premier interrupteur de prévisualisation.
- Aucun transfert financier des recettes d'un tiers sans cadre PSP juridiquement validé.
- Aucun effet de la nouvelle activité sur l'actuelle production Audiotel.
- Aucun masquage d'une information client ou réglementaire légalement obligatoire.

## État réel et points à brancher avant une migration effective

Les tables de préparation et le code GitHub existent sur branche de travail. Les migrations 073 à 077 sont **non appliquées en production**. Le module de consolidation Business Live est **non raccordé aux CDR des deux fournisseurs**. Il manque la confirmation de l'opérateur direct PGI, les contrats partenaires de collecte et de portabilité, le schéma financier PSP, la qualification contractuelle et une recette réseau sur un environnement dédié. Les tests unitaires peuvent être exécutés en CI, mais aucun succès de CI ou d'essais PostgreSQL réels n'est présumé.

Sources :
- Arcep, conservation des numéros fixes, mobiles et SVA : https://www.arcep.fr/actualites/actualites-et-communiques/detail/n/portabilite-des-numeros-210323.html
- Arcep, affectation des numéros de téléphone : https://www.arcep.fr/mes-demarches-et-services/acteurs-regules/operateurs-telecoms/fiches-pratiques/operateurs-telecoms-affectation-des-numeros-de-telephone.html
- Arcep, décision 2022-2148 et processus de conservation : https://www.arcep.fr/la-regulation/grands-dossiers-thematiques-transverses/la-numerotation/portabilite-numeros-telephone-fixes-et-mobiles.html
- AF2M, recommandations déontologiques 2026 : https://af2m.org/rd-sva/

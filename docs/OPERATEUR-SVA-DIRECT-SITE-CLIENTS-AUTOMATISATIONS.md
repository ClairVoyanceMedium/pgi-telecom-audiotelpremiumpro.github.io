# PGI Telecom : preparation du site, de l'espace client et des automatisations SVA directes

Date : 10 octobre 2026. Branche de preparation uniquement, aucun deploiement.

## 1. Choix d'architecture

Une seule societe, deux univers commerciaux distincts :
- Audiotel Premium Pro, activite actuelle avec les partenaires SVA et abonnement existant ;
- PGI Telecom, distribution SVA directe, future activite geree dans le meme groupe juridique mais avec un circuit commercial, des comptes analytiques, une numerotation, des contrats et des reversements distincts.

Il ne faut pas lancer les deux activites en meme temps par accident. La premiere mise en production Audiotel ne doit jamais activer le futur service direct.

## 2. Rubrique Internet reservee

Trois pages publiques sont preparees dans le depot mais exclues de la fabrication statique actuelle :
- site/distribution-sva/index.html : accueil du futur service ;
- site/distribution-sva/solutions/index.html : catalogue de prestations envisagées ;
- site/distribution-sva/conformite/index.html : exigences et limites reglementaires.

Navigation dediee : Presentation, Solutions, Conformite, Espace client direct. Chaque page est "noindex, nofollow" dans son fichier source et rappelle que le projet n'est pas ouvert au commerce.

Le serveur backend/src/static-site.mjs renvoie 404 pour tout chemin /distribution-sva/ et /site/distribution-sva/ afin d'eviter une publication accidentelle, meme si des fichiers etaient recopies dans dist. La liste explicite de scripts/build-static.mjs ne contient aucun de ces fichiers. Le sitemap actif ne contient aucun chemin direct.

Au second top depart, ajouter au menu de la page d'accueil Audiotel un lien clairement separe "Distribution SVA directe" seulement si ce service est effectivement ouvert. Le conserver dans le menu principal ne doit pas detourner la conversion de l'activite Audiotel. L'ancien site et ses tarifs ne sont pas modifies pendant la preparation.

Les pages doivent etre reprises par une revue humaine du contenu, de la disponibilite commerciale, des CGV, des identifiants legaux et des normes d'accessibilite avant indexation et ouverture.

## 3. Espace client direct

Maquette fonctionnelle preparee :
- site/distribution-sva/espace-client/index.html ;
- site/distribution-sva/client-portal.js.

Il n'y a aucune inscription libre. L'authentification reutilise la session securisee de l'espace client PGI existant, mais le droit d'acces est distinct.

Nouvelle route reservee :
GET /api/v1/customer/direct-sva/overview

Cette route :
1. exige une session client valide ;
2. recupere l'appartenance du client au tenant autorise ;
3. exige la permission de lecture de son propre dossier ;
4. recherche uniquement direct_sva_customer_accounts pour son tenant ;
5. refuse les comptes non inscrits ou la phase preparatoire ;
6. interdit les chiffres et donnees de l'activite Audiotel.

Le sous-espace direct possede ses futurs modules Dossiers, Numeros, Portabilite, Appels, Reversements, Documents comptables et Support. Aucun chiffre n'est simule. Le nouvel espace ne devient pas visible ou accessible avant attribution explicite des droits et une migration de mise en service revue.

Pour la publication, le chemin /distribution-sva/espace-client/ devra beneficier des en-tetes HTTP Cache-Control: no-store, CSP privee et X-Robots-Tag: noindex. Les documents financiers doivent toujours etre valides cote serveur, pas uniquement masques cote navigateur.

## 4. Cockpit operateur direct

Le cockpit Comptabilite actuel comporte un choix entre Comptabilite Audiotel et Comptabilite distribution directe. La sous-interface directe est chargee a la demande. Aucun poids supplementaire n'est ajoute au chargement principal du cockpit.

Modules directs prepares :
- indicateurs de numerotation et d'interconnexion ;
- comptabilite en partie double et journal par activite ;
- pre-rapprochement des relevés operateurs ;
- historique et export de donnees ;
- conformité Arcep, AF2M, APNF et obligations PSP ;
- registre des integrations GA4, GSC, HubSpot et comptabilite ;
- supervision de 13 processus automatiques.

La validation des ecritures applique les restrictions deja preparees, dont une deuxieme personne pour approuver. Les actions sensibles ne doivent jamais se cacher derriere un simple clic client sans accord juridique ou financier.

## 5. Moteur d'automatisation a douze plus un processus

Les treize flux standard prepares sont :
1. reception du prospect ;
2. controle de conformite ;
3. revue contractuelle ;
4. affectation de numero ;
5. portabilite ;
6. reception des CDR ;
7. rapprochement des montants operateurs ;
8. brouillon comptable ;
9. revue des factures ;
10. reversement aux editeurs ;
11. synchronisation du CRM ;
12. mesure Analytics ;
13. suivi du support.

La table direct_sva_automation_jobs utilise une reference idempotente unique et un statut pending_authorization. Les moteurs financiers et de telephonie ne peuvent pas etre actives par defaut. L'historique des evenements est non destructif et le moteur de supervision montre aussi les flux encore sans donnees.

Automatiser ne signifie pas omettre les controles : des moteurs pourront preparer sans intervention les dossiers recevables, verifier les formulaires, rapprocher les montants et produire les alertes. Les dossiers ambigus, les contestations, les incidents de fraude et les paiements de tiers doivent etre escalades conformement aux obligations du prestataire de paiement.

Toute operation en production devra recevoir un contrat, un mecanisme de reprise et des preuves d'execution reelle. Un workflow prepare n'est pas un workflow connecte.

## 6. Mesure d'audience et conversions

La propriete GA4 actuelle est reservee a Audiotel Premium Pro. La future rubrique directe doit avoir une propriete GA4 distincte et ses propres dimensions evenementielles.

Scripts reserves :
- site/direct-sva-tracking.js ;
- site/distribution-sva/measurement.js.

La collecte restera inactive tant que :
- la nouvelle propriete GA4 n'existe pas ;
- les dimensions n'ont pas ete creees ;
- la mise en service commerciale n'a pas ete autorisee ;
- le consentement valide ou une autre base legale n'a pas ete confirmee pour le traitement effectif.

Les futurs indicateurs suivront, selon consentement, les pages importantes, sections vues, clics de menu, etapes de demande, erreurs, contrats et activations quand ces evenements auront reellement lieu. Aucun nom, email, numero d'appelant, numero de dossier ou identifiant CDR ne sera inclus dans les parametres GA4.

Aucun script direct SVA n'est charge dans le site commercial Audiotel actuel.

## 7. HubSpot, Search Console et CRM

HubSpot : portail unique pour la societe, pipeline direct SVA reserve, suivi des cas et une nomenclature pgi_business_unit. Les deals et contrats d'une personne deja cliente d'Audiotel seront conserves dans un parcours direct distinct. Aucune synchronisation CRM directe n'est active.

Google Search Console : la propriete du domaine couvre les deux activites, mais une propriete de chemin et un sitemap propres a /distribution-sva/ peuvent etre ajoutes apres l'existence des pages. Ne pas soumettre de pages inexistantes.

Google Analytics : les deux proprietes doivent distinguer sessions et conversions pour des budgets marketing analytiques comparables.

## 8. Conditions de lancement

Le module backend/src/direct-sva-launch-plan.mjs definit huit dependances pour une future recette. Il est purement documentaire et renvoie toujours production_deployment_permitted=false et site_publication_permitted=false.

Conditions bloquantes : attribution des ressources, contrat d'interconnexion, preconditions financieres PSP, validation fiscale et comptable, habilitations des clients, separation du CRM et d'Analytics, tests de charge et de reprise, et ordre explicite de PGI.

Les controles ne doivent pas autoriser un deploiement du distributeur sous le simple effet d'un cron, d'une modification SQL ou d'un acces administrateur non valide.

## 9. Ce qui reste a produire lorsque les informations arriveront

- veritable formulaire contractuel de distribution directe, conforme aux obligations sectorielles ;
- processus KYC et stockage des documents selon une politique de confidentialite ;
- service d'attribution et de portabilite selon contrat d'operateur ;
- moteur tarifaire valide sur les grilles operateurs ;
- import et verification cryptographique des CDR de la collecte ;
- rapprochement bancaire et traitement des impayes ;
- regles de reversements et mandat du PSP, si approprie ;
- raccordement des ecritures au grand livre legal et FEC unique ;
- pipeline HubSpot et definitions GA4 relies aux ressources effectivement creees ;
- chargement de la rubrique dans le site public, retrait controle du noindex et publication du sitemap ;
- simulation et recette bout en bout, puis deuxieme top depart.

Aucun prestataire, document externe ni paiement n'a ete modifie durant cette preparation.


## Verrou technique du premier lancement Audiotel

Le circuit de distribution directe dispose maintenant de deux controles complementaires :

1. L'onglet du cockpit comptable n'est visible que si window.PGI_CONFIG.directSvaOperatorUiEnabled === true. Cette valeur n'est pas ajoutee au site courant et demeure absente par defaut.
2. Les routes du serveur /api/v1/platform/direct-sva/* et /api/v1/customer/direct-sva/* retournent un refus 404 tant que PGI_DIRECT_SVA_API_PREVIEW_ENABLED n'est pas validee explicitement. Le parametre est false par defaut dans backend/src/config.mjs.

Le module administratif assets/direct-sva-cockpit.js est copie lors de la construction statique, mais n'est telecharge par le navigateur que lorsque l'onglet est effectivement ouvert. Les pages publiques /distribution-sva/ et l'espace client direct ne sont toujours pas copies ; le serveur maintient leur refus, y compris pour les chemins encodes.

Activer ces interrupteurs seuls ne constitue pas un lancement. Les verrous SQL continuent d'interdire l'affectation et l'activation de numeros et les paiements. L'ouverture commerciale ne peut intervenir qu'apres obtention des preuves, recette PostgreSQL et autorisation PGI.

Les nouveaux controles automatises sont dans tests/direct-sva-site-and-client.test.mjs, tests/direct-sva-business.test.mjs et tests/direct-sva-migration-integrity.test.mjs. Aucun resultat de CI ou de test PostgreSQL de bout en bout n'est revendique tant qu'il n'a pas ete effectivement execute.

# PGI Telecom : preparation de la distribution directe SVA en France

Etat au 10 octobre 2026 : ETUDE ET PREPARATION, AUCUNE EXPLOITATION DIRECTE ACTIVE.

## 1. Decision strategique

Objectif de PGI Telecom : devenir elle-meme operateur exploitant et distributeur direct de numeros de services a valeur ajoutee en France. PGI conserverait la relation contractuelle de telephonie avec l'editeur final, sa politique commerciale, la supervision, la facturation et les donnees d'exploitation. Un partenaire peut assurer les fonctions techniques de transport, collecte et interconnexion sous contrat.

Ce modele est distinct du statut de simple apporteur d'affaires et de la revente d'un contrat conclu entre l'editeur et un operateur attributaire tiers.

Ne jamais presenter PGI comme deja attributaire d'une ressource ou autorisee a collecter des fonds de tiers. La phase actuelle consiste a preparer les interfaces et dossiers sans changer les droits de production.

## 2. Positionnement reglementaire

Les obligations resultent de la nature effective du service et de son contrat avec le client, meme si l'exploitation du reseau est sous-traitee. L'Arcep indique que l'operateur qui conclut le contrat de telephonie doit en principe etre attributaire des numeros affectes a ses clients, sauf notamment lorsqu'un client conserve son numero par portage. Les nouvelles mises a disposition de numeros en 08 entre operateurs sont interdites depuis le 1er aout 2018.

Le depot d'une declaration prealable L.33-1 n'est plus obligatoire depuis 2021. En revanche, une demande d'identifiant CE peut etre necessaire pour solliciter de nouvelles ressources. La decision d'attribution reste indispensable : un identifiant CE n'est pas une decision d'attribution.

Pour les numéros speciaux SVA, l'Arcep rappelle :
- verification de l'identite, de l'etablissement et des informations de l'editeur ;
- transparence du service, des tarifs et des reclamations ;
- portabilite et affectation exclusive ;
- exigences d'ouverture nationale du service ;
- criteres de gestion des blocs, avec 80 % d'utilisation du sous-bloc ouvert avant un autre sous-bloc, sous reserve des regles applicables ;
- mise en oeuvre du prefixe propre de routage pour les numeros portes a compter du 1er juillet 2028.

Tout contrat de collecte/reversement de fonds pour compte de tiers doit etre valide au regard du droit des services de paiement. L'Arcep signale en particulier l'exigence d'un statut approprie, tel qu'un mandat d'agent d'un prestataire de services de paiement ou un agrement, selon le schema retenu. Stripe configure pour les abonnements ne justifie pas, a lui seul, les reversements SVA.

Sources officielles :
- https://www.arcep.fr/mes-demarches-et-services/acteurs-regules/operateurs-telecoms/fiches-pratiques/operateurs-telecoms-affectation-des-numeros-de-telephone.html
- https://extranet.arcep.fr/communications-electroniques/identifiant-ce
- https://www.arcep.fr/la-regulation/grands-dossiers-thematiques-transverses/la-numerotation.html
- https://af2m.org/souscrire-aux-cgs-sva/
- https://af2m.org/rd-sva/
- https://af2m.org/liste-prestataires-services-paiement-dsp2/

## 3. Demarches externes, sans engagement actuellement

### Arcep

1. Verifier l'entite juridique exacte de PGI, son SIREN et les coordonnees du responsable technique/reglementaire.
2. Etablir l'analyse de qualification d'operateur avec conseil specialise.
3. Demander si necessaire l'identifiant CE via le portail officiel.
4. Construire le dossier justifiant les besoins de ressources SVA, leur utilisation, les categories et la capacite de gestion.
5. Solliciter les blocs souhaites et attendre une decision d'attribution expresse avant tout provisionnement reel.
6. Prevoir le suivi d'utilisation des ressources, le rapport annuel et les obligations de restitution.

A titre de reference, la taxe annuelle Arcep d'un bloc standard de 1 000 numeros est de 20 euros. Ce n'est pas le prix d'une mise en exploitation : aucune interconnexion, collecte, assurance, supervision ni prestation technique n'est comprise.

### AF2M et APNF

1. Demander les Conditions Generales de Service SVA a l'AF2M et recevoir leur devis et dossier.
2. Verifier la version 2026 des recommandations deontologiques SVA.
3. Engager les demarches APNF et RSVA ainsi que les droits et acces necessaires, selon les exigences applicables.
4. Organiser les contacts fraude, incidents, litiges et controles d'editeurs.

Tarifs AF2M affiches a la date de verification : frais d'acces de 475 euros HT, abonnement annuel selon le nombre de numeros avec minimum de 100 euros HT. A confirmer par ecrit avant engagement, hors frais APNF et autres prestataires.

### Interconnexion, collecte et prestations techniques

Demander des propositions ecrites a des acteurs capables de fournir une interconnexion ou une collecte d'operateur exploitant, distincte d'une simple offre de souscription de numeros a l'unite.

Le dossier technique devra couvrir :
- routage national des 081, 082 et 089 autorises et tarifs de collecte ;
- capacite, SIP, TLS, DTMF, SBC, origination, destinations de secours et supervision ;
- mecanismes de portabilite, synchronisation du RSVA et prefixes de routage ;
- appels de test fixes et mobiles, qualite, indicateurs, SLA, incidents et fraude ;
- CDR avec identifiant unique, timestamps, duree facturee, corrections, export et reconciliation ;
- conditions des flux financiers, garantie et calendrier de reversement ;
- contrat de traitement de donnees, secret des communications, retention et securite ;
- procedure de sortie et migration operateur sans interruption client.

Ne pas considerer une connexion trunk SIP comme suffisante pour une collecte SVA et un contrat de gros.

### Paiements et comptabilite

1. Valider le schema juridique des fonds avec un conseil et un PSP specialise dans le marche SVA.
2. Distinguer dans le registre les montants factures aux appelants, les sommes effectivement collectees par les operateurs, la marge PGI, le net client et les contestations.
3. Interdire le decaissement tant que le reglement n'est pas confirme, le KYC valide et le profil PSP actif.
4. Conserver des justificatifs comptables exportables et relier chaque correction au CDR et au reglement d'origine.
5. Ne pas supposer que le compte bancaire PGI ou le module Stripe des abonnements est habilite a faire transiter des fonds de tiers.

## 4. Architecture cible compatible avec le site existant

La plateforme actuelle comporte deja les objets "tenants", "sva_numbers", "tenant_number_assignments", les profils KYC et financiers, les procedures de portabilite, la gestion des operateurs, la reconciliation et les controles SVA. Ces objets restent la source du parcours client actuel.

Evolutions futures seulement apres validation du schema et des contrats :
- registre des decisions Arcep et blocs attribues a PGI ;
- inventaire des numeros par bloc avec attribution et affectataire final distincts ;
- numero, categorie tarifaire, statut RSVA et historique non destructif ;
- workflow de reservation, KYC, validation, portabilite, activation et liberation ;
- roles "operateur attributaire", "operateur exploitant", "prestataire technique", "editeur" et "apporteur" representes separement ;
- rapprochement CDR / facture operateur / marge PGI / net client ;
- gestion des demandes de revendeurs sans sous-affectation interdite a un autre operateur.

Regles de migration :
- pas de modification du domaine public ou des CTAs existants ;
- aucun nouveau numero marque "attribue" ou "actif" par defaut ;
- aucune migration destructive ni changement de routage implicite ;
- nouveaux schemas et adaptateurs introduits de maniere additive uniquement apres revue ;
- toute future fonctionnalite directe desactivee par defaut et conditionnee a preuves reellement verifiees ;
- separation stricte des informations KYC, contrats, identifiants et secrets du depot Git.

Le module backend/src/direct-sva-operator-readiness.mjs est uniquement un evaluateur documentaire pur. Il n'est appele ni par le serveur, ni par un worker, ni par les paiements, ni par le frontend et ne peut activer aucune fonction de production. Ses preuves d'exemple n'etablissent aucun statut juridique.

## 5. Controles avant la premiere affectation PGI

| Controle | Preuve attendue | Etat au 10/10/2026 |
| --- | --- | --- |
| Entite juridique et responsabilites | SIREN, Kbis, contacts et responsabilites | Non verifie |
| Analyse du statut d'operateur | Avis juridique sur le modele exact | Non verifie |
| Identifiant CE | Confirmation Arcep | Non verifie |
| Ressources en numérotation | Decision Arcep pour les blocs | Non attribue dans ce dossier |
| AF2M | CGS et justificatifs de souscription | Non verifie |
| APNF et RSVA | Adherence, identifiants et procedure | Non verifie |
| Collecte et interconnexion | Contrats signes et recette technique | Non verifie |
| Portabilite | Procedure testee et interlocuteurs identifies | Non verifie |
| KYC, anti-fraude et transparence | Preuves par service et affectataire | Non verifie |
| Flux financiers de tiers | PSP ou mandat autorise et valide | Non verifie |
| Donnees et comptabilite | CDR, controle interne, rapprochements | Non verifie |
| Securite et continuité | Tests charge, failover, reprise, suivi | Non verifie |
| Revue de lancement | GO formel et preuves horodatees | Non verifie |

Un affichage technique vert ou une demonstration ne remplacent aucune preuve contractuelle ou reglementaire.

Consulter aussi docs/OPERATEUR-SVA-DIRECT-COMPTABILITE.md pour le plan de comptes provisoire, les controles debit/credit, la separation analytique et le futur raccordement au FEC legal unique.

## 6. Ordre de travail et risques

P0, avant toute signature : confirmer la structure juridique, la qualification d'operateur, les conditions d'attribution et le modele PSP. Ce sont les risques de blocage prioritaires.

P1 : obtenir les conditions ecrites des fournisseurs d'interconnexion et de collecte, les couts APNF/AF2M, les conditions de portabilite, les contraintes de traffic et de lutte contre la fraude.

P2 : finaliser le registre des blocs, les workflows d'affectation, les adaptateurs d'operateurs et les preuves documentaires sans perturber les clients existants.

P3 : simuler les appels, les CDR et les flux financiers dans un environnement de test isole avec donnees fictives, puis effectuer les recettes avec partenaires en environnement d'essai.

P4 : revue independante technique, juridique et financiere, tests de reprise, plan de retour arriere. Seulement alors proposer un passage controle en production, sur ordre explicite du proprietaire de PGI Telecom.

## 7. Ce qui n'a pas ete fait

- aucune demande d'identifiant CE et aucune demande d'attribution Arcep ;
- aucune signature ou souscription AF2M/APNF ;
- aucun accord d'interconnexion ou mandat PSP ;
- aucune attribution, reservation ou activation de numero ;
- aucun transfert ou decaissement de fonds ;
- aucune modification du site public, du domaine, du routage ou du backend en production ;
- aucun merge dans "main" et aucun deploiement Vercel.

Ces absences sont volontaires. La preparation documentaire et les tests logiciels n'autorisent pas une exploitation directe.

## Protection contre une activation incoherente et regles actualisees

Le controle preparatoire de l'operateur direct comporte des preuves documentaires supplementaires relatives :

- a l'etablissement des editeurs de SVA majores dans l'Espace economique europeen ou l'Association europeenne de libre-echange, avant toute affectation ;
- au nom et a la description du service, a l'identification du fournisseur et a son canal de reclamation ;
- a la tarification C+S, a la signaletique et au message gratuit d'information tarifaire avant facturation ;
- a l'application des recommandations deontologiques AF2M 2026, en vigueur depuis le 1er septembre 2026.

Ces preuves viennent s'ajouter aux autorisations d'operateur, ressources et contrats. Elles ne sont pas des preuves d'identite validees par le logiciel lui-meme : elles necessitent une verification humaine et contractuelle. Une fiche interne complete ne peut jamais autoriser une activation commerciale ni un paiement.

Les modules de lecture des controles operateur et d'integrations echouent maintenant explicitement si PostgreSQL signale une activation inattendue, au lieu de fabriquer un statut « desactive » dans la reponse.

Sources officielles consultees le 10 octobre 2026 :
- https://www.arcep.fr/mes-demarches-et-services/acteurs-regules/operateurs-telecoms/fiches-pratiques/operateurs-telecoms-affectation-des-numeros-de-telephone.html (version 23 septembre 2026).
- https://af2m.org/rd-sva/ (recommandations applicables au 1er septembre 2026).


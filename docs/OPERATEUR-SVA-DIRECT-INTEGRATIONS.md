# PGI Telecom : preparation des integrations du futur distributeur SVA direct

Etat : preparation sur branche GitHub uniquement, 10 octobre 2026.
Aucune migration Neon, modification d'un compte GA4, creation de propriete GSC, changement HubSpot, ni publication du site a ce stade.

## 1. Une entite legale, deux centres de profit

La personne morale de PGI Telecom exploite successivement ou parallelement :
- Audiotel Premium Pro : activite actuelle avec son systeme de services et ses partenaires.
- Distribution SVA directe : activite future, possiblement avec ses propres ressources de numerotation Arcep.

Les deux centres analytiques sont APP et DSVA. Le profil de comptabilite legale est UNIQUE et renvoie au parametrage platform_accounting_settings(id=1).

Les donnees operationnelles, grilles clients, couts techniques, marges, appels, contrats, releves, dossiers d'affectation et indices de revenus restent strictement rattaches a leur unite. Une personne peut etre commune dans le CRM, mais ses affaires commerciales doivent avoir des references et pipelines distincts.

**Ne pas creer de FEC supplementaire pour le centre DSVA au sein de la meme societe.** La future table de raccordement au grand livre legal possede une contrainte d'unicite sur l'ecriture source directe ; la copie comptable reste bloquee tant que le mapping n'a pas ete approuve par l'expert-comptable.

Tables : pgi_company_business_units, direct_sva_integration_readiness, direct_sva_statutory_accounting_bridge, direct_sva_crm_outbox_preparation.

## 2. Inventaire confirme sur les comptes existants

Google Search Console :
- Propriete domaine existante : sc-domain:audiotel-premium-pro.com.
- Aucune propriete de sous-dossier du distributeur n'a ete creee.

Google Analytics :
- Compte PGI : 409520461, propriete actuelle Audiotel : 556033345.
- Mesure GA4 actuelle : G-SZY50J75N7.
- Trois definitions personnalisees deja enregistrees : account_type, service_intent et lead_source.
- La dimension pgi_business_unit n'est pas enregistree sur cette propriete au moment de la verification ; le code en preparation emettra ce parametre uniquement apres le deploiement autorise.

HubSpot :
- Portail : 149417663.
- Champ de reference dossier PGI existant : pgi_dossier_ref.
- Le schema ne presente pas encore de champ et pipeline definitivement valides pour le metier "distribution directe".
- Aucun contact, affaire, champ, formulaire ou pipeline n'a ete cree ou modifie.

## 3. Strategie Google Analytics 4

Le moyen le plus net d'empecher le melange des sessions et du chiffre d'affaires est de disposer de deux proprietes GA4 :
1. Propriete existante 556033345 reservee a Audiotel Premium Pro.
2. Nouvelle propriete GA4 a creer avant le lancement du distributeur direct, avec son propre identifiant de mesure.

Les pages publiques du distributeur seront sous le chemin /distribution-sva/. La couche actuelle site/hubspot-tracking.js exclut deja ces futurs chemins et etiquettera ses evenements Audiotel pgi_business_unit=audiotel_platform. Les achats/reboursements verifies par Stripe sont egalement attribues a Audiotel dans le code du backend.

Le module site/direct-sva-tracking.js est autonome et n'est importe par AUCUNE page actuelle. Il ne peut etre initialise que si :
- chemin public commence par /distribution-sva/ ;
- l'identifiant appartient a une propriete dediee, differente de G-SZY50J75N7 ;
- la configuration de la propriete et les dimensions personnalisees ont ete confirmees ;
- le consentement analytique existe, sans Global Privacy Control ;
- le lancement juridique et le parcours ont ete approuves.

Consent Mode : aucun signal publicitaire autorise ; analytics_storage commence a denied, puis seulement apres consentement est mis a granted.

Evenements preparatoires :
- dsva_operator_interest
- dsva_number_request_started
- dsva_number_request_submitted
- dsva_portability_request_submitted
- dsva_contract_accepted
- dsva_number_activated

Champs autorises : pgi_business_unit, pgi_funnel_stage, pgi_service_type. Aucun email, telephone, numero de dossier, IP, numero d'appelant ou identifiant CDR. Les champs doivent etre enregistres comme dimensions event-scoped dans la nouvelle propriete avant reporting.

Aucun evenement purchase direct SVA ne sera cree sur la base d'un appel theorique ; l'attribution de recettes requiert une source collectee et rapprochee, et une comprehension exacte du modele financier et de TVA.

## 4. Strategie Search Console

La propriete domaine existante couvre naturellement les deux futurs ensembles de pages. Pour une analyse a part, demander ensuite une nouvelle propriete URL-prefix :
- https://audiotel-premium-pro.com/distribution-sva/

Il faut d'abord que cette adresse et ses pages existent et soient verifiables. GSC n'a aucune capacite a reserver un classement Google pour des pages inexistantes.

Architecture de contenu projetee :
- /distribution-sva/ : presentation de la distribution directe ;
- /distribution-sva/solutions/ : offre commerciale ;
- /distribution-sva/portabilite/ : service de portabilite direct ;
- /distribution-sva/integration/ : API et connectivite operateur si accessibles commercialement ;
- /distribution-sva/conformite/ : informations reglementaires exactes ;
- /distribution-sva/contact/ : dossier d'accompagnement.

Avant activation : aucune de ces URLs ne doit etre annoncee dans le sitemap, dans un lien public, dans un canonique actif ou une demande d'indexation. La propriete GSC URL-prefix devra etre creee et verifiee seulement lorsque le chemin existe.

Apres validation : sitemap distinct pour la rubrique, robots, canonicals, contenus non dupliques, donnees structurees fondees sur le service reel, performances web, journal des conversions par groupe de pages, suivi des requetes et des positions par ensemble. Ne jamais promettre ou inventer un classement.

## 5. Strategie HubSpot

Conserver le meme portail 149417663 pour la meme societe, en evitant de dupliquer les personnes.
Un contact peut etre rattache a plusieurs affaires, une par activite.

Le pipeline existant "default" et les etapes actuelles restent reserves au parcours Audiotel.

Pour le distributeur direct, preparer un pipeline NOUVEAU et distinct, avec etapes commerciales adaptees :
- prospect direct SVA ;
- qualification reglementaire et technique ;
- proposition contractuelle ;
- contrat signe ;
- dossier Arcep, affectation et routage selon eligibilite ;
- active apres preuves ;
- perdu/refuse/clos.

Les etapes et IDs finaux doivent provenir du pipeline reel HubSpot lors de sa creation. L'adaptateur logiciel refuse explicitement le pipeline "default" pour la future distribution.

Champs proposes, a creer apres validation du schema HubSpot :
- pgi_business_unit : enumeration audiotel_platform, direct_sva ;
- pgi_source_reference : reference metier unique, format DSVA-... ;
- pgi_sva_product_type : numeros, portabilite, interconnexion, distribution ;
- pgi_operator_onboarding_status : stade d'instruction et de preuves ;
- pgi_dossier_ref : reutiliser le champ existant plutot que le recreer.

Le formulaire HubSpot actuel et l'automatisation de deals Audiotel ne sont pas modifies. Les informations personnelles ne sont pas copiees dans un second contact sans besoin contractuel ou consentement pertinent.

Le module backend/src/direct-sva-integrations.mjs sait preparer un modele de deal specifique mais ne transmet rien. Le registre direct_sva_crm_outbox_preparation refuse send_enabled et hubspot_deal_id pendant la phase actuelle. Aucun jeton API HubSpot n'est consigne dans Git.

## 6. Cockpit et comptabilite

Le cockpit Comptabilite offre deux onglets :
- Activite Audiotel : logique existante, inchangée.
- Activite Distribution directe : module charge au clic, utilise seulement les tables direct_sva_*. Il comporte une vue integrateur read-only des statuts futurs.

Le rapport de distributeur affiche produits, charges, resultat provisoire, creances operateurs, dettes editeurs, brouillons et historique. Le pre-rapprochement des releves CDR reste sans ecriture ni paiement.

La comptabilite generale legale devra fusionner les ecritures directes validees UNE SEULE FOIS, sans compter les sommes reversees aux editeurs comme des recettes PGI lorsqu'elles ne le sont pas contractuellement.

Ne jamais apparenter l'abonnement Audiotel a une remuneration distributeur : les prix, frais, marges, comptes et clients sont distincts.

## 7. Ordre et preuves necessaires avant lancement direct

1. Dossier juridique de l'operateur, attribution Arcep et arrangements AF2M/APNF selon obligations.
2. Contrats de collecte, interconnexion, reseaux et protocole CDR authentifie.
3. Flux PSP, KYC, taxes et reversements approuves.
4. Mapping de comptabilite directe vers le grand livre legal unique et revue expert-comptable.
5. Propriete GA4 DSVA distincte, dimensions et parametrage de consentement en environnement de recette.
6. Nouvelle propriete Search Console de chemin apres mise en ligne des pages, sitemap et controle d'indexation.
7. Pipeline HubSpot dedie, proprietes confirmees, tests anti-doublons des contacts et affaires.
8. Tests de non-regression Audiotel, securite, habilitations, recette PostgreSQL, e2e et test d'appels.
9. Validation formelle "GO" et top depart specifique de l'utilisateur.

Aucune de ces etapes de connexion externe n'est automatisee ni declaree accomplie par une simple preparation GitHub.

## 8. Interdictions permanentes en phase preparatoire

- Aucun merge vers main ni deploiement Vercel.
- Aucun changement de production Neon.
- Aucun nouveau numero presente comme attribue.
- Aucun virement, reversement ou encaissement pour tiers active.
- Aucun evenement GA4 direct emis.
- Aucun deal HubSpot direct ni e-mail automatique direct cree.
- Aucune nouvelle URL commerciale DSVA mise dans un sitemap public.
- Aucune assimilation de deux sous-comptabilites a deux personnes morales.

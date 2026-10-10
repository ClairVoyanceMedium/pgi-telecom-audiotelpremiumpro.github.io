# PGI Telecom | Dossier de raccordement et de mise en production SVA

Version : 10 octobre 2026. Source : branche de préparation `prep/pgi-direct-sva-operator-2026-10-10`. **Aucune autorisation d'exploitation réelle ni de déploiement n'est implicite.**

## 1. Contrat d'architecture : un seul client, une seule société

La plateforme historique Audiotel Premium Pro demeure la référence canonique des clients existants : `tenants.id`, `tenant_number_assignments.id`, `sva_numbers.id`, E.164, identifiants d'authentification, historiques d'appels, factures, règlements et règles de remise à zéro Business Live.

La future distribution SVA directe est une nouvelle unité analytique de la même entité juridique, avec des données contractuelles, opérateurs et financières cloisonnées. Les sommes encaissées pour compte de tiers ne doivent pas être automatiquement reconnues comme chiffre d'affaires PGI.

Ne jamais créer de nouveaux comptes clients pour accompagner un simple changement technique de prestataire. Une portabilité confirmée conserve le numéro dans la mesure où les conditions légales et techniques sont satisfaites, sans promesse de coupure nulle.

## 2. Inventaire des composants préparés

| Domaine | Code et frontière | Statut |
| --- | --- | --- |
| Catalogue de l'activité | `site/distribution-sva/` ; pages accueil, solutions, conformité, Business Live, conservation des numéros et portail | Rédigé, noindex, absent du site public |
| Cockpit distributeur | `assets/direct-sva-cockpit.js`, `assets/direct-sva-switches.js` | Préparation privée derrière autorisation admin |
| Bascule de prestataire existant | `assets/direct-sva-transitions.js`, `backend/src/direct-sva-customer-transition.mjs` | Plans documentaires seulement |
| PostgreSQL | Migrations 073 à 077 | À appliquer sur base de recette isolée avant revue de déploiement |
| Business Live | `backend/src/direct-sva-business-live-continuity.mjs` | Consolidation future, sans liaison à un CDR opérateur réel |
| Revenus | `backend/src/direct-sva-reconciliation.mjs` et sous-journal direct | Pré-rapprochement uniquement, aucun paiement |
| Cockpit de lancement | `backend/src/direct-sva-production-readiness.mjs` | Diagnostic read-only, commercial toujours bloqué |
| Portail client | `site/distribution-sva/espace-client/` | Bloqué, aucune inscription libre |
| Automatisations | Treize workflows documentés et verrouillés | Aucune exécution externe |
| CRM et analytics | Propriétés cibles HubSpot, GA4, GSC | Aucun flux direct autorisé |

## 3. Pré-requis exigibles du futur opérateur, prestataire de collecte ou partenaire SIP

Recevoir la documentation signée et versionnée sur les rôles respectifs : opérateur attributaire, opérateur exploitant, opérateur de transport, collecteur SVA, prestataire de portabilité. Les habilitations et droits d'usage des ressources Arcep et des processus AF2M/APNF/RSVA doivent être vérifiés. Une simple connexion SIP ne prouve aucune capacité de collecte ou de portabilité.

Spécification d'interface demandée, sans présumer de l'existence d'une API :

- protocole (API HTTPS authentifiée, fichier SFTP signé ou service dédié), modalités d'authentification, rotation des clés et mécanisme de révocation ;
- numéros E.164, références de portabilité, horodatage exact de la prise d'effet et source faisant foi ;
- plan de routage, réseau de secours, fenêtres de maintenance, procédures d'alerte et retour opérationnel ;
- CDR uniques, identifiant du prestataire, sens, appel démarré/terminé, durée facturable et admissible au reversement, devise, référence d'époque contractuelle, corrections et annulations ;
- contrat tarifaire versionné (appelant, mobile, coût technique, frais fixes, reversement PGI, reversement éditeur) avec dates de validité ;
- relevés amont (prévisionnel, confirmé, effectivement payé), rapprochement des paiements, contestations, impayés et retenues ;
- SLA mesurables, escalade fraude et incidents, maintenance, continuité, plan de réversibilité et durées légales de conservation.

**Interdiction de fabriquer un CDR, un paiement ou une référence opérateur lorsque le prestataire ne l'a pas fournie.** Les adaptateurs doivent refuser les flux incomplets ou contradictoires plutôt que calculer des chiffres fictifs.

## 4. Cycle complet de migration des clients déjà abonnés

1. Cartographier le numéro et les permissions de l'affectataire avec l'hébergeur actif.
2. Enregistrer une révision non modifiable du plan par numéro sans modifier le routage.
3. Vérifier le mandat, l'information contractuelle due, la tarification, le statut réglementaire et l'éligibilité à la portabilité.
4. Recetter la nouvelle collecte hors production, avec un modèle de CDR différent par contrat et par prestataire.
5. Confirmer la date réseau réellement appliquée par les parties habilitées et préserver les appels déjà engagés.
6. Appliquer les traitements financiers au contrat en vigueur à la date de l'appel, puis rapprocher chaque CDR une seule fois.
7. Présenter les résultats au même client PGI dans la synthèse Business Live sans afficher inutilement les détails d'interconnexion interne.
8. Ne solder l'ancien opérateur qu'après clôture des relevés, corrections et obligations de restitution ou de réclamation.

Une migration réseau effectuée ne s'annule pas par une simple contre-migration de base SQL. Le plan de retour arrière doit être contractualisé et validé avant la bascule.

## 5. HubSpot, GA4 et Search Console

**HubSpot** : même portail de société, propriétés `pgi_business_unit` et `pgi_source_reference` propres à la nouvelle activité, pipeline indépendant, pièces KYC jamais répliquées dans des champs marketing, règles anti-doublons de contact, suppression des secrets dans les journaux, aucune synchronisation sans consentement/base légale appropriée et configuration vérifiée.

**Google Analytics 4** : propriété spécifique, dimensions autorisées et approuvées, consentement valide, événements contractuellement nommés, déduplication des conversions. Ne pas envoyer e-mail, téléphone, numéro SVA, identifiant client, référence de dossier, RIO ou CDR. Le trafic Audiotel existant doit rester attribué à sa propriété historique.

**Search Console** : le domaine parent reste valide ; préparer une propriété URL-prefix pour `/distribution-sva/` si utile aux rapports, des canonicals et un sitemap isolés, puis ne demander l'indexation qu'après levée des barrières commerciales et publication effective. Ne jamais exposer le portail client aux robots.

## 6. Paiements, comptabilité et protection de la trésorerie

L'abonnement de plateforme, les éventuels services CB complémentaires et les recettes SVA de tiers sont des flux juridiques séparés. Les webhooks Stripe d'abonnement ne constituent pas la preuve du règlement opérateur SVA, ni une autorisation de distribuer des fonds de tiers.

Pour tout reversement automatisé ultérieur, exiger ensemble :

- source du relevé opérateur authentifiée et CDR dédupliqué ;
- période et montant confirmés, versement réellement encaissé puis vérifié en banque ;
- contrat éditeur et droits de paiement, KYC/KYB à jour, bénéficiaire et mandat PSP autorisés ;
- montant PGI et client rapprochés, absence de contestation ou d'impayé bloquant ;
- contrôle de l'unicité du paiement et référence idempotente non réutilisable ;
- pièces justificatives, historisation de la décision et lien unique vers le journal comptable.

Ne pas confondre sous-journal analytique et FEC légal ; validation du plan de comptes, TVA et schéma de reconnaissance du chiffre d'affaires par un professionnel qualifié. Aucune duplication des écritures entre Audiotel et distribution directe.

## 7. Sécurité et observabilité

- Sessions client existantes préservées ; aucune inscription directe libre.
- Contrôle d'autorisation serveur par client, protection CSRF sur les écritures, principe de moindre privilège.
- Historique append-only des préparations et décisions, séparation des opérations de préparation et d'exécution réseau.
- Contrôle d'état des interrupteurs en base : anomalie = blocage, jamais statut rassurant fabriqué.
- Supervision : fraîcheur des CDR, doublons, dérive des taux ASR/ACD, incidents SIP, variances financières, échecs webhook, latence du Business Live, erreur d'accès croisé entre clients.
- Sauvegardes vérifiées avec exercices de restauration en environnement de recette, registre de secrets hors dépôt, surveillance des accès et changements d'autorisation.
- Alerte immédiate au cockpit si l'activité commerciale paraît activée sans preuve. Les états doivent être dérivés des systèmes de référence, pas du texte de présentation.

## 8. Séquence de décision avant production

1. Vérifier les autorisations et justificatifs réglementaires, contrats, publication légale, KYC et PSP ; ce sont des conditions externes non remplaçables par le logiciel.
2. Renseigner l'identité juridique, le SIREN, le régime TVA et le mapping comptable réel ; ne pas inventer ces données.
3. Exécuter les migrations sur une branche Neon isolée et vérifier les déclencheurs SQL réels, index, transactions, permissions et retour arrière.
4. Exécuter la suite `npm run verify` sur le dernier commit et contrôler les journaux réels. Des tests écrits ne prouvent pas qu'ils ont réussi.
5. Recetter le parcours bout en bout avec les interfaces opérateur et paiement, y compris doublons, panne, litiges, notifications et portage impossible.
6. Vérifier le contenu juridique du site, le consentement Analytics, les formulaires, le CRM, les politiques de confidentialité et les fiches tarifaires réelles.
7. Vérifier le monitoring, les alertes, les sauvegardes et les procédures de gestion d'incident.
8. Après ordre explicite du propriétaire et constat GO validé, ouvrir uniquement les fonctionnalités autorisées dans une release approuvée.

## 9. Informations restant indispensables

- Entité juridique de PGI réellement vérifiée, SIREN et fiscalité.
- Décision d'attribution / cadre opérateur, AF2M, APNF/RSVA.
- Fournisseur de collecte/interconnexion, spécifications et contrats signés.
- Grille de reversements, échantillons CDR officiels et règles de correction.
- PSP habilité, schéma des fonds de tiers et rapprochement bancaire.
- Consentement / informations contractuelles et règles de portabilité par numéro.
- IDs et consentements vérifiés HubSpot/GA4/GSC à créer ou paramétrer dans l'activité directe.
- Recette, dossier de preuve indépendant et autorisation de lancement.

La formule « il ne restera que les branchements » ne serait donc pas exacte à ce stade. Le logiciel peut réduire le travail restant, pas délivrer les autorisations, contrats, clés et preuves réelles.

## 10. Références institutionnelles

- Arcep, affectation des ressources, version du 23 septembre 2026 : https://www.arcep.fr/mes-demarches-et-services/acteurs-regules/operateurs-telecoms/fiches-pratiques/operateurs-telecoms-affectation-des-numeros-de-telephone.html
- Arcep, options de qualité renforcée et conservation des numéros spéciaux : https://www.arcep.fr/actualites/actualites-et-communiques/detail/n/portabilite-des-numeros-210323.html
- AF2M, recommandations déontologiques SVA applicables au 1er septembre 2026 : https://af2m.org/rd-sva/


## 11. Etat verifie des integrations le 10 octobre 2026 (lecture reelle)

Cette section de suivi est un inventaire ponctuel. Les situations peuvent changer ; aucun des controles ci-dessous n'autorise une mise en production.

| Systeme | Observation verifiee | Consequence |
| --- | --- | --- |
| Neon production | Aucune table `direct_sva_%` en production ; migrations existantes jusqu'a 071 | Ne pas declarer le distributeur deploye |
| Neon preparation | Branche `prep-direct-sva-integration-2026-10-10` ; migrations 072 a 079 executees et enregistrees dans le registre isole ; 25 tables `direct_sva_%`, 10 triggers et 132 contraintes CHECK | Base isolee prete pour revues supplementaires, pas une preuve de fonctionnement des partenaires |
| Verrous de lancement | `commercial_operation_enabled=false`, `number_activation_enabled=false`, `payouts_enabled=false`, six connecteurs directs sur `disabled` | Aucun acte commercial, routage ou versement autorise |
| GitHub | Migration 077 corrigee : regex E164 entiere et retrait du bloc SQL duplique ; assertion specifique ajoutee au test d'integrite | Le code correctif reste dans la branche de preparation |
| Stripe | Compte principal en mode reel present ; prix recurrent Audiotel 4,90 EUR actif ; webhooks Audiotel actifs ; zero compte beneficiaire Connect liste | Ne pas confondre abonnements avec collecte SVA ou reversements editeurs |
| HubSpot | Portail actuel accessible ; pipeline de deals `default` seul observe ; `pgi_business_unit` et `pgi_source_reference` absents des proprietes verifiees | Creation d'un pipeline DSVA et de ses proprietes avant toute transmission |
| Resend | Domaine existant verifie, envoi et reception actifs ; webhook `email.received` actif | Le futur canal de reclamations direct reste a valider avec un flux reel bout en bout |
| Search Console | Domaine existant ; groupe de contenu analytique cree et propriete URL-prefix `https://audiotel-premium-pro.com/distribution-sva/` creee et enregistree mais non activee dans GSC Wizard | Aucun ajout au sitemap, aucune publication ni demande d'indexation |
| Comptabilite | Identite legale et SIREN non renseignes dans `platform_accounting_settings` ; `vat_regime=unconfigured`, `fec_enabled=false` | Unification comptable legale et mapping TVA a completer |

**Pas de changement Vercel, pas de migration Neon sur la branche de production, pas de creation d'abonnement, d'encaissement ni de virement Stripe.** La creation du groupe de contenu GSC n'indexe pas les futures pages.

## 12. Actions externes restant necessaires

1. **Operateur / collecteur** : choix d'un partenaire technique, contrat, grilles tarifaires versionnees, CDR de reference, preuves de collecte, portabilite et routage. Aucun fournisseur ni numeros ne sont declares actifs en leur absence.
2. **PSP / reversements editeurs** : determination contractuelle de l'encaisseur, du beneficiaire, des obligations KYC/KYB, du circuit des fonds, des avis de paiement amont et des regles de rapprochement bancaire. Les webhooks de l'abonnement Stripe existant ne sont pas la preuve des recettes SVA.
3. **HubSpot** : configurer pipeline et proprietes independants apres verification du portail, puis conserver l'identite du contact transversal avec une affaire par activite.
4. **GA4** : creer et confirmer une propriete distincte, son identifiant de mesure et les dimensions event-scoped, sans parametres personnels. La future activation reste conditionnee au consentement et au lancement autorise.
5. **Comptabilite** : completer denomination, SIREN, fiscalite et comptes sur justificatifs, definir un FEC legal unique avec axes APP et DSVA et interdire la double reconnaissance des recettes.
6. **Validation finale** : recueillir les preuves de conformite, verifier le reseau, les evenements et les restitutions, puis attendre le top depart explicite pour autoriser les actes commerciaux.

Les connexions externes ne doivent pas se declarer automatiquement « actives » sur la seule base des fichiers de preparation. La base et le backend rejettent toujours les activations SVA directes tant que les approbations sont absentes.

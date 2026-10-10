# PGI Telecom : séparation permanente des deux activités

État : préparation technique du 10 octobre 2026. Ce document décrit la convention de nommage du projet, pas une autorisation d'exploitation.

## 1. Noms officiels à conserver

La société et son environnement informatique restent PGI Telecom. Elle comporte **deux activités commerciales séparées** :

| Rôle | Première activité, inchangée | Deuxième activité, en préparation |
| --- | --- | --- |
| Nom public | **Audiotel Premium Pro** | **PGI Telecom Distribution** |
| Identifiant technique stable | `audiotel_platform` | `direct_sva` |
| Centre analytique | `APP` | `DSVA` |
| Parcours Internet | Accueil et pages actuelles de `audiotel-premium-pro.com` | Futur parcours `/distribution-sva/` |
| Relation client | Services SVA proposés par les partenaires de l'activité actuelle | Distribution et exploitation SVA futures, après raccordement des opérateurs |
| Tarification | Abonnement actuel 4,90 EUR TTC/mois ; portabilité prioritaire facultative 9,90 EUR TTC ponctuels | Tarifs distributeur distincts, jamais copiés par défaut |
| Commercialisation | Parcours existant à préserver | Non ouverte et techniquement bloquée |
| Suivi | Relevés, Business Live et historique de l'activité actuelle | Business Live et relevés futurs provenant uniquement de sources opérateurs vérifiées |

**Règle impérative : le nom Audiotel Premium Pro ne doit jamais être remplacé, corrigé ni fusionné avec celui de PGI Telecom Distribution sur le site actuel ou dans l'espace client actuel.**

Les anciens noms descriptifs `Distribution SVA directe`, `distribution directe` et `distributeur direct` restent admissibles pour expliquer une fonction technique, un modèle contractuel ou un texte descriptif, **mais ils ne remplacent plus le nom commercial PGI Telecom Distribution dans les titres, logos textuels, entêtes, pieds de page, menus et CRM de la deuxième activité.**

## 2. Autonomie de l'activité distributeur

- Deux présentations commerciales et deux parcours contractuels, avec tarification et pièces justifiant les services indépendantes.
- Un **seul dossier client PGI Telecom** et un identifiant d'authentification conservé. Ne pas réinscrire les clients existants pour la migration technique ; attribuer des droits distincts par activité.
- Deux inventaires de numéros et deux flux de données d'appels. Une transition d'hébergement ne réécrit ni les appels antérieurs ni leurs règlements, ni les dates de remise à zéro.
- Les revenus, reversements, retenues, frais opérateur, marges et indicateurs financiers sont attribués à leur unité métier. Ne jamais afficher une estimation comme un paiement confirmé.
- Un compte légal et un FEC de la société lorsque les activités appartiennent à la même personne morale ; **deux analyses de rentabilité** distinctes et un rapprochement de chaque source justificative.
- HubSpot peut conserver un contact commun, mais les affaires, références, produits et pipelines distributeur doivent être séparés. Les propriétés et le pipeline futurs ne sont pas encore déployés.
- Google Analytics 4 : propriété spécifique à PGI Telecom Distribution à configurer avant émission. GSC : propriété URL-prefix de préparation créée pour `/distribution-sva/`, publication et indexation non autorisées à ce stade.
- Stripe : les abonnements Audiotel, les paiements CB complémentaires et la rémunération de la distribution SVA ne constituent pas un même flux. Les reversements SVA exigent collecte démontrée, rapprochement, contrats et schéma PSP habilité.
- Les réclamations doivent suivre la bonne activité, avec acheminement Gmail et suivi HubSpot sans mélange des tickets, et sans réponse automatique prétendant disposer d'une autorisation absente.

## 3. Convention technique de nommage

Les clés persistantes `audiotel_platform`, `direct_sva`, les chemins `/distribution-sva/`, les tables `direct_sva_*` et les identifiants d'API **ne sont pas renommés** par ce chantier de marque. Ils assurent la compatibilité avec les structures, références, données et tests existants.

Les changements portent uniquement sur les libellés affichés propres à la deuxième activité :
- pages et documents préparatoires sous `site/distribution-sva/` ;
- onglet privé du cockpit, sous-journal et écrans de préparation ;
- libellés de pipelines et d'affaires de la deuxième activité lorsque ceux-ci seront créés ;
- profil `direct_sva` du registre `pgi_company_business_units` ; migration **080** réservée à cette seule ligne.

La migration 080 conserve la ligne `audiotel_platform` exactement telle quelle. L'activation commerciale du distributeur reste `false`. Le compte bancaire, le compte Stripe et le centre juridique commun ne confondent pas les recettes.

## 4. Verrous et non-régression

Avant chaque lancement :
1. Exécuter `node --test tests/direct-sva-brand-isolation.test.mjs`, puis les tests de non-régression et l'ensemble `npm run verify`.
2. Vérifier les deux noms publics sur leurs propres pages et le titre comptable Audiotel dans le cockpit.
3. Vérifier séparément les règles de consentement GA4, les pipelines CRM, les canaux de support, les transactions Stripe et les références de rapprochement.
4. Confirmer que les contraintes SQL empêchent l'activation de numéros, l'exploitation commerciale et le versement des fonds de tiers avant autorisations et recettes.
5. Respecter la consigne permanente : **aucun déploiement Vercel, aucune fusion vers `main` et aucune migration de production sans top départ explicite**.

## 5. État de mise en œuvre

La branche de préparation contient le nouveau nom de la deuxième activité dans les pages, les éléments privés de cockpit, le module d'intégrations et la migration 080. La base de recette Neon, indépendante de la production, sert à valider les migrations.

L'activité actuelle **Audiotel Premium Pro** n'est pas renommée. L'activité **PGI Telecom Distribution** ne propose toujours pas de numéros, n'encaisse pas de revenus SVA et ne verse pas de fonds aux éditeurs tant que les partenaires et autorisations ne sont pas établis.

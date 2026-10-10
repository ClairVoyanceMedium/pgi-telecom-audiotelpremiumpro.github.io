# PGI Telecom Distribution : Pôle Télécom & Réseau
## Préparation SEO, GEO, recherche vocale et internationale

**État au 10 octobre 2026 : préparatoire uniquement. Aucun déploiement ni indexation autorisés.**

### 1. Séparation entre les deux activités

- **Audiotel Premium Pro** : activité actuelle de souscription et gestion commerciale des numéros surtaxés, inchangée.
- **PGI Telecom Distribution** : dénomination technique et opérationnelle de l'activité future.
- **Pôle Télécom & Réseau** : appellation éditoriale du lien discret situé sous « Se connecter à mon espace client » et de la page d'accueil propre au futur pôle.
- Toutes les nouvelles pages se trouvent sous `/distribution-sva/` dans la branche `prep/pgi-direct-sva-operator-2026-10-10`.
- Le lien sur la page Audiotel conserve `hidden` ; les chemins du pôle renvoient 404 dans le serveur ; les fichiers ne font pas partie de la liste de publication statique ; aucune page du pôle ne figure au sitemap commercial.

### 2. Pages réellement préparées

**16 pages en français**, dont les dix précédentes : accueil, solutions, Business Live, transition, conformité, espace client privé, réclamations, conditions, mentions légales et confidentialité.

**Six pages éditoriales détaillées créées :**
1. `/distribution-sva/architecture-reseau/` : rôle des opérateurs, supervision, incidents et continuité.
2. `/distribution-sva/numerotation/` : droits, cycle de vie, affectation et portabilité SVA.
3. `/distribution-sva/interconnexion-routage/` : interfaces, destinations, tests et reprise.
4. `/distribution-sva/releves-reversements/` : CDR, rapprochement, encaissement et paiements.
5. `/distribution-sva/partenaires/` : opérateurs, éditeurs, contrats et responsabilité.
6. `/distribution-sva/questions-frequentes/` : réponses directes, utiles aussi aux recherches conversationnelles et vocales.

**20 pages internationales préparées**, dans cinq langues : `/en/`, `/es/`, `/pt/`, `/de/` et `/it/`, avec les sous-pages `solutions/`, `faq/` et `partners/` pour chacune.

Pour le référencement des langues, les trois pages françaises accueil, solutions, questions fréquentes et la page partenaires possèdent leurs annotations alternates réciproques avec les homologues internationales. Chaque groupe comprend `x-default` pointant vers sa page française, ainsi qu'une URL canonique propre à chaque langue. Les traductions sont rédigées avec leurs titres, textes, FAQ et menus propres, sans simple substitution du bandeau. La navigation propose explicitement les autres langues ; aucune redirection par adresse IP ou langue présumée.

### 3. SEO technique

- HTML sémantique : un `h1` par page, titres et descriptions propres, liens internes textuels, questions/réponses en `details/summary`, fil conducteur entre le site et les dossiers.
- Données structurées `WebPage` et `BreadcrumbList` là où elles sont ajoutées ; les informations déclarées correspondent au contenu visible. Pas d'avis, d'étoiles, de partenaires ni de ressources télécom inventés.
- Certaines anciennes pages comportent déjà canonique et description mais leurs mentions juridiques et coordonnées resteront à vérifier au lancement.
- Le portail client `/espace-client/` est non indexable **y compris après l'ouverture** ; il n'a pas besoin d'URL canonique publique.
- Le module `scripts/direct-sva-seo-plan.mjs` inventorie **36 pages** et produit un projet de sitemap multilingue **uniquement après sept autorisations explicites**. Les **35 pages publiques** y seraient éligibles ; l'espace client reste exclu.
- Le sitemap direct ne doit pas être ajouté au sitemap Audiotel ou soumis à Search Console tant que les pages ne sont pas publiées et renvoient 200.

### 4. GEO et visibilité dans les moteurs de réponse IA

La qualité, l'originalité et la vérifiabilité de l'information restent prioritaires. Aucune méthode ne garantit l'apparition dans ChatGPT, Gemini, Perplexity ou les Aperçus IA.

Les pages doivent répondre à des intentions précises : différences entre SVA et distribution, conditions d'attribution, fonctionnement d'une interconnexion, sécurité, rapprochement des CDR, continuité des comptes et obligations des partenaires. Chaque réponse doit renvoyer à son contenu détaillé, sans chiffres ni allégations techniques non prouvés.

Après lancement, compléter les contenus avec :
- des références vérifiées aux textes et décisions applicables (Arcep, AF2M, APNF selon le cas) et une date de vérification ;
- des informations officielles sur le rôle juridique de PGI, les opérateurs et les partenaires réellement contractés ;
- des guides originaux sur les procédures et interfaces effectivement disponibles ;
- des exemples chiffrés uniquement vérifiables, clairement identifiés comme hypothétiques s'ils sont simulés ;
- un contact professionnel authentifié et une identité éditoriale responsable.

**Ne pas créer de faux témoignages, de fausses études de cas ou de faux partenariats.** Google n'exige pas de nouveau fichier spécial « GEO », « IA » ou de balisage dédié pour figurer dans ses réponses générées. Les fondamentaux du SEO restent essentiels.

Références officielles :
- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
- https://developers.google.com/search/docs/specialty/international/localized-versions

### 5. Recherche vocale et assistants conversationnels

- Contenu lisible et direct dans le HTML : une question naturelle suivie d'une réponse concrète.
- Lisibilité sur téléphone, navigation au clavier, titres explicites et textes non dissimulés dans des animations.
- Page FAQ dédiée dans six langues ; questions concernant la disponibilité, la conservation des numéros et la différence entre montants estimés et encaissés.
- Aucun balisage `speakable` artificiel ni `FAQPage` présenté comme une garantie de résultat enrichi : Google restreint l'affichage enrichi des FAQ selon les catégories de site.
- Les performances réelles doivent être évaluées par des recherches tests, la Search Console, les conversions et l'expérience utilisateur, pas par des déclarations de classement.

### 6. Préparation internationale sans promesse infondée

Le référencement multilingue **ne crée aucun droit** de vendre des numéros SVA ou d'exploiter un réseau dans un autre pays. Les versions internationales décrivent le **projet français** et la possibilité de **futurs échanges techniques B2B**. Avant l'ouverture commerciale dans un pays, documenter ses règles de numérotation, de tarification, de fiscalité, de protection des données, de médiation et de paiement.

Les pages de partenaires n'acceptent pas de contrats ou de demandes de souscription ; le canal CRM réservé n'est pas actif. Les informations de conformité françaises sont accessibles par un lien identifié, sans se faire passer pour des CGV locales.

Une expansion future peut ajouter de nouvelles langues ou des versions régionales `hreflang` spécifiques seulement avec un contenu et des conditions réellement adaptés au territoire.

### 7. Image d'accueil validée

Le visuel approuvé est le photomontage monochrome à compartiments diagonaux : relais télécom, réunion technique, homme en casque de chantier devant la cartographie réseau, bureau/serveurs, avec le logo Audiotel Premium Pro en haut à droite. L'original validé a été conservé dans cette conversation ; une version WebP optimisée est préparée dans l'environnement de travail.

**Point d'intégration non terminé :** ce binaire n'a pas encore été ajouté au dépôt GitHub. Ne pas déclarer la photo visible sur la future page tant que l'actif n'est pas transféré dans `assets/`, référencé dans le HTML, ajouté au manifeste d'assemblage, et testé sur mobile avec dimensions explicites, `alt` descriptif et `fetchpriority` mesuré.

Ne jamais utiliser une image inventant une salle de supervision ou un réseau réel comme preuve de capacité opérationnelle : photo illustrative et affichage distinct du statut réel.

### 8. Mesures et conversions, activité distincte

- Propriété GA4 dédiée Distribution, **distincte** de la propriété Audiotel existante.
- Le chargeur `site/distribution-sva/site.js` prépare une mesure commune aux pages traduites uniquement après validations de publication, de propriété dédiée et du cadre légal. Le module `measurement.js` maintient le contrôle des autorisations et du consentement.
- Événements futurs : affichages de sections, changements de langue, consultations de guides, clics vers les informations partenaires, lectures FAQ et parcours d'accès client, uniquement dans le cadre légal applicable.
- Ne jamais transmettre noms, emails, numéros appelants, identifiants de CDR ou données de réclamation à GA4.
- HubSpot : prévoir un pipeline, une source et des propriétés `pgi_business_unit=direct_sva`, `language`, `landing_path`, `request_type` dédiés. L'envoi CRM ne devient réel qu'après vérification de l'API, des permissions, des formulaires et de la base légale.
- Search Console : segmenter par répertoire / langue et contrôler couverture, requêtes, clics, impressions, taux de clic, pays et pages indexées.
- Mesurer aussi Core Web Vitals, navigation mobile, anomalies de crawl, réponses des assistants IA issues d'expériences reproductibles, leads B2B qualifiés et qualité de traduction. Ne pas confondre présence IA et conversion réelle.

### 9. Conditions de publication et tests

Le générateur `scripts/direct-sva-seo-plan.mjs` refuse de produire un sitemap sans **les sept validations** :
1. `explicit_business_release`
2. `legal_publication_approved`
3. `telecom_contracts_verified`
4. `numbering_rights_verified`
5. `content_language_reviewed`
6. `technical_production_checks_passed`
7. `seo_indexation_authorized`

Tests créés :
- `tests/direct-sva-international-seo.test.mjs` : inventaire des pages, cohérence des titres et canoniques, `hreflang` bidirectionnel, données structurées, contenu, sécurité de publication.
- `tests/direct-sva-seo-plan.test.mjs` : non-publication par défaut, refus avec toute validation manquante, sitemap hypothétique avec 35 URL publiques et exclusion permanente du portail client.

Après autorisation de lancement, une **modification de déploiement distincte** devra encore : autoriser le chemin côté serveur, assembler les pages, valider les traductions et textes légaux, charger le vrai visuel, générer les pages d'indexation, appliquer les en-têtes corrects, contrôler HTTPS/CSP, déclarer les sitemaps, et vérifier les flux réels. **Ces étapes ne sont pas effectuées.**

### 10. État final de cette préparation

Les sources enrichies et le module de planification sont **enregistrés sur la branche de préparation uniquement**, sans modification du site Audiotel en production. Tests de source et de cohérence possibles ; la suite Node et les essais réels de crawl, traduction humaine, indexation Search Console et visite de production restent nécessaires pour qualifier le lancement.

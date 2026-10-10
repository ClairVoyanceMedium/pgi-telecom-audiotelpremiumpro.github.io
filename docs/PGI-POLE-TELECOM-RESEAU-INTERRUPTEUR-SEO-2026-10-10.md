# Pôle Télécom & Réseau : interrupteur de visibilité, protection du SEO

**10 octobre 2026 | Développement préparé seulement | Aucun déploiement Vercel ni activation commerciale**

## Choix de conception

Il n'existe pas de méthode sûre permettant à la fois de rendre une page durablement inaccessible à tout visiteur et de conserver son indexation et sa place sur les moteurs de recherche. Google recommande de maintenir les pages et de limiter les fonctions commerciales lors d'une pause, plutôt que de fermer tout le site : https://developers.google.com/search/docs/crawling-indexing/pause-online-business?hl=fr

Le cockpit possède donc trois contrôles réellement différents :

1. **Interface PGI Telecom Distribution** : affiche ou masque le cockpit interne de préparation, sans effet public.
2. **Afficher le Pôle Télécom & Réseau sur le site** : contrôle exclusivement le lien dans l'en-tête Audiotel, sous la connexion client. Si le pôle a été préalablement publié, un arrêt du lien laisse **les 35 pages publiques consultables**, les URLs canoniques et le sitemap intacts.
3. **Exploitation commerciale** : toujours bloquée par les contrôles réglementaires, techniques et financiers. Le bouton de visibilité ne doit jamais attribuer un numéro, lancer des paiements ou rendre un espace client actif.

## États HTTP après approbation préalable de la publication

| État éditorial | Lien accueil | Pages d'information | Balise robots | Sitemap | Commercial |
|---|---|---|---|---|---|
| Avant publication approuvée | Caché | 404, même si « afficher » coché | noindex | Non disponible | Bloqué |
| Publié, lien visible | Visible | 200 | index,follow | 200, 35 URL | Bloqué séparément |
| Publié, lien caché | Caché | 200, message discret de suspension | index,follow | 200, mêmes 35 URL | Bloqué séparément |
| Échec de lecture de la configuration | Caché | 503 temporaire, Retry-After 300 s | Pas de noindex forcé | 503 | Bloqué |

En permanence, la page `/distribution-sva/espace-client/` et les autres chemins non expressément autorisés renvoient 404. Les chemins directs vers `/site/distribution-sva/.../index.html` restent inaccessibles et ne créent aucun doublon canonique.

**Aucune garantie de classement** : les moteurs modifient leurs résultats selon de nombreux facteurs. Le mécanisme évite les causes techniques évidentes de désindexation liées au basculement du menu.

## Fichiers préparés sur la branche GitHub

- `database/migrations/084_direct_sva_website_visibility.sql` : préférence de navigation persistante, audit append-only, **interdiction SQL explicite d'autoriser la publication** avant une future migration distincte.
- `backend/src/direct-sva-website-visibility.mjs` : lecture déterministe et mise à jour transactionnelle du réglage, validation stricte de l'état attendu, rôle administrateur.
- `backend/server.mjs` : lecture admin `GET /api/v1/platform/direct-sva-website` et enregistrement CSRF `POST /api/v1/platform/direct-sva-website/navigation`.
- `assets/direct-sva-switches.js` : troisième interrupteur dans le cockpit, confirmation de l'activation et messages pédagogiques SEO.
- `backend/src/direct-sva-public-site.mjs` et `backend/src/static-site.mjs` : liste blanche des 35 pages, route sitemap, transformation du `noindex` uniquement après publication séparée, injection du lien dans l'accueil, lecture accessible lorsque la navigation est cachée.
- `scripts/build-static.mjs` : emballage des pages internationales et des ressources sous un serveur bloquant en prépublication. Le simple fait d'embarquer les fichiers ne les rend pas accessibles.
- `Dockerfile.vercel`, `Dockerfile`, `infra/Dockerfile.platform` : inclusion de la liste SEO nécessaire au serveur, empêchant l'échec de démarrage lors d'une prochaine compilation.
- `tests/direct-sva-website-visibility.test.mjs` : tests unitaires, contrôles du sitemap et scénario HTTP futur.

## Migration Neon

**Appliquée uniquement sur la branche de staging `br-wild-meadow-auuv4k65`** du projet `silent-waterfall-98567339`. État constaté après migration :

- `public_content_authorized=false`
- `navigation_enabled=false`
- `commercial_calls_to_action_enabled=false`
- aucun audit de changement administrateur
- migration 084 enregistrée avec somme de contrôle.

**Rien de cette migration n'a été appliqué à la branche de base/production Neon.**

## Étapes dépendant encore du lancement

- Contrôle réglementaire, contractuel et technique, textes légaux définitifs, test de l'image de bannière, parcours mobile et formulaires. **Ne pas déclarer tous les services opérateur actifs à l'ouverture des pages informatives.**
- Revue indépendante d'une future migration de libération éditoriale levant seulement le `CHECK(public_content_authorized=false)`, avec preuve de publication autorisée. La bascule de navigation ne doit pas lever ce verrou.
- Déploiement unique seulement après « top départ » explicite.
- Contrôles de toutes les pages et langues en HTTPS avec `200`, réécriture `index,follow`, en-têtes de sécurité, Search Console et absence d'erreur d'exploration.
- Soumission du sitemap Distribution et suivi de l'indexation. Conserver le sitemap actif pendant une pause du lien.

## Limite explicitement assumée

Avec le mode anti-désindexation, une personne qui possède l'URL exacte ou qui arrive depuis un moteur de recherche pourra toujours consulter les informations du Pôle lorsque le lien est « désactivé ». **C'est indispensable pour ne pas faire disparaître les pages des moteurs.** Une fermeture totale resterait un mécanisme d'urgence distinct à développer avec avertissement d'impact SEO, et non le comportement normal du bouton.

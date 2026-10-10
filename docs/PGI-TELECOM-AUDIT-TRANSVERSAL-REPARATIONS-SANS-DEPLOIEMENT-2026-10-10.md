# PGI Telecom | Tour d'horizon et réparations sécurisées

**10 octobre 2026**  
**Branche uniquement :** `prep/pgi-direct-sva-operator-2026-10-10`  
**Contrainte :** aucune modification déployée, aucun paiement, aucune action sur des clients réels.

## Synthèse factuelle

Deux activités sont **volontairement distinctes** :
1. **PGI Telecom | Audiotel Premium Pro**, l'activité SVA déjà en production.
2. **PGI Telecom Distribution**, éditée publiquement sous **Pôle Télécom & Réseau**, en préparation.

Aucune modification de production, de comptes Stripe, de flux financiers, de données HubSpot ou de droits opérateurs n'est comprise dans ce correctif. Le code de la deuxième activité ne doit pas se substituer aux contrats, au réseau ou au service clients existants.

## Contrôles réalisés en lecture seule

| Domaine | Constat étayé | Limite |
|---|---|---|
| Vercel Audiotel | Pas de groupe d'erreur d'exécution signalé dans la fenêtre de 24 heures interrogée | Ce n'est pas une démonstration de tous les parcours utilisateurs |
| Neon Distribution | 0 compte client, 0 numéro, 0 écriture comptable ; publication, activité commerciale et connecteurs externes désactivés | Aucun essai réel de trafic, d'encaissement, de paiement ou de migration client |
| GitHub | Branches et modules séparés, verrou de publication côté serveur, contrôles d'accès et protection des routes privées | Les modifications ne disposent pas d'un déploiement de préproduction ni d'une certification CI récente |
| Stripe Audiotel | Compte en mode réel, abonnement 4,90 EUR mensuel actif, deux endpoints webhook actifs (vérifiés lors du contrôle précédent du même jour) | Ni paiement test ni preuve d'une livraison/traitement bout en bout |
| Stripe Distribution | Aucun circuit `payment_psp` autorisé dans la base de préparation | Encaissements et reversements réels indisponibles |
| HubSpot Distribution | Modèle de propriétés et de pipelines propres à Distribution préparé en JSON | Ni création de ces pipelines dans le portail ni flux réel vérifié |
| GA4 et Search Console | Pages internationales, canoniques, liens linguistiques, événements et propriété Search Console dédiée préparés | Propriété GA4 distincte non prouvée, pages encore inaccessibles publiquement |

## Anomalies corrigées, à risque réduit

### A. Stabilité SEO lors de la désactivation du lien du pôle

**Avant :** le serveur injectait en français un avertissement de suspension dans toutes les pages, notamment les pages anglaises, espagnoles, portugaises, allemandes et italiennes. Une simple modification du lien dans le cockpit changeait donc aussi le contenu indexable.

**Après :** le bouton de navigation affecte uniquement le lien sur l'accueil Audiotel, **sans modifier les pages indexables, le titre, le canonique ni le sitemap Distribution**. Le contenu reste strictement identique que le lien soit visible ou non. La publication initiale reste soumise à son propre verrou.

Fichier : `backend/src/direct-sva-public-site.mjs`.

### B. Lien de connexion prématuré

**Avant :** plusieurs pages informatives pouvaient proposer un lien vers `/distribution-sva/espace-client/`, volontairement fermé au public et servi en 404.

**Après :** tant que le service client Distribution n'est pas autorisé, le lien est remplacé dans la réponse publique par une indication non cliquable et localisée selon les six langues. Un état commercial réellement autorisé utiliserait la connexion existante `/client.html`, et non une fausse page publique.

Fichiers : `backend/src/direct-sva-public-site.mjs` et `site/distribution-sva/style.css`.

### C. Découverte du sitemap par les moteurs

**Avant :** le sitemap Distribution était disponible dans le plan de publication future, mais `robots.txt` ne le signalait pas.

**Après :** **uniquement après approbation éditoriale et publication**, le serveur conserve toutes les directives Audiotel existantes et ajoute le sitemap `/distribution-sva/sitemap.xml`. Cacher le lien du pôle ne retire pas ce sitemap. Le résultat est idempotent et conserve les 35 adresses destinées à l'indexation. Avant ouverture, le `robots.txt` d'Audiotel ne change pas.

Fichiers : `backend/src/static-site.mjs`, `backend/src/direct-sva-public-site.mjs`.

### D. Tests de non-régression

Les tests `tests/direct-sva-website-visibility.test.mjs` ont été enrichis pour vérifier la stabilité du HTML publié, le lien client indisponible et l'annonce contrôlée du sitemap, ainsi que les différents états HTTP.

Contrôles effectivement exécutés sur les fonctions pures lues dans GitHub, via un environnement JavaScript isolé :
- 35 URL éditoriales et une route client privée analysées ;
- 70 combinaisons de réponses HTML avec le bouton d'administration activé ou désactivé, **aucune anomalie de stabilité SEO détectée** ;
- même canonique, même HTML et même sitemap quelle que soit la visibilité du lien ;
- annonce du sitemap ajoutée une seule fois et exclue de l'état non publié ;
- vérification syntaxique des modules ciblés : réussie.

**Attention :** ceci n'est pas une exécution Node intégrale de la suite de tests, ni une simulation complète du navigateur, du réseau et de PostgreSQL.

## Anomalies précédentes déjà corrigées, non redéployées

- Empreinte de déduplication Business Live étendue aux heures de fin et à la référence contractuelle, pour refuser des CDR contradictoires.
- Vérification des identifiants numériques sans conversion implicite de `true` en `1`.
- Brouillons comptables en centimes validés sans conversion de booléens, de valeurs scientifiques ou d'espaces.
- Contrôle des autorisations clients par activité, contrat, locataire et verrous commerciaux.
- Effacement de l'espace client après expiration de session ou accès refusé.
- Diagnostic administrateur distinct des lignes RLS PostgreSQL.

## Risques à traiter avant publication, sans modification aveugle

1. **RLS et droits SQL** : les principales tables Distribution ne disposent pas encore d'isolation native PostgreSQL RLS. Les filtres applicatifs sont présents mais la défense en profondeur doit être revue et éprouvée avec les véritables rôles et requêtes du serveur, avant toute migration.
2. **Raccordements externes** : opérateurs SVA, encaissements et paiements Distribution, HubSpot direct, GA4 séparé, flux CDR et rapprochement bancaire ne sont pas réels.
3. **Essais de bout en bout** : une préproduction isolée, la suite Node complète, quatre profils clients, des sessions et permissions réelles, le parcours complet de souscription et de résiliation, les appels, la migration de distributeur et les écritures comptables restent à homologuer.
4. **Image du pôle** : la bannière validée avec l'utilisateur reste à transférer et intégrer dans les sources du site, après optimisation et contrôle des marques.
5. **Qualité juridique et internationale** : chaque pays visé réclame une revue des ressources télécom, du cadre tarifaire et des textes adaptés. Des traductions ne sont pas des autorisations d'exploitation.
6. **SEO mesuré** : sans publication, le classement et la présence dans les assistants vocaux ou moteurs IA ne peuvent pas être confirmés ; le bouton de visibilité n'est pas une garantie de maintien de positions.

## Conclusion et politique de modifications

**Résultat :** corrections ciblées sur la fiabilité du parcours et la stabilité SEO, sans changer l'offre Audiotel Premium Pro ni déployer Distribution.

**Non réalisé :** déploiement Vercel, fusion sur `main`, activation du site Distribution, mouvement sur Stripe ou HubSpot, création de compte réel et migration SQL.

Les contrôles de production restent read-only. Une nouvelle phase de recette vérifiée est nécessaire avant de qualifier Distribution d'opérationnel.

# Operator Efficiency 1.16 — PGI • Telecom

## Objectif

La couche 1.16 réduit le temps perdu par l'opérateur et la charge inutile sur le navigateur, le réseau et le backend.

Le principe est simple : charger moins, recalculer moins et atteindre n'importe quelle action plus vite.

## Démarrage consolidé

Le démarrage de production est organisé autour de deux endpoints :

- `GET /api/v1/app/bootstrap` : identité, baselines et control plane wholesale ;
- `GET /api/v1/dashboard/bootstrap` : KPI, comparaison de période, analytics, experts, santé, routage et réconciliation.

Le détail CDR reste chargé séparément et de manière bornée, car il est paginé et n'a pas la même fréquence de rafraîchissement.

Le front conserve un fallback vers les anciens endpoints pendant un rolling deployment.

## Cache des métadonnées

Le bootstrap applicatif léger est conservé localement pendant 60 secondes.

Les métadonnées lourdes ne sont donc pas redemandées à chaque événement CDR.

Un événement de baseline ou un rafraîchissement manuel forcé invalide ce cache.

## Temps réel incrémental

Les événements SSE n'ont pas tous le même coût :

- nouvel appel : chargement d'une seule page récente de CDR, fusion et déduplication ;
- expert/opérateur/alerte : actualisation du dashboard sans recharger les CDR ;
- changement de baseline : synchronisation complète.

Le navigateur conserve au maximum un échantillon récent borné pour les détails. Les KPI et graphiques principaux restent alimentés par les agrégats serveur.

## Application en arrière-plan

Lorsque l'application passe en arrière-plan :

- la connexion SSE est arrêtée ;
- les synchronisations inutiles sont suspendues ;
- les événements nécessaires sont marqués comme en attente.

Au retour :

- absence courte : reprise incrémentale ;
- absence supérieure à 30 secondes : resynchronisation complète afin de ne pas rater une rafale importante d'appels.

## Rendu par espace de travail

Le navigateur ne recalcule plus toutes les vues cachées.

`renderActiveView` ne rend que l'espace actuellement visible :

- Cockpit ;
- Appels ;
- Finance ;
- Experts ;
- Opérateurs ;
- Plateforme SVA ;
- Supervision ;
- Paramètres.

Changer d'onglet déclenche un rendu local immédiat sans requête réseau supplémentaire.

## Palette universelle

Le bouton **Actions** et le raccourci `Ctrl/⌘ + K` permettent d'accéder directement à :

- toutes les vues ;
- les périodes courantes ;
- l'actualisation ;
- l'action prioritaire ;
- le mode mobile essentiel/complet ;
- l'export CSV ;
- l'impression/PDF.

Sur mobile, un bouton flottant ouvre la même palette.

## Workspace mémorisé

Le navigateur mémorise :

- dernière vue ouverte ;
- dernière période ;
- période personnalisée ;
- marché sélectionné ;
- mode mobile essentiel/complet.

Une réouverture de l'application revient donc directement au contexte de travail précédent.

## Alertes décisionnelles

Le Cockpit centralise les anomalies actionnables :

- écart de reversement ;
- ASR faible ;
- qualité voix dégradée ;
- API indisponible ;
- retard CDR ;
- dead letters ;
- file de jobs trop ancienne.

L'absence d'anomalie est également explicitement affichée.

## Modularisation frontend

Le runtime est séparé en modules cacheables :

- `core.js` : logique métier pure ;
- `api-client.js` : transport HTTP ;
- `data-client.js` : bootstrap, pagination et normalisation CDR ;
- `demo-data.js` : génération démo uniquement ;
- `command-palette.js` : accès rapide ;
- `workspace.js` : préférences locales ;
- `app.js` : orchestration et rendu.

Le fichier principal reste plafonné à 90 KiB.

Le shell complet reste plafonné à 260 KiB.

## Règles de performance

1. Ne jamais recharger tout l'historique CDR pour un événement temps réel.
2. Ne jamais recalculer une vue cachée.
3. Préférer les agrégats serveur aux calculs navigateur.
4. Garder les listes détaillées paginées et bornées.
5. Suspendre les flux inutiles lorsque l'application est cachée.
6. Préserver les fallbacks pendant les déploiements progressifs.
7. Ne pas augmenter les budgets front pour masquer une croissance du code.

# Cockpit Intelligence — PGI • Telecom

## Rôle

Le Cockpit est la page de pilotage principale.

Il doit permettre de comprendre en quelques secondes :

- combien d'appels arrivent ;
- combien aboutissent ;
- combien de minutes sont générées ;
- combien de chiffre d'affaires et de reversement sont produits ;
- à quelles heures et quels jours l'activité est la plus forte ;
- quels experts et opérateurs contribuent le plus ;
- comment se répartissent les durées ;
- si la qualité RTP est correcte ;
- si le backend, les CDR, les workers et la résilience sont sains.

La vue technique précédemment nommée **Système** est appelée **Supervision**.

## Sources de données

### Agrégats exacts serveur

En production, les graphiques principaux utilisent l'API :

`GET /api/v1/dashboard/analytics`

Cette API s'appuie sur :

- `platform_rollups_hourly_sharded` ;
- `dashboard_dimension_rollups_daily` ;
- `quality_rollups_hourly_sharded` ;
- les bords de période lus dans les faits bruts lorsque nécessaire.

Les graphiques ne téléchargent donc pas des millions de CDR dans le navigateur.

### CDR détaillés

Le navigateur charge volontairement un ensemble récent et borné de CDR pour :

- le tableau des appels ;
- les fiches de détail ;
- certains diagnostics fins.

Cette limite protège la mémoire des téléphones et évite qu'un historique massif ralentisse le Cockpit.

## Graphiques du Cockpit

### Finance

- CA généré ;
- reversement attendu ;
- reversement confirmé ;
- reversement encaissé ;
- marge estimée ;
- CA & reversement dans le temps ;
- ratios financiers ;
- comparaison avec la période précédente.

Les montants ne sont jamais additionnés entre devises différentes.

### Trafic

- appels & minutes dans le temps ;
- heatmap jours × heures ;
- répartition par heure ;
- répartition par jour de semaine ;
- heure de pointe ;
- jour le plus actif.

### Conversion

- ASR ;
- abandons ;
- échecs ;
- entonnoir entrants → aboutis → appels longs → éligibles.

### Durées

- < 1 minute ;
- 1–5 minutes ;
- 5–10 minutes ;
- 10–20 minutes ;
- 20–30 minutes ;
- 30 minutes et plus ;
- non aboutis.

### Experts

- contribution ;
- minutes ;
- ASR ;
- reversement attendu ;
- classement de période.

### Opérateurs

- volume par réseau ;
- part du trafic ;
- contribution par opérateur.

### Qualité voix

- MOS ;
- perte de paquets ;
- jitter ;
- latence ;
- grade qualité.

La qualité voix est agrégée côté serveur dans `quality_rollups_hourly_sharded`.

### Économie unitaire

- valeur moyenne par appel ;
- CA par minute ;
- marge moyenne par appel ;
- durée moyenne des appels aboutis.

## Périodes

Tous les graphiques principaux suivent la période globale :

- aujourd'hui ;
- 7 jours ;
- semaine ;
- mois ;
- année ;
- période personnalisée.

Ils suivent également le marché sélectionné lorsqu'une plateforme multi-marchés est active.

## Mobile

Sur mobile, le mode **Vue essentielle** conserve les indicateurs prioritaires et masque les analyses lourdes.

Le bouton **Voir l'analyse complète** permet d'afficher tous les graphiques.

Cette stratégie évite de rendre l'interface inutilisable sur Android ou iOS tout en conservant la richesse du desktop.

## Déploiement progressif

Pendant une mise à jour, si le nouvel endpoint analytique n'est pas encore disponible mais que le reste de l'API fonctionne, le front peut se rabattre temporairement sur les CDR récents.

Ce repli évite de rendre tout le dashboard indisponible pendant un rolling deployment.

## Règles de conception

1. Aucun graphique principal ne doit exiger le chargement de l'historique complet.
2. Les graphiques financiers ne mélangent jamais plusieurs devises.
3. Les périodes sélectionnées sont appliquées de manière cohérente.
4. Les agrégats serveur sont préférés aux calculs navigateur.
5. Les informations détaillées restent paginées et bornées.
6. Le mobile garde une vue essentielle rapide.
7. Les données absentes sont affichées comme absentes, jamais inventées.
8. Les états démo et production doivent rester visuellement distinguables.

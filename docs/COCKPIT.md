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


## Command Center 1.17

La couche 1.17 ajoute : taux de décroché, abandon et échec, part des appels de 10 minutes et plus, ratio minutes éligibles/facturables, taux de marge, couverture confirmé/attendu et encaissé/attendu, concordance financière, score de qualité voix, concentration du premier expert et du premier opérateur, tendances CA/marge, MOS/perte paquets, valeur/marge par appel et chaîne attendu → confirmé → encaissé.

La vue Supervision affiche aussi l’état du relais PostgreSQL temps réel, les souscripteurs SSE, les événements publiés/reçus, les erreurs de relais et le rôle du processus. Les métriques nécessitant des données non collectées, comme un SLA historique ou un PDD exact, ne sont pas simulées.


## Caller Experience 1.18

La couche Expérience appelant exploite les données réellement présentes dans les CDR :

- attente moyenne tous appels ;
- attente moyenne des appels aboutis ;
- attente moyenne avant abandon ;
- part des appels aboutis en 20 secondes ou moins ;
- part des abandons en 10 secondes ou moins ;
- temps moyen passé dans le SVI avant mise en file ;
- temps moyen passé en file jusqu'au pont ou au raccrochage ;
- histogramme des attentes ≤10 s, 11–20 s, 21–30 s, 31–60 s, 61–120 s et >120 s ;
- tendance attente moyenne / décroché rapide ;
- part des échantillons RTP dégradés et part des MOS <3,5.

Les seuils RTP utilisés pour le signal « dégradé » sont : perte de paquets ≥5 %, jitter >5 ms ou latence >150 ms. Ils servent au diagnostic technique du Cockpit et ne constituent pas un SLA client.

Les métriques sont consolidées dans `experience_rollups_hourly_sharded` et dans les colonnes de dégradation de `quality_rollups_hourly_sharded`, avec lecture des bords de période dans les CDR bruts pour conserver l'exactitude des fenêtres personnalisées.


## Performance Radar 1.19

### Signaux de dérive

Le Radar calcule six signaux sur les séries déjà retournées par le backend : trafic, ASR, abandon, attente moyenne, chiffre d’affaires et MOS. La dernière période est comparée à la médiane des douze périodes précédentes. La dispersion utilise la médiane des écarts absolus, convertie avec un facteur 1,4826 et un plancher de 5 % de la médiane pour éviter les divisions instables lorsque la série est quasi constante.

Le signal ne devient défavorable que dans le sens opérationnel concerné : baisse pour ASR, chiffre d’affaires et MOS ; hausse pour abandon et attente ; dérive dans les deux sens pour le trafic. Les seuils statistiques sont 2,5 pour « écart notable » et 3,5 pour « anomalie forte ». Ils ne sont pas présentés comme des SLA contractuels.

### Benchmark contributeurs

Les matrices Experts et Opérateurs affichent : part du trafic, nombre d’appels, ASR, ACD, CA moyen par appel et marge. Les graphiques volume × ASR positionnent jusqu’aux douze premiers contributeurs et affichent l’ASR plateforme comme référence horizontale. Les cartes de concentration indiquent la part Top 1 et Top 3 sans appliquer de jugement externe sur le niveau de concentration.

### Performance front

Le code du radar est un asset paresseux. Il n’est pas préchargé dans le shell PWA et ne compte donc pas dans le budget critique de 260 KiB. Il possède un budget séparé de 16 KiB et est mis en cache par la stratégie runtime des scripts après son premier chargement.

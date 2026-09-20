# PGI Control Tower, Policy Engine & Digital Twin

Version fonctionnelle : 1.28.0.

## Control Tower

`GET /api/v1/platform/control-tower` agrège les signaux déjà présents dans Audiotel Premium Pro sans créer une seconde source de vérité.

La vue calcule notamment :
- clients actifs / total ;
- lignes SVA actives ;
- numéros réglementairement prêts ;
- abonnements bloqués ;
- contrôles réglementaires bloquants ;
- incidents critiques ;
- portabilités nécessitant une action ;
- tâches en dead-letter ;
- capacité des destinations et appels simultanés en cours ;
- régions prêtes et résilience déclarée.

Le `readiness_score` est un indicateur opérationnel interne. Il n'est ni une certification, ni une validation ARCEP, ni une preuve de conformité.

## Policy Engine

`POST /api/v1/platform/policy/evaluate` centralise des décisions explicables avec trois résultats possibles :

- `ALLOWED` : les règles disponibles sont satisfaites ;
- `BLOCKED` : au moins une condition obligatoire échoue ;
- `ACTION_REQUIRED` : aucune règle bloquante n'échoue, mais une dépendance ou action reste nécessaire.

Intentions actuellement couvertes :
- `activate_number` ;
- `port_in` ;
- `payout_customer` ;
- `carrier_switch` ;
- `customer_access`.

Chaque réponse contient les bloqueurs, les actions requises et les faits évalués. Le moteur est un dry-run : `mutates_state=false`.

Le moteur ne remplace pas les garde-fous PostgreSQL existants. Les triggers et fonctions fail-closed restent l'autorité finale pour les mutations réelles.

## Digital Twin

`POST /api/v1/platform/digital-twin/simulate` simule un incident ou une montée en charge à partir des métriques réelles du cockpit, sans modifier les données.

Scénarios :
- `carrier_outage` : perte de l'opérateur principal et disponibilité du secours ;
- `traffic_spike` : multiplication de la concurrence d'appels face à la capacité déclarée ;
- `mass_portability` : traitement d'un volume important de portabilités par vagues ;
- `regulatory_expiry` : expiration simulée des validations réglementaires ;
- `billing_failure` : pourcentage simulé d'abonnements en échec ;
- `region_failure` : perte d'une région / datacenter et capacité DR.

Toutes les réponses portent `dry_run=true` et `mutates_state=false`.

## Connexions externes

La Control Tower affiche explicitement que les branchements externes ne sont pas actifs. Aucun appel Stripe, opérateur SVA, APNF/RSVA ou PSP n'est déclenché par ces trois modules.

Les simulations utilisent uniquement l'état interne disponible et des hypothèses bornées. Elles ne doivent jamais être présentées comme une mesure issue d'un opérateur non connecté.

## Performance

L'interface `assets/control-tower.js` est lazy-loadée depuis la palette de commandes. Elle ne fait pas partie du shell initial du cockpit.

Le budget de taille dédié est contrôlé par `scripts/check-size.mjs`.

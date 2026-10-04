# Programme de parrainage

## Objectif

Le parrainage est un levier d’acquisition optionnel d’Audiotel Premium Pro. Il est piloté globalement depuis le cockpit administrateur et peut être activé ou désactivé sans déploiement.

## Règles opérationnelles

- Le réglage global est stocké côté serveur dans `platform_feature_controls`.
- Le programme est activé par défaut lors de l’installation de la migration.
- Seul un administrateur peut modifier son état.
- Les lectures restent accessibles aux rôles d’administration autorisés.
- Chaque changement est journalisé dans `audit_log`.
- Quand le programme est désactivé, l’espace client ne présente plus le module de parrainage.
- Quand le programme est désactivé, un ancien code présent dans une URL ne produit aucune nouvelle attribution.
- Les codes existants et l’historique des attributions ne sont jamais supprimés par la désactivation.
- La réactivation rend à nouveau les codes clients utilisables.
- Les codes de parrainage sont des identifiants commerciaux, jamais des secrets d’authentification.

## Attribution

Un lien client suit la forme `/demande-ouverture/?ref=PGI-...`.

La demande d’ouverture publique transmet le code au backend uniquement lorsqu’il respecte le format prévu. Le backend vérifie ensuite que le programme est actif, que le code existe et qu’un client ne se parraine pas lui-même.

La donnée de code n’est pas envoyée à GA4. L’analytics public conserve uniquement ses dimensions à faible cardinalité.

## Avantage

Le mécanisme d’avantage reste volontairement en mode `manual` tant qu’une politique commerciale définitive n’a pas été validée. Le logiciel peut donc attribuer et compter les demandes sans promettre automatiquement une remise ou un montant non contractualisé.

# PGI Telecom Distribution : Stripe réellement préparé

**Date : 10 octobre 2026**
**Compte Stripe existant : PGI Telecom - Audiotel Premium Pro, mode réel.**
**État du service Distribution : préparation, sans flux financier ni publication.**

## Résultat des interventions dans Stripe

**Produit créé directement dans Stripe :**
- Nom : `PGI Telecom Distribution | Pôle Télécom & Réseau`
- Identifiant : `prod_VPxqF47RlQ0uoi`
- Type : `service`
- `active=false`, `default_price=null` : aucune possibilité de facturer par ce produit sans création ultérieure de tarif et activation.
- Aucune souscription Distribution, aucun lien de paiement, aucun paiement d'essai ou réel, aucun remboursement.
- Aucune modification des webhooks ou des produits Audiotel.

**Métadonnées isolées :**
`pgi_business_unit=direct_sva`, `pgi_legal_entity=pgi_primary`, `pgi_cost_center=DSVA`, `pgi_crm_namespace=distribution_directe`, `pgi_catalog_status=preparation`, `pgi_payments_enabled=false`, `pgi_checkout_enabled=false`, `pgi_network_enabled=false`.

### Relecture dans Stripe après création

- 2 produits présents au total.
- Audiotel Premium Pro : `prod_VJeVHmZAUiMfc7`, `active=true`, prix par défaut `price_1UMnqtIcUK9dp98WB2r7spV8` (4,90 EUR/mois), inchangé.
- Distribution : `prod_VPxqF47RlQ0uoi`, `active=false`, **0 prix**, **0 webhook Distribution**.
- Les **2 webhooks actifs Audiotel** sont restés actifs et inchangés.

## Modifications préparées dans GitHub, uniquement sur la branche de préparation

**`config/pgi-direct-sva-stripe-catalog.json`** : identité exacte du produit, son état inactif, les métadonnées et la séparation de l'existant.

**`backend/src/direct-sva-stripe-catalog.mjs`** : contrôle des identifiants produit, de la cohérence des métadonnées et du centre analytique, rejet des prix appartenant à l'autre activité, identification des événements Distribution à partir de la référence du produit et de `pgi_business_unit`. Le traitement d'un événement peut uniquement produire un état de revue, **jamais une validation de paiement**.

**`backend/server.mjs`** : après vérification existante de la signature Stripe, le webhook Audiotel reconnaît les événements Distribution et les ignore dans sa propre comptabilité. Cela ne constitue pas un webhook Distribution : celui-ci sera un endpoint séparé lorsqu'il sera effectivement prêt. Aucune règle d'abonnement, d'impayé ou de remboursement Audiotel n'a été remplacée.

**`backend/src/direct-sva-integrations.mjs` et `assets/direct-sva-cockpit.js`** : le cockpit Distribution affichera une section Stripe avec le produit réellement créé, identifié comme état **observé le 10/10/2026**, et pas comme une connexion de paiement active ou synchronisée en temps réel.

**`config/pgi-direct-sva-integrations-audit-2026-10-10.json`** : inventaire mis à jour ; `payment_psp.authorized` demeure `false`.

**`tests/direct-sva-stripe-catalog.test.mjs`** : tests de prévention des doublons, validation du catalogue inactif, séparation des prix, rejet d'événements d'une autre activité, contrôle de signature, vérification des événements Audiotel et des gardes sur le cockpit.

## Pour finaliser Stripe Distribution

1. Définir **les prestations réellement facturables**, leur montant, le régime fiscal et leur facturation (ponctuelle ou récurrente). Ne pas copier automatiquement le tarif Audiotel de 4,90 EUR.
2. Créer des prix adaptés **au produit Distribution**, sans toucher aux prix Audiotel.
3. Déployer séparément l'API Distribution, puis créer un **webhook propre à Distribution** avec secret distinct, validation HMAC de la signature, idempotence persistante et comparaison au produit, au prix et au dossier client.
4. Tester successivement : paiement accepté, paiement refusé, paiement asynchrone, remboursement total/partiel, événement en double, retard de livraison et interruption de connexion, sur une préproduction dédiée.
5. Déterminer le flux financier exact entre PGI, opérateur, éditeur et client, ainsi que les obligations de paiement et de rapprochement. Le fait d'avoir un produit Stripe ne donne pas automatiquement le droit d'effectuer des reversements de tiers.
6. Prévoir la ventilation comptable `APP` / `DSVA`, tout en conservant le FEC légal unique de la société.

**Aucune migration PostgreSQL ni aucun déploiement Vercel n'a été effectué pour ces ajouts Stripe.**

**Important :** l'interrupteur éditorial du cockpit pour afficher le Pôle Télécom & Réseau est indépendant. Il pourra ouvrir les **pages informatives** après leur mise en service, sans requérir un Stripe Distribution actif.

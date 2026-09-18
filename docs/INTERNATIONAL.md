# Internationalisation PGI • Telecom

## Objectif

PGI reste exploitable en France aujourd’hui, mais le modèle de données ne dépend plus d’un pays unique. Un même client peut être rattaché à plusieurs marchés sans dupliquer son compte, ses experts ou le backend.

La séparation structurante est :

```
client / tenant
  ├── marché(s)
  │     ├── langue et locale
  │     ├── fuseau horaire
  │     ├── devise de facturation
  │     ├── profil fiscal et conformité locale
  │     ├── opérateur(s) compatibles
  │     └── numéros de service
  └── experts
```

## Standards de référence

La couche internationale utilise des identifiants standards plutôt que des valeurs françaises codées en dur :

- numéros publics canoniques : ITU-T E.164 ;
- pays : ISO 3166-1 alpha-2 ;
- monnaies : ISO 4217 ;
- langues/locales : BCP 47 ;
- fuseaux horaires : base IANA tz.

Ces standards servent d’identifiants techniques. Ils ne remplacent jamais la validation réglementaire propre à chaque pays.

## Marchés

La table `operating_markets` décrit un pays exploitable par PGI. France est le seul marché activé par défaut. Ajouter un autre pays doit commencer avec le statut `planned` ou `onboarding`.

Un marché possède notamment : code pays, devise par défaut, locale, fuseau horaire, régulateur, autorité de numérotation, région de données, profil de numérotation et exigences de conformité.

Aucun pays ajouté à la base ne devient automatiquement exploitable.

## Clients internationaux

`tenant_market_profiles` permet à un même tenant d’opérer dans plusieurs pays.

Le pays de constitution juridique du client reste dans `tenants.country_code`. Ses pays d’exploitation sont indépendants et se trouvent dans `tenant_market_profiles`.

Chaque couple client/marché peut avoir sa propre devise de facturation, locale, timezone, immatriculation fiscale, politique de résidence de données, conformité locale et conditions commerciales.

## Numérotation

`sva_numbers.e164` reste la référence canonique internationale.

`sva_number_aliases` accepte les formes nationales ou spécifiques à un trunk opérateur. Le backend résout un alias vers le même numéro canonique avant de choisir le tenant et ses experts.

Le routage reste fail-closed :

```
numéro livré par l’opérateur
  → alias éventuel
  → numéro E.164 canonique
  → marché
  → tenant
  → experts du tenant
```

Un alias inconnu ne doit jamais être deviné ou routé vers un autre client.

## Opérateurs

Un opérateur n’est pas considéré comme mondial par défaut.

`carrier_market_capabilities` indique explicitement les marchés couverts, familles de service disponibles, états commercial/technique, capacités spécifiques et devises de règlement supportées.

`carrier_connection_markets` indique quels trunks ou connecteurs peuvent être utilisés dans quels marchés.

Les routes logiques portent désormais un `market_id`. Le routeur français actuel reste compatible et de nouvelles routes peuvent être ajoutées par marché sans réécriture de la couche métier.

## Finances multi-devises

Les CDR, contrats opérateurs, règlements opérateurs, règlements clients et écritures du ledger portent leur devise.

Règle de sécurité : PGI ne doit jamais sommer des montants de devises différentes.

Le cockpit Wholesale retourne les totaux regroupés par devise. Une conversion consolidée ne devra être introduite que lorsqu’une source de taux de change, une date de valorisation et une politique comptable auront été définies.

Le schéma historique conserve une contrainte de règlement opérateur par `carrier_id + période`. Tant que cette contrainte n’est pas remplacée dans une migration contrôlée, une même marque opérateur utilisée dans plusieurs juridictions de facturation doit être représentée par des contreparties opérateur distinctes par marché ou entité légale. Cela préserve la sécurité des migrations et évite tout mélange comptable.

## Conformité et paiement

Le KYC de l’entité reste au niveau tenant. La conformité d’exploitation est rattachée à chaque marché.

`payment_compliance_market_profiles` permet d’associer un profil de paiement différent selon le pays.

L’activation d’un nouveau marché doit rester bloquée tant que les points locaux pertinents ne sont pas documentés et validés, notamment numérotation, contrat opérateur, information consommateur, fiscalité, protection des données et flux de paiement.

## Procédure pour ajouter un pays

1. Créer le marché en statut `planned` avec code pays, devise, locale et timezone.
2. Documenter le régulateur, l’autorité de numérotation et les exigences locales.
3. Ajouter au moins une capacité opérateur pour ce marché.
4. Configurer le trunk/connecteur du marché.
5. Ajouter les numéros canoniques E.164 et leurs alias opérateur.
6. Créer le profil client/marché avec devise, locale et conformité.
7. Configurer le profil de paiement si des reversements tiers sont nécessaires.
8. Tester routage, CDR, tarification et règlements sans activer le marché.
9. Passer le marché et ses dépendances à `active` uniquement après validation.

Cette procédure évite toute duplication d’application. L’ajout d’un pays consiste principalement à ajouter de la configuration, des contrats et des connecteurs.

## Cockpit par marché

L’API de synthèse, la liste des appels et la réconciliation acceptent un marché opérationnel. Le front sélectionne automatiquement la France tant qu’elle est le seul marché actif.

Lorsque plusieurs marchés passent au statut `active`, un sélecteur apparaît dans le cockpit. Le choix est mémorisé localement et les appels/KPI opérationnels sont chargés uniquement pour le marché sélectionné, ce qui empêche les agrégations transfrontalières involontaires.

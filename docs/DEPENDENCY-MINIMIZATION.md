# Dépendances minimales — architecture PGI souveraine

## Objectif

PGI Telecom • Audiotel Premium Pro doit réduire les dépendances externes au strict nécessaire.

## Dépendance externe minimale

### 1. Opérateur SVA hôte

Rôle strictement limité à ce que PGI ne peut pas assumer directement dans le modèle actuel :

- ressource de numérotation / exploitation réseau du 089 ;
- accessibilité du 089 depuis les réseaux appelants ;
- interconnexion SVA ;
- portabilité réseau ;
- collecte/reversement de la composante service selon le contrat ;
- obligations opérateur associées à la ressource.

L'opérateur ne doit pas être propriétaire du cœur métier PGI.

Il ne doit pas imposer, lorsque le contrat le permet :

- son SVI ;
- son routage métier ;
- son dashboard ;
- son CRM ;
- son moteur de statistiques ;
- sa logique expert ;
- son stockage comme source de vérité ;
- son moteur de marge ;
- ses exports comme seul accès aux données.

## Composants possédés par PGI

| Fonction | Propriétaire |
|---|---|
| Dashboard | PGI |
| API | PGI |
| PostgreSQL | PGI |
| Valkey | PGI |
| Kamailio/OpenSIPS | PGI |
| FreeSWITCH | PGI |
| SVI | PGI |
| Routage experts | PGI |
| Files d'attente | PGI |
| Présence experts | PGI |
| CDR interne | PGI |
| Modèle client | PGI |
| Moteur financier | PGI |
| Réconciliation | PGI |
| Historique contrats | PGI |
| Exports | PGI |
| Monitoring | PGI |
| Alertes | PGI |
| Audit | PGI |
| Sauvegardes | PGI |
| CI/CD | PGI / GitHub |
| Numéro 089 affecté | utilisateur final, via opérateur |
| Interconnexion SVA | opérateur hôte |
| Collecte réseau / reversement | opérateur hôte |

## Fournisseurs non nécessaires

PGI ne nécessite pas comme dépendance structurelle :

- plateforme Audiotel hébergée tierce ;
- fournisseur de SVI hébergé ;
- fournisseur de dashboard télécom ;
- fournisseur de CRM téléphonique ;
- fournisseur de files d'attente ;
- fournisseur de CDR métier ;
- moteur de réconciliation tiers ;
- Cloudflare ;
- outil de monitoring SaaS obligatoire.

Des services facultatifs pourront être ajoutés uniquement s'ils apportent un gain mesurable et restent remplaçables.

## Règle d'architecture

Aucun composant métier ne doit importer un SDK propre à un opérateur SVA.

La relation opérateur est limitée à :

```
PGI canonical model
       │
       ▼
Carrier Adapter v1
       │
       ├── SIP
       ├── CDR
       └── Settlement
             │
             ▼
       opérateur hôte
```

## Source de vérité

La source de vérité est PGI :

- FreeSWITCH/Kamailio pour les événements téléphoniques internes ;
- PostgreSQL pour le modèle métier ;
- relevé opérateur conservé comme preuve externe ;
- rapprochement entre les deux.

Un dashboard opérateur n'est jamais la source de vérité de PGI.

## Indépendance réseau

Le système doit continuer à fonctionner pour les fonctions non réseau même si l'opérateur hôte est indisponible :

- consultation historique ;
- finance historique ;
- rapports ;
- experts ;
- configuration ;
- audit.

La panne du fournisseur ne doit pas corrompre les données PGI.

## Changement d'opérateur

Le remplacement de l'opérateur doit se limiter à :

1. créer son profil/adaptateur ;
2. renseigner le nouveau contrat ;
3. configurer les connexions SIP/CDR/règlement ;
4. tester ;
5. porter le même 089 ;
6. basculer `sva-primary`.

Aucune refonte applicative.

## PSP / établissement de paiement

Si l'opérateur utilise un établissement de paiement en sous-jacent pour les reversements, PGI ne doit pas en dépendre techniquement dans le cœur.

L'opérateur/adaptateur encapsule cette relation. Si le modèle contractuel impose une relation directe avec un PSP, elle reste une dépendance financière périphérique, jamais une dépendance téléphonique ou applicative.

# PGI Telecom Distribution : séparation des accès, cockpit et espace client

**Contrôle du 10 octobre 2026 | Branche de préparation uniquement | Aucun déploiement ni changement client réel**

## 1. Deux activités, une identité client lorsque cela est autorisé

Audiotel Premium Pro reste le service SVA commercial actuel. PGI Telecom Distribution est la future activité opérateur/distributeur, présentée publiquement sous « Pôle Télécom & Réseau ».

L'objectif : **une seule connexion PGI** pour un client qui relève des deux services, avec **des habilitations, des dossiers, des preuves télécoms et des états financiers propres à chaque activité**. La réutilisation du compte ne vaut pas attribution automatique de droits sur la Distribution.

## 2. Renforcement réellement enregistré dans GitHub

### Espace client : `backend/src/direct-sva-customer.mjs`

- Identifiant `tenant_id` strictement numérique et positif ; rejet des booléens, objets, écritures ambiguës, dépassements et identifiants manquants.
- La ligne d'inscription doit provenir de `direct_sva_customer_accounts`, porter `business_unit='direct_sva'` et correspondre au `tenant_id` authentifié.
- Pour qu'un futur client puisse consulter ses données : `access_state='active'`, `dashboard_enabled=true`, `client_contract_accepted=true` et `commercial_operation_enabled=true` dans les interrupteurs PGI Distribution.
- La base de staging **interdit encore** cet état actif par des contraintes PostgreSQL. Aucune ouverture n'en découle.
- Les cas et numéros sont sélectionnés par `tenant_id` ; leur propriétaire est revérifié à la sortie de l'adaptateur, avant assemblage de la réponse.
- **Échec bloquant de toute la réponse** si une ligne d'un autre locataire apparaît, même si un futur adaptateur de base renvoie des données inattendues.
- Aucune donnée de facturation Audiotel, de parrainage ou de versement PSP n'est appelée par cette fonction.

### Interface client : `site/distribution-sva/client-portal.js`

- Après déconnexion, expiration de session, erreur de réponse ou absence d'autorisation, les informations privées sont **retirées du DOM et de l'état en mémoire**, pas simplement masquées.
- Une réponse tardive ne peut pas réafficher un ancien compte après un nouveau chargement.
- Un état API inattendu, tel qu'un paiement client prétendument actif avant le déverrouillage, est refusé.
- L'impression est possible uniquement lorsque le panneau client a passé les vérifications.
- Aucune inscription libre, aucun numéro activé, aucun paiement réel.

### Cockpit administrateur : `backend/src/direct-sva-access-readiness.mjs` et `assets/direct-sva-cockpit.js`

Nouvel onglet **« Sécurité des accès »** en préparation, rafraîchi lors de sa consultation :

- tables de séparation présentes ;
- contraintes PostgreSQL empêchant la création d'un compte client actif non approuvé ;
- verrous de distribution et d'exploitation commerciale ;
- compteurs anonymes de dossiers et numéros ;
- différenciation explicite entre protection interne observée et recette client réelle non accomplie ;
- absence d'accès aux dossiers et écritures Audiotel.

Route administrateur : `GET /api/v1/platform/direct-sva/access-readiness`, déjà protégée par le mécanisme de prévisualisation du pôle, elle-même limitée aux administrateurs. Ce contrôle est en lecture seule.

### Business Live

`backend/src/direct-sva-business-live-continuity.mjs` est couvert dans les tests :

- rejet des appels d'un autre client ou d'un autre numéro ;
- absence de raccordement opérateur non vérifié ;
- déduplication des appels répétés ;
- distinction de l'estimation, des montants confirmés et des sommes payées ;
- préservation de l'identité et du dossier client existants lors d'une transition hypothétique.

Ce n'est **pas** une preuve d'alimentation par un opérateur réel ou de paiement effectif.

## 3. Tests de non-mélange ajoutés

`tests/direct-sva-tenant-isolation.test.mjs` : **10 scénarios**, couvrant client sans droits Distribution, compte en préparation, compte Audiotel mal étiqueté, compte d'un autre client, contrat manquant, verrou commercial fermé, accès hypothétique autorisé, résultat multi-client rejeté, identifiants invalides et CDR Business Live répétés.

`tests/direct-sva-access-readiness.test.mjs` : **5 scénarios**, couvrant contraintes en base, comportements de sécurité par défaut, données inattendues, absence d'accès aux tables Audiotel et affichage dans le cockpit.

Les **15 scénarios ont réussi en exécution JavaScript isolée** sur les versions GitHub. Ils sont ajoutés à `verify:vercel`; il manque la confirmation de la **suite Node complète** et une recette technique HTTP/SQL sur un environnement isolé. Les essais sont des simulations, **pas de véritables comptes clients créés**.

## 4. État réel observé dans Neon de préparation

Branche de staging `br-wild-meadow-auuv4k65`, projet `silent-waterfall-98567339` :

| Contrôle | Valeur observée |
|---|---|
| Tables nécessaires au diagnostic des accès | 6/6 |
| Comptes Distribution | 0 |
| Dossiers Distribution | 0 |
| Numéros Distribution actifs | 0 |
| Publication du site Distribution | Désactivée |
| Exploitation Distribution | Mode `preparation` |
| Activation de numéros | `false` |
| Reversements | `false` |
| Exploitation commerciale | `false` |
| Contraintes de non-activation de comptes préparatoires | Présentes |

La base de production n'a pas été modifiée et les migrations directes ne s'y trouvent pas.

## 5. Priorités avant de déclarer l'espace client opérationnel

1. **Exécuter la CI Node complète** et de vrais essais HTTP sur des comptes fictifs exclusivement dans une base jetable cloisonnée, avec contrôles de rôle, session, CSRF, permissions et taux de requêtes.
2. Vérifier un scénario multi-client à quatre profils : Audiotel seul, Distribution seule, client des deux activités, administrateur, avec accès interdits par défaut.
3. Tester le cycle de vie des droits : invitation, acceptation contractuelle, autorisation, suspension, révocation et session expirée. Formaliser une migration de libération après contrôle juridique, jamais avant.
4. Terminer les connecteurs opérateurs/banque/PSP et HubSpot propres à Distribution. Aucun paiement ou montant non confirmé ne doit apparaître comme réel.
5. Réaliser un test de continuité Business Live avant/après un changement de prestataire en comparant les mêmes appels sources, la ligne client, les bornes de période, les rapprochements et les deux comptes analytiques.
6. Préparer les alertes de dérive, essais de restauration, contrôles périodiques de permissions et de séparations, sans exposer de données identifiantes dans les tableaux de diagnostic.

## 6. Positionnement précis

**Cockpit Distribution : structure et diagnostic préparés, pas encore homologués.**

**Espace client Distribution : protection renforcée, bloqué en préproduction.**

**Audiotel Premium Pro : inchangé en production.**

La présence des interfaces et les tests simulés ne valent pas certification de sécurité ni mise en service. Aucun transfert de numéro ou de fonds et aucune publication du Pôle Télécom & Réseau n'ont été exécutés.

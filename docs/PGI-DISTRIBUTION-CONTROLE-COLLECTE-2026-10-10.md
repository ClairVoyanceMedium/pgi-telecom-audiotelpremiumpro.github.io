# PGI Telecom Distribution : contrôle de préparation financière du 10 octobre 2026

**Périmètre : deuxième activité seulement.** La première activité conserve son nom et tous ses circuits : **Audiotel Premium Pro**. La branche de préparation `prep/pgi-direct-sva-operator-2026-10-10` n'est pas la production.

## Constats directs, en lecture seule

| Source | Observation | Interprétation |
| --- | --- | --- |
| GitHub | Durcissement de `backend/src/direct-sva-reconciliation.mjs` et cinq nouveaux contrôles dans `tests/direct-sva-reconciliation.test.mjs` | Changements enregistrés sur la branche isolée, non déployés |
| Neon / production `main` | 0 table `direct_sva_*` ; aucun registre `pgi_company_business_units` | La deuxième activité n'est pas entrée en production |
| Neon / `prep-direct-sva-integration-2026-10-10` | 27 tables `direct_sva_*`; interface aperçu OFF ; exploitation commerciale OFF ; opérateur en mode `preparation` | Isolation et verrouillage de la deuxième activité confirmés |
| Neon / branche de préparation | Numérotation et paiements éditeurs OFF ; six connecteurs déclarés et six désactivés | Aucun circuit direct autorisé à envoyer des données |
| Stripe / compte PGI en mode réel | `charges_enabled=true`, `payouts_enabled=true`, capacité `transfers=active` | **Aptitude générale du compte**, pas une validation d'usage SVA ni de versements à des éditeurs |
| Stripe / compte PGI en mode réel | Solde EUR disponible 0, en attente 0 ; 0 compte connecté renvoyé par l'API v1 | Aucun fonds Stripe à affecter à Distribution ; inventaire comptes v2 non vérifié |
| Vercel | Aucun groupe d'erreurs d'exécution détecté sur les dernières 24 h lors du contrôle | Indice limité : ne prouve ni les parcours clients ni l'absence d'erreurs non agrégées |
| GitHub / nouveau commit de préparation | Aucun statut CI remonté sur `be1ba071408f8135a4fbac415196075703a94312` | Suite complète et essais de bout en bout non attestés |

La précédente documentation indiquait 25 tables de préparation au moment de son relevé. Le contrôle SQL du présent chantier indique **27 tables**. Ce chiffre actualise l'inventaire ; il ne constitue pas une preuve de capacité commerciale.

## Renforcement du relevé opérateur

Le moteur de rapprochement des CDR :

1. refuse désormais les objets d'entrée invalides et les lignes qui ne sont pas des objets financiers ;
2. exige la devise explicite `EUR`, sans lui substituer une valeur implicite ;
3. exige une durée facturable entière fournie sous forme numérique (aucune conversion implicite de `null`, d'une chaîne ou d'un booléen) ;
4. dérive l'empreinte de référence uniquement des champs CDR financiers autorisés ;
5. rend cette empreinte indépendante de l'ordre de réception des lignes ;
6. conserve les refus de doublons CDR et de répartitions arithmétiques incohérentes.

Ces changements protègent l'identité des relevés et la qualité du **pré-rapprochement**. Ils ne remplacent pas une preuve d'appel certifiée par l'opérateur, ne reconnaissent pas des fonds bancaires et n'autorisent aucun paiement.

## Séquence impérative pour la future collecte

1. **Référence de fait télécom** : contrat opérateur, tarif applicable, numéro, date de service, ID canonique d'appel, preuve CDR vérifiée.
2. **Créance calculée** : facturation selon le mandat et le rôle juridique PGI (principal ou intermédiaire) ; versionnement des tarifs.
3. **Règlement opérateur** : relevé signé, référence unique de transaction bancaire indépendante, monnaie et date valeur.
4. **Rapprochement** : preuve banque ↔ versement opérateur ↔ relevé de collecte ↔ CDR ; rejets, retenues, remboursements et compensations tracés séparément.
5. **Droits des éditeurs** : KYC/KYB, contrat, part financière, éventuels blocages et réserve de liquidité ; aucun montant `estimé` n'est `encaissé`.
6. **Ordre de paiement** : autorisation du circuit légal et du PSP, clés d'idempotence, séparation des approbations et traçabilité des échecs.
7. **Comptabilité** : journal légal unique de la société, centres analytiques `APP` et `DSVA`, affectation PCG/TVA validée, contrôle FEC et rapprochement banque.
8. **Business Live** : affichage distinct des montants prévisionnels, confirmés, encaissés et effectivement reversés, sans exposer aux clients un changement d'opérateur interne.

Le circuit de paiement Distribution ne doit jamais détourner l'abonnement Audiotel à 4,90 €, la portabilité prioritaire à 9,90 € ni les flux de parrainage de la première activité.

## Blocages encore réels

- Contrats de collecte et interconnexion, CDR authentifiés et attribution/routage des numéros.
- Validation de la nature des fonds télécoms et du circuit autorisé par le prestataire de paiement.
- Données réelles de rapprochement bancaire, identification des bénéficiaires et modèle fiscal.
- Pipeline HubSpot distinct, propriété GA4 propre, support Gmail bout en bout et contrôles d'accès authentifiés.
- Exécution attestée de `npm run verify`, validations SQL indépendantes, recette complète client et opérateur, reprise après incident.

**Décision de mise en production : NON.** Aucun déploiement Vercel, aucune fusion dans `main`, aucune migration Neon sur la production, aucun changement Stripe, aucun paiement et aucune activation commerciale ne découlent de ce rapport. Le top départ du propriétaire reste nécessaire.

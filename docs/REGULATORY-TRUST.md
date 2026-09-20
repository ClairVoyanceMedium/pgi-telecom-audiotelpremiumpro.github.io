# Regulatory Trust Center — France SVA

## Objectif

Le Regulatory Trust Center transforme la conformité SVA en contrôles techniques vérifiables. Il ne déclare jamais Audiotel Premium Pro « conforme » par simple configuration : un contrôle reste `not_started`, `pending`, `failed` ou `expired` tant qu'une preuve réelle n'a pas été enregistrée.

L'activation d'une affectation SVA externe est fail-closed. Elle reste impossible tant que les conditions techniques et réglementaires modélisées ne sont pas satisfaites.

## Références officielles suivies

- Arcep, authentification des numéros / MAN : https://www.arcep.fr/mes-demarches-et-services/acteurs-regules/operateurs-telecoms/fiches-pratiques/authentification-numeros-telephone-fixe-ou-mobile-que-faire-en-tant-que-operateur-telephonique.html
- Arcep, Identifiant CE : https://extranet.arcep.fr/communications-electroniques/identifiant-ce
- AF2M, recommandations déontologiques SVA : https://af2m.org/rd-sva/
- Code de la consommation, services accessibles par opérateurs : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032221565/
- Décision Arcep 2022-1583 / plan de numérotation : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000046830288

Les exigences contractuelles de l'opérateur attributaire et les versions en vigueur des recommandations AF2M restent à vérifier lors du raccordement réel.

## Contrôles par numéro

Chaque couple client / numéro possède un `sva_regulatory_profile`.

Activation externe requise :

1. KYC vérifié.
2. Droits de numérotation vérifiés.
3. Identité de l'éditeur vérifiée.
4. Informations RSVA vérifiées.
5. Transparence tarifaire vérifiée.
6. MGIT vérifié ou explicitement non applicable.
7. Processus de réclamation vérifié.
8. Surveillance fraude vérifiée.
9. Nom, description, fournisseur, adresse et contact réclamation renseignés.
10. Opérateur attributaire et référence amont présents.
11. Revue réglementaire non expirée.

## Contrôles plateforme France

Le registre `platform_regulatory_controls` prépare les preuves pour :

- Identifiant CE lorsque requis pour l'activité visée.
- Accès / intégration APNF et RSVA.
- Cadre contractuel et recommandations AF2M.
- MAN / authentification du numéro d'appelant lorsque le rôle réellement exercé l'exige.
- Traçabilité des routes en cas de fraude.
- Notification et gestion d'incident.
- Traitement des signalements 33700.

Ces lignes sont initialisées en `not_started`. Aucune migration ne les marque automatiquement `verified`.

## Preuves append-only

`sva_regulatory_evidence_events` est un journal append-only :

- chaque événement est horodaté ;
- chaque événement contient la référence de la preuve ;
- un statut `verified` exige une référence ;
- chaque événement contient le SHA-256 du précédent ;
- la chaîne est sérialisée par verrou transactionnel par numéro ;
- UPDATE et DELETE sont refusés par trigger ;
- toute écriture applicative est également inscrite dans `audit_log`.

Une correction ne modifie donc pas une ancienne preuve : elle ajoute un nouvel événement.

## Evidence Pack automatique

Chaque affectation SVA peut générer un dossier d'audit JSON horodaté depuis le cockpit. Le pack consolide dans une transaction cohérente :

- identité du client et du numéro ;
- état KYC ;
- profil réglementaire et état de préparation ;
- chaîne complète des preuves réglementaires et son hash de tête ;
- historique de portabilité et événements opérateur assainis ;
- affectations successives aux opérateurs ;
- historique d'activation / suspension de la ligne ;
- incidents de service et dossiers fraude ;
- contrôles réglementaires de la plateforme pour le marché concerné ;
- route opérateur courante et dernières bascules.

Le pack contient sa propre empreinte SHA-256 et un indicateur de continuité des liens de la chaîne de preuves. Chaque export reçoit un identifiant UUID et est inscrit dans le registre append-only `sva_regulatory_evidence_pack_exports` avec son hash, puis journalisé dans `audit_log`. Pour limiter l'exposition de données sensibles, le pack exclut volontairement le RIO brut, les secrets de portabilité, les numéros d'appelants et le contenu des appels.

## Signalements et fraude

`sva_abuse_cases` accepte notamment les origines 33700, Arcep, DGCCRF, opérateur, consommateur et détection interne.

Les niveaux de sévérité créent des échéances de première réponse et de résolution. Le champ `suspension_required` permet de matérialiser immédiatement un besoin de coupure ou de quarantaine sans supprimer l'historique.

## Règle de sécurité

Aucune intégration opérateur, APNF, 33700 ou PSP n'est simulée comme active. Les connecteurs réels devront fournir une preuve de configuration et être validés séparément avant passage à `verified`.

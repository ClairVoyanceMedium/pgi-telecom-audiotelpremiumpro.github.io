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
- Décision Arcep 2025-2215 du 27 novembre 2025, version du plan applicable au 1er janvier 2026 : https://www.arcep.fr/uploads/tx_gsavis/25-2215.pdf

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

## Garde-fous ARCEP 2026

La migration `040_arcep_2026_number_guardrails.sql` ajoute un second verrou fail-closed pour les numéros spéciaux français à tarification majorée des racines 081, 082 et 089. Il traduit en contrôles techniques séparés les exigences du plan de numérotation applicable au 1er janvier 2026, sans prétendre délivrer une certification juridique.

Avant activation externe, le dossier doit désormais établir :

- l'affectation exclusive et stable du numéro à une seule personne physique ou morale ;
- l'utilisation du numéro pour un seul service ;
- la mise à disposition de la portabilité dès l'affectation ;
- la vérification du respect du plafond tarifaire applicable à la racine concernée ;
- l'absence d'utilisation temporaire du numéro pour contacter une personne sans consentement préalable explicite ;
- l'éligibilité de l'entité lorsqu'elle relève du secteur public, ou le caractère non applicable de ce contrôle ;
- pour un 089, le blocage de sa présentation comme identifiant de l’appelant ;
- pour un 0895, la classification explicite correspondant à la catégorie dédiée aux services que l'éditeur souhaite rendre inaccessibles avec l'option de contrôle parental.

Une seconde chaîne de preuves, `sva_arcep_2026_evidence_events`, est append-only et protégée par SHA-256. Une activation concurrente du même numéro par deux clients est aussi refusée sous verrou transactionnel par numéro.

Dans le cockpit administrateur, chaque numéro externe dispose maintenant d'une fiche « Conformité ARCEP 2026 ». Elle présente séparément les huit contrôles, leur statut courant et permet d'ajouter un nouvel événement de preuve avec source et référence. Aucun bouton ni automatisme ne transforme un contrôle en `verified` sans action explicite ; le backend exige en plus une référence de preuve pour tout statut `verified`.

## Surveillance des échéances

La migration `043_regulatory_review_monitoring.sql` ajoute une file d'attention réglementaire persistante. Le worker d'alertes la réévalue périodiquement et classe les situations en quatre niveaux opérationnels visibles dans le cockpit :

- **Bloquant** : revue dépassée, profil actif qui n'est plus prêt, contrôle plateforme `failed/expired` ou preuve de plateforme arrivée à expiration.
- **Aujourd'hui** : échéance dans les 24 heures.
- **Bientôt** : échéance dans les 30 jours.
- **Revue non planifiée** : profil techniquement prêt mais sans prochaine date de revue.

Les alertes sont dédupliquées. Un administrateur peut les acquitter ; cet acquittement ne modifie ni la preuve, ni son statut, ni le routage. Une aggravation de l'état réouvre automatiquement l'alerte.

La surveillance ne suspend pas automatiquement une affectation déjà active. En revanche, les fonctions de readiness continuent de bloquer une nouvelle activation lorsque la revue est dépassée ou que les contrôles requis ne sont plus prêts. Cette séparation évite qu'une simple échéance calculée provoque une coupure de production sans décision opérationnelle explicite.

Lors de l'ajout d'une preuve ARCEP 2026 depuis le cockpit, l'administrateur peut définir `next_review_at`. Cette date alimente directement la surveillance proactive.

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
- profil ARCEP 2026, chaîne de preuves ARCEP 2026 et hash de tête dédié ;
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

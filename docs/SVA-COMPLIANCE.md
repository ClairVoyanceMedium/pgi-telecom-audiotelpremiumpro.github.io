# SVA Compliance Center — version 1.30

Le SVA Compliance Center complète le Regulatory Trust Center et les garde-fous ARCEP 2026. Il structure les preuves liées à l'écosystème SVA français sans revendiquer de certification, d'agrément, d'adhésion ou d'approbation d'un organisme.

## Référentiels suivis

Le registre `regulatory_framework_registry` distingue volontairement les rôles :

- **ARCEP** : plan national de numérotation et règles attachées aux ressources ;
- **APNF / RSVA** : informations de référence sur l'éditeur, le service et la tarification SVA ;
- **af2m** : recommandations déontologiques SVA 2026, version applicable depuis le 1er septembre 2026 ;
- **DGCCRF** : information tarifaire, pratiques loyales, réclamations et protection du consommateur ;
- **CNIL** : information vie privée, minimisation, conservation et droits des personnes ;
- **33700** : traitement et escalade des signalements d'appels/messages indésirables ;
- **médiation de la consommation** : évaluation d'applicabilité et preuve du dispositif lorsque requis ;
- **ACPR / DSP2** : évaluation d'applicabilité lorsqu'un modèle pourrait relever des services de paiement.

Les deux derniers cadres sont explicitement conditionnels. Une conclusion `not_applicable` est possible uniquement pour les contrôles autorisés et doit être justifiée.

## Profil SVA par numéro

`sva_service_compliance_profiles` décrit notamment :

- catégorie et audience du service ;
- mode de facturation ;
- prix TTC par appel lorsqu'il existe ;
- durée maximale facturable ;
- plafond mensuel utilisateur ;
- paramètres MGIT ;
- information vie privée ;
- contact consommateur ;
- référence de médiation ;
- version du référentiel af2m ;
- prochaine revue.

Le profil n'est jamais présenté comme une validation juridique.

## Garde-fous AF2M 2026

La readiness technique applique des contrôles locaux correspondant notamment aux éléments structurants du référentiel 2026 :

- prix par appel inférieur ou égal à 24 EUR TTC ;
- plafond utilisateur mensuel inférieur ou égal à 300 EUR TTC ;
- pour un service facturé à plus de 0,20 EUR/min, durée facturable maximale de 30 minutes ;
- lorsque le MGIT est requis : durée de 10 à 20 secondes, tarif annoncé en premier, indication de renoncement, absence de musique de fond et bip avant facturation.

Ces contraintes servent de garde-fous logiciels. Elles ne remplacent pas l'analyse du service réel ni les obligations contractuelles.

## Preuves et audit

Les preuves sont enregistrées dans `sva_ecosystem_evidence_events`.

- append-only ;
- chaîne SHA-256 ;
- source identifiée ;
- référence de preuve ;
- échéance facultative ;
- justification obligatoire lorsqu'un contrôle conditionnel est déclaré non applicable.

L'**Evidence Pack** réglementaire inclut désormais la chaîne historique Trust Center, la chaîne ARCEP 2026 et la chaîne SVA écosystème.

Il exclut toujours les RIO bruts, secrets de portabilité, numéros appelants et contenus d'appel.

## Changements tarifaires

`sva_tariff_change_plans` prépare localement les changements tarifaires :

- date d'effet au premier jour d'un mois ;
- délai local minimal de sept jours ;
- tarif cible et référence RSVA éventuelle ;
- historique et audit.

Aucune opération de cette table ne transmet une déclaration au RSVA. La future connexion APNF/RSVA devra rester un adaptateur externe explicite.

## Activation

Pour une nouvelle activation SVA externe française, trois niveaux indépendants doivent être prêts :

1. Regulatory Trust Center ;
2. garde-fous ARCEP 2026 lorsque applicables ;
3. SVA Ecosystem Readiness.

Le trigger `zzzzz_tenant_number_assignments_sva_ecosystem_gate` est fail-closed pour les nouvelles activations.

L'ajout de la migration 045 ne suspend pas automatiquement les lignes déjà actives.

## Sources de référence

La conception est alignée sur les sources publiques vérifiées lors de la version 1.30, notamment :

- décision ARCEP n° 2025-2215 et plan national de numérotation ;
- décision ARCEP n° 2022-1583 concernant notamment le référentiel SVA ;
- recommandations déontologiques SVA 2026 de l'af2m ;
- informations DGCCRF relatives aux numéros surtaxés et au message gratuit d'information tarifaire ;
- référentiels publics CNIL relatifs à la transparence et, selon le champ applicable, aux violations de données dans les communications électroniques.

Le logiciel conserve les versions/références afin de permettre des révisions futures : une règle externe peut évoluer sans que son ancien état de preuve soit réécrit.

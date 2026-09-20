# PGI Telecom — trajectoire Wholesale SVA

Dernière vérification marché et réglementation : 18 septembre 2026.

## Objectif

PGI Telecom doit pouvoir évoluer d'un service Audiotel exploité pour compte propre vers une plateforme SVA multi-clients, puis éventuellement vers un opérateur SVA attributaire de ses propres ressources.

La plateforme technique reste indépendante de l'opérateur amont : SIP/FreeSWITCH, routage, CDR, réconciliation, supervision, dashboard, clients et experts restent dans PGI.

## Principe réglementaire à respecter

Pour les numéros spéciaux et courts, un opérateur attributaire ne peut pas mettre de nouveaux numéros à disposition d'un autre opérateur. Hors portabilité, le numéro spécial doit être affecté à l'utilisateur final par l'opérateur attributaire.

Conséquence pour PGI :

- avant d'être lui-même attributaire, PGI peut être intégrateur / plateforme / partenaire commercial ;
- l'opérateur amont reste l'autorité réglementaire d'affectation du 089 à l'éditeur final ;
- PGI conserve dans sa base le tenant, l'éditeur, le numéro, le contrat commercial et l'identité de l'opérateur réglementairement assignant ;
- aucune interface PGI ne doit laisser croire qu'un numéro est juridiquement attribué par PGI tant que PGI n'est pas lui-même attributaire.

Sources :
- ARCEP, décision 2018-0881 et règles de gestion des numéros ;
- consultation ARCEP 2025 sur le plan de numérotation ;
- https://www.arcep.fr/uploads/tx_gsavis/18-0881.pdf
- https://www.arcep.fr/uploads/tx_gspublication/consultation-plan-de-numerotation-2025_juil2025.pdf

## Paiements / reversements

Le modèle commercial cible de PGI est explicite :

```
Opérateur SVA amont
        │ reversement SVA rapproché
        ▼
    PGI Telecom
        │ conserve la marge contractuelle PGI
        ▼
  Net dû au client
        │ paiement sous contrôle de conformité
        ▼
   Client / éditeur
```

Dans le ledger PGI, le reversement opérateur est donc attribué à PGI avant calcul du net client. PGI conserve sa marge selon les conditions configurées pour le tenant, le marché ou le numéro. L’absence de conditions commerciales bloque le reversement client et ne vaut jamais marge nulle implicite.

La circulation juridique et bancaire des fonds doit utiliser un montage autorisé pour le marché concerné. Selon le contrat retenu, cela peut notamment nécessiter un PSP agréé, un statut d’agent de PSP ou un autre schéma validé. `payment_compliance_profiles` représente ce garde-fou. Aucun net client ne devient payable tant que le règlement amont n’est pas encaissé et que le profil de conformité applicable, le KYC et les informations bancaires ne sont pas validés.

Ne jamais activer en production un transit de fonds tiers sur un simple compte bancaire PGI sans cadre de conformité actif.

L'AF2M publie une liste de PSP du marché SVA et des informations sur la mise en conformité :
- https://af2m.org/liste-prestataires-services-paiement-dsp2/
- https://af2m.org/mise-en-conformite-marche-sva-dsp2-reunion-acpr-decembre-2020/

## KYC éditeurs

Chaque éditeur final doit pouvoir être identifié et contrôlé avant activation d'un numéro majoré. PGI conserve uniquement l'état et les références nécessaires dans son modèle ; les documents sensibles doivent rester chez le fournisseur KYC/PSP ou dans un stockage privé prévu à cet effet, jamais dans le dépôt Git.

Les règles déontologiques SVA applicables depuis le 1er septembre 2026 sont publiées par l'AF2M :
- https://af2m.org/rd-sva/

## Phases

### Phase A — PGI éditeur unique

Flux :

```
Opérateur SVA attributaire
        │
        │ numéro 089 + collecte + reversement
        ▼
PGI Telecom
        │ SIP
        ▼
FreeSWITCH / routage / experts
```

L'opérateur amont fournit le 089 et la collecte. PGI fournit le service et toute la couche technique.

### Phase B — PGI plateforme multi-éditeurs

Flux :

```
Opérateur SVA attributaire
        │
        ├── 089 → Editeur A
        ├── 089 → Editeur B
        └── 089 → Editeur C
                │
                ▼
           PGI Telecom
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
    Tenant A Tenant B Tenant C
```

L'opérateur attributaire reste le titulaire réglementaire de l'affectation. PGI gère :

- onboarding et états KYC ;
- configuration commerciale ;
- routage SIP ;
- isolation des données ;
- experts/destinations ;
- CDR ;
- calculs de reversements ;
- reporting ;
- facturation de la plateforme ;
- rapprochement entre relevés amont et comptes clients.

### Phase C — PGI opérateur SVA attributaire

Objectifs supplémentaires :

1. Obtenir les ressources de numérotation auprès de l'ARCEP.
2. Mettre en place les interconnexions et conventions nécessaires.
3. Souscrire aux Conditions Générales de Services SVA AF2M.
4. Adhérer aux processus APNF requis et obtenir les identifiants opérateur correspondants.
5. Mettre en œuvre la conformité DSP2 via un PSP/agent ou autre schéma validé.
6. Mettre en place les procédures KYC/LCB-FT et de contrôle des éditeurs.
7. Assurer portabilité, ouverture réseau, lutte antifraude, réconciliation et obligations de reporting.

AF2M — souscription opérateur SVA :
https://af2m.org/souscrire-aux-cgs-sva/

ARCEP — taxes de numérotation :
https://www.arcep.fr/la-regulation/grands-dossiers-thematiques-transverses/la-numerotation/taxes-de-numerotation.html

## Candidats amont identifiés

### Orange Wholesale France

Positionnement : niveau interconnexion opérateur.

Offre officielle SVA :
- ouverture des numéros SVA sur réseaux Orange et opérateurs tiers ;
- collecte/facturation/recouvrement ;
- interconnexion IP ;
- convention d'interconnexion requise.

Source :
https://wholesale.orange.com/france/fr/nos-solutions/interconnexion/fixe/service-a-valeur-ajoutee/

Statut PGI : cible stratégique pour la phase opérateur. Le contact commercial passe par le formulaire officiel Orange Wholesale ; aucune adresse e-mail SVA wholesale publique fiable n'a été identifiée.

### Remmedia

Positionnement : opérateur SVA attributaire spécialisé.

Éléments vérifiés :
- tranches SVA/089 en propre ;
- collecte et portabilité ;
- portail de portabilité en marque blanche pour opérateurs ;
- CGV prévoyant le cas où le client n'exploite pas directement le numéro et doit fournir l'identité/KYC de l'éditeur final ;
- présence d'un montage PSP/agent dans son offre.

Sources :
https://www.remmedia.fr/operateur-sva-france/
https://www.remmedia.fr/vos_numeros_appels/portabilite-de-numeros-entreprise-fixe-mobile/
https://www.remmedia.fr/cgu/

Statut PGI : demande wholesale/marque blanche envoyée le 18/09/2026 à commercial@remmedia.fr.

### Even Media Interactive

Positionnement : opérateur télécom + monétisation.

Éléments vérifiés :
- numéros SVA ;
- trunks SIP ;
- monétisation d'audience ;
- hébergement et développement d'applications audio.

Sources :
https://evenmedia.fr/
https://evenmedia.fr/presentation

Statut PGI : demande wholesale/SIP envoyée le 18/09/2026 à contact@evenmedia.fr.

### Axialys

Positionnement : opérateur / plateforme relation client.

Éléments vérifiés :
- catalogue de numéros SVA ;
- reversements ;
- trunk SIP documenté ;
- API/statistiques et interconnexion IP.

Sources :
https://www.axialys.com/solutions-marketing/numeros-speciaux/
https://guide.axialys.com/guide/guide-technique-trunk-sip/

Statut PGI : demande wholesale/SIP envoyée le 18/09/2026 à axialys@axialys.com.



### BJT Partners

Positionnement : opérateur téléphonique disposant de sa propre infrastructure et de ses propres numéros.

Éléments vérifiés :
- infrastructure opérateur propre ;
- interconnexions directes annoncées avec Orange, SFR et plusieurs opérateurs internationaux ;
- ressources de numérotation propres ;
- présence historique de services SVA 089.

Sources :
https://www.bjtpartners.com/
https://a.surmafacture.fr/sva?date=2026-03-03&numero=0890358667

Statut PGI : demande wholesale/SIP/multi-clients envoyée le 18/09/2026 à support@bjtmail.com, avec demande de transfert au service commercial/opérateurs.

### Sewan

Positionnement : opérateur télécom et plateforme de distribution en marque blanche.

Éléments vérifiés :
- modèle partenaire en marque blanche ;
- plus de 1 000 partenaires télécoms ;
- autonomie commerciale et gestion de marge laissées aux partenaires ;
- plateforme de gestion automatisée Sophia.

Sources :
https://www.sewan.fr/fr-fr/devenez-partenaire/
https://www.sewan.fr/fr-fr/specialiste-telecoms/

Statut PGI : demande wholesale/SVA envoyée le 18/09/2026 à contact@sewan.fr.

### SFR Business

Positionnement : opérateur national avec offre Numéros Spéciaux/SVA.

Éléments vérifiés :
- numéros spéciaux à tarification majorée ;
- MGIT géré dans l'offre ;
- fichiers eBills mensuels détaillés avec numéro SVA, réseau appelant, durée, montant facturé et référence unique d'appel ;
- compte de reversement présent dans les données de facturation.

Sources :
https://assistance.utilisateur-relationclient.sfrbusiness.fr/numeros-speciaux/
https://assistance.utilisateur-relationclient.sfrbusiness.fr/ns/dmc-e-bills-ou-fichiers-de-facturation-2-2/

Statut PGI : demande de relation wholesale/interconnexion envoyée le 18/09/2026 à relationclientsentreprise@sfr.com avec demande de transfert au service Numéros Spéciaux/opérateurs.

### Keyyo / Bouygues Telecom Pro

Positionnement : opérateur entreprise avec réseau de revendeurs.

Éléments vérifiés :
- tarifs et reversements SVA publiés ;
- réseau de plus de 300 partenaires revendeurs ;
- programme partenaire.

Sources :
https://www.keyyo.com/fr/numeros-speciaux/tarifications-reversements
https://partner.keyyo.com/fr/devenir-partenaire

Statut PGI : programme partenaire/marque blanche confirmé publiquement ; le contact commercial passe par le formulaire partenaire officiel, aucun e-mail commercial direct fiable n'a été identifié.

## Données à obtenir de chaque fournisseur

Aucun fournisseur n'est considéré validé tant que les éléments suivants ne sont pas reçus par écrit :

- preuve que le fournisseur est attributaire ou identité exacte de l'attributaire ;
- modèle contractuel wholesale / marque blanche / partenaire ;
- capacité à gérer plusieurs éditeurs finaux ;
- règles KYC et secteurs autorisés ;
- liste des paliers 089 ;
- reversement net par palier ;
- frais fixes et variables ;
- réserve de fraude / holdback ;
- délais de paiement ;
- livraison SIP vers notre SBC/FreeSWITCH ;
- redondance et SLA ;
- formats CDR/API/SFTP ;
- données de règlement pour rapprochement appel par appel ;
- procédure de portabilité ;
- API de provisioning en volume ;
- conditions de sortie et conservation/portabilité des numéros.

## Règle d'architecture PGI

Aucun fournisseur ne doit être codé en dur.

La chaîne reste :

```
tenant
  → tenant_number_assignment
  → sva_number
  → logical carrier route
  → carrier adapter
  → upstream carrier
```

Les flux financiers restent séparés :

```
appel
  → revenu service théorique
  → payout amont attendu
  → payout amont confirmé
  → frais plateforme PGI
  → reversement tenant
```

Les écritures financières restent auditables et append-only.


## Extension internationale

La couche Wholesale est désormais multi-marchés. Le pays juridique du tenant est distinct de ses marchés d’exploitation, et chaque marché peut avoir sa propre devise, locale, timezone, conformité, numérotation et capacité opérateur.

Les numéros restent canoniques en E.164 et les formes livrées par les trunks sont gérées par des alias explicites. Les reversements sont regroupés par devise et ne sont jamais consolidés entre monnaies sans politique de change.

Voir `docs/INTERNATIONAL.md` pour le modèle complet et la procédure contrôlée d’ouverture d’un nouveau pays.

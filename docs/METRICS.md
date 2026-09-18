# Référentiel des métriques

## Finance

### CA généré

Montant théorique de la composante service facturée aux appelants.

```
CA service TTC = unités facturables × tarif service TTC
```

Ce chiffre n'est pas le reversement encaissé par PGI Telecom.

### Reversement attendu

Montant calculé avec le contrat opérateur applicable à l'appel :

- taux par minute ;
- origine mobile/fixe ;
- durée minimale ;
- incrément de facturation ;
- règle d'arrondi ;
- exclusions contractuelles.

### Reversement confirmé

Montant reconnu par le relevé ou CDR opérateur après rapprochement.

### Reversement encaissé

Montant réellement réglé sur le compte de paiement. En production, il doit rester distinct du montant confirmé.

### Écart de réconciliation

```
écart = reversement attendu - reversement confirmé
```

Un écart ne doit jamais être effacé automatiquement. Il passe par un statut documenté : matched, variance, excluded ou manual_review.

### Marge estimée

```
marge = reversement confirmé - coût expert - coûts techniques affectés
```

La fiscalité et les charges externes non intégrées au moteur ne doivent pas être présentées comme incluses.

## Téléphonie

### Calls total
Nombre total de tentatives entrant dans le périmètre sélectionné.

### Connected
Appels ayant atteint la mise en relation avec un expert.

### ASR
Answer-Seizure Ratio :

```
ASR = appels aboutis / tentatives × 100
```

### ACD
Average Call Duration : durée moyenne de conversation des appels aboutis.

### Wait time
Temps entre l'entrée dans la file et la mise en relation.

### Billable duration
Durée reconnue par notre moteur de facturation.

### Payout-eligible duration
Durée éligible au reversement selon les règles du contrat opérateur. Elle peut différer de la durée facturable.

## Qualité média

### Latence
Mesure aller ou aller-retour selon la source. La source exacte doit être enregistrée avec la métrique.

### Jitter
Variation du délai RTP.

### Packet loss
Part des paquets RTP perdus.

### MOS
Indicateur de qualité lorsqu'il est réellement calculé ou fourni. Ne jamais fabriquer un MOS en production.

## Remise à zéro

Une remise à zéro du dashboard crée une **baseline**. Elle ne modifie ni ne supprime :

- appels ;
- CDR ;
- relevés opérateur ;
- règlements ;
- journaux d'audit.

La période affichée est simplement bornée par la baseline active.

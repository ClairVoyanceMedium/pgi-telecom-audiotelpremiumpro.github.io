# Procédure de réponse à incident

## Sévérité

### P1
- 089 indisponible ;
- trunk SIP coupé ;
- perte ou corruption de CDR ;
- suspicion de compromission ;
- écart financier massif ou systémique.

### P2
- baisse significative d'ASR ;
- latence ou qualité dégradée ;
- retard d'ingestion CDR ;
- divergence financière limitée.

### P3
- problème d'affichage ;
- métrique secondaire indisponible ;
- défaut sans impact client.

## P1 — actions immédiates

1. Ne pas supprimer de données.
2. Noter heure de début et symptômes.
3. Identifier la dernière version Git connue comme saine.
4. Vérifier opérateur, SIP, Kamailio, FreeSWITCH, API, base.
5. Si compromission suspectée, révoquer les secrets affectés.
6. Conserver les logs utiles.
7. Effectuer un rollback si la cause est liée au dernier déploiement.
8. Ouvrir un rapport d'incident avec chronologie.

## Incident financier

- figer le relevé source ;
- calculer son SHA-256 ;
- ne jamais éditer le fichier d'origine ;
- isoler les appels divergents ;
- documenter toute exclusion ou correction.

## Après incident

- cause racine ;
- impact ;
- mesures correctives ;
- tests ajoutés ;
- action préventive ;
- date de clôture.

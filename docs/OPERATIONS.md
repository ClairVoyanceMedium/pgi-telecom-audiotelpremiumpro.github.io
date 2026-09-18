# Runbook d'exploitation

## Priorité 1 — appel impossible

1. Vérifier l'état du trunk SIP.
2. Vérifier la résolution DNS et la connectivité vers le SBC opérateur.
3. Vérifier les réponses SIP 4xx/5xx/6xx.
4. Vérifier Kamailio puis FreeSWITCH.
5. Vérifier les limites de concurrence.
6. Ne jamais modifier le numéro public ou le palier D080 comme action de dépannage automatique.

## Priorité 1 — écart financier

1. Geler l'état de réconciliation, sans supprimer de CDR.
2. Calculer minutes éligibles internes.
3. Importer/recontrôler le relevé opérateur.
4. Comparer règle d'arrondi, durée minimale et origine mobile/fixe.
5. Identifier les appels divergents.
6. Journaliser toute correction manuelle.

## Sauvegardes

Cibles minimales à mettre en production :

- PostgreSQL : sauvegarde quotidienne + WAL/PITR si disponible ;
- configurations téléphonie : Git + copie chiffrée ;
- relevés opérateur : stockage privé immuable ;
- secrets : gestionnaire dédié, jamais dans Git.

Le script `scripts/backup-postgres.sh` écrit d’abord un fichier temporaire, vérifie que son catalogue est lisible par `pg_restore`, puis calcule et revalide son SHA-256 avant de publier le dump. Une restauration complète dans une base isolée doit néanmoins être testée périodiquement. Une sauvegarde jamais restaurée ne constitue pas une preuve de reprise.

## Déploiement

- toute modification passe par Git ;
- tests automatiques avant déploiement ;
- tag/version pour les releases ;
- rollback vers la version précédente en cas d'échec ;
- migration base de données versionnée et réversible lorsque possible.

## Alertes production à prévoir

- trunk SIP indisponible ;
- hausse des erreurs SIP ;
- ASR en chute ;
- ACD anormalement bas ;
- aucune CDR reçue depuis X minutes ;
- divergence CDR opérateur/interne ;
- retard de règlement ;
- CPU/RAM/disque ;
- latence/jitter/perte paquets ;
- expert bloqué en statut busy ;
- file d'attente anormalement longue.

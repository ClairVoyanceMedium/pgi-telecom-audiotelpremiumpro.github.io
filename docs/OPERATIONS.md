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

Le script `scripts/backup-postgres.sh` exécute `pg_dump` à l’intérieur du conteneur PostgreSQL privé, écrit d’abord un fichier temporaire, vérifie que son catalogue est lisible par `pg_restore`, puis calcule et revalide son SHA-256 avant de publier le dump. Le script `scripts/restore-drill.sh <dump>` restaure ensuite le fichier dans une base temporaire isolée, contrôle les tables critiques et supprime cette base de test. Une sauvegarde jamais restaurée ne constitue pas une preuve de reprise.

## Déploiement

- toute modification passe par Git ;
- tests automatiques avant déploiement ;
- tag/version pour les releases ;
- rollback vers la version précédente en cas d'échec ;
- migration base de données versionnée et réversible lorsque possible.

## Migrations de base de données

Avant chaque déploiement backend, le service `migrate` doit terminer avec succès. Une erreur de migration ou un checksum différent interdit le démarrage de l’API.

Ne jamais corriger rétroactivement un fichier déjà présent dans `schema_migrations`. Ajouter une nouvelle migration corrective.

## Liveness et readiness

Deux sondes ont des rôles distincts :

- `/api/v1/health` confirme uniquement que le processus HTTP répond ;
- `/api/v1/ready` reste privé et valide PostgreSQL ainsi que la fraîcheur des workers outbox et alertes.

Le healthcheck Docker utilise `/ready`. Par défaut, le worker outbox doit avoir réussi dans les 15 dernières secondes et le worker alertes dans les 120 dernières secondes. Ces seuils peuvent être ajustés par environnement sans modifier le code.

## Arrêt gracieux et traçabilité

Lors d’un arrêt, les workers sont stoppés, les connexions SSE sont drainées et le serveur HTTP dispose de 10 secondes par défaut pour terminer les connexions restantes avant fermeture forcée.

Chaque requête production écrit un log JSON minimal avec `request_id`, route logique, méthode, statut et durée. L’URL brute, les paramètres, le numéro appelant et le corps des requêtes ne sont pas journalisés.

Le front et l’API exposent la version ainsi que le SHA Git exact. Après chaque déploiement, ces deux valeurs doivent correspondre au commit attendu.

## Audit hôte 24/7

Le script `scripts/host-audit.sh` réalise un contrôle local complet sans exposer de nouvel endpoint Internet :

- symlinks de releases front/backend et alignement des SHA Git ;
- identité de release réellement annoncée par le front et l’API ;
- `/health` et `/ready` ;
- métriques locales : outbox, retard CDR et experts disponibles ;
- état des conteneurs PostgreSQL/API ;
- espace disque libre ;
- présence, âge et checksum de la dernière sauvegarde PostgreSQL.

Seuils par défaut :

- sauvegarde : maximum 30 h ;
- espace libre : minimum 5 GiB ;
- retard CDR en phase opérateur : maximum 900 s ;
- outbox : maximum 100 événements ;
- alignement SHA front/backend : obligatoire.

Les exemples `infra/systemd/pgi-host-audit.service.example` et `infra/systemd/pgi-host-audit.timer.example` exécutent cet audit toutes les cinq minutes. Les chemins de référence sont `/srv/pgi-backend`, `/srv/pgi-dashboard` et `/etc/pgi-telecom/production.env`. Si d’autres chemins sont retenus lors de l’installation du serveur, adapter l’unité avant activation.

L’audit écrit uniquement dans le journal systemd. Aucun service de monitoring supplémentaire n’est requis pour ce contrôle local.

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

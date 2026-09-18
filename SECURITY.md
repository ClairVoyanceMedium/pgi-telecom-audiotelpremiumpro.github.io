# Security Policy

## Surfaces publiques et privées

Le dépôt peut contenir le front de démonstration et le code applicatif, mais jamais de secret ni de donnée client réelle.

GitHub Pages est réservé au mode `demo`. Le cockpit de production est construit en mode `production` et servi en même origine que l’API derrière Caddy.

## Secrets interdits dans Git

Ne jamais committer :

- identifiants ou mots de passe SIP ;
- secret FreeSWITCH/Kamailio ;
- token opérateur ou token d’ingestion ;
- secret de session ;
- mot de passe PostgreSQL ;
- clé de hachage des appelants ;
- fichier d’environnement réel ;
- CDR réels ;
- numéro appelant complet ;
- IBAN, KYC ou document contractuel ;
- export financier confidentiel.

Les secrets de production sont injectés depuis l’environnement sécurisé du serveur ou GitHub Environments/Secrets selon le flux de déploiement.

## Authentification du cockpit

La production impose l’authentification par session.

Les cookies utilisent le préfixe `__Host-`, `Secure`, `SameSite=Strict` et `Path=/`. Le cookie de session est `HttpOnly`. Les écritures exigent en plus le jeton CSRF correspondant.

Le login possède une limite anti-bruteforce dédiée par client, distincte de la limite globale de l’API.

## Endpoints machine

L’API écoute sur loopback côté hôte. Caddy ne publie pas :

- `/api/v1/internal/*` ;
- `/api/v1/ingest/freeswitch` ;
- `/api/v1/ready` ;
- `/api/v1/ingest/cdr` par défaut.

FreeSWITCH/Kamailio utilisent les routes locales directement. Si un futur opérateur impose une ingestion CDR distante, l’exposition de `/api/v1/ingest/cdr` devra être ajoutée explicitement avec authentification par token et, si disponible, filtrage IP opérateur.

## Données personnelles

Les numéros appelants sont masqués par défaut. Le hachage utilise une clé dédiée de production. Le navigateur ne reçoit aucun secret opérateur.

L’accès éventuel à une donnée complète devra être limité à un rôle autorisé et journalisé.

## Base de données

L’API production ne démarre qu’après réussite des migrations transactionnelles. Une migration déjà appliquée est identifiée par son checksum et ne doit jamais être modifiée rétroactivement.

Les sauvegardes PostgreSQL doivent être lisibles par `pg_restore`, vérifiées par SHA-256 et faire l’objet de tests périodiques de restauration réelle.

## Remise à zéro

La remise à zéro des métriques ne supprime jamais les CDR sources. Elle crée une baseline auditée en base.

# Modèle de menace

## Actifs critiques

- disponibilité du 089 ;
- identifiants SIP ;
- CDR ;
- règlements opérateur ;
- données clients ;
- comptes administrateur ;
- comptes experts ;
- historique d'audit ;
- paramètres de tarification.

## Menaces principales

### Fraude SIP

Risque : appels non autorisés, détournement de trunk ou consommation de ressources.

Mesures :

- ACL IP opérateur stricte ;
- authentification selon le contrat ;
- limitation de débit ;
- séparation du plan d'administration ;
- alertes sur volumes anormaux ;
- aucun secret dans GitHub.

### Falsification financière

Risque : modification d'un CDR ou d'un montant confirmé pour masquer une divergence.

Mesures :

- CDR sources immuables ;
- journal d'audit append-only ;
- rapprochement attendu/confirmé séparé ;
- corrections manuelles tracées ;
- hash des fichiers de relevé opérateur.

### Compromission du compte admin

Mesures :

- authentification forte ;
- MFA côté fournisseur d'identité ;
- sessions courtes pour les opérations sensibles ;
- journalisation des exports et accès aux numéros complets ;
- principe du moindre privilège.

### Fuite de données

Mesures :

- numéro masqué par défaut ;
- hash déterministe pour les recherches de récurrence ;
- chiffrement applicatif du numéro complet si sa conservation est nécessaire ;
- aucune donnée réelle dans GitHub Pages ;
- export uniquement via backend authentifié.

### Déni de service

Mesures :

- limites de concurrence ;
- files d'attente bornées ;
- timeouts SIP et API ;
- surveillance CPU/RAM/disque ;
- stratégie de reprise opérateur si disponible.

### Données périmées dans le front

Mesures :

- aucune CDR réelle dans le cache PWA ;
- requêtes API en no-store ;
- indication explicite de l'état réseau ;
- horodatage de dernière synchronisation.

## Séparation des responsabilités

GitHub contient le code et la configuration non sensible.

Le serveur privé contient l'exécution, les secrets, les CDR et les données financières.

# Téléphonie — couche opérateur minimale

Ce dossier documente l'interface attendue entre l'opérateur SVA et PGI Telecom.

## Chaîne cible

```
Opérateur SVA D080
      │
      │ SIP
      ▼
SBC / Kamailio
      │
      ▼
FreeSWITCH
      │
      ├── SVI
      ├── files d'attente
      ├── ponts vers experts
      ├── CDR
      └── événements temps réel
```

## Paramètres à obtenir avant configuration finale

Ne pas inventer ces valeurs. Elles devront venir du contrat opérateur :

- adresse(s) IP/SBC opérateur ;
- transport UDP/TCP/TLS autorisé ;
- ports SIP ;
- authentification IP ou digest ;
- codecs ;
- format du numéro appelé ;
- format CLI ;
- gestion P-Asserted-Identity / Diversion ;
- DTMF RFC2833/SIP INFO ;
- timers et Session-Expires ;
- codes SIP spécifiques de rejet ;
- contraintes de concurrence ;
- plan de reprise / second SBC ;
- méthode d'export CDR opérateur.

## Sécurité

- aucune interface SIP d'administration exposée publiquement ;
- ACL stricte sur les IP opérateur ;
- fail2ban/rate-limit en complément, jamais à la place des ACL ;
- TLS/SRTP si fourni et supporté de bout en bout ;
- secrets hors GitHub ;
- logs sans numéro complet par défaut ;
- séparation réseau management / signalisation / données lorsque l'infrastructure le permet.

## CDR

FreeSWITCH devra générer un identifiant d'appel stable propagé au backend et rapprochable avec l'identifiant opérateur.

Les durées suivantes doivent rester distinctes :

- durée totale ;
- attente ;
- conversation ;
- durée facturable ;
- durée éligible au reversement.

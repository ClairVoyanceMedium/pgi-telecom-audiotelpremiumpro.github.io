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


## Routage multi-client obligatoire

En production, FreeSWITCH doit transmettre le numéro SVA effectivement appelé à chaque demande de routage.

Exemple de contrat machine :

```
GET http://127.0.0.1:8080/api/v1/internal/routing/next-expert?sva_number=0890123456
```

ou, pour la réponse texte destinée au dialplan :

```
GET http://127.0.0.1:8080/api/v1/internal/routing/next-expert/text?sva_number=0890123456
```

Le backend résout :

```
numéro SVA
  → tenant propriétaire
  → experts appartenant au même tenant
  → expert disponible
```

En mode production :

- l'absence de `sva_number` provoque `SVA_ROUTING_CONTEXT_REQUIRED` ;
- un numéro inconnu ou non routable provoque `SVA_NUMBER_NOT_ROUTABLE` ;
- un numéro sans tenant provoque `SVA_TENANT_NOT_CONFIGURED` ;
- un CDR associant un expert d'un autre tenant est rejeté avec `EXPERT_TENANT_MISMATCH`.

Ce comportement est volontairement fail-closed : aucun appel ne doit pouvoir tomber sur l'équipe d'un autre éditeur à cause d'une configuration incomplète.

Le `destination_number` FreeSWITCH doit être propagé sans invention ni substitution. Le format exact (national/E.164) sera figé lors de l'intégration opérateur et devra correspondre à la valeur configurée dans `sva_numbers`.

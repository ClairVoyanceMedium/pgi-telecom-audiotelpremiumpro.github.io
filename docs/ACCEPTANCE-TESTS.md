# Tests d'acceptation avant production

Aucun lancement réel ne doit être validé tant que les scénarios critiques n'ont pas été exécutés.

## Appels

- appel depuis Orange mobile ;
- appel depuis Orange fixe si disponible ;
- appel depuis SFR ;
- appel depuis Bouygues ;
- appel depuis Free ;
- appel abouti vers un expert disponible ;
- appel lorsque l'expert est occupé ;
- abandon dans le SVI ;
- abandon dans la file ;
- raccrochage expert ;
- raccrochage appelant ;
- appel simultané multiple ;
- appel long ;
- appel très court ;
- DTMF valide et invalide.

## CDR

Pour chaque scénario :

- started_at correct ;
- bridged_at correct ;
- ended_at correct ;
- attente correcte ;
- conversation correcte ;
- durée facturable correcte ;
- durée éligible reversement correcte ;
- opérateur d'origine correct ;
- expert correct ;
- SIP final code correct ;
- cause de fin cohérente.

## Finance

- application du taux contractuel ;
- déduction mobile si contractuelle ;
- durée minimale ;
- incrément ;
- arrondi ;
- changement de contrat selon date d'effet ;
- rapprochement matched ;
- rapprochement variance ;
- appel absent du relevé ;
- doublon opérateur ;
- règlement partiel ;
- règlement complet ;
- correction rétroactive.

## Dashboard

- Aujourd'hui ;
- 7 jours ;
- semaine ;
- mois ;
- année ;
- période personnalisée ;
- filtres CDR ;
- export CSV ;
- impression/PDF ;
- fiche détaillée ;
- mobile 320 px ;
- tablette ;
- desktop ;
- état hors ligne ;
- reprise réseau.

## Baseline

- reset global ;
- aucune suppression de CDR ;
- historique de reset présent ;
- agrégats post-baseline corrects ;
- restauration de la vue historique réservée au rôle autorisé.

## Sécurité

- accès admin non autorisé refusé ;
- rôle finance limité ;
- rôle expert limité à ses données ;
- numéro complet masqué par défaut ;
- secret absent du front ;
- secret absent des logs ;
- secret absent des erreurs ;
- CORS validé ;
- cookies/session sécurisés ;
- MFA activé pour les comptes privilégiés.

## Résilience

- redémarrage API ;
- redémarrage PostgreSQL ;
- redémarrage Valkey ;
- redémarrage FreeSWITCH ;
- redémarrage Kamailio ;
- perte momentanée de l'API sans perte d'appel ;
- perte momentanée du dashboard sans perte de CDR ;
- restauration sauvegarde testée.

## Critère final

Le go-live nécessite zéro anomalie P1/P2 ouverte sur les flux appel, CDR, reversement et sécurité.

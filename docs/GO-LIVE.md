# Checklist Go-Live

## Contractuel

- [ ] 089 attribué
- [ ] D080 confirmé
- [ ] affectation/portabilité confirmée
- [ ] reversement écrit
- [ ] règles mobile/fixe écrites
- [ ] durée minimale/incrément/arrondi écrits
- [ ] délai de règlement écrit

## SIP

- [ ] SBC primaire
- [ ] SBC secondaire
- [ ] ACL configurée
- [ ] codecs validés
- [ ] DTMF validé
- [ ] RTP validé
- [ ] concurrence validée
- [ ] appels de tous réseaux testés

## Données

- [ ] PostgreSQL privé
- [ ] sauvegarde automatique
- [ ] restauration testée
- [ ] chiffrement/masquage validé
- [ ] politique de rétention configurée
- [ ] audit activé

## Finance

- [ ] moteur contractuel configuré
- [ ] import relevé opérateur
- [ ] rapprochement appel par appel
- [ ] statut payé distinct du statut confirmé
- [ ] seuils d'alerte configurés

## Application

- [ ] authentification
- [ ] rôles
- [ ] dashboard mobile
- [ ] exports
- [ ] baselines
- [ ] alertes
- [ ] mode production activé
- [ ] mode démo désactivé en production

## Exploitation

- [ ] monitoring
- [ ] alertes P1/P2
- [ ] espace disque
- [ ] logs
- [ ] rotation logs
- [ ] procédure incident
- [ ] procédure rollback
- [ ] coordonnées NOC opérateur

## Validation

- [ ] tous les tests de docs/ACCEPTANCE-TESTS.md passés
- [ ] aucun secret dans GitHub
- [ ] aucun incident P1/P2 ouvert

# Go-live opérateur SVA — checklist de preuve

## Règle

Une intégration opérateur n’est jamais considérée active parce qu’un nom d’opérateur existe dans l’interface. Le go-live exige des preuves commerciales, réglementaires, techniques et financières.

## 1. Contrat commercial

Conserver hors dépôt public :

- contrat signé ;
- entité contractante exacte ;
- marchés couverts ;
- familles de numéros autorisées ;
- grille tarifaire ;
- rémunération/reversement ;
- délais de règlement ;
- retenues et règles antifraude ;
- support et escalade ;
- SLA éventuel ;
- conditions de résiliation ;
- responsabilités relatives aux données et CDR.

Aucun taux opérateur fictif ne doit être utilisé en production.

## 2. Interconnexion technique

Valider :

- trunk SIP de production ;
- authentification IP, TLS, credentials ou mécanisme prévu ;
- IP et plages autorisées ;
- codecs ;
- DTMF ;
- CLI/ANI ;
- timeouts SIP ;
- capacité simultanée ;
- routage entrant ;
- destination de secours ;
- fenêtres de maintenance ;
- monitoring du trunk.

Les secrets restent exclusivement dans le gestionnaire de secrets de production.

## 3. Numéros

Pour chaque numéro :

- titulaire et assignor connus ;
- statut réel chez l’opérateur ;
- tarif appelant réel ;
- marché et réglementation associés ;
- données RSVA/APNF/AF2M requises selon le cas ;
- date d’activation ;
- destination active ;
- test d’appel entrant ;
- information tarifaire cohérente ;
- preuve exportable.

## 4. CDR et réconciliation

Avant tout reversement :

- schéma CDR documenté ;
- identifiant événement unique ;
- fuseau horaire ;
- règles d’arrondi ;
- durée facturable ;
- appels non éligibles ;
- annulations/corrections ;
- fréquence de remise ;
- rapprochement opérateur ↔ PGI ;
- tolérance de divergence ;
- procédure de contestation ;
- conservation de la source et empreinte des fichiers.

## 5. Fraude et conformité

Valider :

- trafic artificiel ;
- auto-appels ;
- ping call ;
- volumes atypiques ;
- destinations interdites ;
- blocage par numéro/service ;
- procédure 33700 ou mécanismes applicables ;
- contact fraude opérateur ;
- suspension urgente ;
- conservation de preuve ;
- reprise après faux positif.

## 6. Tests avant production

Exécuter au minimum :

1. appel normal connecté ;
2. appel abandonné ;
3. appel court ;
4. appel long ;
5. DTMF ;
6. transfert/routage ;
7. destination indisponible ;
8. bascule standby ;
9. rollback ;
10. duplication CDR ;
11. CDR en retard ;
12. événement inconnu ;
13. divergence financière ;
14. test de charge dans les limites contractuelles.

Chaque test doit laisser une preuve horodatée.

## 7. Bascule

Le changement d’opérateur utilise le mécanisme quatre yeux existant :

- préparation ;
- validation indépendante ;
- activation atomique ;
- contrôle health ;
- contrôle appels ;
- contrôle CDR ;
- contrôle financier ;
- fenêtre de rollback ;
- décision explicite de fermeture de la fenêtre.

## 8. Go / No-Go

GO uniquement si :

- contrat valide ;
- connexion active ;
- numéro réel actif ;
- route active ;
- destination fonctionnelle ;
- conformité sans blocage ;
- CDR reçus et rapprochés ;
- antifraude testée ;
- rollback prouvé ;
- support opérateur joignable ;
- Launch Readiness ne signale plus `operator` ou `regulatory` comme bloquant.

Sinon : NO-GO. Le produit peut continuer en préparation interne mais ne doit pas présenter le service concerné comme actif.

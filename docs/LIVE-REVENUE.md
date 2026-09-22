# Reversements en direct

## Objectif

Le cockpit client et le cockpit administrateur affichent une estimation financière qui progresse pendant les appels actifs, sans confondre cette estimation avec un montant comptabilisé ou payable.

## Trois niveaux financiers

1. **En direct, provisoire** : calcul à partir des routes actives, du temps écoulé et des conditions contractuelles actuellement applicables.
2. **Après fin d’appel** : le CDR calcule le reversement attendu avec les secondes réellement éligibles et les règles de facturation.
3. **Après rapprochement** : les relevés opérateur alimentent les montants confirmés puis payés. Pour un client externe, la distribution distingue le reversement opérateur, la marge PGI et le net client.

Le compteur live n’est donc jamais présenté comme un solde acquis.

## Calcul live

Le serveur résout, sans valeur fictive de secours en production :

- le numéro SVA et sa devise ;
- le contrat opérateur actif et son taux de reversement ;
- les conditions de reversement du tenant ;
- les appels/routes actuellement actifs ;
- le temps écoulé depuis la réservation de la route.

Il expose une base estimée et un taux par seconde. L’interface incrémente visuellement le compteur chaque seconde entre deux synchronisations serveur.

Le cockpit administrateur sépare :

- reversement opérateur estimé ;
- net clients estimé ;
- marge PGI estimée.

Le portail client n’expose que le net estimé lorsque le rôle possède `finance.read`.

## Fraîcheur

Le cockpit administrateur réagit aux événements de réservation et de libération de routes. Le portail client se resynchronise périodiquement lorsqu’il est connecté et visible. Le bouton « Mettre à jour le calcul » force également une lecture serveur.

## Limites et garde-fous

Une route générique pouvant porter plusieurs appels simultanés reste une estimation jusqu’au CDR. Le montant définitif est toujours issu des faits d’appel, des règles contractuelles et du rapprochement opérateur. Une devise ambiguë est affichée comme multi-devises plutôt que convertie artificiellement.

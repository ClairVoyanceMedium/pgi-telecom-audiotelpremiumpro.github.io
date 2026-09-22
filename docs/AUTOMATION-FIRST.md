# Automatisation par défaut

## Principe

Le chemin nominal de PGI Telecom doit fonctionner sans intervention humaine. Une action humaine n’est requise que pour une exception, une décision réglementaire/commerciale, une anomalie, un litige ou une opération irréversible.

## Chaîne nominale

1. inscription client et création du tenant ;
2. vérifications d’éligibilité et de conformité ;
3. activation de l’abonnement après événement serveur du prestataire de paiement ;
4. attribution ou portabilité du numéro ;
5. routage et suivi des appels ;
6. ingestion des CDR ;
7. calcul financier et rapprochement opérateur ;
8. distribution opérateur → PGI → marge PGI → net client ;
9. génération des alertes et preuves ;
10. mise à jour automatique des cockpits.

Les traitements durables utilisent la `work_queue`, des leases, heartbeats, reprises et dead letters. Les effets externes doivent rester idempotents.

## Fail-closed

Une automatisation ne doit jamais transformer l’absence d’une preuve en succès. L’activation SVA reste bloquée si un prérequis obligatoire manque : contrat opérateur, conditions de reversement, KYC, conformité, affectation du numéro ou connexion externe requise.

## Intervention humaine

Le système peut préparer, vérifier, relancer et proposer. Une validation humaine reste volontairement conservée pour les opérations à risque élevé ou irréversibles, notamment les litiges complexes, les corrections de conformité, certaines décisions financières et la libération définitive d’un numéro.

## Connexions externes

Les adaptateurs opérateur, paiement, banque/KYC et canaux de notification restent des dépendances explicites. Tant qu’un adaptateur n’est pas réellement raccordé, le système indique « non connecté » et ne simule pas une exécution réussie.

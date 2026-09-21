# Customer Relations, Billing Disputes & Offboarding

Audiotel Premium Pro traite les réclamations, litiges financiers et départs clients comme des dossiers traçables. Le moteur agent peut analyser les faits, préparer et exécuter les actions réversibles, mais ne peut pas fabriquer un fait externe ni contourner une validation financière, client ou opérateur.

## Principes

1. **Une seule vérité métier** : les CDR, abonnements, reversements, règlements opérateur et affectations SVA restent les sources autoritatives. Le dossier relation client référence ces données, il ne les réécrit pas.
2. **Montant contesté isolé** : un litige peut créer un hold interne sur le montant contesté. Ce hold n'est ni un avoir ni un remboursement et ne modifie jamais une facture.
3. **Preuves minimisées** : les pièces sont référencées par source, identifiant, référence externe ou SHA-256. Ne jamais copier de données carte, secret, mot de passe ou RIO complet dans le dossier, l'audit ou le contexte agent.
4. **Agent par niveaux de risque** : automatique pour l'analyse et les actions réversibles ; validation PGI pour les mouvements financiers et la résolution ; confirmation client pour une décision de départ ; confirmation externe pour les faits opérateur ou paiement.
5. **Aucun faux succès** : une portabilité, une facture finale, un remboursement ou une révocation n'est jamais déclaré terminé avant le retour du fournisseur concerné.
6. **Le départ n'est pas une panne** : portabilité, obligations contractuelles, facture finale, reversement final, export des données et révocation des accès sont suivis séparément.

## Litige financier

Flux nominal : le client ouvre un dossier ; le système horodate la réclamation ; le montant contesté est isolé si nécessaire ; l'agent relie les données autoritatives disponibles ; il produit une réconciliation explicable et peut demander une information manquante ; il répond au client ; si une correction est justifiée, l'avoir ou le remboursement reste soumis à validation puis à la confirmation du prestataire ; la résolution et la clôture restent auditées.

Pour un dossier déclaré comme consommateur, le moteur conserve la date de réclamation écrite et la date de préparation possible à la médiation. Il peut préparer le dossier mais ne prétend jamais avoir saisi un médiateur sans connexion externe et preuve de dépôt.

## Départ et portabilité sortante

Le propriétaire ou administrateur client indique s'il quitte tout le service ou certaines lignes, choisit de porter, libérer ou conserver provisoirement ses numéros et indique une date souhaitée. Le PGI enregistre exactement les lignes concernées, prépare l'export, le compte final et le dernier reversement. Pour un port-out, le RIO est demandé par un canal opérateur et le PGI ne conserve que son état et éventuellement ses quatre derniers caractères. Une planification ou une réussite n'est enregistrée qu'après confirmation opérateur.

Les options entreprise `report`, `cancel` et `return_back` sont suivies séparément lorsqu'elles sont disponibles. La révocation des accès intervient après la sortie sûre. En cas de résiliation sans portage, une date de quarantaine/conservation est enregistrée pour empêcher une remise à disposition immédiate du numéro.

Une demande ou récupération de RIO ne doit pas être utilisée comme déclencheur de rétention commerciale.

## ChatGPT / agent orchestration

L'endpoint `agent-context` fournit uniquement le dossier, les échéances, les références de preuves, la timeline utile, l'état de sortie, les actions précédentes et les prochaines actions autorisées. Les payloads agent sont nettoyés avant persistance : RIO, mots de passe, tokens, cookies, autorisations et données carte sont exclus.

Chaque action possède un `risk_class` et un `execution_mode`. Le stockage d'une action ne vaut jamais autorisation implicite.

## Données et conservation

La fin de la relation commerciale ne signifie pas suppression immédiate de toutes les données. Le PGI distingue les données encore nécessaires au compte final ou à un litige, les données soumises à une obligation légale de conservation et les données dont la finalité opérationnelle a pris fin et qui devront être supprimées ou anonymisées selon la politique applicable. Un `legal_hold` protège un dossier contentieux d'une purge automatique future.

## Connecteurs externes

Le modèle est prêt pour les adaptateurs opérateur, facturation et médiation. Tant qu'un adaptateur n'est pas connecté, les actions concernées restent `queued` ou `approved` et aucune confirmation externe n'est simulée.

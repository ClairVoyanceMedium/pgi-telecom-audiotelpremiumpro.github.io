# PGI Telecom | Automatisation des réclamations et du site

Date : 10 octobre 2026. Branche de préparation : `prep/pgi-direct-sva-operator-2026-10-10`. **Aucune activation ni déploiement de la distribution directe.**

## Architecture des réclamations

### Traitement Audiotel Premium Pro existant
- Adresse d'expédition du support : `support@audiotel-premium-pro.com`.
- Boîte Gmail interne : valeur effective de `PGI_INTERNAL_NOTIFICATION_EMAIL` (ne jamais exposer cette adresse dans les réponses clients ou dans les pages publiques).
- Resend : domaine confirmé vérifié, envoi activé, réception activée et webhook d'entrée `email.received` activé, au contrôle du 10 octobre 2026.
- Chemin d'entrée en production : `POST /api/v1/email/resend/webhook`, événement signé Svix, `forwardInboundEmailToInternal`, puis Gmail interne. L'historique des messages clients liés à des tickets existants est conservé par les fonctions de journalisation et l'intégration HubSpot lorsqu'un dossier est résolu de façon fiable.
- Automatisation ChatGPT déjà active : `Service clients PGI Telecom`, exécution horaire, avec réponse externe seulement depuis une adresse métier autorisée, prise en compte des heures ouvrées et exclusion des actes sensibles.
- Le réacheminement vers Gmail passe par Resend, et non par une connexion directe de l'application à la boîte Gmail. Une boîte connectée à ChatGPT ne permet pas à elle seule un processus serveur toujours actif.

### Future distribution SVA directe
- Adresse de réception préparée : `reclamations@audiotel-premium-pro.com` ; à tester avant annonce publique.
- Tous les e-mails entrants destinés à cette adresse sont étiquetés par le routage de préparation avec `business_unit: direct_sva`, un sujet Gmail `Réclamation PGI Telecom Distribution SVA` et une catégorie Resend `dsva_complaint`. Aucun destinataire Gmail interne n'est codé en dur.
- Le nouveau moteur `backend/src/direct-sva-complaint-automation.mjs` définit sept catégories, priorité explicite et dates cibles internes, tout en refusant les instructions d'action externe contenues dans les messages.
- Base préparatoire `database/migrations/078_direct_sva_complaint_inbox_preparation.sql` : références uniques, justificatifs, file d'actions, audits et séparation des activités. **En préparation, les traitements d'envoi et de paiement sont explicitement bloqués en base.**
- Le formulaire `site/distribution-sva/reclamations/` contient des champs définis, accessibles et vérifiables. Son script attend les réponses de l'endpoint de disponibilité. `GET /api/v1/public/direct-sva/complaints/capabilities` retourne actuellement toujours non disponible ; `POST /api/v1/public/direct-sva/complaints` refuse les dépôts. Aucune demande publique n'est faussement déclarée enregistrée.
- Le cockpit dispose d'un rapport privé anonymisé sur les états préparatoires via `GET /api/v1/platform/direct-sva/complaints/readiness`, soumis aux droits admin et à l'interrupteur d'aperçu privé.

## Chaîne opérationnelle cible après validation du lancement

1. Le client dépose une réclamation par formulaire ou e-mail. Vérification d'adresse et protection contre l'abus de formulaire selon le niveau de risque.
2. Le service confirme la persistance du message avec identifiant unique et date de réception. À défaut de persistance, aucun accusé positif n'est affiché.
3. Classification déterministe et priorisation : fraude/privacité prioritaires, pas de commande exécutée sur instruction contenue dans un e-mail.
4. Un message de notification est inscrit dans une file persistante, puis transmis à l'adresse Gmail interne configurée. Les identifiants d'envoi et l'état de remise sont enregistrés.
5. Un accusé de réception factuel est envoyé à l'adresse vérifiée ou dans le cadre du dispositif antifraude validé, sans divulguer d'informations personnelles.
6. Une piste de suivi distincte est créée dans HubSpot avec `pgi_business_unit=direct_sva` lorsque le pipeline, les propriétés et l'autorisation de traitement sont vérifiés. Aucun ticket inventé à partir d'une simple notification.
7. L'automatisation de relation client lit les faits disponibles, classe, vérifie les dossiers et prépare les réponses utiles dans la langue du client. Les réponses non sensibles peuvent être envoyées depuis l'adresse métier selon les horaires, sans demander systématiquement une action manuelle.
8. Les opérations réglementées ou à conséquence irréversible restent suspendues jusqu'à la preuve ou validation exigée (portage, remboursement, litige, contrat, fonds de tiers, suppression).
9. Les rappels de délai et les réouvertures de réclamations sont idempotents, avec remontée d'incident sur échec de notification et conservation de l'historique.
10. Le cockpit et le bilan quotidien présentent les volumes réels, catégories, états, délais, réouvertures, anomalies et actions en attente sans confondre activité direct SVA et Audiotel.

## Fiabilité et correction du webhook

Un défaut antérieur a été corrigé en branche : la réception d'un webhook `email.received` était auparavant marquée terminée en base AVANT confirmation du transfert vers Gmail. En cas d'échec Resend sur le transfert, la relivraison du webhook devenait un doublon et le courrier pouvait rester non transféré. Désormais l'accusé du webhook entrant est enregistré **après** l'acceptation du transfert. Un échec laisse l'événement admissible à une nouvelle tentative signée, et le transfert utilise une clé d'idempotence fondée sur l'identifiant du message.

Cette correction nécessite une recette end-to-end après déploiement ; elle n'est pas actuellement active en production du seul fait de son commit GitHub. Un traitement différé complémentaire pour les événements restés en attente au-delà de la fenêtre de relivraison devra être ajouté avant de promettre une garantie de reprise sans intervention.

## Grille d'automatisation du site entier

| Domaine | Automatisations utilisables ou préparées | Dépendances non garanties |
| --- | --- | --- |
| Formulaires Audiotel | Envoi Resend, HubSpot, erreurs et protections de base | Rapprochement des formulaires et incidents de délivrabilité réels |
| Accueil clients | Dossiers, sessions, e-mails et états de compte | Vérification des pièces et droits de numérotation avant activation |
| Abonnements | Événements Stripe et réception webhook, relances | Contrat B2B/B2C et moyens de paiement confirmés |
| Business Live | État et cumuls contrôlés, remise à zéro persistante | CDR et opérations réelles fournis par opérateur |
| Portabilité | Dossier et contrôles de préparation | Mandat, validation réseau et respect des droits |
| Réclamations Audiotel | Messages entrants vers Gmail, relation client, suivi | Une recette de bout en bout et tolérance aux pannes validées |
| Réclamations SVA directes | Pages, modèle de triage, registre et notifications préparatoires | Lancement direct autorisé, form intake, worker, canal de réception testé |
| CRM | Liaison HubSpot selon source, dossiers existants | Pipeline direct dédié et autorisation d'écriture |
| Analytics | Événements GA4 encadrés par consentement | Propriété directe séparée et schéma validé |
| SEO | Site, canonicals, tableaux de bord, Search Console | Publication/indexation des pages directes uniquement après ouverture |
| Comptabilité | Sous-journaux, export, rapprochement, FEC cible | Expertise comptable, flux bancaire réel, PSP autorisé |
| Parrainage | Programme Audiotel et politiques de reversements | Bénéficiaires, éligibilité et confirmations de paiement |
| Sécurité | Contrôles d'accès, webhook signé, séparation des données, audits | Recettes sécurité indépendantes et restauration testée |
| Alertes et rapports | Bilan quotidien et surveillance du service clients | Fiabilité des connecteurs, anti-doublons et suivi des échecs |

## Contrôles indispensables avant de dire que tout est automatique

- Tests réels de réception sur `reclamations@...`, acheminement Gmail, Reply-To, retour client et rattachement au bon ticket.
- Spécification d'un événement source faisant autorité, d'une file de traitement durable, d'une clé d'idempotence et d'une politique de reprise pour chaque intégration.
- Vérification de la compatibilité RGPD : traces minimales dans GA4, droits d'accès, conservation, réclamations sensibles et pièces jointes.
- Alertes qui signalent les tâches bloquées, les tentatives épuisées et les transmissions incohérentes ; aucun effacement de tickets sous prétexte d'automatisation.
- Recette de procédures de panne Resend, HubSpot, Gmail, Stripe et opérateur, ainsi que des temps de traitement hors heures ouvrées.
- Distinction absolue entre préparation, action simulée, action acceptée par un prestataire et action réellement terminée.
- Revue juridique et activation progressive après le top départ explicite.

**Automatisation complète ne signifie pas autonomie juridique absolue.** Les opérations sans conséquence irréversible pourront devenir autonomes. Les décisions qui nécessitent un mandat, un règlement confirmé ou une autorisation réglementaire demeurent bloquées jusqu'à obtention d'une preuve réelle.

# Préparation migration GitHub / Vercel vers PGI Telecom

Date de préparation : 2026-10-06

## Objectif

Déplacer proprement le dépôt Audiotel Premium Pro hors de l'identité GitHub historique ClairVoyanceMedium, sans perte de données, sans rupture de production et sans modifier le domaine public audiotel-premium-pro.com.

## État actuel vérifié

- Dépôt GitHub : ClairVoyanceMedium/pgi-telecom-audiotelpremiumpro.github.io
- Branche de production : main
- Projet Vercel : pgi-telecom-audiotelpremiumpro-github-io
- Domaine public principal : audiotel-premium-pro.com
- Domaine secondaire : audiotel-premium-pro.fr
- Le déploiement Vercel depuis Git est limité à main.
- Les branches hors main ne doivent donc pas être utilisées comme source de production.

## Cible proposée

À confirmer après création de l'organisation GitHub :

- Organisation : PGITelecom ou autre identifiant exact choisi par le propriétaire
- Dépôt : audiotel-premium-pro
- Projet Vercel : audiotel-premium-pro
- Équipe Vercel : PGI Telecom

Ne pas coder le nom cible définitivement avant que l'organisation GitHub existe et que son identifiant exact soit confirmé.

## Références à l'ancienne identité détectées

1. .github/CODEOWNERS
   - Référence active : @ClairVoyanceMedium
   - À remplacer après transfert par le propriétaire ou l'équipe GitHub de la nouvelle organisation.

2. CHANGELOG.md
   - Référence historique uniquement.
   - À conserver : elle documente la suppression de l'ancienne identité publique.

3. tests/marketing-site.test.mjs
   - Référence volontaire.
   - Le test vérifie que l'ancienne identité GitHub n'apparaît pas dans les sources SEO publiques.
   - À conserver ou adapter seulement si le comportement testé change.

Aucune référence publique critique au propriétaire GitHub historique n'a été trouvée dans les URL canoniques du site.

## Procédure de migration

### Phase 1 : avant transfert

1. Vérifier que main est saine et correspond à la production.
2. Vérifier que le dernier déploiement Vercel est READY.
3. Vérifier /api/v1/health.
4. Sauvegarder la base PostgreSQL selon la procédure existante.
5. Inventorier les variables d'environnement Vercel sans exposer leur valeur.
6. Inventorier les domaines rattachés au projet Vercel.
7. Vérifier les webhooks et intégrations dont l'URL dépend du domaine public.
8. Vérifier les workflows GitHub et règles de branche.

### Phase 2 : transfert GitHub

1. Créer l'organisation GitHub cible.
2. Vérifier que le propriétaire actuel est autorisé à transférer le dépôt vers cette organisation.
3. Transférer le dépôt existant plutôt que créer une copie neuve.
4. Renommer le dépôt en audiotel-premium-pro si ce nom est disponible.
5. Vérifier que l'historique Git, les branches, tags, issues et pull requests sont présents.
6. Mettre à jour CODEOWNERS.
7. Vérifier les permissions et équipes de la nouvelle organisation.

### Phase 3 : Vercel

1. Vérifier le lien Git du projet existant.
2. Reconnecter le même projet Vercel au nouveau dépôt si Vercel ne suit pas automatiquement le transfert GitHub.
3. Ne pas créer un nouveau projet Vercel si le projet existant peut être conservé.
4. Conserver les mêmes domaines personnalisés.
5. Conserver les variables d'environnement et paramètres du projet.
6. Renommer le projet Vercel uniquement après validation du lien Git.
7. Renommer l'équipe / le slug Vercel séparément, après validation du projet.

## Données qui ne doivent pas être migrées par copie

Les éléments suivants restent dans leurs systèmes respectifs et ne doivent pas être recréés juste à cause du changement GitHub :

- base Neon PostgreSQL
- données clients
- comptabilité
- CDR
- Stripe
- HubSpot
- Resend
- GA4
- Search Console
- domaines DNS
- secrets et variables Vercel

Le dépôt GitHub contient le code et les migrations. Les données de production restent dans les services externes.

## Tests obligatoires après transfert

- production HTTPS accessible
- audiotel-premium-pro.com répond 200
- www redirige correctement
- .fr redirige correctement
- /api/v1/health répond 200
- connexion client
- cockpit administrateur
- Stripe
- HubSpot
- Resend
- GA4
- moteur comptable
- FEC
- parrainage
- portabilité
- paiement CB
- CDR / ingestion téléphonie
- tâches planifiées Vercel
- aucun lien public vers l'ancienne identité GitHub

## Rollback

Si la reconnexion GitHub / Vercel échoue :

1. ne pas modifier les domaines de production ;
2. conserver le projet Vercel existant ;
3. revenir au dernier déploiement READY ;
4. rétablir temporairement le lien Git précédent si possible ;
5. ne supprimer aucun dépôt, projet, domaine ou environnement avant validation complète.

## Règle de sécurité

Aucune suppression de l'ancien emplacement, aucun changement DNS et aucune suppression de secret ne doit être effectué tant que la production n'a pas été entièrement vérifiée après transfert.

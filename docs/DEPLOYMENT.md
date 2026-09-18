# Déploiement sans Cloudflare

## Front dashboard

Le front est conçu pour GitHub Pages.

Réglage GitHub attendu :

```
Settings
→ Pages
→ Build and deployment
→ Source
→ GitHub Actions
```

Le workflow `.github/workflows/pages.yml` publie le site après un push sur `main`.

## Backend privé

Le backend, PostgreSQL, Valkey, Kamailio et FreeSWITCH ne peuvent pas tourner sur GitHub Pages.

Ils devront fonctionner sur un serveur 24/7.

Architecture recommandée :

```
Internet
   │
HTTPS direct
   ▼
Caddy / reverse proxy
   │
   ▼
API PGI Telecom
   ├── PostgreSQL (localhost uniquement)
   └── Valkey (localhost uniquement)

Opérateur SVA
   │ SIP
   ▼
Kamailio
   ▼
FreeSWITCH
   ▼
API / CDR
```

Aucun Cloudflare n'est requis.

## DNS

Le domaine API pourra utiliser directement un enregistrement A/AAAA vers le serveur.

## TLS

Utiliser un certificat TLS automatique via le reverse proxy. Ne jamais stocker une clé privée TLS dans GitHub.

## Pare-feu

N'exposer publiquement que ce qui est nécessaire :

- 443/TCP pour l'API HTTPS ;
- SIP uniquement selon le contrat opérateur et les IP autorisées ;
- RTP sur la plage strictement configurée ;
- SSH restreint par politique d'administration.

PostgreSQL et Valkey restent liés à 127.0.0.1 ou à un réseau Docker privé.

## Déploiement

Pipeline cible :

```
push GitHub
→ tests
→ build
→ image/version
→ déploiement
→ health check
→ rollback automatique si échec
```

Le backend ne sera activé qu'une fois le serveur et les paramètres opérateur connus.

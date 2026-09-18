# Authentification et origine réseau

## Architecture recommandée en production

Pour éviter les problèmes de cookies tiers et réduire la surface CORS, le dashboard et l'API doivent idéalement partager la même origine :

```
https://telecom.example.tld/
https://telecom.example.tld/api/v1/...
```

Le front est toujours versionné et déployé depuis GitHub, mais Caddy sert le front et reverse-proxy l'API.

## Pourquoi ne pas utiliser le domaine github.io en production réelle

Le domaine GitHub Pages est adapté à la démonstration statique.

Pour les données réelles, une API située sur un autre domaine peut transformer le cookie de session en contexte cross-site selon l'origine utilisée et le navigateur. Les politiques anti-tracking rendent ce modèle moins prévisible.

## Session recommandée

- cookie HttpOnly ;
- Secure obligatoire ;
- SameSite=Strict lorsque le parcours le permet ;
- Path=/ ;
- durée courte avec rotation ;
- régénération après authentification ;
- CSRF protégé pour toutes les mutations ;
- MFA sur les rôles privilégiés.

Ne jamais stocker un token de longue durée dans localStorage.

## CORS

Avec une origine unique, CORS n'est pas nécessaire pour les appels du dashboard.

Si une seconde origine doit être autorisée :

- liste blanche exacte ;
- jamais `Access-Control-Allow-Origin: *` avec credentials ;
- méthodes minimales ;
- en-têtes minimaux ;
- preflight correctement borné.

## CSP

GitHub Pages utilise une CSP via balise meta pour la démonstration.

En production, Caddy émet une CSP HTTP comprenant notamment `frame-ancestors 'none'`, qui ne peut pas être fiablement imposée par une balise meta.

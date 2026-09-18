# Confidentialité et minimisation des données

## Principes techniques

PGI Telecom • Audiotel Premium Pro doit appliquer la minimisation des données dès la conception.

### Numéro appelant

Par défaut, le dashboard n'affiche qu'une version masquée.

Pour les fonctions de récurrence client :

- utiliser un hash déterministe du numéro normalisé ;
- conserver le numéro complet uniquement si un besoin légitime est défini ;
- si conservation nécessaire, le chiffrer au repos ;
- limiter l'accès aux rôles autorisés ;
- journaliser tout accès exceptionnel au numéro complet.

### GitHub

Aucune donnée personnelle réelle ne doit être publiée dans GitHub, GitHub Pages, les issues ou les workflows.

### Logs

Les logs techniques doivent éviter :

- numéro complet ;
- identité client ;
- document KYC ;
- IBAN ;
- contenu de consultation.

### Export

Les exports CSV/PDF contenant des données réelles devront être générés côté backend authentifié, avec journalisation et expiration si un lien temporaire est utilisé.

### Rétention

La durée de conservation doit être définie par type de donnée et par obligation applicable. Le moteur devra permettre la purge ciblée sans altérer les écritures nécessaires au contrôle financier ou aux obligations légales.

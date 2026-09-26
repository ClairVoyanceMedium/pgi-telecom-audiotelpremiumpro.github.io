# Marque et terminologie — Audiotel Premium Pro

## Règle de marque

- **Nom public et client : Audiotel Premium Pro**
- **Cockpit interne : PGI • Telecom - Audiotel Premium Pro**
- Les interfaces client, messages client, exports client, e-mails futurs et documents commerciaux doivent utiliser **Audiotel Premium Pro**.
- Les préfixes techniques historiques `PGI_*`, noms de variables, métriques, routes API et identifiants internes peuvent rester inchangés afin de préserver la compatibilité.

## Positionnement métier

Audiotel Premium Pro est une plateforme SVA générique : aucun métier ou secteur ne doit être traité comme cible exclusive.

Un numéro SVA peut être utilisé par tout professionnel ou toute organisation ayant un ou plusieurs services, équipes, intervenants ou postes, par exemple :

- accueil ;
- service commercial ;
- support client ;
- service technique ;
- prise de rendez-vous ;
- service juridique ;
- assistance ;
- consultants ou conseillers ;
- professionnels indépendants ;
- intervenants spécialisés, indépendants, équipes ou autres profils compatibles avec le service.

## Terminologie visible

Dans l’interface générale, préférer :

- **intervenant** plutôt que « expert » lorsqu’il s’agit d’une personne ;
- **service** lorsqu’il s’agit d’un département ou d’une fonction ;
- **poste** lorsqu’il s’agit d’une destination individuelle ;
- **destination d’appel** pour une cible PSTN/SIP ou un centre d’appels.

Le terme technique historique `experts` peut rester dans le schéma SQL, les API et le code tant qu’un renommage structurel n’apporte aucune valeur fonctionnelle et pourrait introduire une régression.

## Routage multi-services

Un même numéro Audiotel peut représenter une entreprise entière. Le routage doit pouvoir évoluer vers :

`numéro public → menu vocal/choix → service ou intervenant → destination réelle`

Le choix pourra être individuel, par service, automatique ou hybride. La plateforme ne doit jamais supposer qu’un numéro correspond à une seule personne ou à un seul secteur d’activité.

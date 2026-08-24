# AUT-102 — Apprentissage éditorial borné

## Résultat livré

Noosphere produit une version immuable de recommandation à partir des réponses
LinkedIn observées et des appels attribués aux contenus de la stratégie active.
Le prochain radar d'idées peut prioriser un angle déjà publié, mais il ne peut
pas sortir du contrat éditorial courant.

## Séparation vérité / attribution

- un commentaire ou une réponse entrante observée par le provider est un fait ;
- un appel rattaché par le modèle d'attribution reste une inférence ;
- un like seul n'entre jamais dans l'apprentissage ;
- chaque élément conserve un `sourceRef`, un lien ouvrable et sa date ;
- les recommandations ne portent que sur l'audience active, un pilier et un
  angle existants.

Chaque version fige l'ICP, les piliers, les claims, les formats et la cadence
qui constituaient la frontière au moment du calcul. Le moteur ne met à jour ni
la stratégie, ni l'ICP, ni un quota.

## Durabilité

`editorial_learning_versions` conserve les faits, inférences, recommandations,
bounds, fenêtre de 90 jours, hash d'entrée et version du modèle déterministe.
Les lignes sont immuables en PostgreSQL et isolées par workspace. Un même hash
de preuves ne crée pas deux versions.

Le worker réconcilie l'apprentissage après les interactions et l'attribution.
`GET /api/v1/content/learning` expose uniquement la dernière version du
workspace de la session. La stratégie LinkedIn restitue les recommandations et
leur niveau de preuve.

## Consommation bornée

Lors de la prochaine recherche quotidienne, les deux meilleurs angles appris
sont placés au début du plan de requêtes. Le repository vérifie que leur pilier
existe encore dans la version active ; tout signal hors policy est ignoré.

## Preuves exécutées

- tests unitaires de séparation fait/inférence et de non-élargissement ;
- contrat HTTP et isolation du workspace dérivé de la session ;
- intégration PostgreSQL interaction → recommandation v1 → plan de recherche ;
- rejeu identique sans nouvelle version ;
- refus de mutation SQL d'une version ;
- `EXPLAIN` de la lecture de dernière version : `Index Scan Backward` sur
  `editorial_learning_versions_latest_idx`.

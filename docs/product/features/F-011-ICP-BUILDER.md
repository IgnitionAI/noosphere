# F-011 — Approfondir un segment en ICP

## Résultat utilisateur

Transformer un segment client validé en critères suffisamment précis pour
rechercher des entreprises et identifier les bons décideurs.

## Entrée

Un `CustomerSegment` retenu dans F-009.

## Sortie

Un ICP brouillon contenant :

- définition du segment ;
- géographie ;
- type et taille d’organisation ;
- maturité attendue ;
- spécialités éventuelles ;
- décideurs, champions, validateurs et utilisateurs ;
- problème principal et résultat recherché ;
- signaux d’intention ;
- exclusions et notes de qualification.

## Parcours

1. choisir un segment retenu ;
2. préciser les entreprises ciblées ;
3. sélectionner les rôles impliqués dans l’achat ;
4. décrire le problème et le résultat recherché ;
5. sélectionner les signaux observables ;
6. définir les exclusions ;
7. enregistrer le brouillon et passer au segment suivant.

L’utilisateur peut créer un seul ICP ou traiter successivement tous les segments.

## Règles

1. chaque segment crée son propre ICP brouillon ;
2. aucun critère n’est inventé comme une donnée de marché vérifiée ;
3. les rôles distinguent décision, influence, validation et utilisation ;
4. un signal doit être observable via une source ou saisissable manuellement ;
5. une exclusion est évaluée avant tout sourcing ;
6. enregistrer ne publie pas l’ICP ;
7. aucun sourcing ne démarre depuis le builder.

## Critères d’acceptation

- changer de segment conserve le brouillon précédent ;
- les champs entreprise, persona, problème, signaux et exclusions sont présents ;
- les critères sélectionnables réagissent en un clic ;
- le résumé reflète le segment courant ;
- l’utilisateur peut enregistrer et passer au segment suivant ;
- l’utilisateur peut créer uniquement l’ICP courant ;
- les valeurs non précisées restent visibles dans « À préciser » ;
- l’écran fonctionne à 375, 768, 1024 et 1440 px.

## Route et prototype

**Route cible** : `/w/[workspaceSlug]/icps/new`

Prototype :
[`icp-builder.html`](../../../prototype/icp-builder.html)

## Hors périmètre

- estimation de population sans fournisseur de données ;
- recherche d’entreprises ;
- recherche de contacts ;
- scoring ;
- publication automatique ;
- génération de messages.

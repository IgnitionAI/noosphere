# F-011 — Revue et publication du livrable ICP

## Résultat utilisateur

Examiner la recommandation du deep agent, vérifier les preuves, corriger les
propositions et publier un ICP opérationnel.

## Contenu du livrable

- synthèse exécutive ;
- carte concurrentielle ;
- ICP principal, secondaires et exploratoires ;
- caractéristiques d’entreprise ;
- comité d’achat ;
- problèmes et résultats recherchés ;
- signaux d’intention ;
- exclusions ;
- preuves et niveau de confiance ;
- contradictions et inconnues ;
- critères exploitables par le futur sourcing.

## Parcours

1. lire la synthèse ;
2. comparer les concurrents ;
3. choisir une proposition ICP ;
4. ouvrir les preuves associées ;
5. corriger ou rejeter un finding ;
6. demander une recherche complémentaire si nécessaire ;
7. publier une `ICPVersion`.

## Règles

1. le rapport est une proposition, jamais une vérité automatique ;
2. une preuve publique et une donnée fournie restent distinguées ;
3. une correction humaine ne disparaît pas lors d’un retry ;
4. une contradiction non résolue bloque le finding concerné ;
5. une inconnue reste visible après publication ;
6. publier crée une version immuable ;
7. le sourcing n’utilise que la version publiée.

## API à spécifier

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/product-research-runs/:id/report` | lire le livrable et ses propositions |
| PATCH | `/api/v1/product-research-runs/:id/findings/:findingId` | corriger ou rejeter un finding |
| PATCH | `/api/v1/product-research-runs/:id/icp-proposals/:proposalId` | corriger une proposition |
| POST | `/api/v1/product-research-runs/:id/actions/publish-icp` | publier une version immuable |

## Critères d’acceptation

- chaque affirmation importante possède une preuve ou un badge hypothèse ;
- sélectionner une preuve permet d’identifier sa source ;
- plusieurs ICP peuvent être comparés ;
- les inconnues sont regroupées et lisibles ;
- l’utilisateur peut corriger les champs proposés ;
- une recherche complémentaire ne relance que les étapes concernées ;
- seul un admin ou owner publie ;
- l’écran fonctionne à 375, 768, 1024 et 1440 px.

## Prototype

[Rapport ICP sourcé](../../../prototype/icp-builder.html)

## Hors périmètre

- recherche d’entreprises ;
- recherche de personnes ;
- génération de messages ;
- modification rétroactive d’un ICP publié.

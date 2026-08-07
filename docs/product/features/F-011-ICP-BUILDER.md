# F-011 — Revue et publication du livrable ICP

## Résultat utilisateur

Examiner la recommandation du deep agent, vérifier les preuves, corriger les
propositions et publier un ICP opérationnel.

## Acteurs et permissions

| Acteur | Lecture | Mutation | Approbation |
|---|---|---|---|
| owner | oui | oui | publie |
| admin | oui | oui | publie |
| operator | oui | corrige findings et propositions | non |
| reviewer | oui | corrige findings et propositions | non |
| viewer | oui | non | non |

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
6. un ICP est un conteneur canonique du workspace : publier crée une
   `ICPVersion` immuable rattachée à cet ICP, numérotée séquentiellement
   par ICP ;
7. publier depuis une proposition de recherche crée l’ICP et sa v1 ; publier
   depuis un ICP existant crée la version suivante sans nouveau run ;
8. `run_id` et `proposal_id` conservés sur la version ne sont que la
   provenance de la v1, jamais l’identité de l’ICP ;
9. les critères d’une version sont structurés (`ICPCriterion` : dimension,
   opérateur, valeur, caractère obligatoire/souhaitable/exclusif) pour
   permettre l’explicabilité critère par critère en F-023 ;
10. le sourcing n’utilise que la version publiée.

## Contrats API

Le modèle canonique est adopté (ADR acceptée) : conteneur `ICP` +
`ICPVersion` immuable + `ICPCriterion` structuré. La migration 0006
(`icp_versions` couplée à `run_id`/`proposal_id`, unicité
`(workspace, proposal)`) sera refondue : ajout de `icp_id`, unicité
`(icp_id, version)`, `run_id`/`proposal_id` rétrogradés en provenance de la
v1. L’événement `ICPVersionPublished` existe déjà.

| Méthode | Route | Usage | État |
|---|---|---|---|
| GET | `/api/v1/product-research-runs/:id/report` | lire le livrable et ses propositions | implémenté |
| PATCH | `/api/v1/product-research-runs/:id/findings/:findingId` | corriger ou rejeter un finding | implémenté |
| PATCH | `/api/v1/product-research-runs/:id/icp-proposals/:proposalId` | corriger une proposition | implémenté |
| POST | `/api/v1/product-research-runs/:id/actions/publish-icp` | publier : crée l’ICP et sa v1 depuis une proposition | implémenté, à adapter au modèle canonique |
| GET | `/api/v1/icps` | lister les ICP du workspace avec leur version courante | à spécifier |
| GET | `/api/v1/icps/:id` | lire un ICP et l’historique de ses versions | à spécifier |
| POST | `/api/v1/icps/:id/actions/publish` | publier la version suivante d’un ICP existant (sans nouveau run) | à spécifier |
| GET | `/api/v1/icp-versions/:id` | lire le détail d’une version publiée, critères inclus | à spécifier |

**Routes UI** : `/w/[workspaceSlug]/research/[runId]/report` (existant) et
`/w/[workspaceSlug]/icps` (liste des ICP, détail et historique des versions,
à livrer).

**Événement sortant** : `ICPVersionPublished` (porteur de `icp_id` et du
numéro de version).

## Critères d’acceptation

- chaque affirmation importante possède une preuve ou un badge hypothèse ;
- sélectionner une preuve permet d’identifier sa source ;
- plusieurs ICP peuvent être comparés ;
- les inconnues sont regroupées et lisibles ;
- l’utilisateur peut corriger les champs proposés ;
- une recherche complémentaire ne relance que les étapes concernées ;
- seul un admin ou owner publie ;
- les versions publiées sont listées et consultables hors du rapport ;
- une version publiée n’est jamais modifiée par une correction ultérieure ;
- l’écran fonctionne à 375, 768, 1024 et 1440 px.

## États et erreurs

- loading : skeleton du rapport et de la liste des versions ;
- empty : aucune version publiée — action principale vers le rapport ;
- validation : publication refusée si contradiction non résolue, avec le
  finding concerné ;
- forbidden : viewer en lecture seule, operator/reviewer sans action publier ;
- provider indisponible : quota modèle épuisé expliqué explicitement, sans
  bloquer la consultation des résultats déjà validés ;
- conflit métier : correction concurrente du même finding ou proposition ;
- reprise : quitter la page conserve corrections et checkpoints.

## Données et confidentialité

- agrégats : `ICP` (conteneur canonique), `ICPVersion`, `ICPCriterion`,
  `ICPProposal` (provenance de la v1), `ResearchFinding` ;
- données personnelles : auteur de publication (`published_by`) uniquement ;
- rétention : un ICP et ses versions publiées sont conservés tant que le
  sourcing ou une campagne les référence ; la suppression d’un ICP est un
  soft delete (`deleted_at`) qui ne touche pas les versions déjà utilisées ;
- audit : correction, rejet et publication tracés.

## Tests obligatoires

- domaine : immutabilité d’une version publiée, blocage sur contradiction,
  numérotation séquentielle par ICP ;
- intégration PostgreSQL : unicité (icp, version), rejet d’UPDATE sur une
  version publiée ;
- isolation workspace : ICP et versions invisibles depuis un autre
  workspace ;
- permission : publication refusée à un operator par appel direct API ;
- idempotence : publication rejouée sans seconde version ;
- E2E : rapport → correction → publication v1 → republication v2 du même
  ICP → consultation de l’historique.

## Questions résolues avant développement

- ADR tranchée : conteneur `ICP` canonique + `ICPVersion` + `ICPCriterion`
  (et non proposal-as-ICP) ; l’ADR technique est rédigée dans
  `docs/architecture/adr/` ;
- plusieurs `ICPVersion` peuvent être publiées depuis un même run (ICP
  distincts), et un même ICP peut être republié en v2+ sans nouveau run ;
- une version erronée n’est pas dépubliée : elle est remplacée par une
  nouvelle version ;
- la suppression d’une version utilisée par le sourcing est hors périmètre de
  cette feature.

## Prototype

[Rapport ICP sourcé](../../../prototype/icp-builder.html)

## Hors périmètre

- recherche d’entreprises ;
- recherche de personnes ;
- génération de messages ;
- modification rétroactive d’un ICP publié.

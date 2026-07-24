# F-009 — Mission deep research ICP

## Résultat utilisateur

À partir d’un produit et d’un marché, un deep agent recherche les concurrents,
analyse leurs positionnements et produit plusieurs propositions d’ICP sourcées.

## Entrées

- URL, nom et description du produit ;
- géographie et langues ;
- type de vente ;
- concurrents connus, facultatifs ;
- documents internes, facultatifs ;
- profondeur de recherche.

## Workflow

```text
draft
→ queued
→ product_analysis
→ competitor_discovery
→ competitor_analysis
→ segment_synthesis
→ icp_synthesis
→ evidence_review
→ ready_for_review
```

Chaque étape écrit un checkpoint durable. Une reprise ne recommence pas les
étapes déjà validées.

## Rôles du deep agent

- `ProductAnalyst` : structure le produit, ses claims et ses inconnues ;
- `CompetitorResearcher` : découvre et qualifie concurrents et alternatives ;
- `ICPStrategist` : synthétise segments, personas, problèmes et signaux ;
- `EvidenceReviewer` : contrôle sources, contradictions et extrapolations ;
- `ResearchOrchestrator` : planifie, reprend et assemble le livrable.

## Règles

1. Une mission appartient exactement à un workspace.
2. Une source publique conserve URL, date, extrait et empreinte.
3. Un document interne est distingué d’une preuve publique.
4. Une affirmation sans preuve reste une hypothèse.
5. Les chiffres non confirmés sont retirés ou signalés.
6. Un concurrent découvert reste candidat avant qualification.
7. Un retry n’écrase jamais un résultat humainement validé.
8. La mission ne crée ni entreprise CRM, ni contact, ni campagne.
9. Le deep agent ne publie jamais directement un ICP.

## Objets

- `ProductResearchRun` : mission, état et checkpoints ;
- `ResearchStageRun` : exécution d’une étape ;
- `AIRun` : appel de modèle individuel ;
- `CompetitorCandidate` : concurrent découvert ;
- `MarketEvidence` : source et passage ;
- `ResearchFinding` : affirmation, confiance et preuves ;
- `ICPProposal` : proposition produite par la mission.

## API à spécifier

| Méthode | Route | Usage |
|---|---|---|
| POST | `/api/v1/product-research-runs` | créer la mission |
| POST | `/api/v1/product-research-runs/:id/actions/start` | lancer |
| GET | `/api/v1/product-research-runs/:id` | état et progression |
| GET | `/api/v1/product-research-runs/:id/evidence` | sources |
| POST | `/api/v1/product-research-runs/:id/actions/pause` | pause |
| POST | `/api/v1/product-research-runs/:id/actions/resume` | reprise |
| POST | `/api/v1/product-research-runs/:id/actions/research-more` | recherche complémentaire |

## Critères d’acceptation

- le brief peut être lancé avec une URL et un marché ;
- les concurrents connus restent facultatifs ;
- la progression expose l’étape active et les résultats partiels ;
- une source en échec ne masque pas les autres résultats ;
- pause, reprise et retry sont idempotents ;
- chaque finding affiche preuves ou statut d’hypothèse ;
- le livrable contient au moins un ICP classé ;
- aucune prospection n’est déclenchée.

## Prototypes

- [Brief de mission](../../../prototype/product-reading.html)
- [Progression de la recherche](../../../prototype/research-progress.html)

## Socle backend implémenté

- agrégat et transitions : `packages/domain/src/gtm/product-research.ts` ;
- contrats des agents : `packages/contracts/src/product-research.ts` ;
- orchestration : `packages/application/src/gtm/research-orchestrator.ts` ;
- migration Drizzle : `packages/infrastructure/migrations/` ;
- queue PostgreSQL : `packages/infrastructure/src/jobs/postgres-job-queue.ts` ;
- worker Bun : `apps/worker/src/` ;
- exploitation : `docs/architecture/F009_BACKEND_RUNBOOK.md`.

Les routes HTTP restent à implémenter. L’adaptateur de modèle est injecté au
composition root et n’appartient pas à ce socle.

## Hors périmètre

- sourcing d’entreprises et de contacts ;
- estimation de TAM non sourcée ;
- publication automatique ;
- génération de campagne ;
- apprentissage automatique à partir des corrections.

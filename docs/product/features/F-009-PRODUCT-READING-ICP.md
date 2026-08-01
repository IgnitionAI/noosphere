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
- audience recherchée : clients finaux, partenaires ou les deux ;
- contraintes d’achat et exclusions métier, facultatives.

## Workflow

```text
draft
→ queued
→ product_analysis
→ competitor_discovery
→ competitor_analysis
→ buyer_landscape_discovery
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
- `BuyerResearcher` : découvre les verticales clientes, workflows, corpus,
  comités d’achat, taxonomies de sourcing et arbitrages build-vs-buy ;
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
10. Le site du produit prouve ses capacités et son positionnement, jamais la
    demande marché, la douleur, le budget ou la priorité d’un segment.
11. Clients finaux, partenaires et équipes capables de construire en interne
    sont toujours classifiés séparément.
12. Un ICP exige au moins deux preuves marché publiques provenant de domaines
    externes distincts et un plan de sourcing exploitable.

## Objets

- `ProductResearchRun` : mission, état et checkpoints ;
- `ResearchStageRun` : exécution d’une étape ;
- `AIRun` : appel de modèle individuel ;
- `CompetitorCandidate` : concurrent découvert ;
- `BuyerSegment` : verticale acheteuse classifiée, avec workflows,
  build-vs-buy et filtres de prospection ;
- `MarketEvidence` : source et passage ;
- `ResearchFinding` : affirmation, confiance et preuves ;
- `ICPProposal` : proposition produite par la mission.

## API implémentée

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/v1/product-research-runs` | retrouver les missions récentes du workspace après navigation ou rechargement |
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
- l’objectif « clients finaux » est appliqué par défaut ;
- la découverte acheteurs recherche les clients et cas d’usage des
  concurrents, pas seulement leurs caractéristiques techniques ;
- la progression expose l’étape active et les résultats partiels ;
- quitter la page ne perd pas la mission et le front permet de reprendre son suivi ;
- une source en échec ne masque pas les autres résultats ;
- pause, reprise et retry sont idempotents ;
- chaque finding affiche preuves ou statut d’hypothèse ;
- le livrable contient au moins un ICP classé ;
- le livrable contient au maximum cinq ICP prospectables avec secteurs,
  tailles, géographies, titres, signaux, exclusions et mots-clés ;
- un intégrateur ou une équipe de build ne peut pas devenir l’ICP principal
  d’une recherche « clients finaux » ;
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
- exploitation : `docs/architecture/F009_BACKEND_RUNBOOK.md` ;
- façade applicative : `packages/application/src/gtm/product-research-application.ts` ;
- transport HTTP : `packages/interface/src/http/product-research-handler.ts` ;
- serveur Bun : `apps/api/src/index.ts` ;
- contrat OpenAPI : `packages/contracts/openapi/product-research-v1.json`.

Le transport dérive toujours le workspace et le rôle d’une session Better Auth
et d’un membership actif. Le slug vient de la route via `x-workspace-slug` et
n’est jamais accepté dans le payload. L’exécuteur LangChain reste instancié au
composition root du worker sans coupler le domaine.

## Hors périmètre

- sourcing d’entreprises et de contacts ;
- estimation de TAM non sourcée ;
- publication automatique ;
- génération de campagne ;
- apprentissage automatique à partir des corrections.

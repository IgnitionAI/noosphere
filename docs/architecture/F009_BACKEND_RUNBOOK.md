# Runbook backend F-009

## Périmètre

Ce runbook couvre le socle de la mission de recherche produit : migrations,
checkpoints, jobs PostgreSQL, orchestration et branchement d’un adaptateur
d’agents. Il ne couvre ni les routes HTTP, ni un fournisseur de modèles.

## Préparer PostgreSQL

```bash
cp .env.example .env
bun install
bun run db:migrate
```

La migration initiale est additive. En production, une correction de schéma
se fait par une nouvelle migration forward-only. La suppression des tables
F-009 n’est permise que sur une base locale jetable.

## Contrat de l’adaptateur d’agents

Le module défini par `RESEARCH_AGENT_ADAPTER_MODULE` exporte :

```ts
export async function createResearchAgentExecutor(): Promise<ResearchAgentExecutor>
```

L’exécuteur reçoit un `ResearchStage`, un input validé et retourne :

- une sortie conforme au contrat de l’étape ;
- fournisseur, modèle et version de prompt ;
- paramètres sans secret ;
- coût éventuel et latence.

Les schémas de référence vivent dans
`packages/contracts/src/product-research.ts`. Une sortie invalide termine
l’étape avec `AGENT_OUTPUT_INVALID`. Aucun payload métier n’est écrit dans les
logs du worker.

## Démarrer le worker

```bash
bun run worker
```

Pour vérifier le branchement sans boucle de polling :

```bash
WORKER_ONCE=1 bun run worker
```

`SIGTERM` et `SIGINT` arrêtent la prise de nouveaux jobs puis ferment les deux
pools PostgreSQL.

## Reprise et idempotence

- unicité d’un job : `(workspace_id, type, idempotency_key)` ;
- lease concurrent : `FOR UPDATE SKIP LOCKED` ;
- un lease expiré redevient éligible ;
- retry fournisseur : backoff exponentiel borné à 15 minutes ;
- après `max_attempts`, le job passe en `dead_lettered` ;
- un checkpoint `completed` court-circuite toute relivraison ;
- un checkpoint `human_reviewed` ne peut pas être remplacé ;
- la transition, l’`AIRun`, l’outbox et le prochain job partagent une
  transaction.

## Diagnostic

```sql
select id, type, status, attempts, locked_by, locked_until, last_error_code
from jobs
where status in ('running', 'retry', 'dead_lettered')
order by updated_at desc;

select run_id, stage, attempt, status, review, error_code, completed_at
from research_stage_runs
where workspace_id = $1
order by started_at;
```

Ne jamais remettre un job en `pending` à la main sans vérifier le checkpoint
associé. La reprise normale consiste à corriger la cause puis à réenfiler une
action avec la même clé d’idempotence ou une action explicite de recherche
complémentaire.

## Vérification

```bash
bun run check
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ignition_outbound_test \
  bun run test:integration
```

Le test PostgreSQL vérifie la migration, le lease concurrent, la déduplication,
l’écriture atomique run/job/outbox et le refus d’une relation inter-workspace.

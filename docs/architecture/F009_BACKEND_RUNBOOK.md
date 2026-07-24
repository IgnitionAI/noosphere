# Runbook backend F-009

## Périmètre

Ce runbook couvre le socle de la mission de recherche produit : migrations,
API HTTP, checkpoints, jobs PostgreSQL, orchestration et branchement des
adaptateurs de contexte authentifié et d’agents. Il ne fournit ni
l’implémentation Better Auth, ni un fournisseur de modèles.

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

## Contrat de l’adaptateur d’authentification

Le module défini par `REQUEST_CONTEXT_ADAPTER_MODULE` exporte :

```ts
export async function createRequestContextResolver(): Promise<RequestContextResolver>
```

Le resolver reçoit la requête Web standard et retourne `userId`,
`workspaceId` et `role`. Les identifiants doivent être des UUID et le rôle doit
être `viewer`, `operator`, `reviewer`, `admin` ou `owner`. Une session absente
doit lever `RequestAuthenticationError`.

Le module d’exemple déclaré dans `.env.example` est un point de branchement,
pas un adaptateur factice livré en production. L’intégration Next.js/Better
Auth devra construire ce contexte depuis la session et l’appartenance au
workspace. Le payload HTTP ne peut jamais choisir son workspace.

## Démarrer l’API

Après migration et avec un adaptateur de contexte disponible :

```bash
bun run api
```

L’API écoute `PORT` (3000 par défaut), limite les corps à 1 Mio et expose :

- `GET /health/live` pour le processus ;
- `GET /health/ready` pour la disponibilité PostgreSQL ;
- les sept routes `/api/v1/product-research-runs`.

Le handler utilise uniquement les standards Web `Request`/`Response`. Il peut
donc aussi être monté dans un Route Handler Next.js sans modifier les cas
d’usage. Les erreurs sont des Problem Details avec un `code` stable.

Le contrat machine complet est
`packages/contracts/openapi/product-research-v1.json`.

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
l’écriture atomique run/job/outbox, l’isolation inter-workspace et un parcours
HTTP réel create/start/evidence/research-more.

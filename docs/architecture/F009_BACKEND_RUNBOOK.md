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

## Authentification et contexte workspace

L’API monte Better Auth sous `/api/auth/*`. Configurer :

- `BETTER_AUTH_URL` avec l’origine publique de l’application ;
- `BETTER_AUTH_SECRET` avec au moins 32 caractères aléatoires ;
- `BETTER_AUTH_TRUSTED_ORIGINS` avec les origines autorisées, séparées par une
  virgule ;
- `BETTER_AUTH_ALLOW_SIGN_UP=false` hors bootstrap contrôlé.

Better Auth possède les tables `auth_users`, `auth_sessions`, `auth_accounts`
et `auth_verifications`. Le domaine possède `workspaces` et
`workspace_members`, conformément à l’ADR-008.

Chaque appel métier transmet le slug issu de la route Next.js dans
`x-workspace-slug`. Le resolver valide la session en base, puis cherche un
membership actif vers un workspace actif. Le slug n’accorde donc jamais un
accès à lui seul :

- session absente ou révoquée : `401 AUTHENTICATION_REQUIRED` ;
- header absent ou mal formé : `400 WORKSPACE_CONTEXT_REQUIRED` ;
- membership absent ou désactivé : `403 WORKSPACE_FORBIDDEN`.

Le payload HTTP ne peut jamais choisir son workspace.

### Bootstrap du premier owner

Après la migration, renseigner temporairement les variables
`BOOTSTRAP_OWNER_*` et `BOOTSTRAP_WORKSPACE_*`, puis exécuter :

```bash
bun run bootstrap:owner
```

La commande crée le compte Better Auth si nécessaire, crée le workspace si
nécessaire et rend ce membre `owner`. Elle est idempotente, ne journalise ni le
mot de passe ni le cookie et refuse un workspace suspendu ou supprimé.
Retirer ensuite `BOOTSTRAP_OWNER_PASSWORD` de l’environnement du processus.
L’inscription HTTP reste désactivée avec `BETTER_AUTH_ALLOW_SIGN_UP=false`.

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

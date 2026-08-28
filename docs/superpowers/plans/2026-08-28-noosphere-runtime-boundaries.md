# Noosphere Runtime and Adapter Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a reusable, stateless Noosphere application runtime from the API process and make inbound adapter boundaries reject direct persistence/provider dependencies.

**Architecture:** `packages/bootstrap/src/create-noosphere-api-runtime.ts` owns infrastructure construction and returns a `NoosphereRuntime` with bounded application capabilities, authenticated HTTP dispatch, health and shutdown operations. `apps/api` is a thin process/transport entrypoint that delegates to the runtime; future MCP adapters can use the same capability object without REST loopback or raw database/provider access. Architecture verification is made callable and uses the TypeScript AST to scan MCP/interface adapter paths for Drizzle, schema/persistence, SDK and provider imports while preserving the existing domain/application checks.

**Tech Stack:** TypeScript, Bun, Drizzle/Postgres infrastructure hidden behind composition, Bun HTTP server, Bun test.

**Spec:** GitHub issue #70, “Extract reusable Noosphere application runtime and enforce adapter boundaries”.

## Global Constraints

- Preserve existing HTTP routes, status codes, authorization, and worker composition.
- Do not introduce a service locator or a network hop between adapters and application use cases.
- Runtime instances contain only process-scoped immutable composition and infrastructure handles; no request, tenant, transcript, or agent-session state.
- MCP/interface adapter source must not import `drizzle-orm`, database schema/persistence symbols, or provider SDK/adapters directly.
- Keep deployment invariants from `AGENTS.md`; do not push or close the GitHub issue.

### Task 1: Characterize the current composition and architecture checker

**Files:**
- Modify: `scripts/verify-architecture.ts`
- Test: `tests/unit/architecture-boundaries.test.ts`

**Interfaces:**
- Produce an exported `verifyArchitecture(input?: { root?: string; sourceRoots?: readonly string[] }): readonly string[]` function returning violations without exiting the process.
- Preserve CLI behavior: print violations and exit 1, or print the verified file count and exit 0.

- [x] **Step 1: Write failing acceptance tests** for an in-memory fixture containing a valid MCP adapter, then fixtures importing Drizzle, `@outbound/infrastructure/database/schema`, a persistence adapter, and a provider adapter; assert each violation is detected and valid application imports remain allowed.
- [x] **Step 2: Run `npx bun test tests/unit/architecture-boundaries.test.ts` and observe the expected missing-export/failed-boundary assertions.
- [x] **Step 3: Refactor the checker into the exported pure AST function and add explicit adapter-boundary rules for `packages/interface/src/mcp/` and `packages/mcp/`, including static/dynamic/require/ImportEquals declarations, schema/persistence/provider SDK detection and extension-aware alias/relative resolution.
- [x] **Step 4: Run the focused test and `npx bun run check:architecture`; confirm both pass.

### Task 2: Define bounded runtime capabilities and stateless lifecycle

**Files:**
- Create: `packages/bootstrap/src/noosphere-runtime.ts`
- Create: `packages/bootstrap/src/runtime-capabilities.ts`
- Create: `packages/bootstrap/src/create-noosphere-runtime.ts`
- Test: `tests/unit/noosphere-runtime.test.ts`

**Interfaces:**
- `RuntimeCapabilities` groups existing application-level use cases (`crm`, `content`, `conversations`, `knowledge`, `operations`, `prospectMemory`, `pipeline`, `campaigns`, `approvals`) as readonly values without exposing `Database`, schema tables, or provider clients.
- `NoosphereRuntime` exposes `capabilities`, `handle(request)`, `handleAuth(request)`, `health()`, and `close()`; no per-request mutating state is held.
- `createNoosphereApiRuntime(environment?: NodeJS.ProcessEnv): NoosphereRuntime` owns API composition; `createNoosphereRuntime` remains an injectable transport-neutral runtime for tests and future adapters.

- [x] **Step 1: Write failing tests** asserting a runtime exposes capability groups, handles health/auth delegation through injected boundaries, has no `database`/provider fields, and returns stable references across requests.
- [x] **Step 2: Run the focused test and observe failure because the bootstrap package does not exist.
- [x] **Step 3: Implement the bounded runtime contracts and injectable composition factory. Keep infrastructure construction private to the API composition; expose only application use cases and lifecycle/transport methods.
- [x] **Step 4: Run the focused test and `npx bun run check:types`; confirm pass.

### Task 3: Move API composition and routing behind the runtime

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `packages/bootstrap/src/create-noosphere-api-runtime.ts`
- Test: `tests/unit/noosphere-runtime-http-compatibility.test.ts`

**Interfaces:**
- Runtime `handle(request)` must preserve all existing route dispatch and error handling currently in `apps/api/src/index.ts`.
- API entrypoint retains only environment/bootstrap invocation, `Bun.serve`, startup logging, signal shutdown, and readiness response delegation.

- [x] **Step 1: Write a failing compatibility test** using injected handler/capability fakes to assert representative health, auth, and application route dispatch does not call REST loopback.
- [x] **Step 2: Run the focused test and record the failure before extraction.
- [x] **Step 3: Move all handler construction, route dispatch, health and shutdown wiring into the bootstrap factory; the API retains only process transport concerns.
- [x] **Step 4: Run targeted HTTP tests, the compatibility test, and `npx bun run check:types`; fix only regressions from extraction.

### Task 4: Verify all gates and document adapter usage

**Files:**
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `README.md` (only if the runtime entrypoint requires user-facing setup documentation)
- Test: existing `tests/http/*`, `tests/integration/*`, and architecture tests

- [x] **Step 1: Run `npx bun test tests/unit tests/http` and targeted integration tests available in the environment.
- [x] **Step 2: Run `npx bun run check:architecture`, `npx bun run check:types`, and `npx bun run check`; record any environment-only blockers (Docker/.env/infra) without weakening checks.
- [x] **Step 3: Inspect `git diff` for accidental provider/schema exposure, ensure no MCP REST calls or mutable request state, and send the Manager a file/test/limitation report.

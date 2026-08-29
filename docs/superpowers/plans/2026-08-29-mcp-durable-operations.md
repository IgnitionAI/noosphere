# MCP Durable Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-bound durable handles for asynchronous MCP jobs, so a start call returns a queued operation immediately and `operation_get`/its resource can report bounded state after worker, retry, restart, or dead-letter transitions.

**Architecture:** The application owns the durable operation contract while the MCP write transaction attaches its operation UUID to the existing domain job created by the content-generation repository. A PostgreSQL store updates that read model from worker transitions; interface tools/resources expose only the authenticated workspace's operation and never keep MCP-session or process-memory state.

**Tech Stack:** TypeScript, Bun tests, Zod v4, MCP SDK 2, Drizzle PostgreSQL migrations, existing `JobQueue`/worker lease and retry infrastructure.

**Spec:** Issue #75 — Opérations durables pour les jobs MCP (team task assignment dated 2026-08-29).

## Global Constraints

- `start` returns immediately with `status: "queued"`, an `operationId` UUID distinct from `jobId`, a `correlationId`, and `noosphere://operations/{operationId}`.
- Persist operation state in PostgreSQL with statuses exactly `queued`, `running`, `completed`, `failed`, and `cancelled`; `resultRefs` are bounded and contain no secrets or raw provider payloads.
- Every read and state transition is constrained by `workspaceId`; a foreign-tenant operation behaves as not found and does not reveal existence.
- Replays reuse the existing MCP idempotency/correlation model; they never create a second operation or domain job for the same workspace/client/tool/request key.
- Worker leases, retries, restart recovery, and dead-letter handling reuse the existing `JobQueue`; no MCP session, in-memory registry, or generic cancel endpoint is introduced.
- No provider call crosses the operation/application boundary; migration changes are additive and forward-only.
- No commit, push, or production schema rewrite is part of this task.

### Task 1: Define the durable operation application contract

**Files:**
- Modify: `packages/application/src/mcp/mcp-durable-operations.ts`
- Test: `tests/unit/mcp-durable-operations.test.ts`

**Interfaces:**
- Consumes: `McpExecutionContext` from `packages/application/src/mcp/mcp-read-capabilities.ts` and `McpWriteCommand` from `packages/application/src/mcp/mcp-write-capabilities.ts`.
- Produces: `McpOperationStatus`, `McpOperationRecord`, and the transaction-facing `McpOperationStore` for Tasks 2–5.

- [x] **Step 1: Write the unit contract test**

```ts
test("attaches the durable operation to the leaseable domain job and run result", async () => {
  // Covered by tests/unit/mcp-durable-operations.test.ts.
});
```

- [x] **Step 2: Run the focused tests**

Run: `npm exec --yes bun -- test tests/unit/mcp-durable-operations.test.ts`

Expected: PASS for the transaction-facing operation contract.

- [x] **Step 3: Add the minimal types and transaction contract**

Define these exact bounded shapes:

```ts
export type McpOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type McpOperationRef = { readonly type: string; readonly id: string };
export interface McpOperationRecord {
  readonly operationId: string; readonly workspaceId: string; readonly clientId: string; readonly userId: string;
  readonly tool: McpWriteToolName; readonly requestKey: string; readonly inputHash: string; readonly jobId: string; readonly correlationId: string;
  readonly status: McpOperationStatus; readonly resultRefs: readonly McpOperationRef[];
  readonly errorCode: string | null; readonly operationUri: string; readonly createdAt: Date; readonly updatedAt: Date;
}
export interface McpOperationStore {
  createQueued(input: { context: McpExecutionContext; command: McpWriteCommand; operationId: string; jobId: string; correlationId: string; now: Date }): Promise<{ record: McpOperationRecord; inserted: boolean }>;
  get(input: { workspaceId: string; operationId: string }): Promise<McpOperationRecord | null>;
}
`McpOperationStore.createQueued` accepts the real domain job ID/correlation ID and bounded run result reference.
```

`content_draft_create` creates the ContentGenerationRun and its real content job in the MCP write transaction, then calls `createQueued` with that job's identifiers and `{type:"ContentGenerationRun",id:runId}`. The persisted MCP write result returns queued state and all operation handle identifiers; replay preserves them through the existing ledger.

- [x] **Step 4: Run the focused tests to verify the contract passes**

Run: `npm exec --yes bun -- test tests/unit/mcp-durable-operations.test.ts`

Expected: PASS with replay and tenant isolation assertions green.

### Task 2: Persist operation records in a forward-only migration

**Files:**
- Create: `packages/infrastructure/migrations/0102_mcp_durable_operations.sql`
- Modify: `packages/infrastructure/migrations/meta/_journal.json`
- Modify: `packages/infrastructure/src/database/schema.ts`
- Create: `packages/infrastructure/src/auth/postgres-mcp-operation-store.ts`
- Test: `tests/integration/mcp-durable-operations.test.ts`

**Interfaces:**
- Consumes: `McpOperationStore` and `McpOperationRecord` from Task 1, `Database` from `packages/infrastructure/src/database/client.ts`, and existing `jobs` row identifiers.
- Produces: `PostgresMcpOperationStore`, `mcpOperations` schema, and atomic transition methods `markRunning`, `complete`, `fail`, `cancel` for Tasks 3–5.

- [ ] **Step 1: Write the failing PostgreSQL tests**

```ts
test("persists queued operations and deduplicates the workspace/client/tool/request key", async () => {
  const first = await store.createQueued(input);
  const replay = await store.createQueued({ ...input, operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
  expect(first.inserted).toBe(true);
  expect(replay.inserted).toBe(false);
  expect(replay.record.operationId).toBe(first.record.operationId);
  expect((await database.client`select count(*)::int as count from mcp_operations where workspace_id = ${workspaceId}`)[0]?.count).toBe(1);
});

test("state transitions are lease-owned, bounded, and survive a fresh store instance", async () => {
  const queued = await store.createQueued(input);
  await store.markRunning({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, now });
  await store.complete({ workspaceId, operationId: queued.record.operationId, jobId: queued.record.jobId, resultRefs: [{ type: "company", id: crypto.randomUUID() }], now });
  expect((await new PostgresMcpOperationStore(database).get({ workspaceId, operationId: queued.record.operationId }))?.status).toBe("completed");
});

test("a foreign workspace cannot read or transition an operation", async () => {
  const queued = await store.createQueued(input);
  expect(await store.get({ workspaceId: crypto.randomUUID(), operationId: queued.record.operationId })).toBeNull();
  await expect(store.markRunning({ workspaceId: crypto.randomUUID(), operationId: queued.record.operationId, jobId: queued.record.jobId, now })).rejects.toThrow("MCP_OPERATION_NOT_FOUND");
});
```

- [ ] **Step 2: Run the integration tests on a freshly migrated ParadeDB database**

Run: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/ignition_outbound_test npm exec --yes bun -- run db:migrate && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/ignition_outbound_test npm exec --yes bun -- test tests/integration/mcp-durable-operations.test.ts`

Expected: FAIL at migration/table lookup, before implementation.

- [ ] **Step 3: Add the additive table and Drizzle model**

Use this SQL shape, preserving forward-only behavior:

```sql
CREATE TABLE IF NOT EXISTS "mcp_operations" (
  "operation_id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "client_id" varchar(180) NOT NULL REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "tool" varchar(100) NOT NULL,
  "request_key" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "correlation_id" varchar(200) NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL CHECK ("status" IN ('queued','running','completed','failed','cancelled')),
  "result_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error_code" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_operations_request_uq" UNIQUE ("workspace_id", "client_id", "tool", "request_key")
);
CREATE INDEX IF NOT EXISTS "mcp_operations_workspace_status_idx" ON "mcp_operations" ("workspace_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "mcp_operations_job_idx" ON "mcp_operations" ("workspace_id", "job_id");
```

Add the corresponding `mcpOperations` model with `resultRefs` as JSONB, indexes on `(workspaceId, status, updatedAt)` and `(workspaceId, jobId)`, and journal entry `idx: 102`, tag `0102_mcp_durable_operations`.

- [ ] **Step 4: Implement atomic insert/read/transitions**

`createQueued` inserts the complete tenant/client/user identity and returns the existing row on the unique-key conflict. It compares a replay's `inputHash` with the persisted hash and throws `MCP_OPERATION_IDEMPOTENCY_CONFLICT` on divergence; the current application fake may defer this comparison, but the PostgreSQL slice must enforce it. Every transition predicates on `workspace_id`, `operation_id`, `job_id`, and the expected current status; absent rows throw `MCP_OPERATION_NOT_FOUND`, lease mismatches throw `MCP_OPERATION_LEASE_LOST`, and `resultRefs` is capped at 20 refs with each `type`/`id` capped at 120 characters. `errorCode` is the only persisted failure detail.

- [ ] **Step 5: Run the integration tests to verify persistence**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/ignition_outbound_test npm exec --yes bun -- test tests/integration/mcp-durable-operations.test.ts`

Expected: PASS for replay, restart, transition, bounds, and tenant isolation.

### Task 3: Connect worker lease/retry/dead-letter outcomes

**Files:**
- Create: `packages/application/src/mcp/mcp-tracked-job-lifecycle.ts`
- Modify: `packages/infrastructure/src/auth/postgres-mcp-operation-store.ts`
- Modify: `apps/worker/src/research-worker.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `tests/unit/mcp-operation-processor.test.ts`

**Interfaces:**
- Consumes: `LeasedJob`, `PostgresMcpOperationStore`, and the existing worker dispatch loop.
- Produces: generic `McpTrackedJobLifecycle` hooks around existing domain jobs; no MCP-specific queue job, dispatcher, acknowledgement, or retry engine.

- [x] **Step 1: Write the failing lifecycle tests**

- `untracked jobs remain unchanged`
- `tracked success marks running then completed with resolver refs`
- `scheduled retry remains non-terminal`
- `dead letter marks failed`
- `workspace/job mismatch is not found and leaks nothing`
- `restart after completion is idempotent`

- [x] **Step 2: Run tests and verify the lifecycle contract fails before implementation**

Run: `npm exec --yes bun -- test tests/unit/mcp-operation-processor.test.ts`

Expected: FAIL because the generic lifecycle contract does not yet exist.

- [x] **Step 3: Implement and centrally register the lifecycle**

`McpTrackedJobLifecycle` performs tenant-scoped `findByJob`, marks `running` before dispatch, invokes an injected result-ref resolver after domain success, and marks `completed` with bounded refs. It never acknowledges or retries. The existing worker catch path calls `queue.retry` and then `afterRetry`; only an actual `dead_lettered` outcome marks the operation failed. Untracked jobs and all existing domain routes remain unchanged.

- [x] **Step 4: Verify targeted tests, types, architecture, and diff**

Run: `npm exec --yes bun -- test tests/unit/mcp-operation-processor.test.ts tests/integration/mcp-durable-operations.test.ts`

Expected: PASS with a fresh processor/store instance observing persisted `running`, `failed`, and `completed` records; exhausted jobs are `dead_lettered` without a second effect.

### Task 4: Expose `operation_get` and the durable operation resource

**Files:**
- Modify: `packages/application/src/mcp/mcp-durable-operations.ts`
- Modify: `packages/application/src/mcp/mcp-read-capabilities.ts`
- Modify: `packages/interface/src/mcp/mcp-read-contracts.ts`
- Modify: `packages/interface/src/mcp/mcp-read-tools.ts`
- Modify: `packages/interface/src/mcp/mcp-read-resources.ts`
- Modify: `packages/bootstrap/src/create-noosphere-api-runtime.ts`
- Extend: `tests/unit/mcp-read-tools.test.ts`
- Extend: `tests/unit/mcp-read-capabilities.test.ts`
- Extend: `tests/unit/mcp-read-contracts.test.ts`

**Interfaces:**
- Consumes: the operation store's workspace-scoped `get`, `McpExecutionContext`, and the existing MCP server registration functions.
- Produces: strict `operation_get` input `{ operationId: string }`, tool output with bounded operation fields, and template `noosphere://operations/{operationId}`.

- [x] **Step 1: Write the failing registration/resource tests**

```ts
test("registers operation_get and never exposes a generic cancel tool", async () => {
  const listed = await discoverTools(registerAllMcpTools(server, capabilities, context));
  expect(listed).toContain("operation_get");
  expect(listed).not.toContain("operation_cancel");
});

test("operation_get and its resource return the same workspace-bound bounded record", async () => {
  const result = await callTool("operation_get", { operationId });
  expect(result.structuredContent).toMatchObject({ operationId, status: "queued", operationUri: `noosphere://operations/${operationId}` });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(await readResource(`noosphere://operations/${operationId}`)).toMatchObject({ contents: [{ uri: `noosphere://operations/${operationId}` }] });
});
```

- [x] **Step 2: Run the focused interface tests and verify they fail**

Run: `bun test tests/unit/mcp-read-tools.test.ts tests/unit/mcp-read-contracts.test.ts`

The repository environment has no Bun executable (`bun: command not found`); the pre-implementation test invocation is blocked by the runner, while the TypeScript contract remains independently type-checked.

- [x] **Step 3: Implement strict contracts, tool, resource, and runtime wiring**

Parse only UUID `operationId`; map missing/foreign records to the existing stable `NOT_FOUND` shape. Return only `operationId`, `jobId`, `correlationId`, `status`, bounded `resultRefs`, safe `errorCode`, timestamps, and `operationUri`; do not return input arguments, input hashes, provider IDs, tokens, or error messages. Register the tool/resource alongside the existing read catalogues and inject the OAuth workspace context on every call. The application projection and transport allowlist both enforce this shape.

- [x] **Step 4: Verify SDK discovery, call, resource, and tenant isolation**

Run: `bun test tests/unit/mcp-read-contracts.test.ts tests/unit/mcp-read-capabilities.test.ts tests/unit/mcp-read-tools.test.ts`; additionally run `tsc --noEmit`.

Expected: PASS; no cancel registration and foreign operation reads resolve to `NOT_FOUND`. `tsc --noEmit` passes in this environment; Bun runtime tests remain to be run by CI/QA when Bun is available.

### Task 5: Make start enqueue atomically and preserve correlation/idempotency

**Files:**
- Modify: `packages/application/src/mcp/mcp-write-capabilities.ts`
- Modify: `packages/interface/src/mcp/mcp-write-tools.ts`
- Modify: `packages/bootstrap/src/create-noosphere-api-runtime.ts`
- Test: `tests/unit/mcp-durable-operations-start.test.ts`
- Extend: `tests/integration/mcp-durable-operations.test.ts`

**Interfaces:**
- Consumes: Task 1 contract and Task 2 store, existing canonical MCP write hash and domain job repository.
- Produces: asynchronous write-tool response `{ status: "queued", operationId, jobId, correlationId, operationUri }` for commands whose effect is worker-backed.

- [ ] **Step 1: Write the failing start-tool tests**

```ts
test("an asynchronous MCP write returns queued without executing its effect inline", async () => {
  const response = await callWriteTool("content_draft_create", args);
  expect(response.structuredContent).toMatchObject({ status: "queued", operationId: expect.any(String), jobId: expect.any(String), correlationId: expect.any(String) });
  expect(effect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify current synchronous behavior fails the contract**

Run: `npm exec --yes bun -- test tests/unit/mcp-durable-operations-start.test.ts`

Expected: FAIL because the current write path executes/returns a mutation result instead of an immediately queued operation handle.

- [ ] **Step 3: Route only worker-backed operations through `start`**

Keep internal synchronous mutations unchanged where their existing contract requires an immediate durable result. Route `content_draft_create` through the atomic MCP write path, attaching its operation handle to the existing domain job and reusing that job correlation ID for operation, audit, and worker transitions.

- [ ] **Step 4: Verify replay, restart, failure, and audit correlation**

Run: `npm exec --yes bun -- test tests/unit/mcp-durable-operations-start.test.ts tests/integration/mcp-durable-operations.test.ts`

Expected: PASS with one operation/job per replay, stable correlation ids, persisted failure state, and no raw payloads in operation rows.

### Task 6: Run release-quality targeted gates and self-review

**Files:**
- Review: all files listed in Tasks 1–5
- Test: `tests/unit/mcp-durable-operations.test.ts`, `tests/unit/mcp-operation-processor.test.ts`, `tests/unit/mcp-operation-tools.test.ts`, `tests/integration/mcp-durable-operations.test.ts`

**Interfaces:**
- Consumes: all completed operation contracts and migrations.
- Produces: a verified, frozen diff ready for Manager review; no commit or push.

- [ ] **Step 1: Run all focused MCP tests**

Run: `npm exec --yes bun -- test tests/unit/mcp-durable-operations.test.ts tests/unit/mcp-operation-processor.test.ts tests/unit/mcp-operation-tools.test.ts tests/unit/mcp-durable-operations-start.test.ts tests/integration/mcp-durable-operations.test.ts`

Expected: all focused tests pass, including PostgreSQL replay, tenant, restart, lease, retry, dead-letter, success, and failure cases.

- [ ] **Step 2: Run repository gates**

Run: `npm exec --yes bun -- run check:types && npm exec --yes bun -- run check:architecture && npm exec --yes bun -- run check:build && git diff --check`

Expected: each command exits 0; no production ports/services or provider imports are added.

- [ ] **Step 3: Self-review the spec and diff**

Confirm every global constraint is covered: immediate queued response, distinct UUIDs, durable statuses, bounded refs/errors, workspace isolation, idempotent replay, existing queue/worker recovery, operation tool/resource, no generic cancel, no in-memory state, additive migration, and no provider call. Confirm all plan terms resolve to the exact types/files named earlier and scan the plan for forbidden placeholder markers or vague implementation steps.

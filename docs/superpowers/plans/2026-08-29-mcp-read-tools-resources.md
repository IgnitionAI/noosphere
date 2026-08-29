# MCP Read-Only Tools and Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the ten bounded, tenant-scoped read tools and eight URI resources from issue #73 through the existing stateless MCP transport.

**Architecture:** Application contracts own typed read ports; bootstrap wires existing PostgreSQL-backed read models behind wrappers. MCP interface code consumes only capabilities and OAuth principal context, never database/schema/provider modules. Resource and tool adapters share strict Zod input/output normalization, redaction, and opaque workspace-scoped cursors.

**Tech Stack:** TypeScript, Zod 4, Bun tests, official MCP TypeScript SDK 2.0.0, Drizzle hidden behind bootstrap.

**Spec:** GitHub issue #73, “Expose first read-only tools and resources for GTM context”.

## Global Constraints

- Keep the catalogue names and URI templates stable: no workspace ID in arguments or URIs.
- Every read uses the OAuth principal workspace and rechecked membership/RBAC; cross-tenant entities are not found without leakage.
- Bound collection inputs to `limit` 1–100 and opaque cursors ≤512 bytes; reject unknown Zod keys.
- Viewer redaction must remove amount/currency and sensitive/provider identifiers, credentials, and authorization material.
- Preserve Prospect 360 facts, hypotheses, recommendations, contradictions, missing information, and provenance receipts.
- MCP adapters must not import Drizzle, database schema/persistence, provider SDKs, or HTTP loopback.

### Task 1: Read contracts and redaction

**Files:**
- Create: `packages/application/src/mcp/mcp-read-capabilities.ts`
- Create: `packages/interface/src/mcp/mcp-read-contracts.ts`
- Test: `tests/unit/mcp-read-contracts.test.ts`

- [ ] Write failing tests for strict tool argument schemas, bounded cursor/limit, URI parameter schemas, and viewer-sensitive field redaction.
- [ ] Implement explicit application read-port types for workspace, CRM, prospect, pipeline, opportunity, conversations, campaigns, content calendar, and health.
- [ ] Implement strict Zod schemas and normalization helpers without exposing `workspaceId` inputs.
- [ ] Run `npx bun test tests/unit/mcp-read-contracts.test.ts` and verify green.

### Task 2: Compose existing read models and minimum gap adapters

**Files:**
- Modify: `packages/bootstrap/src/runtime-capabilities.ts`
- Modify: `packages/bootstrap/src/create-noosphere-api-runtime.ts`
- Create: `packages/infrastructure/src/crm/postgres-mcp-read-repository.ts`
- Create: `packages/infrastructure/src/pipeline/postgres-mcp-opportunity-reader.ts`
- Create: `packages/infrastructure/src/content/postgres-content-calendar-reader.ts`
- Test: `tests/unit/mcp-read-capabilities.test.ts`

- [ ] Add failing composition tests proving workspace scoping and calls to existing `PostgresOperationalViews`, `PostgresCrmRepository`, `PostgresProspectViewRepository`/`ProspectMemoryOperationsApplication`, `PostgresOpportunityRepository`, `PostgresCampaignAutopilotDashboard`, and `NoosphereRuntime.health`.
- [ ] Add only the missing unified CRM search, single opportunity read, and content-calendar read ports/adapters; keep SQL/schema imports in infrastructure.
- [ ] Wire immutable capability wrappers and pass OAuth principal role/scopes into each read operation.
- [ ] Run the focused capability tests and verify green.

### Task 3: Register MCP tools and resources

**Files:**
- Create: `packages/interface/src/mcp/mcp-read-tools.ts`
- Create: `packages/interface/src/mcp/mcp-read-resources.ts`
- Modify: `packages/interface/src/mcp/mcp-transport.ts`
- Test: `tests/unit/mcp-read-tools.test.ts`
- Test: `tests/unit/mcp-read-resources.test.ts`
- Test: `tests/unit/architecture-boundaries.test.ts`

- [ ] Write failing fake-capability tests for all ten tools and eight URI templates, including calls, reads, pagination, redaction, and forbidden unknown arguments.
- [ ] Register SDK `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, and `resources/read` handlers using fresh request capabilities.
- [ ] Return structured bounded data and stable internal IDs/timestamps; map missing entities to non-leaking not-found errors.
- [ ] Verify architecture fixtures reject DB/provider imports from MCP adapters.

### Task 4: Protocol and acceptance coverage

**Files:**
- Create: `tests/integration/mcp-read.test.ts`
- Modify: `tests/http/mcp-transport.test.ts`

- [ ] Use official MCP client 2.0.0 to exercise initialize, tools/resources discovery, all representative calls/reads, and modern/legacy stateless restart isolation.
- [ ] Cover OAuth scopes, fresh membership/RBAC, viewer redaction, cross-tenant IDs, opaque cursor stability, and bounded responses.
- [ ] Run targeted MCP tests, `bun run check:types`, `bun run check:architecture`, `bun run check:build`, and `git diff --check`; report unavailable database integration gates.

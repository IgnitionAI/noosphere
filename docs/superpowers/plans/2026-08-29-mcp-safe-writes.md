# MCP Safe Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose bounded, idempotent MCP mutations that never perform external provider effects.

**Architecture:** Interface validates strict write commands and forwards an OAuth principal to an application write port. A durable PostgreSQL ledger deduplicates `(workspace, client, tool, requestKey)` and stores a canonical input hash before delegating to existing CRM, pipeline, content and scheduler ports.

**Tech Stack:** TypeScript, Zod v4, MCP SDK 2, Drizzle PostgreSQL migrations.

## Global Constraints

- `mcp:write` scope and fresh workspace membership are mandatory.
- Viewer/reviewer are denied; operator ownership and admin/owner policies are enforced.
- `send`, `publish`, and `book` are never registered.
- Request keys are UUIDs; replay with a different canonical hash is a stable 409.
- Migration is additive and forward-only; no raw secrets/provider calls cross the application boundary.

### Task 1: Write contracts and ledger port

**Files:** `packages/interface/src/mcp/mcp-write-contracts.ts`, `packages/application/src/mcp/mcp-write-capabilities.ts`, `tests/unit/mcp-write-contracts.test.ts`.

- Add strict schemas for the seven approved commands, expectedVersion/CAS and bounded fields.
- Add explicit `McpWriteLedger` and `McpWriteCapabilities` interfaces with stable result/error codes.
- Tests cover UUID request keys, forbidden commands, role/scope matrix and canonical hash stability.

### Task 2: Implement SDK registrations

**Files:** `packages/interface/src/mcp/mcp-write-tools.ts`, `packages/interface/src/mcp/mcp-transport.ts`, `tests/unit/mcp-write-tools.test.ts`.

- Register only approved tools, invoke the capability port, and map errors to 401/403/404/409/429.
- Keep response fields bounded to id/version/state/operation/correlation/audit reference.

### Task 3: Durable PostgreSQL ledger and migration

**Files:** `packages/infrastructure/src/database/schema.ts`, `packages/infrastructure/src/database/migrations/0099_*.sql`, `packages/infrastructure/src/auth/postgres-mcp-write-ledger.ts`, tests.

- Add additive `mcp_write_operations` table with unique tenant/client/tool/request key, canonical hash, status/result and timestamps.
- Implement transactional lock/insert/replay/hash conflict handling.

### Task 4: Runtime wiring and acceptance tests

**Files:** `packages/bootstrap/src/create-noosphere-api-runtime.ts`, `packages/bootstrap/src/runtime-capabilities.ts`, tests.

- Wire ledger plus existing CRM/opportunity/content/scheduler applications; queue drafts and dry-run scheduling only.
- Pass authenticated OAuth principal and fresh membership context; add SDK idempotence/CAS/tenant tests.

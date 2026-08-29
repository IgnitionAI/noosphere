# MCP Workspace OAuth 2.1 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-scoped OAuth 2.1 authorization server and MCP resource-server boundary with durable PKCE, opaque audience-bound tokens and immediate membership revocation.

**Architecture:** `packages/interface/src/mcp/mcp-oauth.ts` owns Web Request/Response contracts, strict RFC/MCP parameter validation and redacted consent metadata. `packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts` owns hashed grant persistence, row-lock transactions and fresh membership lookup; the interface service owns hashing, random secrets, refresh rotation/reuse detection. API bootstrap composes the service into `/oauth/*`, `/.well-known/*` and MCP authorization without changing Better Auth browser routes.

**Tech Stack:** TypeScript, Bun Web Standard handlers, Drizzle/PostgreSQL, Web Crypto SHA-256/CSPRNG, Better Auth session/membership readers, RFC 8414/RFC 8707/RFC 9728, OAuth 2.1 Authorization Code + PKCE S256.

**Spec:** GitHub issue #72; MCP Authorization (2025-11-25) and OAuth 2.1/RFC 7636/RFC 8414/RFC 8707/RFC 9728.

## Global Constraints

- Access tokens are opaque, hashed at rest, audience-bound to the canonical `/mcp` resource, short-lived, and never logged.
- Authorization codes are S256-only, single-use and short-lived; redirect URIs are exact registered matches and authorization requests require state.
- Refresh tokens rotate atomically; reuse revokes the family and returns `invalid_grant`.
- Every MCP bearer request re-resolves active workspace membership and role; no tool accepts a client-supplied `workspaceId`.
- Scope authorization is the intersection of token scopes and current role policy; revocation takes effect on the next request.
- Migrations are additive/forward-only; Better Auth browser endpoints and schema are unchanged; no UI is added.

### Task 1: Define interface contracts and redacted OAuth route handler

**Files:** Create `packages/interface/src/mcp/mcp-oauth.ts`; test `tests/unit/mcp-oauth.test.ts`.

- [ ] Write failing tests for protected-resource metadata, authorization-server metadata, exact redirect/PKCE/state validation, consent contract, and deterministic OAuth error status/body behavior.
- [ ] Implement `McpOAuthService` methods `registerClient`, `beginAuthorization`, `exchangeAuthorizationCode`, `refreshAccessToken`, `revokeToken`, `authenticateMcpRequest`, and `metadata`; keep token values out of returned logs/contracts.
- [ ] Implement `createMcpOAuthHandler(service, options)` for GET metadata/authorize and POST token/revoke. Require form encoding on token/revoke, HTTPS/localhost redirects, `response_type=code`, `code_challenge_method=S256`, exact `redirect_uri`, and `state`; return 400/401/403/404/405/429 according to error class.
- [ ] Expose consent data (`client_id`, client name, workspace slug/name, requested/effective scopes, state and redirect) without issuing a code until `approved=true`; approved responses redirect with code and state.
- [ ] Run `npx --yes bun test tests/unit/mcp-oauth.test.ts` and verify the new tests fail before implementation, then pass.

### Task 2: Add additive OAuth persistence

**Files:** Modify `packages/infrastructure/src/database/schema.ts`; create `packages/infrastructure/migrations/0098_mcp_oauth.sql`; update migration metadata; test schema/migration assertions in `tests/unit/mcp-oauth.test.ts`.

- [ ] Add `mcp_oauth_clients`, `mcp_oauth_authorization_codes`, `mcp_oauth_access_tokens`, `mcp_oauth_refresh_tokens`, and `mcp_oauth_token_revocations` with UUID keys, SHA-256 hash uniqueness, user/workspace/client foreign keys, scopes, `/mcp` audience, expiries, consumed/rotated/revoked timestamps, and indexes for lookup/expiry.
- [ ] Add composite client/workspace foreign keys where a grant row carries both identities; use `ON DELETE CASCADE` only for workspace-owned OAuth rows and no destructive migration statements.
- [ ] Generate the SQL via Drizzle where possible, review it, and ensure the migration journal/snapshots remain forward-only.

### Task 3: Implement PostgreSQL OAuth service

**Files:** Create `packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts`; extend `packages/infrastructure/src/auth/postgres-workspace-membership-reader.ts` only if a bounded lookup is needed; tests `tests/integration/mcp-oauth.test.ts` when a database is available.

- [ ] Implement CSPRNG token generation and Web Crypto SHA-256 hashing; persist only hashes and redacted audit payloads.
- [ ] Register public clients with normalized exact redirect URIs and bounded metadata; bind codes/tokens to user, workspace and client.
- [ ] Issue one-use/TTL authorization codes and exchange only with matching verifier (`S256`), client, redirect and resource audience; issue opaque access plus refresh token.
- [ ] Atomically rotate refresh tokens under row lock, mark the replaced token, revoke the family on replay, and persist revocation records idempotently.
- [ ] Validate bearer hashes, audience `/mcp`, expiry/revocation and fresh active membership/role on every call; derive allowed scopes from role and reject missing scope with 403.
- [ ] Add rate-limit checks keyed by client/user/IP and audit events that include IDs/action only, never code/token/verifier.

### Task 4: Compose API routes and MCP auth

**Files:** Modify `packages/bootstrap/src/create-noosphere-api-runtime.ts`, `packages/interface/src/mcp/mcp-transport.ts`, `deploy/Caddyfile`, `docs/architecture/runtime-boundaries.md`.

- [ ] Compose `PostgresMcpOAuthService` with Better Auth session/membership readers and dispatch OAuth metadata/authorize/token/revoke before `/mcp`; leave `/api/auth/*` unchanged.
- [ ] Replace the boolean-only production authorizer with the OAuth service bearer validator (development token remains opt-in and disabled in production); MCP receives only the validated principal contract.
- [ ] Emit `WWW-Authenticate` with protected-resource metadata on 401 and enforce canonical host/origin, no query-string tokens, and `/mcp` audience.
- [ ] Route `/.well-known/oauth-*` and `/oauth/*` to API in Caddy before the web fallback without adding services, ports, or loopback calls.

### Task 5: Acceptance and verification

**Files:** Extend `tests/unit/mcp-oauth.test.ts`; add static `tests/unit/mcp-oauth-caddy-compose.test.ts`; update docs only where behavior is now true.

- [ ] Cover PKCE success/replay/wrong verifier/expiry, redirect/state/CSRF, audience/scope/RBAC, fresh disabled membership, refresh rotation/reuse/revoke, tenant isolation, restart persistence, rate-limit responses and redacted logs.
- [ ] Run targeted tests, `tests/unit tests/http`, `check:types`, `check:architecture`, `check:build`, Compose static validation with explicit placeholders, and `git diff --check`; document unavailable database/integration credentials.

## Security hardening follow-up

- The API is reached over the private `http://api:3001` hop. Caddy strips
  client forwarding headers and stamps `X-Noosphere-Forwarded-Proto` from
  `{http.request.scheme}`. Bootstrap validates the public issuer as HTTPS
  (except localhost), while OAuth authorization permits only configured
  private service hosts (`MCP_TRUSTED_INTERNAL_HOSTS`) over HTTP; public/direct
  HTTP and untrusted `X-Forwarded-Proto` remain rejected.
- OAuth form POSTs are bounded to 16 KiB before decoding, with both
  `Content-Length` and streamed-byte checks returning 413.
- Token, revoke and authorize requests use a durable rate-limiter port keyed
  by endpoint/client plus user (authorize) or edge client IP (token/revoke),
  returning stable 429 + `Retry-After`. Production bootstrap wires the
  PostgreSQL implementation backed by the existing OAuth audit store and
  transaction advisory locks; no process-local limiter state is used.

# Local MCP Test Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reproducible, local-only journey from a clean checkout to an authenticated MCP call and a verified governed fake effect, with durable state, tenant isolation, safe credentials, bounded resources, and scoped cleanup.

**Architecture:** Add a dedicated local Compose overlay and thin Bun orchestration scripts around the existing A4 seeder, smoke runner, OAuth store, MCP transport, capabilities, worker, and durable-effect repositories. Local fake adapters are selected only by an explicit local configuration; the production composition, provider boundary, auth/policy gates, and Caddy production files stay unchanged. The sequence is #80 startup, #81 fixtures, parallel #82 fakes and #83 client config, #84 verification, then #85 clean-checkout validation.

**Tech Stack:** Bun 1.3.4, TypeScript 5.9, Docker Compose v2, Caddy local CA, PostgreSQL/Drizzle, Better Auth OAuth/PKCE, official MCP TypeScript SDK 2.0.0, Inspector 0.16.3, and existing Bun unit/integration runners.

**Spec:** docs/superpowers/specs/2026-08-31-local-mcp-test-environment-design.md

## Global Constraints

- Use AMD64 Linux, Docker Engine/Compose v2, Bun 1.3.4, and loopback-only local ports.
- Publish only Caddy on 127.0.0.1:18080 and 127.0.0.1:18443; never publish API, database, MinIO, SearXNG, crawler, or TEI.
- Keep production OAuth, PKCE, audience, membership, scope, tenant, policy, marker-before-effect, reconciliation, and redaction behavior unchanged.
- Build application images locally; do not require registry login, production secrets, public DNS, or a public endpoint.
- Use real durable OAuth rows and normal MCP transport; do not enable development authentication.
- Keep bearer values and database credentials out of argv, logs, reports, committed fixtures, and test output; generated host secret files are mode 0600.
- Local governed-effect fakes are explicit and provider-free; campaign_activation remains ADAPTER_UNAVAILABLE.
- Clean only fixture-key rows and the named local Compose project; never run docker compose down -v or delete an existing volume.
- Run one heavy integration or E2E suite at a time and exactly one local worker process.
- Every task follows RED test, observed failure, minimal GREEN implementation, focused verification, and review before any task commit.

---

## File and ownership map

| Area | Files | Responsibility |
| --- | --- | --- |
| Local topology | compose.mcp-local.yml, scripts/start-local-mcp.ts, scripts/stop-local-mcp.ts | Loopback Compose project, local builds, migration/readiness, scoped stop/status |
| Local fixtures | scripts/prepare-mcp-local.ts, package.json, docs/runbooks/mcp-local.md | Fixture key, OAuth identities, private credentials, FK-safe scoped cleanup |
| Local fakes | packages/infrastructure/src/mcp/local-governed-effect-fakes.ts, packages/bootstrap/src/create-noosphere-api-runtime.ts, apps/worker/src/index.ts | Explicit local fake adapter composition and bounded counters |
| Client config | scripts/write-mcp-local-client-config.ts, scripts/smoke-mcp-production.ts | Canonical endpoint/audience/CA/config and safe Inspector forwarding |
| Verification | scripts/verify-mcp-local.ts, package.json | Official SDK protocol, safe write, approval, fake effect, replay, policy/tenant negatives |
| Clean checkout | scripts/validate-mcp-local-quickstart.ts, docs/validation/2026-08-31-local-mcp-quickstart.md | Sequential validation evidence, restart, scoped cleanup, dated redacted report |

The API/runtime remains the authority for authorization, workspace derivation,
capability invocation, and durable state. The worker remains the only fake
effect caller. The seeder remains the only fixture-row writer. The verifier
calls MCP through Caddy and never calls API internals. The orchestrator never
makes business decisions.

## Dependency and review order

1. #80 creates the local project and readiness contract.
2. #81 consumes #80 and creates deterministic identities and private credentials.
3. #82 and #83 consume #81 independently.
4. #84 consumes #80, #81, #82, and #83.
5. #85 consumes all earlier slices and records clean-checkout evidence.

Each task ends with a focused test result and a reviewer checkpoint. The
commands below are execution commands for a future implementation session; they
are not run while this documentation task is being reviewed.

### Task 1: #80 — deterministic one-command local stack startup

**Files:**
- Create: compose.mcp-local.yml
- Create: scripts/start-local-mcp.ts
- Create: scripts/stop-local-mcp.ts
- Modify: package.json, adding mcp:local:start, mcp:local:stop, and mcp:local:status
- Create: tests/unit/mcp-local-startup.test.ts
- Create: tests/integration/mcp-local-startup.test.ts
- Create or modify: docs/runbooks/mcp-local.md

**Interfaces:**
- Consumes: compose.infrastructure.yml, compose.production.yml, deploy/Caddyfile.mcp-smoke, the local env file, Docker/Compose subprocesses, and existing health endpoints.
- Produces: startLocalMcp(options: LocalMcpStartOptions): Promise<LocalMcpReady>; stopLocalMcp(options: LocalMcpStopOptions): Promise<void>; inspectLocalMcp(options: LocalMcpInspectOptions): Promise<LocalMcpStatus>.
- LocalMcpStartOptions has envFilePath: string, projectName: string, httpPort: number, httpsPort: number, and run: (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>.
- LocalMcpReady has projectName: string, resource: string, publishedPorts: readonly string[], workerCount: 1, and correlationId: string.
- LocalMcpServiceStatus has name: string, state: "running" | "exited" | "missing" | "unknown", and health: "healthy" | "unhealthy" | "unknown".
- LocalMcpStatus has projectName: string, resource: string, publishedPorts: readonly string[], services: readonly LocalMcpServiceStatus[], workerCount: number, correlationId: string, and redacted: true.
- LocalMcpStopOptions has envFilePath: string, projectName: string, and run with the same subprocess result shape.
- LocalMcpInspectOptions has envFilePath: string, projectName: string, and run with the same subprocess result shape.
- All returned strings are bounded and redacted; no raw subprocess output is returned.

- [ ] **Step 1: Write the failing topology and startup tests**

~~~ts
import { describe, expect, test } from "bun:test";
import {
  inspectLocalMcp,
  startLocalMcp,
} from "../../scripts/start-local-mcp";

test("rejects a merged config that publishes anything except loopback Caddy", async () => {
  const run = async (argv: string[]) => {
    if (argv.includes("config")) {
      return {
        exitCode: 0,
        stdout: "proxy 127.0.0.1:18080->80,api 0.0.0.0:3000->3000",
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await expect(
    startLocalMcp({
      envFilePath: "/tmp/mcp-local.env",
      projectName: "noosphere-mcp-local",
      httpPort: 18080,
      httpsPort: 18443,
      run,
    }),
  ).rejects.toMatchObject({ code: "MCP_LOCAL_UNSAFE_PORTS" });
});

test("uses one worker and reports a canonical local resource", async () => {
  const commands: string[][] = [];
  const run = async (argv: string[]) => {
    commands.push(argv);
    return {
      exitCode: 0,
      stdout: "proxy 127.0.0.1:18080->80,127.0.0.1:18443->443",
      stderr: "",
    };
  };
  const ready = await startLocalMcp({
    envFilePath: "/tmp/mcp-local.env",
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    run,
  });
  expect(ready.resource).toBe("https://mcp.localhost:18443/mcp");
  expect(ready.workerCount).toBe(1);
  expect(commands.some((argv) => argv.includes("config"))).toBe(true);
});
~~~

- [ ] **Step 2: Run the focused tests and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-startup.test.ts
~~~
Expected: FAIL because the local command modules and error code do not yet
exist. Do not start Docker in this RED step.

- [ ] **Step 3: Implement the minimal local overlay and orchestration**

Create compose.mcp-local.yml by layering the existing infrastructure and
production files. Reset proxy ports with Compose-supported ports override to
127.0.0.1:18080:80 and 127.0.0.1:18443:443, mount the local Caddy file read-only,
and leave every other service port unpublished. Select local application builds
for api, web, and worker. Use migration completion before API readiness and
configure one worker with bounded batch and poll settings.

Implement startLocalMcp to validate Bun, docker, docker compose, env-file mode
0600, loopback ports, and the merged config before up. Run local application
builds, then docker compose up -d --wait database minio searxng crawler migrate
api web proxy worker. Probe /health/ready over the Caddy local CA with a finite
deadline. Return stable bounded codes for prerequisite, configuration, port,
Compose, migration, or health failures. Never print subprocess stdout/stderr
verbatim.

Implement stopLocalMcp to run fixture cleanup first through the scoped seeder,
then stop/remove only the project services without -v. Implement inspectLocalMcp
as read-only. Refuse an existing project name that resolves to an unrelated
Compose label.

- [ ] **Step 4: Run focused GREEN tests and static topology gates**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-startup.test.ts
npx --yes bun@1.3.4 run check:types
docker compose --env-file .env.mcp-local -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-local.yml config --quiet
~~~
Expected: focused unit tests pass, TypeScript passes, and Compose config
resolves without published non-Caddy ports. An opt-in local integration run
uses a dedicated TEST_DATABASE_URL and one worker:
~~~sh
npx --yes bun@1.3.4 test tests/integration/mcp-local-startup.test.ts
~~~
The integration test must fail closed when Docker or TEST_DATABASE_URL is
unavailable and must not delete volumes.

- [ ] **Step 5: Review and commit the self-contained #80 slice**

After reviewer approval, inspect:
~~~sh
git diff --check
git status --short
~~~
Then commit only the #80 files:
~~~sh
git add compose.mcp-local.yml scripts/start-local-mcp.ts scripts/stop-local-mcp.ts package.json tests/unit/mcp-local-startup.test.ts tests/integration/mcp-local-startup.test.ts docs/runbooks/mcp-local.md
git commit -m "feat(mcp): add deterministic local startup"
~~~
No push is part of this task sequence.

### Task 2: #81 — scoped OAuth and demo fixture seeder

**Files:**
- Create: scripts/prepare-mcp-local.ts
- Modify: scripts/prepare-mcp-production-smoke.ts, adding a non-destructive reuse mode and fixture-ID resolver
- Modify: package.json, adding mcp:local:seed and mcp:local:cleanup
- Modify: docs/runbooks/mcp-local.md
- Create: tests/unit/mcp-local-fixtures.test.ts
- Create: tests/integration/mcp-local-fixtures.test.ts

**Interfaces:**
- Consumes: the #80 env file and project, A4 exports createMcpSmokeSeedPlan, formatMcpSmokeEnvironmentFile, prepareMcpProductionSmoke, cleanupMcpProductionSmoke, resolveMcpSmokeFixtureIds, and the real Postgres MCP OAuth store.
- Produces: prepareMcpLocal(options: PrepareMcpLocalOptions): Promise<McpLocalFixtureResult>; cleanupMcpLocal(options: CleanupMcpLocalOptions): Promise<void>.
- PrepareMcpLocalOptions has databaseUrl: string, fixtureKey: string, envFilePath: string, readPrivateFile: (path: string) => Promise<string | null>, and writePrivateFile: (path: string, content: string) => Promise<void>.
- McpSmokePrepareOptions has mode: "create" | "reuse"; PrepareMcpLocalOptions may inject seed: (databaseUrl: string, outputPath: string, input: McpSmokeSeedPlanInput, options: McpSmokePrepareOptions) => Promise<McpSmokeSeedPlan> for unit tests, while production defaults to prepareMcpProductionSmoke.
- McpSmokeFixtureIds has proposal: { foreign: string; viewer: string }, aggregate: { foreign: string; viewer: string }, and revoked: { accessTokenId: string; familyId: string }.
- type McpLocalFixtureIds = McpSmokeFixtureIds is the exported alias used by later verifier tasks; every proposal, aggregate, access-token, and family ID is obtained through this resolver rather than guessed from request input.
- resolveMcpSmokeFixtureIds(fixtureKey: string): McpSmokeFixtureIds is the single deterministic resolver shared by the A4 seeder and local wrapper; it uses the same stable UUID algorithm as insertion and performs no database write.
- McpLocalPrivateCredentials has reviewerToken: string, operatorToken: string, viewerToken: string, revokedToken: string, and envFilePath: string. It is process-private and never part of redactedSummary.
- McpLocalIdentity has name: "reviewer" | "operator" | "viewer", workspaceId: string, role: "reviewer" | "operator" | "viewer", scopes: readonly string[], and clientId: string.
- McpLocalPrivateIdentity has kind: "identity", name: "reviewer" | "operator" | "viewer", workspaceId: string, role: "reviewer" | "operator" | "viewer", scopes: readonly string[], clientId: string, token: string, and revoked: false. McpLocalPrivateRevokedIdentity has kind: "revoked", name: "revoked", workspaceId: string, role: "viewer", scopes: readonly ["mcp:read"], clientId: string, token: string, accessTokenId: string, familyId: string, and revoked: true. McpLocalPrivateCredential is the union of those two private, in-process-only shapes.
- loadMcpLocalPrivateCredential(credentials: McpLocalPrivateCredentials, identities: readonly McpLocalIdentity[], fixtureIds: McpSmokeFixtureIds, name: "reviewer" | "operator" | "viewer" | "revoked"): McpLocalPrivateCredential resolves the requested bearer and identity metadata without logging, serializing, or returning it from a report. The revoked selection uses the viewer identity plus fixtureIds.revoked and is only accepted by sdkFactory/verifier calls that need to prove revocation.
- McpLocalFixtureResult has fixtureKey: string, workspaceIds: readonly [string, string], workspaceSlugs: readonly [string, string], identities: readonly [McpLocalIdentity, McpLocalIdentity, McpLocalIdentity], fixtureIds: McpSmokeFixtureIds, credentials: McpLocalPrivateCredentials, resource: string, envFilePath: string, and redactedSummary: string. Its public/report-facing projection contains only identity labels and fixture IDs, never credentials or database URLs.
- McpLocalFixtureDatabaseClient has deleteFixtureKey(fixtureKey: string): Promise<void> and close(): Promise<void>; it is the only database capability accepted by cleanupMcpLocal. createMcpLocalFixtureDatabaseClient(databaseUrl: string): McpLocalFixtureDatabaseClient validates a private, explicitly supplied URL and returns the bounded client; the URL is never logged or included in a report.
- McpLocalFixtureFingerprint has workspaces: number, users: number, memberships: number, clients: number, accessTokens: number, proposals: number, approvals: number, and workspaceIds: readonly string[]. readMcpLocalFixtureFingerprint(databaseUrl: string, fixtureKey: string): Promise<McpLocalFixtureFingerprint> reads only rows selected by the exact fixture slugs.
- CleanupMcpLocalOptions has databaseUrl: string, fixtureKey: string, envFilePath?: string, and required client: McpLocalFixtureDatabaseClient. The caller must explicitly create/resolve this client with createMcpLocalFixtureDatabaseClient(databaseUrl); cleanup never opens an implicit connection, accepts a missing client, or targets all workspaces.
- The credential file is private and 0600; redactedSummary contains no bearer, code, password, refresh token, or database URL.
- prepareMcpProductionSmoke accepts a fourth argument { mode: "create" | "reuse" }. In reuse mode, an existing complete fixture is verified against supplied token hashes and returned untouched; an absent fixture is inserted once; a partial fixture or hash mismatch fails closed. Reuse mode never removes rows, regenerates tokens, or silently replaces an existing key.

- [ ] **Step 1: Write the failing fixture and isolation tests**

~~~ts
import { describe, expect, test } from "bun:test";
import {
  prepareMcpLocal,
  cleanupMcpLocal,
  loadMcpLocalPrivateCredential,
} from "../../scripts/prepare-mcp-local";
import { resolveMcpSmokeFixtureIds } from "../../scripts/prepare-mcp-production-smoke";
import { createMcpSmokeSeedPlan } from "../../scripts/prepare-mcp-production-smoke";

const UUID_PATTERN = /^[0-9a-f-]{36}$/;

test("creates two workspace roles without exposing credentials", async () => {
  const writes: Array<{ path: string; content: string }> = [];
  const result = await prepareMcpLocal({
    databaseUrl: "postgres://private-test-database",
    fixtureKey: "local-plan-a",
    envFilePath: "/tmp/mcp-local-secrets.env",
    readPrivateFile: async () => null,
    writePrivateFile: async (path, content) => writes.push({ path, content }),
  });
  expect(result.workspaceIds).toHaveLength(2);
  expect(result.identities.map(({ role }) => role)).toEqual(["reviewer", "operator", "viewer"]);
  expect(result.redactedSummary).not.toContain("postgres://");
  expect(result.redactedSummary).not.toContain("Bearer");
  expect(writes[0]?.content).toContain("MCP_LOCAL_REVIEWER_TOKEN=");
});

test("cleanup is keyed by fixture and cannot target all workspaces", async () => {
  const deletedKeys: string[] = [];
  await cleanupMcpLocal({
    databaseUrl: "postgres://private-test-database",
    fixtureKey: "local-plan-a",
    client: {
      deleteFixtureKey: async (key: string) => deletedKeys.push(key),
      close: async () => undefined,
    },
  });
  expect(deletedKeys).toEqual(["local-plan-a"]);
});

test("resolves proposal, aggregate, and revoked IDs from the fixture key", async () => {
  const result = resolveMcpSmokeFixtureIds("local-plan-a");
  expect(result.proposal.foreign).toMatch(UUID_PATTERN);
  expect(result.proposal.viewer).toMatch(UUID_PATTERN);
  expect(result.aggregate.foreign).toMatch(UUID_PATTERN);
  expect(result.aggregate.viewer).toMatch(UUID_PATTERN);
  expect(result.revoked.accessTokenId).toMatch(UUID_PATTERN);
  expect(result.revoked.familyId).toMatch(UUID_PATTERN);
});

test("loads a revoked bearer only through the private credential contract", () => {
  const identities = [
    { name: "reviewer", workspaceId: "workspace-a", role: "reviewer", scopes: ["mcp:read", "mcp:write", "mcp:approve"], clientId: "client-a" },
    { name: "operator", workspaceId: "workspace-a", role: "operator", scopes: ["mcp:read", "mcp:write"], clientId: "client-b" },
    { name: "viewer", workspaceId: "workspace-b", role: "viewer", scopes: ["mcp:read"], clientId: "client-c" },
  ] as const;
  const fixtureIds = resolveMcpSmokeFixtureIds("local-plan-a");
  const revoked = loadMcpLocalPrivateCredential({
    reviewerToken: "reviewer-token",
    operatorToken: "operator-token",
    viewerToken: "viewer-token",
    revokedToken: "revoked-token",
    envFilePath: "/tmp/private.env",
  }, identities, fixtureIds, "revoked");
  expect(revoked.kind).toBe("revoked");
  expect(revoked.revoked).toBe(true);
  expect(revoked.token).toBeDefined();
});

test("same-key prepare selects reuse and never silently replaces credentials", async () => {
  const files = new Map<string, string>();
  const seedModes: string[] = [];
  const fixedTokens = {
    reviewer: "reviewer-fixed-token",
    operator: "operator-fixed-token",
    viewer: "viewer-fixed-token",
    revoked: "revoked-fixed-token",
  };
  const prepare = (write: (path: string, content: string) => Promise<void>) =>
    prepareMcpLocal({
      databaseUrl: "postgres://private-test-database",
      fixtureKey: "local-plan-same-key",
      envFilePath: "/tmp/mcp-local-same-key.env",
      readPrivateFile: async (path) => files.get(path) ?? null,
      writePrivateFile: write,
      seed: async (_databaseUrl, _outputPath, input, options) => {
        seedModes.push(options.mode);
        return createMcpSmokeSeedPlan({ ...input, tokens: fixedTokens });
      },
    });
  const first = await prepare(async (path, content) => files.set(path, content));
  const second = await prepare(async () => {
    throw new Error("reuse must not rewrite the credential file");
  });
  expect(second.fixtureIds).toEqual(first.fixtureIds);
  expect(second.credentials).toEqual(first.credentials);
  expect(seedModes).toEqual(["create", "reuse"]);
  expect(files.size).toBe(1);
});
~~~

- [ ] **Step 2: Run the focused tests and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-fixtures.test.ts
~~~
Expected: FAIL because prepare-mcp-local.ts and its typed wrapper are absent. No
database is touched in this RED step.

- [ ] **Step 3: Implement the scoped wrapper and private-file flow**

Wrap the A4 seed-plan functions instead of duplicating proposal, approval, OAuth,
or cleanup SQL. Validate fixtureKey against a bounded alphanumeric pattern and
reject an existing key belonging to another project. Call the existing seeder
with a local hostname/resource and two workspace identities: reviewer with
mcp:read mcp:write mcp:approve, operator with mcp:read mcp:write, and viewer
with mcp:read. Keep OAuth token hashes in PostgreSQL and return opaque token
values only in the private environment file.

Create the host output under umask 077 and chmod 0600. For a container seeder,
create the destination before docker cp and extract a tar stream from the
private container path; do not bind mount a secret output directory. The
wrapper's stdout is a fixed redacted status line with fixture key, workspace
labels, resource, and file path only. FK-safe cleanup first detaches proposal
references, then deletes traces/outbox/reconciliation/intention/approval/
proposal/job rows and OAuth/workspace fixture rows carrying the exact key.
The CLI explicitly resolves createMcpLocalFixtureDatabaseClient(databaseUrl),
passes that client to cleanupMcpLocal, and closes it in a finally block; test
fakes implement both deleteFixtureKey and close. No cleanup path may infer a
client from ambient state or silently omit the required client.

- [ ] **Step 4: Run unit, database, and secret-safety gates**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-fixtures.test.ts
TEST_DATABASE_URL=postgres://dedicated-local-test npx --yes bun@1.3.4 test tests/integration/mcp-local-fixtures.test.ts
npx --yes bun@1.3.4 run check:types
~~~
Expected: role/scope and redaction tests pass; dedicated integration proves two
workspaces, same-key idempotence, fresh-store OAuth acceptance, revoke/demotion,
and old fixture isolation. If TEST_DATABASE_URL is absent, integration reports a
clear prerequisite result without deleting or resetting any database.

The integration fixture uses only a dedicated TEST_DATABASE_URL and performs a
real same-key round trip:
~~~ts
import { createMcpLocalFixtureDatabaseClient } from "../../scripts/prepare-mcp-local";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const fixtureKey = "local-plan-same-key";
const envFilePath = "/tmp/mcp-local-same-key.env";
const readPrivateFile = async (path: string) => Bun.file(path).exists() ? Bun.file(path).text() : null;
const writePrivateFile = async (path: string, content: string) => Bun.write(path, content);
const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
try {
  const first = await prepareMcpLocal({ databaseUrl, fixtureKey, envFilePath, readPrivateFile, writePrivateFile });
  const before = await readMcpLocalFixtureFingerprint(databaseUrl, fixtureKey);
  const second = await prepareMcpLocal({ databaseUrl, fixtureKey, envFilePath, readPrivateFile, writePrivateFile: async () => { throw new Error("reuse rewrote credentials"); } });
  const after = await readMcpLocalFixtureFingerprint(databaseUrl, fixtureKey);
  expect(second.fixtureIds).toEqual(first.fixtureIds);
  expect(second.credentials).toEqual(first.credentials);
  expect(after).toEqual(before);
} finally {
  try {
    await cleanupMcpLocal({ databaseUrl, fixtureKey, envFilePath, client });
  } finally {
    await client.close();
  }
}
~~~
The first call creates the rows and credentials. The second reads the existing
0600 file, verifies token hashes, and returns the same IDs without deleting,
inserting, or regenerating anything. The fingerprint covers every workspace,
user, membership, client, token, proposal, and approval row. A failed write is
reported as explicit cleanup-required state, never used to mint replacement
tokens.

- [ ] **Step 5: Review and commit the self-contained #81 slice**

After review:
~~~sh
git diff --check
git add scripts/prepare-mcp-local.ts package.json docs/runbooks/mcp-local.md tests/unit/mcp-local-fixtures.test.ts tests/integration/mcp-local-fixtures.test.ts
git commit -m "feat(mcp): seed local OAuth fixtures"
~~~

### Task 3: #82 — local-only governed-effect fakes

**Files:**
- Create: packages/infrastructure/src/mcp/local-governed-effect-fakes.ts
- Modify: packages/bootstrap/src/create-noosphere-api-runtime.ts
- Modify: apps/worker/src/index.ts
- Create: tests/unit/mcp-local-governed-effect-fakes.test.ts
- Create: tests/integration/mcp-local-governed-effects.test.ts

**Interfaces:**
- Consumes: the existing SocialPublisher, OutboundChannelGateway, CalendarIntegration,
  ExternalEffectAttemptPort, PostgresMcpGovernedEffectWorker, and final policy
  contracts; #81 fixture IDs and the local-mode environment.
- LocalFakeKind is "conversation_reply" | "content_publication" | "meeting_proposal" | "campaign_activation".
- LocalFakeOutcome has kind: "success" | "failure" | "ambiguous", safeCode: string, and providerReference?: string.
- LocalFakeOptions has mode: "local-fake", allowNetwork: false, outcomes: Readonly<{ [K in LocalFakeKind]: LocalFakeOutcome }>, and counters: LocalFakeCounters.
- LocalFakeCounters has conversationReply: number, contentPublication: number, meetingProposal: number, and campaignActivation: number.
- LocalFakeAdapters has adapters: McpGovernedEffectProviderAdapters, counters: Readonly<LocalFakeCounters>, and outcomeFor(kind: LocalFakeKind): LocalFakeOutcome. adapters.outbound, adapters.publisher, adapters.socialContentReader, and adapters.calendar implement the existing application ports and reject every network operation; the campaign adapter is absent.
- Produces: createLocalGovernedEffectFakes(options: LocalFakeOptions): LocalFakeAdapters; getLocalFakeCounters(): Readonly<LocalFakeCounters>.
- No fake method accepts a bearer, secret, raw provider payload, or arbitrary URL.

- [ ] **Step 1: Write failing adapter and production-isolation tests**

~~~ts
import { expect, test } from "bun:test";
import {
  createLocalGovernedEffectFakes,
  getLocalFakeCounters,
} from "../../packages/infrastructure/src/mcp/local-governed-effect-fakes";

test("returns deterministic bounded outcomes and never permits network", async () => {
  const fakes = createLocalGovernedEffectFakes({
    mode: "local-fake",
    allowNetwork: false,
    outcomes: {
      conversation_reply: { kind: "success", safeCode: "FAKE_ACCEPTED" },
      content_publication: { kind: "failure", safeCode: "FAKE_REJECTED" },
      meeting_proposal: { kind: "ambiguous", safeCode: "FAKE_AMBIGUOUS" },
      campaign_activation: { kind: "failure", safeCode: "ADAPTER_UNAVAILABLE" },
    },
    counters: { conversationReply: 0, contentPublication: 0, meetingProposal: 0, campaignActivation: 0 },
  });
  expect(fakes.outcomeFor("conversation_reply")).toEqual({ kind: "success", safeCode: "FAKE_ACCEPTED" });
  expect(fakes.outcomeFor("campaign_activation")).toEqual({ kind: "failure", safeCode: "ADAPTER_UNAVAILABLE" });
  expect(fakes.adapters.outbound).toBeDefined();
  expect(getLocalFakeCounters().campaignActivation).toBe(0);
});
~~~

- [ ] **Step 2: Run the focused tests and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-governed-effect-fakes.test.ts
~~~
Expected: FAIL because the local fake module and local-only composition are not
present.

- [ ] **Step 3: Implement explicit provider-free composition**

Implement local fakes as adapters of the existing executor ports. Their input
contains only bounded internal IDs and the already-authorized aggregate
snapshot. They return the configured bounded outcome, increment a process-local
counter, and do not import provider SDKs or open sockets. Keep
campaign_activation unavailable.

In create-noosphere-api-runtime, select the fake adapters only when the runtime
is explicitly local and production mode is false; reject a production process
that sets the local fake option. In apps/worker/src/index.ts, inject these
adapters into the existing executor path without adding a second queue or
bypassing the final gate. Record-before-provider, policy, lease, outcome,
acknowledgement, and read-only reconciliation stay in existing repositories.
Do not add a fake provider to application/interface packages.

- [ ] **Step 4: Run fake, architecture, and integration gates**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-governed-effect-fakes.test.ts
npx --yes bun@1.3.4 run check:architecture
npx --yes bun@1.3.4 run check:types
TEST_DATABASE_URL=postgres://dedicated-local-test npx --yes bun@1.3.4 test tests/integration/mcp-local-governed-effects.test.ts
~~~
Expected: local success/failure/ambiguous paths prove marker before callback,
zero resend after unknown, authoritative reconciliation before delivered,
policy suppression/opt-out/human-reply/revision/pause/cancel with zero fake
calls, and contact-null not treated as deletion. Production composition has no
fake import. Integration uses one worker and no external endpoint.

- [ ] **Step 5: Review and commit the self-contained #82 slice**

After review:
~~~sh
git diff --check
git add packages/infrastructure/src/mcp/local-governed-effect-fakes.ts packages/bootstrap/src/create-noosphere-api-runtime.ts apps/worker/src/index.ts tests/unit/mcp-local-governed-effect-fakes.test.ts tests/integration/mcp-local-governed-effects.test.ts
git commit -m "test(mcp): add local governed effect fakes"
~~~

### Task 4: #83 — ready-to-copy client and Inspector configuration

**Files:**
- Create: scripts/write-mcp-local-client-config.ts
- Modify: scripts/smoke-mcp-production.ts
- Modify: docs/runbooks/mcp-local.md
- Create: tests/unit/mcp-local-client-config.test.ts

**Interfaces:**
- Consumes: #80 resource/CA, #81 fixture result, smoke runner's bounded identity
  parser, official SDK 2.0.0, and verified Inspector CLI behavior.
- Produces: writeMcpLocalClientConfig(options: WriteMcpLocalClientConfigOptions): Promise<McpLocalClientConfig>; buildMcpLocalInspectorCommand(options: InspectorCommandOptions): string[].
- WriteMcpLocalClientConfigOptions has outputPath: string, resource: string, caPath: string, tokenFilePath: string, and identities: ReadonlyArray<McpLocalIdentityLabel>.
- McpLocalClientConfig has resource: string, transport: "streamable-http", legacyTransport: "http", caPath: string, tokenFilePath: string, identities: ReadonlyArray<McpLocalIdentityLabel>, and redacted: true.
- McpLocalIdentityLabel has name: string, workspaceId: string, role: "reviewer" | "operator" | "viewer", and scopes: readonly ("mcp:read" | "mcp:write" | "mcp:approve")[]; it has no token property.
- InspectorCommandOptions has forwarderUrl: string and method: "tools/list"; the command must not contain an Authorization header or bearer value.

- [ ] **Step 1: Write the failing config and command tests**

~~~ts
import { expect, test } from "bun:test";
import {
  buildMcpLocalInspectorCommand,
  writeMcpLocalClientConfig,
} from "../../scripts/write-mcp-local-client-config";

test("writes a config that references private credentials without embedding them", async () => {
  await writeMcpLocalClientConfig({
    outputPath: "/tmp/mcp-local-client.json",
    resource: "https://mcp.localhost:18443/mcp",
    caPath: "/tmp/mcp-local-root.crt",
    tokenFilePath: "/tmp/mcp-local-secrets.env",
    identities: [{
      name: "reviewer-a",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    }],
  });
  const output = await Bun.file("/tmp/mcp-local-client.json").text();
  expect(output).toContain("tokenFilePath");
  expect(output).not.toContain("Authorization");
  expect(output).not.toContain("Bearer");
});

test("uses the verified Inspector 0.16.3 CLI shape", () => {
  expect(buildMcpLocalInspectorCommand({
    forwarderUrl: "http://127.0.0.1:19090/mcp",
    method: "tools/list",
  })).toEqual([
    "npx", "--yes", "@modelcontextprotocol/inspector@0.16.3", "--cli",
    "http://127.0.0.1:19090/mcp", "--transport", "http", "--method", "tools/list",
  ]);
});
~~~

- [ ] **Step 2: Run the focused tests and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-client-config.test.ts
~~~
Expected: FAIL because the config writer and Inspector command builder do not
yet exist.

- [ ] **Step 3: Implement private config generation and bounded forwarding**

Write a JSON config under umask 077, chmod 0600, and atomically rename it.
Store the canonical HTTPS /mcp resource, Caddy CA path, private token-file
reference, modern and legacy transport names, and bounded workspace/role/scope
labels. Reject credentials, query/fragment, non-HTTPS resources, invalid UUIDs,
unknown roles, or unbounded identity lists.

Preserve scripts/smoke-mcp-production.ts redaction, body/response bounds, and
audience checks while allowing it to read this config. Keep tokens in the
runner environment/private file. Inspector 0.16.3 is invoked against a
loopback forwarder because its CLI has no supported header option. The forwarder
adds Authorization in memory and strips it from diagnostics. The fixed
command shape is npx --yes @modelcontextprotocol/inspector@0.16.3 --cli
http://127.0.0.1:19090/mcp --transport http --method tools/list.

- [ ] **Step 4: Run client-config, protocol, and architecture gates**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-client-config.test.ts
npx --yes bun@1.3.4 test tests/unit/mcp-transport.test.ts
npx --yes bun@1.3.4 run check:types
npx --yes bun@1.3.4 run check:architecture
~~~
Expected: generated config contains no token, Inspector argv contains no
authorization value, and existing modern/legacy MCP, correlation, redaction,
audience, and bounds tests remain green.

- [ ] **Step 5: Review and commit the self-contained #83 slice**

After review:
~~~sh
git diff --check
git add scripts/write-mcp-local-client-config.ts scripts/smoke-mcp-production.ts docs/runbooks/mcp-local.md tests/unit/mcp-local-client-config.test.ts
git commit -m "docs(mcp): publish local client configuration"
~~~

### Task 5: #84 — bounded local functional verification

**Files:**
- Create: scripts/verify-mcp-local.ts
- Modify: package.json, adding mcp:local:verify
- Modify: docs/runbooks/mcp-local.md
- Create: tests/unit/mcp-local-verification.test.ts
- Create: tests/integration/mcp-local-verification.test.ts

**Interfaces:**
- Consumes: #80 readiness, #81 McpLocalFixtureResult, #82 local fake counters,
  #83 client config, official SDK Client/StreamableHTTPClientTransport, and
  existing MCP tool/resource contracts.
- Produces: verifyMcpLocal(options: VerifyMcpLocalOptions): Promise<McpLocalVerificationReport>.
- McpLocalSdkIdentity extends McpLocalIdentityLabel with token: string; this
  value exists only in the verifier process and is never accepted by report
  or logging functions.
- McpLocalConnection has endpoint: string, resource: string, caPath: string,
  and timeoutMs: number.
- McpLocalContentItem has type: "text" | "image" | "resource", text?: string, mimeType?: string, and data?: string.
- McpLocalToolResult has isError: boolean, content: readonly McpLocalContentItem[], and structuredContent?: Readonly<Record<string, unknown>>.
- McpLocalSdkClient has initialize(): Promise<void>, listTools(): Promise<{ tools: readonly { name: string }[] }>, listResources(): Promise<{ resources: readonly { uri: string; name?: string }[] }>, readResource(uri: string): Promise<{ contents: readonly { uri: string; text?: string; mimeType?: string }[] }>, ping(): Promise<Readonly<Record<string, unknown>>>, callTool(name: string, args: Readonly<Record<string, string | number | boolean | null>>): Promise<McpLocalToolResult>, and close(): Promise<void>. Each method is bounded by the verifier deadline.
- McpLocalSdkFactory is (identity: McpLocalSdkIdentity, connection: McpLocalConnection) => Promise<McpLocalSdkClient>.
- McpLocalFixtureIdName is "foreignProposal" | "viewerProposal" | "foreignAggregate" | "viewerAggregate" | "revokedAccessToken".
- VerifyMcpLocalOptions has configPath: string, timeoutMs: number, maxCalls: number, fixtureIds: McpSmokeFixtureIds, resolveFixtureId: (name: McpLocalFixtureIdName) => string, readDurableStateForProposal: (proposalId: string, workspaceId: string) => Promise<McpLocalDurableState>, sdkFactory: McpLocalSdkFactory, and a mandatory edge-probe callback.
- McpLocalDurableState has intentions: number, jobs: number, outbox: number, attempts: number, terminalResults: number, providerBoundaryAttempts: number, and bounded refs containing the scoped proposal, intention, job, outbox, trace, attempt-trace, result-trace, reconciliation, and terminal-status identifiers. `providerBoundaryAttempts` counts durable attempt markers crossing the provider boundary; it is not a measurement of calls made to an external provider.
- McpLocalVerificationReport has correlationId: string, protocol: { modern: boolean; legacy: boolean },
  toolChecks: ReadonlyArray<{ name: string; outcome: "pass" | "fail"; code: string }>,
  durableChecks: ReadonlyArray<{ name: string; outcome: "pass" | "fail"; code: string }>,
  providerBoundaryAttempts: number, fixtureIds: Readonly<Pick<McpSmokeFixtureIds, "proposal" | "aggregate">>, and redacted: true. `providerBoundaryAttempts` is the bounded durable marker count, never an external-provider call counter.
- The report contains no bearer, OAuth code, database URL, secret, raw error, or provider payload.

- [ ] **Step 1: Write failing functional and report-safety tests**

~~~ts
import { expect, test } from "bun:test";
import { verifyMcpLocal } from "../../scripts/verify-mcp-local";

const fixtureIds = {
  proposal: { foreign: "00000000-0000-4000-8000-000000000001", viewer: "00000000-0000-4000-8000-000000000002" },
  aggregate: { foreign: "00000000-0000-4000-8000-000000000003", viewer: "00000000-0000-4000-8000-000000000004" },
  revoked: { accessTokenId: "00000000-0000-4000-8000-000000000005", familyId: "00000000-0000-4000-8000-000000000006" },
} as const;
const baseOptions = {
  fixtureIds,
  resolveFixtureId: (name: McpLocalFixtureIdName) => ({
    foreignProposal: fixtureIds.proposal.foreign,
    viewerProposal: fixtureIds.proposal.viewer,
    foreignAggregate: fixtureIds.aggregate.foreign,
    viewerAggregate: fixtureIds.aggregate.viewer,
    revokedAccessToken: fixtureIds.revoked.accessTokenId,
  }[name]),
  readDurableStateForProposal: async (_proposalId: string, _workspaceId: string) => ({ intentions: 0, jobs: 0, outbox: 0, attempts: 0, terminalResults: 0, providerBoundaryAttempts: 0, refs: { proposalIds: [], intentionIds: [], jobIds: [], outboxIds: [], traceIds: [], attemptTraceIds: [], resultTraceIds: [], reconciliationIds: [], terminalStatuses: [] } }),
  sdkFactory: async (_identity: McpLocalSdkIdentity, _connection: McpLocalConnection) => ({
    initialize: async () => undefined,
    listTools: async () => ({ tools: [] }),
    listResources: async () => ({ resources: [] }),
    readResource: async (_uri: string) => ({ contents: [] }),
    ping: async () => ({}),
    callTool: async (_name: string, _args: Readonly<Record<string, string | number | boolean | null>>) => ({ isError: false, content: [] }),
    close: async () => undefined,
  }),
};

test("reports protocol, tenant, approval, replay, and fake-effect checks", async () => {
  const report = await verifyMcpLocal({
    ...baseOptions,
    configPath: "/tmp/mcp-local-client.json",
    timeoutMs: 30000,
    maxCalls: 32,
  });
  expect(report.protocol.modern).toBe(true);
  expect(report.providerBoundaryAttempts).toBe(0);
  expect(report.redacted).toBe(true);
});

test("never includes secret-like values in a failure report", async () => {
  const report = await verifyMcpLocal({
    ...baseOptions,
    configPath: "/tmp/mcp-local-client.json",
    timeoutMs: 1000,
    maxCalls: 4,
    sdkFactory: async (_identity: McpLocalSdkIdentity, _connection: McpLocalConnection) => {
      throw new Error("Bearer hidden-token database=postgres://secret");
    },
  }).catch((error) => error.report as { redacted: boolean; message?: string });
  expect(report.redacted).toBe(true);
  expect(report.message).toBeUndefined();
});
~~~

- [ ] **Step 2: Run the focused tests and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-verification.test.ts
~~~
Expected: FAIL because verify-mcp-local.ts and its bounded report contract do not
yet exist.

- [ ] **Step 3: Implement the bounded official-SDK verifier**

Load the generated config without printing token values. Construct fresh modern
and legacy official SDK clients, then execute initialize, tools/list,
resources/list, resources/read, and noosphere_ping. Use the operator for the
conversation and content safe writes and identical replays. Use the reviewer
only for approval decisions, and assert that a reviewer prepare attempt is
rejected with MCP_GOVERNED_EFFECT_FORBIDDEN. Use operator and viewer clients
for the remaining write/tenant guards and one local fake effect. Assert a
foreign workspace/proposal lookup is a safe not-found/forbidden response, viewer
projection is redacted, revoked membership is rejected, malformed JSON-RPC and
oversized body/response are rejected, correlation IDs are returned, and rate
limits produce 429 plus Retry-After.

Bound every call and cap maxCalls. Keep one worker configured by #80. Compare
database counts and identifiers before and after the replay: exactly one
intention, job, outbox, attempt, and terminal result for the accepted effect.
Record fake counter deltas and require zero for policy denial/stale facts and
campaign_activation. On ambiguous fake outcome require unknown/reconciling and
never retry the original mutation.

- [ ] **Step 4: Run focused integration and full unit gates sequentially**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/unit/mcp-local-verification.test.ts tests/unit/mcp-transport.test.ts
TEST_DATABASE_URL=postgres://dedicated-local-test npx --yes bun@1.3.4 test tests/integration/mcp-local-verification.test.ts
npx --yes bun@1.3.4 run check:types
npx --yes bun@1.3.4 run check:architecture
~~~
Expected: protocol, scope, tenant, redaction, replay, and durable-state tests
pass; integration uses only the local fake and records providerBoundaryAttempts=0
(durable marker count, not an external-provider metric). Run the
full unit suite only after the targeted integration process exits:
~~~sh
npx --yes bun@1.3.4 test tests/unit
~~~

- [ ] **Step 5: Review and commit the self-contained #84 slice**

After review:
~~~sh
git diff --check
git add scripts/verify-mcp-local.ts package.json docs/runbooks/mcp-local.md tests/unit/mcp-local-verification.test.ts tests/integration/mcp-local-verification.test.ts
git commit -m "test(mcp): verify local MCP journey"
~~~

### Task 6: #85 — clean-checkout quickstart validation

**Files:**
- Create: scripts/validate-mcp-local-quickstart.ts
- Modify: package.json, adding mcp:local:validate
- Create: tests/integration/mcp-local-quickstart.test.ts
- Create: docs/validation/2026-08-31-local-mcp-quickstart.md
- Modify: docs/runbooks/mcp-local.md only for corrections discovered by validation

**Interfaces:**
- Consumes: #80 through #84 commands, Compose project, dedicated fixture key,
  local client config, redacted verifier report, and a fresh checkout/worktree.
- Produces: validateMcpLocalQuickstart(options: ValidateMcpLocalQuickstartOptions): Promise<McpLocalQuickstartReport>.
- McpLocalDisposableTarget is a private input with databaseUrl: string, adminDatabaseUrl: string, databaseName: string, testDatabaseName: string, e2eDatabaseName: string, composeProjectName: string, databaseVolumeName: string, and fixtureKey: string. It is never serialised into a report.
- McpLocalRedactedTarget has fixtureKey: string, databaseName: string, testDatabaseName: string, e2eDatabaseName: string, composeProjectName: string, databaseVolumeName: string, and redacted: true; redactMcpLocalDisposableTarget(target: McpLocalDisposableTarget): McpLocalRedactedTarget is the only target projection accepted by reporting.
- McpLocalDisposableNames has databaseName: string, testDatabaseName: string, e2eDatabaseName: string, composeProjectName: string, databaseVolumeName: string, and fixtureKey: string. expectedMcpLocalDisposableNames(fixtureKey: string): McpLocalDisposableNames derives databaseName "noosphere_mcp_local_" + fixtureKey, testDatabaseName databaseName + "_test", e2eDatabaseName databaseName + "_e2e", composeProjectName "noosphere-mcp-quickstart-" + fixtureKey, and databaseVolumeName composeProjectName + "_paradedb-data". expectedMcpLocalDisposableTarget(fixtureKey: string, databaseUrl: string, adminDatabaseUrl: string): McpLocalDisposableTarget combines those names with the private URLs after validating their PostgreSQL hosts/pathnames; URLs are never returned by the public report projection.
- McpLocalDatabaseState has databaseNames: readonly string[]; readMcpLocalDatabaseState(adminDatabaseUrl: string): Promise<McpLocalDatabaseState> performs only a read-only catalog query. McpLocalWrapperEnvironment has TEST_DATABASE_URL?: string, E2E_DATABASE_URL?: string, and no DATABASE_URL property. ValidateMcpLocalQuickstartOptions has checkoutPath: string, envFilePath: string, fixtureKey: string, target: McpLocalDisposableTarget, clock: () => number, readDockerState: () => Promise<{ projectNames: readonly string[]; volumeNames: readonly string[] }>, readDatabaseState: (adminDatabaseUrl: string) => Promise<McpLocalDatabaseState>, and runWrapper: (name: string, env: McpLocalWrapperEnvironment) => Promise<void>. The validator invokes runWrapper only after both read-only preflights pass; integration receives only TEST_DATABASE_URL and e2e receives only E2E_DATABASE_URL.
- McpLocalQuickstartStep has name: "prerequisites" | "startup" | "seed" | "client" | "verify" | "restart" | "cleanup", outcome: "pass" | "fail", durationMs: number, and code: string.
- McpLocalQuickstartReport has host: { os: string; arch: string; bun: string; compose: string }, target: McpLocalRedactedTarget, steps: readonly McpLocalQuickstartStep[], preservedResources: boolean, providerCalls: number, and redacted: true. It cannot contain databaseUrl or adminDatabaseUrl, even indirectly.
- The validator never receives a bearer value and never runs destructive Docker or database commands.
- The validator accepts only a newly named disposable target: databaseName, testDatabaseName, e2eDatabaseName, composeProjectName, and databaseVolumeName must equal expectedMcpLocalDisposableNames(fixtureKey), readDockerState must show none of those names, and readDatabaseState(adminDatabaseUrl) must show none of the target/test/e2e database names before startup. Both preflights are read-only and run before any wrapper. It rejects production, shared development, QA, or an existing project/volume/database before invoking any wrapper.
- target.databaseUrl must parse as a PostgreSQL URL whose database pathname is target.databaseName and whose host is the private Compose database service or loopback; external, shared, production, QA, or unscoped hosts are rejected before any wrapper runs.

- [ ] **Step 1: Write the failing clean-checkout and preservation tests**

~~~ts
import { expect, test } from "bun:test";
import { validateMcpLocalQuickstart } from "../../scripts/validate-mcp-local-quickstart";

test("requires a fresh checkout and records bounded redacted steps", async () => {
  const wrapperCalls: Array<{ name: string; env: McpLocalWrapperEnvironment }> = [];
  const report = await validateMcpLocalQuickstart({
    checkoutPath: "/tmp/noosphere-clean-checkout",
    envFilePath: "/tmp/mcp-local-secrets.env",
    fixtureKey: "quickstart-a",
    target: {
      adminDatabaseUrl: "postgres://database/postgres",
      databaseUrl: "postgres://database/noosphere_mcp_local_quickstart-a",
      databaseName: "noosphere_mcp_local_quickstart-a",
      testDatabaseName: "noosphere_mcp_local_quickstart-a_test",
      e2eDatabaseName: "noosphere_mcp_local_quickstart-a_e2e",
      composeProjectName: "noosphere-mcp-quickstart-quickstart-a",
      databaseVolumeName: "noosphere-mcp-quickstart-quickstart-a_paradedb-data",
      fixtureKey: "quickstart-a",
    },
    clock: () => 1725000000000,
    readDockerState: async () => ({ projectNames: [], volumeNames: [] }),
    readDatabaseState: async () => ({ databaseNames: ["postgres"] }),
    runWrapper: async (name, env) => wrapperCalls.push({ name, env }),
  });
  expect(report.redacted).toBe(true);
  expect(report.target.redacted).toBe(true);
  expect(JSON.stringify(report)).not.toContain("postgres://");
  expect(report.providerCalls).toBe(0);
  expect(report.steps.map((step) => step.name)).toEqual([
    "prerequisites", "startup", "seed", "client", "verify", "restart", "cleanup",
  ]);
  expect(report.preservedResources).toBe(true);
  const integration = wrapperCalls.find(({ name }) => name === "integration");
  const e2e = wrapperCalls.find(({ name }) => name === "e2e");
  expect(integration).toBeDefined();
  expect(e2e).toBeDefined();
  expect(integration?.env.TEST_DATABASE_URL).toBe("postgres://database/noosphere_mcp_local_quickstart-a_test");
  expect(integration?.env.E2E_DATABASE_URL).toBeUndefined();
  expect(e2e?.env.E2E_DATABASE_URL).toBe("postgres://database/noosphere_mcp_local_quickstart-a_e2e");
  expect(e2e?.env.TEST_DATABASE_URL).toBeUndefined();
  expect(integration?.env.DATABASE_URL).toBeUndefined();
  expect(e2e?.env.DATABASE_URL).toBeUndefined();
});

test("rejects shared QA or existing Docker targets before any wrapper runs", async () => {
  await expect(validateMcpLocalQuickstart({
    checkoutPath: "/tmp/noosphere-clean-checkout",
    envFilePath: "/tmp/mcp-local-secrets.env",
    fixtureKey: "quickstart-a",
    target: {
      adminDatabaseUrl: "postgres://qa/postgres",
      databaseUrl: "postgres://qa/ignition_outbound",
      databaseName: "ignition_outbound",
      testDatabaseName: "ignition_outbound_test",
      e2eDatabaseName: "ignition_outbound_e2e",
      composeProjectName: "qa",
      databaseVolumeName: "paradedb-data",
      fixtureKey: "quickstart-a",
    },
    clock: () => 1725000000000,
    readDockerState: async () => ({ projectNames: ["qa"], volumeNames: ["paradedb-data"] }),
    readDatabaseState: async () => ({ databaseNames: ["ignition_outbound_test"] }),
    runWrapper: async () => undefined,
  })).rejects.toMatchObject({ code: "MCP_LOCAL_TARGET_NOT_DISPOSABLE" });
});

test("rejects an existing target or derived test database before wrappers", async () => {
  let wrapperCalls = 0;
  await expect(validateMcpLocalQuickstart({
    checkoutPath: "/tmp/noosphere-clean-checkout",
    envFilePath: "/tmp/mcp-local-secrets.env",
    fixtureKey: "quickstart-b",
    target: {
      adminDatabaseUrl: "postgres://database/postgres",
      databaseUrl: "postgres://database/noosphere_mcp_local_quickstart-b",
      databaseName: "noosphere_mcp_local_quickstart-b",
      testDatabaseName: "noosphere_mcp_local_quickstart-b_test",
      e2eDatabaseName: "noosphere_mcp_local_quickstart-b_e2e",
      composeProjectName: "noosphere-mcp-quickstart-quickstart-b",
      databaseVolumeName: "noosphere-mcp-quickstart-quickstart-b_paradedb-data",
      fixtureKey: "quickstart-b",
    },
    clock: () => 1725000000000,
    readDockerState: async () => ({ projectNames: [], volumeNames: [] }),
    readDatabaseState: async () => ({ databaseNames: ["noosphere_mcp_local_quickstart-b_test"] }),
    runWrapper: async () => { wrapperCalls += 1; },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_TARGET_NOT_DISPOSABLE" });
  expect(wrapperCalls).toBe(0);
});
~~~

- [ ] **Step 2: Run the focused test and observe RED**

Run:
~~~sh
npx --yes bun@1.3.4 test tests/integration/mcp-local-quickstart.test.ts
~~~
Expected: FAIL because the validator and dated report do not yet exist. Do not
clone a repository or start Docker in this RED step.

- [ ] **Step 3: Implement sequential clean-checkout validation and report**

Require these env-scoped disposable names before invoking any wrapper:
~~~sh
export MCP_LOCAL_FIXTURE_KEY=quickstart-a
export MCP_LOCAL_ADMIN_DATABASE_URL=postgres://database/postgres
export MCP_LOCAL_TARGET_DATABASE_NAME=noosphere_mcp_local_quickstart-a
export MCP_LOCAL_TARGET_DATABASE_URL=postgres://database/noosphere_mcp_local_quickstart-a
export MCP_LOCAL_TEST_DATABASE_NAME=noosphere_mcp_local_quickstart-a_test
export MCP_LOCAL_TEST_DATABASE_URL=postgres://database/noosphere_mcp_local_quickstart-a_test
export MCP_LOCAL_E2E_DATABASE_NAME=noosphere_mcp_local_quickstart-a_e2e
export MCP_LOCAL_E2E_DATABASE_URL=postgres://database/noosphere_mcp_local_quickstart-a_e2e
export MCP_LOCAL_COMPOSE_PROJECT=noosphere-mcp-quickstart-quickstart-a
export MCP_LOCAL_TEST_DATABASE_VOLUME=noosphere-mcp-quickstart-quickstart-a_paradedb-data
npx --yes bun@1.3.4 run mcp:local:validate
~~~
The validator derives the expected names from MCP_LOCAL_FIXTURE_KEY, reads
Docker project/volume names without mutation, then connects with the private
MCP_LOCAL_ADMIN_DATABASE_URL only for a read-only catalog preflight. It refuses
if the target, test, or e2e database already exists, if any expected Docker
name already exists, or if a name is shared/production/QA. Only after both
preflights pass does it invoke wrappers. It passes the explicitly derived
MCP_LOCAL_TEST_DATABASE_URL/MCP_LOCAL_TEST_DATABASE_NAME and
MCP_LOCAL_E2E_DATABASE_URL/MCP_LOCAL_E2E_DATABASE_NAME to the integration and
e2e wrappers respectively. No generic DATABASE_URL, production env file,
shared QA database, or existing volume is accepted.

Run the #80 through #84 commands in one isolated checkout with one worker and
one newly named fixture key. Record exact tool versions, service/image
identifiers, bounded durations, stable failure codes, and only redacted command summaries.
The command order is:
~~~sh
npx --yes bun@1.3.4 run mcp:local:start
npx --yes bun@1.3.4 run mcp:local:seed
npx --yes bun@1.3.4 run mcp:local:verify
docker compose --env-file .env.mcp-local -p noosphere-mcp-quickstart-quickstart-a -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-local.yml restart api worker
npx --yes bun@1.3.4 run mcp:local:verify
npx --yes bun@1.3.4 run mcp:local:cleanup
~~~
The validator's integration/e2e wrappers receive these exact environment
assignments after the preflight (and never inherit an ambient database URL):
~~~sh
env -u DATABASE_URL TEST_DATABASE_URL="$MCP_LOCAL_TEST_DATABASE_URL" npx --yes bun@1.3.4 run test:integration
env -u DATABASE_URL E2E_DATABASE_URL="$MCP_LOCAL_E2E_DATABASE_URL" npx --yes bun@1.3.4 run test:e2e
~~~
Require startup, seed, modern/legacy client, protocol, safe write/replay,
reviewer decision, fake effect, policy negatives, restart, and cleanup to pass.
Capture a before/after list of unrelated Docker volumes and a before/after
marker for unrelated database rows through read-only queries. Cleanup only the
exact fixture key, then stop containers in the exact project without removing
the newly named database volume and without touching any pre-existing project,
database, or volume. The validator does not call a database drop/reset helper.

When a prerequisite is missing, stop with a categorized result and remediation
command. Never turn a skipped live step into a pass. Write the dated report at
docs/validation/2026-08-31-local-mcp-quickstart.md with host assumptions,
commands, outcomes, providerCalls=0, limitations, and the explicit statement
that no public endpoint or real provider was used.

- [ ] **Step 4: Run final sequential release gates**

Run only after targeted #85 integration exits:
~~~sh
npx --yes bun@1.3.4 run check
env -u DATABASE_URL TEST_DATABASE_URL="$MCP_LOCAL_TEST_DATABASE_URL" npx --yes bun@1.3.4 run test:integration
env -u DATABASE_URL E2E_DATABASE_URL="$MCP_LOCAL_E2E_DATABASE_URL" npx --yes bun@1.3.4 run test:e2e
npx --yes bun@1.3.4 run check:architecture
npx --yes bun@1.3.4 run check:build
docker compose --env-file .env.mcp-local -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-local.yml config --quiet
~~~
Run dependency audit and image scan commands documented by the release
environment. Run crawler or Playwright heavy work one process at a time. All
Compose commands use project noosphere-mcp-quickstart-quickstart-a and the
env-scoped target database name noosphere_mcp_local_quickstart-a; integration
uses noosphere_mcp_local_quickstart-a_test and e2e uses
noosphere_mcp_local_quickstart-a_e2e. The final report must list an
unavailable prerequisite as a gap rather than hiding it.

- [ ] **Step 5: Review the complete local journey and commit after approval**

Inspect:
~~~sh
git diff --check
git status --short
~~~
After review, commit only the #85 paths:
~~~sh
git add scripts/validate-mcp-local-quickstart.ts tests/integration/mcp-local-quickstart.test.ts docs/validation/2026-08-31-local-mcp-quickstart.md docs/runbooks/mcp-local.md
git commit -m "test(mcp): validate local quickstart"
~~~

## Cross-slice verification gates

Before #80 review, run focused startup unit and Compose config only. Before #81
review, run focused fixture unit and a dedicated database integration. Before
#82/#83 review, run their focused units plus architecture/types. Before #84
review, run focused verifier and dedicated database integration; then run full
unit once. Before #85 acceptance, run check, integration, E2E, architecture,
build, dependency audit, image scan, crawler, and Compose config sequentially,
with one worker and no public endpoint.

Every implementation session must preserve the historical untracked plan
docs/superpowers/plans/2026-08-29-mcp-governed-external-effects.md. Only the
future task's listed files may change; no migration, provider, Caddy production
route, public port, volume deletion, or production secret is authorized by this
plan.

## Plan self-review

- [x] The plan follows the approved design and its #80 to #85 dependency order.
- [x] Each task has exact create/modify/test paths and named interfaces.
- [x] Each task has an actual RED test, a command with expected failure, minimal
      implementation guidance, GREEN commands, and a review commit boundary.
- [x] Startup, migrations, fixtures, credentials, client connection, protocol
      checks, functional effects, restart, cleanup, resource limits, and
      provider-free behavior are covered.
- [x] OAuth, PKCE, scope, membership, tenant, policy, marker, reconciliation,
      redaction, and Caddy boundaries remain owned by existing runtime code.
- [x] No task publishes an infrastructure port, uses a public endpoint, or
      deletes a volume.
- [x] The local fake is limited to proven kinds and campaign activation remains
      ADAPTER_UNAVAILABLE.
- [x] The historical plan is preserved and no current implementation command is
      executed by writing this document.
- [x] The plan contains no unbounded credential output, raw exception logging,
      or unscoped database cleanup.
- [x] Review finding 1 is addressed with the exact writing-plans header.
- [x] Review finding 2 is addressed with complete status, fixture-ID,
      credential, fake-adapter, SDK-client, factory, verifier, and resolution
      signatures.
- [x] Review finding 3 is addressed by an injected same-key RED/GREEN test and
      a real Postgres fingerprint round trip that forbids deletion or token
      regeneration.
- [x] Review finding 4 is addressed with derived disposable database/project/
      volume names, read-only preflight, and explicit rejection of existing or
      shared targets; cleanup never removes a volume.
- [x] All cleanup snippets provide an explicit bounded client and close it in a
      finally path; no cleanup API silently creates a connection or broadens
      the fixture scope.
- [x] Private identity/bearer loading is a discriminated, in-process-only
      contract; revoked credentials and database URLs are excluded from every
      report projection and redaction test.
- [x] #85 performs Docker and database catalog absence checks before wrappers,
      and integration/e2e wrappers receive only the derived disposable URLs;
      no ambient or existing database is accepted.
- [x] #85 keeps TEST_DATABASE_URL exclusive to integration and E2E_DATABASE_URL
      exclusive to e2e, with env -u DATABASE_URL on both shell wrappers; the
      plan test asserts the separation and proves wrapperCalls=0 on preflight
      rejection.

# Local MCP test environment design

**Issue:** [#79 — Audit and specify the clean-machine developer journey](https://github.com/IgnitionAI/noosphere/issues/79)
**Parent:** [#78 — Local MCP test environment](https://github.com/IgnitionAI/noosphere/issues/78)
**Date:** 2026-08-31
**Status:** Proposal for review; this document makes no implementation change.

## Decision summary

The shortest reliable local journey should be one explicit local-only Compose
project with the existing infrastructure, API, web, worker, and Caddy topology.
A Bun command should validate prerequisites, resolve an environment file with
mode 0600, validate merged Compose configuration, build local application
images, run forward-only migrations, wait for health, seed scoped fixture rows
through a non-root seeder, and print only redacted connection instructions.
A second command should run official MCP SDK checks and a third should clean
only fixture rows and this Compose project.

The public A4 smoke is the starting point, not a production default. Its
loopback ports, internal Caddy CA, private seeder output, OAuth fixture matrix,
official SDK runner, and bounded redacted report are reusable. Production
authentication, tenant checks, policy gates, provider boundaries, and durable
operation semantics remain unchanged. Local fake adapters are an explicit
configuration of the local project and never enter production composition.

The execution plan is intentionally separate and will be written after this
specification is reviewed. The historical untracked plan
docs/superpowers/plans/2026-08-29-mcp-governed-external-effects.md is not part
of this work.

## Goals and non-goals

### Goals

- Define a clean-machine path from clone to the first authenticated MCP call.
- Reuse A4 behavior where it is already safe and tested.
- Make startup, migration, fixtures, credentials, client connection,
  verification, restart, and scoped cleanup explicit.
- Keep local ports loopback-only and prevent production secrets, provider
  adapters, public ingress, or unrelated data.
- Give #80 through #85 exact ownership boundaries, independently testable.
- Keep resource use bounded: one heavy suite at a time and one worker process.

### Non-goals

- No production deployment, release, registry push, public TLS certificate,
  or Caddy production route change.
- No real provider mutation, external network canary, or recipient delivery.
- No weakening of OAuth, PKCE, scope, membership, tenant, approval, policy,
  marker-before-effect, reconciliation, or redaction invariants.
- No deletion of unrelated database rows, named Docker volumes, or QA data.
- No second business implementation of MCP tools or durable effect semantics.

## Supported host and prerequisites

The supported primary host is AMD64 Linux with Docker Engine and Docker Compose
v2, Bun 1.3.4, Git, OpenSSL, and a shell providing umask, mktemp, stat, and
trap. Docker must build local images and create a private network. The host
needs resources for PostgreSQL, MinIO, SearXNG, crawler, TEI, API, web, Caddy,
and one worker; the first run is the expensive operation.

The local project may use existing development infrastructure images, but
application services must be buildable locally. No registry login, production
secret, public DNS record, or public endpoint is required. Caddy generates a
local trusted CA, installed only in the smoke client with NODE_EXTRA_CA_CERTS.

Official defaults are loopback HTTP 127.0.0.1:18080 and HTTPS
127.0.0.1:18443. The canonical local MCP resource is
https://mcp.localhost:18443/mcp. The existing A4 hostname is
mcp-smoke.localhost; the eventual local overlay must choose one hostname and
use it consistently in Caddy, OAuth issuer/resource, Host, Origin, audience,
and client config. No service other than Caddy may publish a port. Port
conflicts must fail before startup with a bounded diagnostic.

## Current inventory

### Existing development path

package.json currently offers dev:bootstrap (generates .env from
.env.example and chooses loopback infrastructure ports), dev:infra (starts
database, minio, searxng, and crawler, then runs minio-init), db:migrate,
bootstrap:owner, dev (separate API and worker processes), dev:infra:down
(without -v), and dev:smoke.

This is useful for general development, but it does not provide one command, a
production-shaped MCP/OAuth edge, deterministic two-workspace credentials,
local governed-effect fakes, or one bounded functional report.

### Existing production-shaped MCP path

compose.infrastructure.yml defines PostgreSQL, MinIO, SearXNG, crawler, and
TEI on the private outbound-private network and publishes no infrastructure
ports. compose.production.yml adds migrations, API, web, workers, and Caddy.
Its proxy intentionally binds configurable TCP 80/443 and must not change for
local testing.

compose.mcp-smoke.yml is the A4 local overlay. It resets proxy ports to
loopback 18080/18443, points the API at the exact HTTPS audience, and adds an
on-demand mcp-smoke-seeder profile. API, database, object storage, search,
crawler, and TEI remain unpublished. The seeder writes bearer values to a
private container directory and the runbook extracts them with docker cp as a
tar stream into a host-created 0600 file; there is no secret bind mount.

docs/runbooks/mcp-production-smoke.md documents A4 startup, Caddy CA, seeding,
revocation, official SDK smoke, optional Inspector, restart, and cleanup.
scripts/prepare-mcp-production-smoke.ts owns deterministic idempotent fixture
rows and FK-safe cleanup. It creates two workspaces, reviewer/operator/viewer
memberships, hashed OAuth values, and bounded proposal/approval fixtures.
scripts/smoke-mcp-production.ts uses @modelcontextprotocol/client 2.0.0 for
modern and legacy transport checks and emits a redacted report.

### Runtime and protocol boundaries already present

packages/bootstrap/src/create-noosphere-api-runtime.ts validates secure
BETTER_AUTH_URL, database and auth configuration, composes read/write and
governed-effect capabilities, and routes OAuth and /mcp. Development auth is
strictly disabled in production and requires an explicit flag, exact token,
bounded UUID identity, configured role/scopes, and configured audience.

packages/interface/src/mcp/mcp-transport.ts enforces /mcp, Host, Origin,
authorization, method, Accept, Content-Type, body/response bounds, JSON-RPC
classification, injectable/durable rate limits, audience, correlation, and
safe request-local observability. Tools are capability-backed and tenant
context comes from authenticated execution context, never request args.

packages/interface/src/mcp/mcp-oauth.ts and
packages/infrastructure/src/auth/postgres-mcp-oauth-store.ts provide OAuth
metadata, authorization-code/PKCE, hashed access/refresh tokens, durable
rotation, family revocation, fresh membership checks, and safe token audit.

packages/bootstrap/src/runtime-capabilities.ts freezes only runtime-owned
wrappers; adapter/repository instances and internals remain usable. The
governed repository, capabilities, final worker gate, attempt repository,
executor, outbox handler, and recovery paths define durable approval, policy,
lease, marker-before-provider, outcome, and read-only reconciliation behavior.

## Reusable A4 components

| Component | Reusable contract | Local use | Boundary |
| --- | --- | --- | --- |
| compose.mcp-smoke.yml | Loopback Caddy overlay and smoke profile | Base for local overlay or selected A4 profile | Assert override and loopback bindings; no production port edit |
| deploy/Caddyfile.mcp-smoke | Exact /mcp and health routing with local CA | Reuse local edge route | No public listener or production Caddy edit |
| scripts/prepare-mcp-production-smoke.ts | Fixture plan, hashed OAuth values, scoped cleanup | Thin local wrapper | No token/DB URL stdout, broad delete, or provider |
| scripts/smoke-mcp-production.ts | Official SDK, modern/legacy, redaction and bounds | Call against local URL/config | Edge smoke stays read/protocol; verifier owns fake effect |
| docs/runbooks/mcp-production-smoke.md | CA, private credential extraction, restart and cleanup | Condense into local runbook | Never down -v or secret bind mount |
| tests/unit/mcp-production-smoke*.test.ts | Static safety assertions | Extend/factor shared assertions | Production overlay unchanged |
| tests/integration/mcp-production-smoke*.test.ts | Real DB JSONB and optional Caddy smoke | Reuse fixture proof | Dedicated DB and opt-in endpoint |

## Gap analysis

The #71–#77 work covers security and durable runtime primitives; #79 must
compose them without duplicating them.

| Gap | Current evidence | Local response | Ticket |
| --- | --- | --- | --- |
| One-command startup | Development needs ordered commands; A4 is manual | Startup validates prerequisites/config, builds, migrates, waits for health | #80 |
| Deterministic identities | A4 seeder is manual | Local wrapper adds idempotent fixture key and two-workspace role matrix | #81 |
| Safe local effect adapters | Final worker gates exist; A4 avoids mutation | Explicit fake for proven kinds; campaign remains unavailable | #82 |
| Ready client config | A4 uses env and optional Inspector forwarder | Generate non-secret transport/scope/role config | #83 |
| Functional verification | A4 intentionally avoids prepare/approve/effect | Bounded verifier owns safe write, approval, fake effect and negatives | #84 |
| Clean-machine proof | A4 is opt-in production-shaped | Fresh checkout/restart/scoped cleanup validation and dated report | #85 |
| Service readiness | Development starts children in parallel | Compose health conditions and bounded readiness probe | #80 |
| Resource safety | Gates prescribe one heavy suite/one worker | Explicit worker settings and serialized heavy commands | #80/#84/#85 |

## Recommended architecture and alternatives

Create a dedicated local Compose project and thin Bun orchestration wrappers.
The local overlay must reset proxy ports to loopback, leave every non-Caddy port
unpublished, select local application builds, use one consistent HTTPS
hostname/audience, run migration before readiness, start one worker, select
fakes only under explicit local configuration, and scope every cleanup operation
to a Compose project and fixture key.

The startup script owns host prerequisites, env permissions, Compose config,
local image builds, up --wait, and health. The seeder owns fixture rows and
private credentials. The verifier owns SDK calls and a redacted report. The
stop/cleanup command cleans fixtures first, then removes only the scoped project
without volume deletion. API/runtime owns authentication, authorization,
tenant derivation and durable transitions. Worker owns queue/lease/final-gate
and is the only process allowed to invoke a local fake.

### Alternative A — extend development scripts

Add MCP setup to dev:setup and use development Compose. This has few new files,
but multiple app processes, dev defaults, no Caddy TLS edge, and shared
developer DB make the acceptance path ambiguous. Not recommended.

### Alternative B — reuse A4 verbatim

Document A4 and add only a fake-adapter flag. This minimizes code and preserves
parity, but remains manual and does not cover safe write/approval/effect.
Useful as compatibility fallback, insufficient for #78 done.

### Alternative C — dedicated overlay and bounded scripts (recommended)

This adds small orchestration surface area but provides an explicit project,
loopback port reset, local-build guarantee, one worker, restart semantics,
private credentials, and independently runnable #80–#85 slices.

## Target journey

The exact script names are implementation contracts for #80–#85; this spec does
not add them now.

~~~sh
npx --yes bun@1.3.4 run mcp:local:start
npx --yes bun@1.3.4 run mcp:local:seed
npx --yes bun@1.3.4 run mcp:local:verify
docker compose --env-file .env.mcp-local \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-local.yml \
  restart api worker
npx --yes bun@1.3.4 run mcp:local:verify
npx --yes bun@1.3.4 run mcp:local:cleanup
~~~

Startup must fail before service creation for missing Bun/Docker/Compose,
invalid env/perms, unsafe ports, or invalid merged config. A second start is
idempotent. Same fixture key does not duplicate rows; a new key cannot touch
old fixtures. Output is redacted, bounded, categorized, and correlation
identified; it never prints bearer values, OAuth codes, DB credentials,
provider payloads, raw exception strings, or stacks.

## State, identity, and security model

The real OAuth flow and workspace membership rows are used; development auth is
not. Fixtures include two workspace UUIDs, a reviewer with
mcp:read mcp:write mcp:approve, an operator with read/write but no approve, and
a viewer with read only. The same bearer is accepted only for its current
workspace and membership. Revocation/demotion is visible before token expiry.

Bearer values are generated, hashed for storage, and retained only in a private
0600 env/config file. No token appears in an argument, committed fixture,
process log, test failure, or report. Client configuration references the
private file or process environment.

The local fake is a test dependency, not an external service, and must be
selected by a local-only setting that production rejects or safely ignores. It
covers only conversation_reply, content_publication, and meeting_proposal;
campaign_activation remains ADAPTER_UNAVAILABLE. Suppression, opt-out, human
reply, source revision, campaign pause, cancellation, and contact-null policy
cases must yield zero fake calls where facts are available; contact-null alone
is not contact deletion. Database traces, attempt markers, outcomes,
acknowledgements, and reconciliation rows are authoritative proof.

## Ticket contracts and exact file/test boundaries

The later implementation plan will turn each contract into ordered RED/GREEN
steps after this design is approved.

### #80 — deterministic one-command local stack startup

**Files:** create compose.mcp-local.yml; create scripts/start-local-mcp.ts and
scripts/stop-local-mcp.ts; modify package.json only for mcp:local:start,
mcp:local:stop, and mcp:local:status; create
tests/unit/mcp-local-startup.test.ts and tests/integration/mcp-local-startup.test.ts;
create/update docs/runbooks/mcp-local.md.

**Contract:** start validates Bun/Docker/Compose and env, asserts merged config
has exactly loopback Caddy ports and no other published service ports, builds
local API/web/worker images, runs migration, starts dependencies and one worker,
waits for health, and returns redacted readiness. stop acts only on project name
and never uses down -v. status does not mutate.

**Tests/gates:** static topology and fail-before-start unit tests; integration
tests for idempotent second start, migration ordering, health timeout, and
scoped stop using a dedicated TEST_DATABASE_URL or opt-in Docker project.
Run the focused unit, check:types, Compose config --quiet, and one bounded
local probe. No test deletes a named volume.

### #81 — scoped OAuth and demo fixture seeder

**Files:** create scripts/prepare-mcp-local.ts as a narrow A4 wrapper; modify
package.json for mcp:local:seed and mcp:local:cleanup; create
tests/unit/mcp-local-fixtures.test.ts and
tests/integration/mcp-local-fixtures.test.ts; update docs/runbooks/mcp-local.md.

**Contract:** validated fixture key and private DB connection create two
workspace-scoped identities/memberships and OAuth clients/tokens, store only
hashed durable values, and write a host env under umask 077 with mode 0600.
Output is redacted. Same key is idempotent; cleanup deletes only fixture-key
rows after FK-safe reference detachment.

**Tests/gates:** unit tests cover role/scope matrix, JSONB binding, redaction,
path/mode/argv safety, and no broad cleanup. Integration tests cover two
workspaces, fresh-store token acceptance, revocation/demotion, rerun, and
isolation on private TEST_DATABASE_URL.

### #82 — local-only governed-effect fakes

**Files:** create packages/infrastructure/src/mcp/local-governed-effect-fakes.ts;
modify packages/bootstrap/src/create-noosphere-api-runtime.ts only for an
explicit local-only fake option; modify apps/worker/src/index.ts only to
inject the existing executor port/counters; create
tests/unit/mcp-local-governed-effect-fakes.test.ts and
tests/integration/mcp-local-governed-effects.test.ts.

**Contract:** fake only proven kinds, deterministic success/failure/ambiguous
outcomes, no network. Existing final policy, marker-before-effect, lease,
durable outcome, ack, and read-only reconciliation remain authoritative.
campaign_activation returns ADAPTER_UNAVAILABLE.

**Tests/gates:** marker before callback, one replay call, unknown does not resend,
matched reconcile only with authoritative bounded proof, policy stale cases
yield zero fake calls, contact-null is not deletion. Architecture rejects
provider imports and production fake composition.

### #83 — client and Inspector configuration

**Files:** create scripts/write-mcp-local-client-config.ts; modify
scripts/smoke-mcp-production.ts only to consume local config without weakening
redaction/bounds; create tests/unit/mcp-local-client-config.test.ts; update
docs/runbooks/mcp-local.md.

**Contract:** config contains canonical HTTPS /mcp endpoint, transport era,
resource/audience, scopes, role/workspace labels, CA path, and a reference to
a private token file, never a committed token. Inspector uses verified pinned
CLI syntax and a loopback forwarder when header flags are unavailable.

**Tests/gates:** no secret in generated files, no unsupported Inspector flags,
modern/legacy initialize/tools/list/resources/list/read/ping config, and
viewer/operator/reviewer examples. Missing optional Inspector is reported,
not hidden.

### #84 — bounded local functional verification

**Files:** create scripts/verify-mcp-local.ts; modify package.json for
mcp:local:verify; create tests/unit/mcp-local-verification.test.ts and
tests/integration/mcp-local-verification.test.ts; update
docs/runbooks/mcp-local.md.

**Contract:** official SDK runs initialize, tools/list, resources/list/read,
ping, safe internal write/replay, one reviewer decision and one governed fake
effect. It checks viewer redaction, operator approval denial, insufficient
scope, foreign IDs, revoked membership, malformed input, correlation, and
bounded rate/response behavior. One worker and explicit deadlines are required.
No real provider and only redacted PASS/FAIL records.

**Tests/gates:** fake integration proves no external network, exactly one
durable intention/job/outbox, replay idempotence, policy denial, restart
persistence, and no cross-workspace oracle. Run one integration process at a
time.

### #85 — clean-checkout quickstart validation

**Files:** create scripts/validate-mcp-local-quickstart.ts;
tests/integration/mcp-local-quickstart.test.ts;
docs/validation/2026-08-31-local-mcp-quickstart.md; update
docs/runbooks/mcp-local.md only for clean-checkout corrections.

**Contract:** fresh checkout/worktree with no pre-existing MCP fixture records
versions, exact commands, bounded durations, service/image identifiers, and
redacted results for startup/seed/client/verify/restart/cleanup. It checks
unrelated Docker volumes and rows remain, states no real provider/public
endpoint, and records host limitations.

**Tests/gates:** sequential one-worker clean-checkout integration; restart
preserves OAuth/durable visibility; cleanup is fixture-key scoped and never
down -v. Compose config, types, architecture, build, and applicable
integration gates precede report acceptance.

## Acceptance matrix

| Area | Required proof | Local mechanism |
| --- | --- | --- |
| Startup | clean checkout, idempotent start, health, migration order | Compose config, up --wait, bounded health |
| Ports | Caddy loopback only; no API/DB/infra publication | merged config inspection |
| Auth | OAuth, PKCE/client/audience/scopes, role matrix | A4-compatible rows and token endpoint |
| Tenant | two workspaces, foreign IDs/args cannot elevate | fresh membership and negative SDK calls |
| Protocol | modern/legacy, malformed, notification, bounds, correlation | SDK and bounded raw HTTP |
| Durable effects | approval, policy, marker, job/outbox, outcome, replay | existing worker/repository and local fake |
| Policy | suppression, opt-out, reply, revision, pause, cancel, contact-null | facts fixtures or injected reader; fake calls 0 |
| Unknown | ambiguous becomes unknown/reconciling, no original retry | deterministic fake and read-only recovery |
| Restart | OAuth and durable state survive restart | scoped Compose restart and fresh clients |
| Secrets | no token/code/password/provider payload in output/files | 0600 env and redacted logs/report |
| Cleanup | only fixture rows/project touched; volumes preserved | fixture-key FK-safe cleanup |
| Resources | one heavy suite and one worker; bounded time | explicit settings and serialized commands |

## Ownership and failure handling

The orchestrator may start containers and report readiness, but may not make
authorization decisions, synthesize tenant IDs, mutate business rows, or call
providers. The seeder creates only rows carrying its fixture key. The verifier
calls the local MCP surface and does not bypass Caddy. The worker is the only
fake-effect caller. Cleanup runs fixture cleanup before removing the scoped
project and preserves unrelated fixtures, rows, volumes, and containers.

Failures use stable bounded categories: prerequisite, configuration, port,
migration, health, fixture, client, or verification. Diagnostics include a
service name and safe remediation command, never raw errors, stacks, SQL,
URLs with credentials, tokens, or provider payloads.

## Self-review checklist

- [x] Issue #79 and parent #78 objectives are represented.
- [x] Current development, production-shaped, A4 Compose, bootstrap, OAuth,
      MCP, worker, and seeder boundaries are inventoried.
- [x] Reusable A4 files and safety boundaries are listed.
- [x] Gaps map to #80–#85 without duplicating #71–#77 behavior.
- [x] Three approaches and trade-offs are explicit; dedicated overlay is
      recommended.
- [x] Commands, ownership, cleanup, and resource limits are explicit.
- [x] Every later ticket has exact file and test boundaries plus gates.
- [x] No production provider, public endpoint, migration, volume deletion,
      or implementation change is part of this documentation task.
- [x] Secret handling, tenant isolation, restart, redaction, stale policy, and
      fake-provider limits are explicit.

## Review boundary

This specification is the only artifact produced before review. No local stack,
provider, database cleanup, test suite, commit, or push is implied by reading
it. After approval, a separate writing-plans document can turn these contracts
into ordered RED/GREEN work while preserving the exact file lists above.

# MCP production canary — 30 August 2026

This report records the release-gate and final QA evidence available on 30
August 2026. It is a QA handoff, not a release approval: no tag, push, public
canary, real-provider mutation, or volume deletion was performed. The official
A4 smoke was run by QA through the local Caddy/TLS path; its provider boundary
and database-counter assertions remained green.

## Source and checkpoint digests

The source was clean apart from the historical untracked plan before the A5
diagnostic patch. A5 adds only the test-only Chromium context change described
below. `HEAD` and `origin/main` were both
`94a5668ea918f3a39ef7ab3fd76013bd13f8cb4a`, with divergence `0 0`.

| Slice | Commit | Scope verified |
|---|---|---|
| A1 | `6916e5fc1f05f3352c36fedf613fd911b3a85422` | strict authenticated MCP boundary, audience/host checks, bounded protocol and batch handling |
| A2 | `9726f8a5786c7b4ef34568b8f42eec21ca70fe14` | allowlisted request observations, safe errors, production configuration validation |
| A3a | `49d937061152a083742a32ab1be8bb9963932003` | durable bounded worker recovery and quarantine |
| A3b | `7ece6fd0fca19d00ee2b9296ef22358a1ee4c88c` | durable atomic OAuth refresh rotation and replay/revocation |
| A4 | `94a5668ea918f3a39ef7ab3fd76013bd13f8cb4a` | Compose/Caddy smoke harness, non-root seeder and scoped fixtures |

Local image IDs used for the static smoke/image checks:

- backend: `sha256:783b1f59e05d3d88dfdfd341237d39d5c6e0fda344121d549db5441ef60d36e0`;
- web: `sha256:2b23edb6b8dab118347cceb99b39f76062eaadcc84b8e8ac445eec71acf28b3e`;
- crawler: `sha256:7fed119bba95d7eb978a73da0e49fc5e0133e03e201ab0c5d74848fcfb2ef574`.

## Gate commands and results

All commands used Bun 1.3.4 (`npx --yes bun@1.3.4`) unless noted.

### Repository check

```text
APP_ENV_FILE=deploy/.env.quickstart.example PATH=/tmp/noosphere-a5-uv:$PATH npx --yes bun@1.3.4 run check
```

Exit `1` on the baseline run. Prototype, TypeScript, architecture and
self-hosting checks passed; the HTTP/unit phase reported `853 pass, 1 skip,
0 fail` (`2790 expect()`), but the crawler phase failed its browser security
test: `42 passed, 1 failed` with `playwright._impl._errors.Error:
Browser.new_page: Target crashed` while creating the second page in
`test_real_browser_never_connects_to_private_redirect_or_subresource`. No
private-target connection was observed.

```text
PATH=/tmp/noosphere-a5-uv:$PATH npx --yes bun@1.3.4 run check:crawler
```

Exit `1`: `42 passed, 1 failed` with the same `Browser.new_page: Target
crashed` failure. A minimal two-page Playwright reproduction without the test
fixture also failed; Chromium logged `pthread_create: Resource temporarily
unavailable (11)`. The system cgroup had `memory.events oom_kill=24` and
`oom=2` while its PID limit was unlimited, identifying host resource pressure
as the cause rather than SSRF behavior.

The TDD fix is test-only in `apps/crawler/tests/test_security.py`: the two
security probes now use one `BrowserContext` and two pages, preserving both
redirect and subresource checks while avoiding two independent context
renderer/thread footprints. The targeted RED was the baseline failure above;
the targeted GREEN was:

```text
apps/crawler/.venv/bin/pytest apps/crawler/tests/test_security.py::test_real_browser_never_connects_to_private_redirect_or_subresource -q
```

Exit `0`: `1 passed in 6.48s`.

The complete crawler gate after the patch was:

```text
PATH=/tmp/noosphere-a5-uv:$PATH npx --yes bun@1.3.4 run check:crawler
```

Exit `0`: `43 passed in 9.09s`.

Final QA also reran the crawler gate in the isolated test container: exit `0`,
`43 passed, 0 failed`. The container method kept Chromium's process/thread
footprint separate from the host cgroup; no crawler provider or public target
was used.

The checks that follow the crawler were run independently:

```text
npx --yes bun@1.3.4 run check:build
```

Exit `0`; API and worker bundles were produced (`9.87 MB` and `9.76 MB`) and
the document extractor bundle (`5.45 MB`) completed.

```text
npx --yes bun@1.3.4 run check:web
```

Exit `0`; Next.js compiled, type-checked, generated its static pages and
prepared standalone assets.

A fresh full-check rerun was attempted with `GOMAXPROCS=1` after the crawler
fix:

```text
GOMAXPROCS=1 APP_ENV_FILE=deploy/.env.quickstart.example PATH=/tmp/noosphere-a5-uv:$PATH npx --yes bun@1.3.4 run check
```

It reached architecture (`587 TypeScript source files`) but exited `1` in
`check:self-hosting`: the Docker Compose Go plugin failed with
`runtime: failed to create new OS thread`/`errno=11` while rendering its
temporary config. A direct `GOMAXPROCS=1 docker compose ... config --images`
with the same safe example values exited `0`, so this is the same host
thread-pressure limitation and not a repository validation failure. The
generated `apps/web/next-env.d.ts` change from this run was removed; no
functional web edit remains.

### Database and browser suites

```text
npx --yes bun@1.3.4 run test:integration
```

Final A5 QA run against the dedicated, already-migrated QA database exited `0`:
`256 passed, 1 skipped, 0 failed`. The single skip is the A4 production smoke
scenario, covered by the official live smoke below; it is not an untested
application path.

```text
npx --yes bun@1.3.4 run test:e2e
```

The repository wrapper was intentionally not rerun during final reconciliation:
it resets its `_e2e` database with `DROP DATABASE`, which is forbidden by the
run instructions, and the QA database was already migrated. The underlying
Playwright suite was instead run directly in an isolated container by QA and
exited `0`: `18/18` (`9 desktop + 9 mobile`), `5.5m`, one worker. This is an
evidence method distinction, not a claim that the destructive wrapper ran.

No database reset or volume deletion was performed during this reconciliation.

### Dependency audits

```text
npx --yes bun@1.3.4 audit --audit-level high
```

Exit `0` (no findings printed).

The crawler prerequisite was installed outside the repository with uv 0.12.7
under `/tmp/noosphere-a5-uv`:

```text
PATH=/tmp/noosphere-a5-uv:$PATH uv export --frozen --no-dev --no-emit-project --format requirements.txt --output-file /tmp/noosphere-crawler-requirements-a5.txt
PATH=/tmp/noosphere-a5-uv:$PATH uvx pip-audit --no-deps --disable-pip --requirement /tmp/noosphere-crawler-requirements-a5.txt
```

Both exited `0`; pip-audit reported `No known vulnerabilities found` (with
only its documented `--no-deps`/hash warnings).

### Compose validation

```text
env APP_ENV_FILE=deploy/.env.quickstart.example POSTGRES_PASSWORD=compose-test-password S3_ACCESS_KEY_ID=compose-test-access S3_SECRET_ACCESS_KEY=compose-test-secret SEARXNG_SECRET=compose-test-searx CRAWLER_API_KEY=compose-test-crawler BACKUP_DIR=/tmp/noosphere-smoke-backups PUBLIC_HOST=noosphere.example.com MCP_SMOKE_HOST=mcp-smoke.localhost MCP_SMOKE_FIXTURE_KEY=a5-config-test MCP_SMOKE_TMP_DIR=/tmp/noosphere-smoke-config docker compose --profile mcp-smoke -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml config --quiet
```

Exit `0`. A JSON inspection of the same rendered configuration showed only
proxy publications `127.0.0.1:18080->80` and `127.0.0.1:18443->443`; API,
database, MinIO, SearXNG, crawler, TEI and workers had no published ports.
The smoke seeder had no bind output volume or user override. No `compose up`
was run.

### Image scans

Trivy 0.67.2 was run with the release severity policy (the scanner image
digest was `sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08`):

```text
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.67.2 image --exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed noosphere-backend:a4-seeder-private
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.67.2 image --exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed ghcr.io/ignitionai/noosphere-web:v0.1.0
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.67.2 image --exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed ghcr.io/ignitionai/noosphere-crawler:v0.1.0
```

All three exited `0`: each reported `0` HIGH/CRITICAL vulnerabilities and no
detected secrets. These were local image scans only; no image was pushed.

## A1–A4 behavior and provider boundary

The A1–A4 checkpoint tests cover authenticated workspace derivation, exact
HTTPS audience/Host policy, bounded JSON-RPC and responses, rate limiting,
correlation, structured safe errors, redacted observations, durable OAuth
rotation/revocation, worker recovery, non-root private seeding and the Caddy
only smoke topology. A4's official live smoke passed with the real SDK in both
modern and legacy modes and the pinned Inspector CLI, API restart, two
workspaces, workspace isolation, RBAC, membership revoke-before-expiry,
viewer redaction, non-root/loopback operation, and cleanup without `down -v`.

The live smoke traversed Caddy/TLS and retained stable database counters for
jobs/outbox/attempts. It made no external provider send/publish/book call; the
provider fake/boundary remained uninvoked. The harness and tests assert no
provider-shaped MCP route and no provider invocation before the durable worker
gate. The smoke proves production-like boundary behavior, not a real-provider
or public-canary result.

## Open release gates

1. The aggregate local `check` still needs a clean CI/QA runner for its
   self-hosting sub-gate: this host hits Docker Compose's `new OS thread` /
   `errno=11` cgroup-pressure failure, while direct constrained Compose config
   and the isolated crawler/browser methods pass. This is an environment limit,
   not an observed application failure.
2. The official A4 live smoke is green, but it is deliberately provider-free
   and local/loopback-only. A real provider/public canary and release approval
   remain out of scope and were not claimed here.

No production release, tag, real-provider/public canary, or destructive database
cleanup was performed for this report.

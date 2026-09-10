# Canary baseline validation — 10 September 2026

Base: `18207a6f7abc8a96ffbb18af4985722a735a0df1` (`main`). Work performed in
an isolated checkout; existing MCP/OAuth changes and the Setup IA branch are
preserved. No VPS, provider account, campaign or production volume was changed.

## Reproduction and causes

The Check run `33472902007` failed five integration tests and skipped browser
execution. A local unmodified baseline reproduced those five failures plus a
sixth time-dependent MCP facts test: 250 passed, 19 skipped, 6 failed.

- Analytics inserted opportunities using database wall time but queried August
  2026. Pinning creation/update dates restores revenue and dimension assertions.
- MCP content facts combined a fixed publication time with an unfixed strategy
  update time. The correct stale-source guard rejected that inconsistent fixture.
- The governed-effect capability unit harness used wall time for an already
  expired meeting. It now injects the clock supported by the component.
- Content discovery and generation suites passed alone. Global schedulers in a
  shared test database consumed fixtures retained by previous suites, including
  immutable smoke sources and the repair suite's active configuration. Merely
  setting `--max-concurrency 1` still failed. The runner now recreates its dedicated
  test database and starts a separate process for each integration file. All
  assertions and within-suite concurrency scenarios are retained. Failures remain
  nonzero and all files are attempted.

No production invariant or assertion was weakened to obtain passing tests.

## Local results

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed |
| `bun run check` | Passed: 989 unit/HTTP tests, 43 crawler tests, types, architecture, self-hosting, backend/web builds |
| `TEST_DATABASE_URL=<dedicated-local-test-db> bun run test:integration` | 256 passed, 19 existing opt-in tests skipped, zero failures across 62 files |
| `E2E_DATABASE_URL=<dedicated-local-e2e-db> bun run test:e2e` | 18 passed, desktop/mobile, zero skipped; repeated after dependency updates |
| `bun audit --audit-level high` | Passed after pinning Next 16.3.3 and Sharp 0.35.4 |
| Crawler `pip-audit` | Blocked by NLTK 3.10.3 / PYSEC-2026-3740 |

The E2E environment uses the same dummy S3 credentials as CI, disabled external
channels and an unavailable Codex binary. This proves authenticated navigation,
not object storage or live inference. The 19 opt-in MCP/local smoke tests are not
claimed as exercised by this integration run.

Audit reproduction from `apps/crawler`:

```sh
uv export --frozen --no-dev --no-emit-project --format requirements.txt --output-file /tmp/noosphere-crawler-requirements.txt
uvx pip-audit --no-deps --disable-pip --requirement /tmp/noosphere-crawler-requirements.txt
```

The [upstream NLTK advisory](https://github.com/nltk/nltk/security/advisories/GHSA-8mgp-746c-j5xp)
lists versions through 3.10.3 as affected and no patched release. No ignore rule
or audit exemption is introduced. Release remains blocked while this audit fails.

## Evidence boundaries

These are local checks, not hosted CI or deployment acceptance. VPS HTTPS,
workers, object storage, restart recovery, backup restoration, external MCP
clients and live providers require separate evidence. No release tag or production
switch is authorized by this report. The changes add no migration or permission;
reverting the commits restores the previous test runner and dependency pins.

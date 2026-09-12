# Instance AI canary validation — 2026-09-10

## Scope and provenance

Original `feat/instance-ai-setup` at `e91bde36355dae36802e1510979011318700db4b` was reviewed, then its seven commits (#87–#93) were rebased in an isolated worktree onto baseline fix `f116092e492bc787b23dbf14b6be5d475ff43231` (PR #94). Original checkout and dirty MCP/OAuth work remain untouched. This branch has not been merged or deployed.

Review found two delivery gaps: no instance fallback selection, and evaluation routes bypassing managed connections. Regression tests reproduced missing connection identity for OpenAI and rejection of Anthropic/OpenRouter. The changes add explicit instance fallback configuration, durable inheritance, managed evaluation candidate routing and bounded route provenance. Evaluations compare their immutable candidate and never substitute the instance fallback.

Further review regressions cover preservation of an omitted fallback, explicit removal, unavailable fallback visibility, default changes between evaluation enqueue and retry, unavailable-candidate resume despite a healthy alternate, and renewal of the same connection. Legacy evaluation upgrade preservation is checked separately after the full suite.

## Executed validation

All database commands used disposable local databases, with the hostname checked before replacing the database name. Existing infrastructure and other application databases were preserved.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed on the rebased branch |
| `bun run check` | Passed: 1,049 unit/HTTP tests, 43 crawler tests, TypeScript, architecture checks and application builds |
| `MCP_LOCAL_FIXTURES_INTEGRATION=1 MCP_LOCAL_GOVERNED_EFFECTS_INTEGRATION=1 bun run test:integration` | Passed: 302 tests, 4 explicit transport-dependent skips |
| `E2E_CONTROLLED_CODEX=true bun run test:e2e` | Passed: 44 desktop/mobile browser tests, no skips |
| `bun test tests/integration/legacy-ai-task-migration.test.ts` | Passed after final legacy backfill: 4 tests, 28 assertions; typecheck also passed |
| `git diff --check` | Passed |

The four integration skips are local Docker startup, two configured MCP functional probes and HTTPS edge SDK smoke. They require their own configured endpoint/identity/CA setup; the test counts above do not prove external MCP accessibility.

Browser tests use the repository's controlled Codex executable in a separate private temporary service home. API-provider browser fixtures are synthetic. These prove UI/authorization/routing behavior, not provider delivery. Separately, the real managed-connection tester completed its empty-input structured probe against configured OpenAI `gpt-5-mini` (5,442 ms) and Kimi `k3` (7,225 ms). Keys were read privately into memory and no database credential rows were written for these probes. This proves local provider connectivity and the required structured output, not VPS connectivity or a CRM messaging loop. Redacted results: `/tmp/noosphere-live-ai-probes.log`. Logs on the validation host: `/tmp/noosphere-ai-reviewed-check.log`, `/tmp/noosphere-ai-final-integration.log`, `/tmp/noosphere-ai-reviewed-browser.log`.

## Migration and permission review before merge

This delivery introduces the instance-administrator role and forward-only migrations 0108–0115. Bootstrap may grant that role to the explicitly configured bootstrap owner; workspace ownership alone does not grant instance administration. Shared encrypted credentials and private Codex service homes are available to API/workers under the instance's authorization rules. Migration 0115 adds optional fallback references and replaces policy capture while retaining existing task contexts.

Operator review of the administrator assignment, encryption key continuity, private service volume and upgrade behavior is required before merging/deploying this permission-changing delivery. Do not reverse migrations or delete volumes. Rollback must restore recorded prior application image digests with the forward schema retained, after compatibility checks.

## Outstanding release and live acceptance gates

PR #94's hosted Check fails at the Python dependency audit: NLTK 3.10.3 / PYSEC-2026-3740 has no upstream patched version verified in this session. No exception or audit suppression was added. Therefore CI is not fully green and no release tag or merge is justified by these local results.

The dedicated Noosphere VPS SSH address is still missing; `noosphere.ignitionai.fr` returned NXDOMAIN when checked. HTTPS, service stability, real persistence/restart, encrypted off-site backup restoration and external MCP acceptance remain unverified. Hermes was not accessed or modified. No real provider recipient was authorized and no external message/publication/meeting action was sent.

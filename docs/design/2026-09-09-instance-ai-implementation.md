# Instance AI setup implementation

Parent: https://github.com/IgnitionAI/noosphere/issues/86

## Ticket 87: explorable setup and instance administrator

Implemented in `feat/instance-ai-setup` from `18207a6` in an isolated worktree.
The original checkout's unrelated MCP changes have not been incorporated.

- Explicit bootstrap grants instance administration idempotently; ordinary workspace ownership does not.
- Bootstrap creates only the account unless `BOOTSTRAP_CREATE_WORKSPACE=true`.
- The first administrator sees `/setup` before onboarding. Skipping is persistent; settings reopen the same setup.
- Research and manual content launch boundaries reject absent AI before generating jobs; manual edits, reads and disabling automation remain usable.
- Availability respects capability overrides, workspace defaults and legacy environment fallbacks. This is legacy credential availability, not the forthcoming real connection test in ticket 88.
- Evaluation checks its explicit model before creating or retrying a run.
- Content schedulers wait without creating new AI jobs when their routes are unavailable. Ready content publication remains independent.
- Research UI and MCP expose an actionable prerequisite; MCP checks use the existing transaction rather than another pool connection.

### Validation

- Type checks, architecture check, backend build, Next production build and self-hosting Compose validation passed.
- HTTP/unit suite: 1,000 passed, one pre-existing failure in `postgres-mcp-governed-effect-capabilities.test.ts` (also reproduced on pristine `18207a6`). The subsequent MCP error-mapping test passes in the focused six-test SDK suite.
- PostgreSQL integration: nine tests passed across instance setup, content idea discovery and continuous evaluation using a dedicated test database.
- Browser setup coverage runs on desktop and mobile with all provider credentials empty: initial setup, skip, workspace creation, return from settings, preserved research draft and setup link.
- No deployment, release tag, production migration or external provider invocation performed.

### Continuation

Tickets 88–93 remain: persisted encrypted connections with real invocation tests; provider adapters; Codex/Kimi onboarding; live workspace inheritance; explicit fallback and durable manual resume; existing-installation migration and end-to-end acceptance.
Existing in-flight jobs, inbound workflows and durable provider-failure recovery belong to ticket 92; this first slice prevents new explicit setup-dependent operations.

Migration `0108_instance_ai_setup.sql` uses the next journal index on this branch. The original dirty checkout already contains an unrelated 0107 migration; preserve and reconcile both journal entries when integrating.

## Ticket 88: OpenAI connection (implemented locally)

Persisted instance connections use encrypted keys and per-model validation leases. API and workers share a database-backed policy reader and the same provider adapter for probes and research. Changes invalidate the relevant proofs; an invalidated default is blocked rather than silently replaced by an environment route.

A controlled HTTP provider passed the encrypted PostgreSQL/API lifecycle and a complete research mission through a separately composed worker without environment provider keys. The real research executor and PostgreSQL orchestrator processed all ten jobs (including the market-investigation join); the run reached `completed`, recorded all V3 stages and exposed a nonempty ICP report. Provider output and evidence are controlled fixtures: this verifies orchestration and configuration, not real-world research quality or live sourcing. Test jobs are removed only within their disposable workspace; the research graph remains available for inspection.

The browser can save a key, test the model, select the default and queue a research mission on desktop and mobile. Eight combined setup E2E cases passed. Three connection integration cases passed with 96 assertions. Type checks, architecture, backend build and Next production build passed. The broad unit/HTTP suite passed 1,010 tests with the same separately reproduced baseline MCP failure recorded above. Two review axes found no remaining concrete production-code defects. Full release gates and cross-provider acceptance remain ticket 93 work.

### External provider evidence

On 2026-09-09 at 11:20:24 UTC, the actual configured OpenAI credential passed `InstanceModelConnectionTester` against `https://api.openai.com/v1/responses` with `gpt-5.4-mini`, effort `low`, a 1,024-token output limit and a 30-second deadline. The model returned the required `connection_probe` output; total time was 1,972 ms. No workspace content was sent and no key is included in this report.

The initial Chat Completions probe was rejected because GPT-5.4 mini does not support function tools with reasoning effort on that endpoint. Switching the adapter to Responses resolved the real provider failure. Controlled tests now use the Responses protocol too; they remain distinct from this external proof.

### Migration correction

The journal timestamps added for 0108/0109 now follow the pre-existing journal timestamps (which are later than the calendar date). 0108 table creation is idempotent so a test installation that already applied the earlier commit can upgrade without replay failure. Upgrade was exercised both from the pre-setup 0106 database and from the dedicated database created by the 56f057b setup tests; no production database was modified.

## Ticket 89: Anthropic, OpenRouter and OpenAI-compatible endpoints

Implemented API-key connections end to end: setup provider selection and custom URL, fixed official endpoints, immutable provider identity, shared encrypted persistence and proof invalidation, provider-specific function-output adapters, API/worker gateway composition. OpenRouter disallows its implicit provider fallback and requires the requested parameters. The generic transport accepts only public HTTPS destinations and exposes an actionable forbidden-destination error.

Six PostgreSQL integration cases pass, including complete missions with all four API-key providers through the real research executor/orchestrator using controlled HTTP responses. Fourteen setup browser cases pass on desktop/mobile: three providers saved/tested/selected and missions queued, compatible URL blocked before sending a key to loopback, plus provider-free exploration. The subsequent targeted desktop/mobile check also verifies the explicit forbidden-destination message (2 passed). Provider contract and catalog checks (11 passed), destination rejection, type, architecture, backend and web checks passed separately. The broad suite found the known baseline MCP failure and an expected catalog test update for newly enumerated providers; the catalog contract was updated and passes its focused suite.

### Live evidence and transport correction

A real compatible-endpoint probe against OpenAI Chat Completions succeeded with `gpt-5-mini` at 2026-09-09T11:42:14.889Z in 2,158 ms. The existing OpenAI key was read only for this bounded synthetic probe and was not saved into another connection. `max_completion_tokens` is used for that protocol; the first call with legacy `max_tokens` failed validation. No Anthropic/OpenRouter keys were available in the local environment, so no live success is claimed for them.

The initial `node:https` custom-lookup implementation worked under Node 22 but failed under the pinned Bun 1.3.4 runtime. The replacement connects directly to the validated public IP with the original Host/SNI and explicit certificate-name verification, no proxy, no reuse and no redirects. A real unauthenticated call returned HTTP 401 from api.openai.com under Bun; a wrong-host certificate was rejected with `ERR_TLS_CERT_ALTNAME_INVALID`. No credentials were sent in these transport probes.

Tickets 90–93 remain. Existing installations and full release acceptance are not yet complete; no push, release or production migration performed.

## Ticket 90: Kimi and isolated ChatGPT service connections

Kimi follows the shared API-key lifecycle with its official endpoint and existing provider adapter. Codex connections store no API key; they derive a private UUID home from explicit `INSTANCE_CODEX_HOME`. The API and worker use the same connection-gateway factory. Setup provides the guided local/container device-login commands, account status and model validation/renewal. Compose mounts a separate persistent service volume into the API and all workers; the backend image bundles the login command and pins Codex 0.147.0.

The login command stages each device flow separately and publishes credentials only under a database lock matching its authentication session ID. Tests and credential resolution are blocked during this session. Starting another login supersedes an abandoned attempt. Success and failure invalidate model proofs; an old attempt cannot publish or cancel the new account. Files are private (directories 0700, auth.json 0600), and ChatGPT tokens never enter database API-key fields or public responses.

Managed Codex model invocations ignore user config/rules and project documents and disable shell, plugins/apps, browsing/computer, image generation, memory and delegation features. Environment-configured legacy Kimi/Codex connections remain intact. The live local CLI is 0.147.0, matching the image pin; its help/features were inspected to verify the flags used by the managed invocation.

### Evidence

- Ten PostgreSQL integration cases pass with 550 assertions on the dedicated `noosphere_instance_ai_90_test_20260909` database: complete research missions through all six providers (controlled HTTP/process outputs), guided login through a controlled executable, credential permissions, authentication fencing and proof invalidation.
- Codex browser tests pass on desktop/mobile: create without API key, guided login, model test/default, expired connection and renewal. Kimi browser tests also pass on desktop/mobile. The fixture executable is explicitly enabled only for these controlled browser runs.
- Seventeen focused gateway/home-status unit tests pass. The broad unit/HTTP suite has 1,021 passes and the same independently reproduced baseline MCP failure. Type, architecture, backend, login-script, Compose and Next production build checks pass.
- A real Kimi probe (`kimi-for-coding`) succeeded on 2026-09-09T12:01:25.165Z in 2,430 ms, with a 1,024-token output limit. No live managed Codex connection was available; no personal Codex credentials were imported or invoked to manufacture that proof.
- Two review axes caught the concurrent-renewal proof race; the session-fencing correction was reviewed again with no remaining defect identified.

Migration 0110 is still unreleased. During development its session column was added after the earlier disposable database had been migrated, so subsequent validation uses the fresh dedicated 90 database. Production and the original checkout database were not changed.

Tickets 91–93 remain: workspace selection/live inheritance with task pinning; explicit fallback and durable manual resume; existing-installation migration and complete release acceptance. No push, deployment or release tag performed.

## #91 — workspace inheritance and durable task routing

Instance-backed workspace application and HTTP API expose authorized ready models (connection/model/effort/name only), support empty routes for live inheritance, reject unauthorized selections, and retain withdrawn choices. Repository preserves connection IDs. Runtime merges per-capability overrides with inherited defaults and refreshes current validated connection versions. Workspace UI uses authorized selections, inheritance, optional ordered fallback, missing-model explanations and save status.

Migration 0111 captures routing at every job insertion, including direct Drizzle writers. `task_ai_contexts` stores the selection independently of job retention; run-based stages and manual resumes share it. `jobs.ai_policy` carries each launch snapshot. API/worker publish model-only environment defaults before accepting work so existing environment-only configurations are captured too. `TaskAiPolicyScope` supplies the durable policy to all worker executor reads and isolates concurrent jobs. Secrets remain in connection storage. Revoked or changed credentials remain subject to current gateway authorization/version checks.

Verification:
- 13 PostgreSQL integration tests / 472 assertions pass on fresh `noosphere_instance_ai_91b_test_20260909` (current 0111). `/tmp/noosphere-91b-integration.log`.
- Complete controlled missions for six instance providers and legacy environment Kimi after defaults change before first lease; stage continuity, reconnect and job-purge/resume retain the original model.
- Desktop/mobile workspace UI: 2 pass, `/tmp/noosphere-91b-e2e.log`.
- Unit/HTTP: 1027 pass, one unchanged baseline MCP governed-effect failure (previously reproduced at 18207a6); `/tmp/noosphere-91-unit-http.log`.
- Type checks, architecture (597 files), backend and Next production builds pass; `/tmp/noosphere-91b-build.log`, `/tmp/noosphere-91b-web.log`.
- Standards and Spec reviewers approved corrected behavior. Their findings drove environment capture, durable retention-independent contexts, research-only candidates, effort display consistency and inherited-default warnings.

Remaining feature work: #92 explicit fallback/durable pause/manual resume; #93 existing-install migration and final full gates. In particular old jobs created before 0111 have null contexts and must be backfilled in #93 before this feature is deployed. 0111 was revised while uncommitted: older disposable 90/91 test DBs have earlier shapes; use fresh 91b or a new DB. No deployment, push, PR or issue closure performed.

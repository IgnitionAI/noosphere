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

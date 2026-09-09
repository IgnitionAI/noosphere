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

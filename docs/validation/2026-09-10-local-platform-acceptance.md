# Local platform acceptance — 2026-09-10

Status: LOCAL MANUAL TESTING READY. This evidence covers the configured local platform; it does not claim VPS deployment or live third-party delivery.

## Requested outcome

Make the complete local platform ready for the user to test manually. Fix the reported regressions, use GPT-5.6 Luna for real AI validation, reserve instance AI configuration to the environment-designated super administrator, preserve user data and keep Hermes untouched. No external messages or campaigns are authorized by this validation.

## Environment

- Implementation: isolated `noosphere-canary-mcp` worktree; root checkout untouched.
- User instance: loopback web 3380 / API 3381, persistent `noosphere_local_interactive_01a08acb` database.
- Original user study retained. Its two completed checkpoints survived an explicit switch from Astra to the configured Luna model during resume; all nine stages completed in the original workspace. Its report opens and survives restart from the persistent local configuration.
- Real Luna validation: workspace `validation-compl-te-luna`, study `8f31c8c2-35be-4f62-9bdc-71c80a4feae1`.
- Isolated MinIO bucket `noosphere-local-interactive`; real local crawler and TEI infrastructure are reused without restarting their containers.
- All automated tests use separate disposable databases and a separate QA checkout.

## Required evidence

| Area | Evidence required | Current state |
| --- | --- | --- |
| Build and checks | Full repository check with current changes | Full check passed: 1078 Bun tests, 43 crawler tests, TypeScript, architecture, self-hosting, backend and production web build |
| Integration | Entire repository integration suite | Full suite passed: 323 tests; 4 environment-opt-in cases skipped. Separate current-source HTTPS MCP smoke covers edge/protocol/isolation. Additional resume/fanout regressions: 3 tests, 89 assertions |
| Browser | Entire authenticated desktop/mobile suite | Final full rerun passed 48/48 desktop/mobile tests, zero skips; includes original-model and newly-configured-model resume, saved checkpoints, guided Codex authentication, and super-admin restrictions |
| Instance AI | Guided login, named models, save/edit, actual Luna probe, super-admin denial on button/page/API | Real Luna probe and default selection passed; permission suite 6 browser tests and DB integration passed |
| Actual research | All nine steps, source-grounded report, report opening and persistence | All 9 Luna stages completed in 14m22s; browser opened report with 4 ICPs and 13 sources; retained after restart |
| Storage and documents | Authenticated upload, extraction, retrieval, restart persistence | Upload 201/204/202, text extraction ready with no warnings; checksum and ready state retained after restart; physical MinIO object retrieved after restart: 164 bytes, SHA-256 matches original upload |
| Product flows | Workspace onboarding, research/ICP, offer, messaging, sequence, content, CRM/import, inbox/calendar, settings/roles, operational console | Full browser and integration suites passed; authenticated GET of 35 workspace pages passed |
| Runtime continuity | Repeatable startup of web/API/workers, graceful stop, restart without losing data | Canonical dev launcher now starts web, API and all 4 workers on configured local ports; actual restart retained report/document. Real child-process regression proved double SIGTERM interrupted draining, now fixed. Local general-worker batch restored from 1 to default 4. |
| MCP | Authenticated discovery, tools, workspace isolation, durable writes/replay | Current-source HTTPS MCP smoke passed modern/legacy protocols, isolation, redaction, revocation and rate limiting with fresh isolated identities. Earlier identities returned 401. |
| Configured providers | Real Luna execution; no unrequested Astra or recipient delivery | Luna default with no fallback; historical Astra queue rows remain paused; original task now pins Luna only; separate real 9-stage study completed |

## Findings being addressed

- Old Codex 0.147 rejected Astra, misreported as model unavailable. Local isolated Codex upgraded to 0.154; explicit outdated-client classification added.
- Codex rejects nested JSON Schema `format: uri`; transport removes that unsupported annotation while the original Zod URL validation remains enforced.
- Instance AI button was shown to workspace members; page and API now use the bootstrapped account matching `BOOTSTRAP_OWNER_EMAIL`.
- The light ICP banner inherited white text; its title now uses the dark signal-ink color.
- Starting a second active study hit the unique database constraint and returned 500. A typed HTTP 409 and preserved-draft UI response replace the server error.
- Full browser tests exposed hidden dependencies on previously saved instance defaults; scenarios now establish their own unconfigured-state preconditions.

Local controlled-provider tests do not prove live third-party delivery or VPS deployment. The four integration opt-in skips cover a separately managed Docker project and live local-stack probes; the existing local stack was exercised directly, including HTTPS MCP and canonical application/worker restart.

## Latest validation details

- Real Luna study: 2026-09-10T13:58:50Z to 14:13:12Z, same original product brief, no Astra fallback. Market fanout consumed five jobs; these are not five failures.
- Runtime restarted using private environment; general worker concurrency returned to four. The previous batch of one serialized independent market investigations and delayed document processing.
- Full checks and integration passed after launcher/model-resume changes. Real-child shutdown and busy-model-change regression tests also passed.
- Original study explicitly resumed using current configured models through the authenticated HTTP action. Its new queue rows use gpt-5.6-luna only; completed historical checkpoints remain intact. The independent validation report is not substituted into this run.

## Recovery behavior

- `resume` preserves the original pinned choice even if current defaults change.
- `resume-current-models` explicitly captures the current workspace/instance model selection and verifies availability inside the same resume transaction. It preserves completed checkpoints and updates unfinished fanout children.
- Model switching returns HTTP 409 while a previous model call is still leased; the study remains paused. Concurrent resume creates only one resumed execution.
- Both resume options pass browser tests on desktop and mobile, with controlled providers asserting the exact requested model.
- Local private configuration is retained at `~/.local/share/noosphere/local-runtime/environment.json` (0600), with a local start helper beside it; it is not committed. The helper detects an already-running instance without launching duplicate workers.
- External Unipile/calendar delivery remains unconfigured and was not attempted; controlled integration/browser coverage is distinct from real recipient delivery. This local acceptance does not claim a VPS deployment or resolve the separate release audit blocker.

## Final original-study acceptance

The original `test-local` run `77f149ee-cedb-4081-9e8f-719221d4640a` completed all nine stages at 2026-09-10T14:28:24Z. Its two initial completed checkpoints still each have exactly one completed row. The rendered original report contains one retained ICP, two sources and three studied hypotheses; its inherited evidence differs from the independent fresh Luna validation report (four ICPs, thirteen sources). No result was copied between the runs. Both reports remain available.

After the original study completed, the whole local application and its four workers restarted using the persistent private configuration. The original study still returned completed/9 stages, and its report rendered with HTTP 200. The launcher helper detected the already-running instance in a separate check and did not create duplicate processes.

Local reproduction commands: `bun run check`, `bun run test:integration` against a disposable `_test` database, `bun run test:e2e` against a disposable `_e2e` database with the controlled Codex executable. Private credentials, loopback port configuration and separate databases were supplied outside the repository. Final browser result: 48 passed, 0 skipped. Live social messaging/calendar channels are disabled; no real recipients were contacted.

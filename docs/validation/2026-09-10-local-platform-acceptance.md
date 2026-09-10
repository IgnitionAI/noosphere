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

## Follow-up: integration onboarding failure

The earlier readiness claim was too broad: it covered loading the integrations page and channel settings, but missed clicking hosted account onboarding without Unipile configured. A real user click returned 500 and replaced the entire integrations page with its error boundary.

Root cause: the Unipile adapter and HTTP layer imported two distinct `ProviderUnavailableError` classes, so `instanceof` failed. The infrastructure path now re-exports the application error. The onboarding server action returns recoverable form state; the form keeps the selected channel on failure and disables submission while pending.

Evidence: actual adapter/HTTP regression went red (500 instead of 503), then passed with the complete connected-account suite (4 tests / 56 assertions). Unipile adapter unit tests: 16 passed. Browser regression reproduced the page error; final desktop/mobile checks both passed, including preservation of the selected channel. TypeScript and architecture checks passed.

The user’s existing root `.env` already contained valid Unipile credentials. These were missing from the isolated runtime. A read-only provider check returned 200; the existing credentials were then applied only to the private local runtime configuration. The real LinkedIn hosted-onboarding request returned 201 with `awaiting_callback` and an official `account.unipile.com` URL. No recipient was contacted. Account authentication remains the user’s next step; hosted-link creation is not proof of a completed account connection or message delivery.

## Empty campaign plan status incident

The plan `30d24c0e-9205-4a5b-8e2c-779dc33fc4d9` initially contained no channel campaign. Its LinkedIn assessment had failed before Unipile configuration; the two other assessments completed without eligible identities. The page nevertheless displayed “Prête” and claimed prospect research had finished. Those labels were based on assessment completion rather than actual campaign creation.

The page now distinguishes assessment pending, assessment failed, and no activated channel, and exposes the channel failure/rationale. Three focused state tests pass; TypeScript and architecture checks validate this local UI change. This is not a new claim of full platform acceptance.

During verification, the live plan had meanwhile progressed: its LinkedIn assessment completed at 16:34:36 UTC and a channel campaign existed. The authenticated browser and API showed 40 discovered profiles, 19 retained at observation time, composing in progress, and zero contacted. The read-only diagnostic executed the current query compiler against the workspace's connected LinkedIn account and received results. It did not retry the assessment, create a campaign or send messages. Discovered profiles and in-progress personalization do not prove ICP relevance or delivery success.

## Product/service to both acquisition preparations

V3 research completion now stores a reusable offer snapshot from the submitted brief (or the completed product-truth summary when the brief description is empty). The source study is retained. Unknown commercial terms remain empty/explicitly missing and imported assertions remain hypotheses, not verified claims. Existing manually created offers are preserved.

The same completion transaction enqueues one idempotent `content.strategy.prepare` job for the highest-ranked ICP. Its offer and ICP version IDs are explicit: the worker cannot accidentally combine unrelated latest snapshots. New Outbound channel campaigns reference that offer version too. The Inbound worker creates a strategy draft; it does not activate publishing or dispatch messages. The strategy screen reports pending/interrupted preparation and refreshes while work runs.

Validation:
- Reproduced missing offer after study completion (expected one, received zero), then passed the research-to-offer-to-strategy/campaign integration scenario, including replay and matching source versions: 192 assertions.
- Editorial integration: three tests, 13 assertions, including explicit source isolation and immutable published versions.
- Unit/HTTP suite: 1081 passing tests; typecheck and architecture checks passed.
- Actual local recovery of study `77f149ee-cedb-4081-9e8f-719221d4640a`: offer version `11e9d9b9-5095-5613-a886-771216255dd9`, strategy `577d585f-e4e1-44eb-b43a-8433ad22a244`, exact ICP version `f691ee31-e0d4-40b9-8db7-3ef99aeecfe9`. One successful preparation attempt, model `gpt-5.6-luna`, four French editorial pillars. Authenticated browser observed pending preparation followed automatically by the actual draft. Autopilot stayed paused.

This is local preparation proof, not proof of LinkedIn publication, lead relevance or revenue. No VPS rollout or external communication was performed for this change. Existing completed studies are not mass-reprocessed automatically; the named local study was recovered explicitly using the same preparation operation.

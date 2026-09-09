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

## #92 in progress — pause foundation (uncommitted)

`AiTaskPauseError` preserves a sanitized provider reason, capability, request key and selected routes after `WorkspaceStructuredModel` exhausts explicit routes. Registered but unselected providers are never invoked. `job_status` gains `paused` in 0112; PostgresJobQueue.pause is idempotent and clears the lease without retry. ResearchWorker handles the pause signal before ordinary retry handling. Research executor preserves the signal; orchestrator records a failed checkpoint, pauses the run, then propagates to worker. Existing paused research branches use queue.pause where available. Console status types/filter/label accept paused.

Focused core unit tests passed (see /tmp/noosphere-92-core-unit.log; includes worker/routing/orchestrator). PostgreSQL tests/integration/paused-ai-jobs.test.ts passes: persisted pause is not leased after a worker reconnect and one simulated day; idempotent repeated pause. Current 91b disposable DB is migrated through 0112. Type checks pass after console status update.

Still required before #92 is complete: full interrupted mission + checkpoint/manual-resume integration and browser proof; authorized, concurrent/idempotent resume (preserve approvals and no duplicate effects); visible provider/model/fallback reason; current connection authorization on resumed invocations and explicit credential refresh policy; propagate pause signals through all AI-producing processors (not only research) so their catches do not convert them to retries or terminal failures. Queue.pause is optional on generic interface for old test adapters, production PostgreSQL supports it. No #92 commit/review yet. No goal completion.

Useful findings: ProductResearchApplication.resume currently checks live workspace availability; ResumeProductResearchRun reads then transitions and inserts resume key based on version, with no row-lock transaction spanning the read. A queued/running resume returns from domain resume but use-case still inserts a job — must stop that path. Research V3 can resume paused/interrupted/partial; checkpoint machinery already skips completed stages. OperatorConsole requeue has a transaction and row lock but restores associated state only for outreach.dispatch and channel assessment, so cannot assume it safely resumes every AI processor. Many runner catches can swallow/reclassify AiTaskPauseError and need evidence-driven inspection.

### #92 checkpoint — atomic research resume and full interrupted mission

Added optional repository `transitionLocked` callback port, implemented with PostgreSQL row lock + run/job/outbox mutation in one transaction. ResumeProductResearchRun uses it and returns without job/events when already queued/running. Regression forced both old reads to see the same paused version: RED showed two ProductResearchResumed events; GREEN produces one event and one replacement job. `tests/integration/paused-ai-jobs.test.ts`: 2 pass/5 assertions on 91b.

New `tests/integration/ai-mission-resume.test.ts` uses a controlled Kimi HTTP provider, actual research executor + worker + PostgreSQL. First stage completes, second hits quota, run and job pause, a newly composed worker on new DB clients does no work even after provider recovery; concurrent manual resumes finish remaining stages and first stage was invoked only once. 1 pass/34 assertions, `/tmp/noosphere-92-mission.log`, fresh `noosphere_instance_ai_92_test_20260909` through0112. This is provider-controlled integration, not live provider proof.

Actual OpenAI/Anthropic adapter fallback RED exposed fallbackAllowed=false on all new API errors. Added `allowsExplicitProviderFallback` for outage/quota/auth/model failures and use in API adapters; current instance authorization failure permits only an explicitly selected secondary. Invalid output and abort remain non-fallback. Test asserts actual adapter primary quota -> selected secondary, visible result metadata provider/model/fallbackReason; no provider invention. Types and core tests rechecked.

Remaining before #92 complete is unchanged broadly: browser resume/permissions, current pinned-route readiness at resume (ProductResearchApplication still checks live workspace), credential version refresh on authorized manual resume, persistent/displayed fallback event details, all other AI processors and scheduler/maintenance interactions, final two-axis review/commit. Initial research-only proof is not full-platform completion.

Inspection leads for next slice: content-generation.ts and content-ideas.ts catches only fail on max attempts then rethrow; add pause guard before terminal failure. evaluation-run-processor executeCase catch currently marks result failed and swallows error — must preserve pending checkpoint and propagate pause. Campaign automation/composition, channel assessment, prospect decision, conversation commands and inbound reply have outer catches that retry or mark failure; inspect and preserve pause before mutations. Prospect decision claim accepts pending/running. Conversation command skip terminal/sending states; generation pause should stay resumable pre-send. OutreachDispatch preparation catch calls #retryPreparation; that helper releases action lease to scheduled before queue retry. A pause must preserve pre-send state without letting schedulers/reconcilers create a fresh automatic job. Simply rethrowing before releasing action can later be treated as unknown execution. Audit paused statuses in liveness queries and/or task-level pause gate to prevent maintenance-induced auto-resume. Do not apply blind catch rewrites around external delivery gates.

### #92 checkpoint — content and evaluation pause propagation

Content generation and idea discovery now rethrow AiTaskPauseError before the max-attempt terminal-failure path. RED/GREEN tests proved the previous implementation called failRun at the attempt limit; corrected behavior preserves the writer checkpoint and discovery cursor. 24 content unit tests pass /43 assertions.

EvaluationRunProcessor.executeCase now preserves a pending case and propagates the pause rather than swallowing it and marking it failed. PostgreSQL RED observed a resolved process call after quota failure; GREEN preserves one completed + one pending case. Full continuous-ai-evaluation integration: 8 pass /36 assertions on isolated 92 DB, `/tmp/noosphere-92-evaluation.log`. No external effects executed. Type checks pass after these edits.

Other campaign/conversation/outreach processors, automatic maintenance interactions, resume authorization/credential refresh and UI end-to-end remain unfinished. Existing #92 requirements are not reduced to the paths already tested. No #92 commit yet.

### #92 checkpoint — prospect decisions and Setter commands

ProspectDecisionJobProcessor now propagates AiTaskPauseError before its automatic retry handler. PostgreSQL RED showed swallowed pause/retry; GREEN proves one model call, paused job, and a repeated scheduler.schedule for the same decision does not relaunch it. Full durable-prospect-decisions suite: 2 pass/14 assertions, `/tmp/noosphere-92-prospect.log`.

ConversationCommandJobProcessor previously marked a provider-paused live Setter command failed. It now resets only the pre-send claimed command from sending to scheduled, records the sanitized AI reason and propagates the pause. Generation occurs before gateway.send, so this does not relax unknown-delivery handling. PostgreSQL test proves no gateway send, resumable command state and no lease after a simulated day. Full conversation-command-dry-run suite: 2 pass/16 assertions, `/tmp/noosphere-92-setter.log`. Types pass.

Still no #92 commit: campaign automation/composition, channel assessment, inbound reply, outreach generation and paused-job liveness/reconciliation require completion plus authorized resume/credential refresh/UI/event visibility. Useful existing broad fixture for pre-send safety: tests/integration/outbound-send-safety.test.ts (campaignFixture around1043, leasedJob around1126, prepareLeasedJob around1139). That fixture is more appropriate than inventing send paths. V3 publication fixture tests/integration/v3-auto-publication.test.ts covers campaign processors. Do not assume a simple catch rethrow is sufficient for pre-send claimed actions; their state and schedulers must also remain paused.

### #92 checkpoint — pre-send generation and channel assessment

OutreachDispatchJobProcessor now releases its pre-send action to scheduled, clears its lease, stores the sanitized AI reason and propagates AiTaskPauseError before ordinary queue retry. Targeted pause test passes; both recovery reconcilers leave the paused job unleased after one simulated day, with zero sends. Full outbound-send-safety suite passes (15 tests), /tmp/noosphere-92-outreach.log. The new fixture cancels prior test-workspace enrollments consistently with neighboring tests to satisfy the active-contact uniqueness invariant.

ChannelAssessmentJobProcessor now propagates AiTaskPauseError before retry/failAssessment. RED swallowed the pause; GREEN retains running assessment/job without scheduling retry, then completes from the retained state on explicit processor reinvocation. Existing full publication scenario passes with 170 assertions. This is processor-level resumability proof, not the still-unfinished authorized manual-resume endpoint/UI.

Remaining #92 scope unchanged: composition/inbound handling, maintenance audit, pinned-route resume authorization and credential refresh, generic resume UI/events, review and commit. CampaignAutomationJobProcessor inspected: its scoring path has no direct model invocation, so no speculative pause catch was added.

### #92 checkpoint — composition and inbound pause propagation

CampaignCompositionJobProcessor and InboundReplyJobProcessor now propagate AiTaskPauseError before their ordinary retry handlers. Added RED/GREEN checks to the existing V3 publication end-to-end integration scenario: composition pause creates no outreach action, inbound pause retains exactly one incoming message and no classification, both preserve their running queue lease for the worker to pause, and explicit subsequent processing completes without duplicate messages. Ordinary non-AI retry behavior remains covered. PostgreSQL scenario passes 177 assertions, /tmp/noosphere-92-campaign-green.log; RED logs /tmp/noosphere-92-campaign-red.log and /tmp/noosphere-92-inbound-red.log.

Next central work is authorized manual resume (still absent for generic paused jobs). Existing consoleJobRecoveryDisposition currently ignores paused, and restoreAssociatedState only handles failed outreach/channel cases; do not simply expose requeue without adapting those checks. Research resume currently checks live workspace availability and must instead validate the pinned task routes; explicit manual resume needs current credential-version refresh for the same connection/provider/model, preserving revocation checks. Existing resume transaction already serializes research double clicks, but generic resume and shared context refresh still need tests and implementation. No #92 commit or release performed.

### #92 checkpoint — pinned resume policy validator (not wired yet)

New task-ai-resume-policy.ts exports refreshTaskAiPolicyForResume. It refreshes only connectionVersion from a currently ready exact connection/provider/model match; preserves pinned model, effort and ordering; permits only the paused capability's selected ready route/explicit fallback; keeps unavailable routes unchanged so invocation still fails closed. Empty snapshots cannot acquire a new environment default. It uses the existing legacy route availability helper for environment selections. Five unit tests /8 assertions pass, including revoked/provider/model mismatch and unrelated-capability refusal. Types pass before the final added test (same typed fixtures).

This helper is NOT yet connected to transactions or HTTP/UI. Next: integrate at PostgresProductResearchRepository.transitionLocked (line197, currently only Resume use case calls it) before job insertion, refreshing task_ai_contexts and new job snapshot under task lock. API repository constructed line442 of create-noosphere-api-runtime.ts, instance repository line455; ProductResearchApplication.resume still incorrectly validates live default. Console paused jobs likewise need transaction validation, state preservation and explicit UI action. Avoid claiming the helper itself delivers manual resume.

### #92 checkpoint — research resume transaction wired

createTaskAiResumePreparation now locks the durable task key (same advisory lock as job-insert trigger), validates the saved policy, refreshes exact ready connection versions and updates task_ai_contexts inside the caller transaction. PostgresProductResearchRepository receives this preparation callback and invokes it before update/job/event insertion in transitionLocked. API bootstrap wires the callback with runtime environment; ProductResearchApplication.resume no longer gates on unrelated live workspace defaults. Current invocation still enforces ready connection/version independently after commit.

RED integration resumed a missing connection; GREEN leaves run paused, then two concurrent application.resume calls create one transition and one replacement job after a ready version2 fixture appears. New job keeps original model and low effort even though current ready model advertises high; live workspace availability deliberately false to verify pinning. Two PostgreSQL tests /8 assertions pass, /tmp/noosphere-92-resume-transaction.log. Full interrupted legacy mission uses the real preparation hook and passes 34 assertions, /tmp/noosphere-92-resume-mission.log. Focused HTTP/unit and types pass.

Generic paused-job console resume, paused-job capability persistence, fallback event visibility/UI, maintenance/fanout audit, browser acceptance, reviews and #93 remain. The preparation helper is now wired for API research resumes; other direct research repository instances without callback remain compatibility/test paths and should be audited before release. No #92 commit yet.

### #92 checkpoint — console resume foundation and capability persistence

0113_ai_pause_capability (idx112/1798048800000) adds jobs.ai_pause_capability; 92 test DB migrated. Worker passes the exact failed capability to queue.pause, which persists it. Unit RED/GREEN verifies propagation, PostgreSQL reconnect verifies retained capability. Worker suite12pass28assertions.

PostgresOperatorConsole accepts the resume-preparation callback (API wired). For paused jobs it validates capability/task key, refreshes the pinned policy in transaction, requeues the same job without resetting domain state or approvals, records JobAiResumed+audit, and handles concurrent repeats idempotently via the recorded resume event. Research and MCP jobs are blocked on this generic path (research must use its dedicated checkpoint resume). Optional missing callback fails closed. JobAiResumed preserves previous reason in its payload; aiPauseCapability retained for duplicate handling. Existing ordinary dead-letter recovery unchanged.

Console UI defaults include paused, offers Reprendre, and explains AI_SETUP_REQUIRED; action notice no longer claims domain repair for a pause. Domain recovery policy marks generic pauses manual. Full console PG6pass30assertions /tmp/noosphere-92-console-green.log; HTTP/unit7pass20assertions /tmp/noosphere-92-console-http.log; types pass. Added PG test uses controlled model policy and synthetic campaign-composition job: proves identity/policy/concurrency, NOT complete domain-effects/browser acceptance. Original console fixtures and cleanup retained; test added at end to avoid diagnostics count contamination.

Still required: real processor-to-console resume integration (including cancellation/approval changes), HTTP unauthorized pause actions, UI browser test, research navigation from console, fallback-use persistence/display, maintenance and fanout audit, reviewers, full #93 migration/gates. Header currently still says Tout est sain if zero dead letters despite paused jobs; fix visible status in next UI work. No #92 commit yet.

### #92 checkpoint — cancelled outbound action and console browser proof

Extended real JIT pause integration through PostgresOperatorConsole.requeue: action cancelled while paused, two concurrent manual resumes, same job leased once, processor acknowledges cancellation without another generation or send, no duplicate lease. Full outbound-send-safety15pass73assertions /tmp/noosphere-92-outreach-resume.log. Fixture injects controlled pinned Kimi policy to validate resume and keeps delivery gateway counter zero; not a live-provider claim.

Console UI now counts paused/dead-letter interventions in its header, avoids false Tout est sain, and links paused research jobs to /w/:slug/research/:runId. New ai-pause-console.spec.ts passes desktop+mobile (2 tests), /tmp/noosphere-92-console-e2e.log: authenticated owner sees pause, unavailable pinned connection blocks resume with actionable alert, ready connection permits same-model requeue, no secret in rendered page. Browser fixture controls connection proof and inserts a paused job; it does NOT yet satisfy full interrupted-mission browser acceptance. First run failed only due to Next route announcer also having role alert; scoped alert locator corrected. No runtime/provider/product failure was masked.

Remaining #92: full research mission browser interruption/resume, fallback-use events/UI, maintenance/fanout pause completeness, review/commit. #93 still outstanding. Generic resume integration proves cancellation respected; further approval-state transitions may need coverage based on review. Current DB92 includes0113. No deployment/push/commit92 yet.

### #92 checkpoint — full mission browser acceptance

ai-research-resume.spec.ts + tests/fixtures/ai-mission-browser.ts now run an actual ResearchWorker/ResearchOrchestrator/LangChain structured-model mission against controlled OpenRouter transport and disposable _e2e DB. Fixture creates current-ready instance connection, first stage completes, second returns429 quota, run/job pause. A separate process with healthy transport cannot lease paused work. Browser follows console research link, sees quota reason, clicks Reprendre through real server action/API, then a new worker process completes9remaining jobs. No first-stage invocation in resumed process; DB confirms exactly one completed product_truth checkpoint. Desktop/mobile2pass /tmp/noosphere-92-mission-e2e.log. This is controlled provider mission proof, not real OpenRouter connectivity.

Research page now shows provider-neutral quota explanation for AI_PROVIDER_QUOTA_EXHAUSTED as well as legacy code and displays it for AI-paused runs. Fixed discovered UUID redaction bug: phone masker could corrupt canonical runId in console payload/link; exact UUID strings are preserved, sensitive keys still redacted. RED/GREEN test includes the actual failing UUID. Unit5pass10assertions /tmp/noosphere-92-uuid-green.log. Types pass before final regex-only fix; diff-check passes.

First browser attempt expected queued after resume but domain correctly uses running; expectation corrected. Later run exposed actual UUID bug, fixed and rerun green. Fixture currently leases research jobs globally by type, so run it in its reset E2E DB; previous failed test can leave work that affects following project until DB reset. Improve fixture isolation before full-suite gate if other E2E tests leave pending research jobs. No root runtime mutated.

Remaining #92: fallback persistence/provider-model-reason display, maintenance/fanout pause audit and final two-axis review/commit; then #93 migration/fullgates. No #92 commit yet.

### #92 checkpoint — durable fallback visibility and review dispatched

WorkspaceStructuredModel records successful explicit fallback through ModelFallbackRecorder (new application port), carrying only workspace/request identity, capability, primary provider/model, actual selected provider/model and sanitized failure code. No prompts, payload or output recorded. PostgresModelFallbackRecorder writes idempotent AiFallbackUsed outbox events, tied to current job/correlation via TaskAiPolicyScope.currentJobId; API immediate invocations receive their own correlation. API and worker factories wire recorder. Record failures propagate before domain side effects. Unit4pass8assertions /tmp/noosphere-92-fallback-green.log; PostgreSQL recorder reconnect/idempotent trace1pass2assertions /tmp/noosphere-92-fallback-pg.log.

Console correlation trace renders selected provider/model, reason and primary choice. Browser controlled-event fixture2pass desktop/mobile /tmp/noosphere-92-fallback-e2e.log. Full types pass. Persistence test directly invokes recorder and unit proves router-to-recorder contract; browser fixture seeds event, so these are separate layers of evidence, not a live-provider fallback mission.

Existing two-axis reviewers reactivated for #92: /root/review_setup_spec and /root/review_setup_standards. They are auditing current uncommitted diff while root must continue maintenance/fanout and task resume completeness. No review approval yet, no commit92. #93 still pending.

### #92 checkpoint — review findings and fanout/deadline fixes

Both reviewers rejected #92 for fanout resume; Spec also found expired deadline after long pause. Domain.resume now adds the paused duration to deadlineAt, preserving remaining budget rather than granting fresh budget; day-long pause and repeated resume unit passes.

Research repository resume transaction detects retained unfinished market child/finalizer jobs and restores paused queue rows with refreshed policy, preserving payload/workItemKey and identity. It skips creating a whole-stage main job when this fanout work exists. Paused research_work_items now marked paused; resume returns them pending. Fanout commitStageStarted no longer overwrites aggregate state from a stale child snapshot. Orchestrator has one central paused guard before finalizer/child dispatch (old duplicate guards removed).

New ai-fanout-resume.test.ts RED reproduced main-job replacement; GREEN proves H01once,H02twice, one finalizer join; also pauses the finalizer then resumes its same job. Combined PG4pass54assertions /tmp/noosphere-92-resume-regression.log; research unit23pass106assertions /tmp/noosphere-92-research-unit.log. First type pass found duplicate narrowed guard and readonly sort fixture issues; corrected, final type process was launched afterward (verify result before claiming). No reviewer reapproval yet.

Still inspect race between commitStageFailed setting run paused and worker queue.pause: immediate manual resume can see an executing child that later becomes paused. Also late sibling starts after pause need explicit test; skip aggregate update prevents overwrite but does not by itself prevent a provider invocation after stale read. Maintenance audit and full #93 outstanding. No commit92.

### #92 checkpoint — atomic research/job pause

ResearchRepository.commitStageFailed accepts optional PauseJobRequest and reports whether it committed the queue pause. PostgreSQL writes run/checkpoint/workitem + paused job/lease release in one transaction, rejecting stale job lease before commit. Orchestrator marks AiTaskPauseError persisted for that job; worker does not repeat queue.pause, avoiding overwriting a manual resume that happened after transaction commit. In-memory implementations return void and retain worker pause fallback.

RED fanout test observed running job after run pause; GREEN expects job already paused without separate queue.pause call. Combined PG fanout+mission2pass47assertions /tmp/noosphere-92-atomic-pause-green.log. Worker test proves persisted signal produces no subsequent pause/retry write; worker+orchestrator unit pass /tmp/noosphere-92-atomic-worker.log. Types pass before latest test addition.

Still unresolved next action: child can read running before sibling pauses, then enter commitStageStarted after pause. Skipping child aggregate update prevents overwriting pause but still permits its provider call. Need row-locked current run check at stage start, atomically pause that job if run now paused, and tell worker pause already persisted. Orchestrator currently passes no job identity to commitStageStarted; add optional lease parameter or equivalent durable boundary. Also finalizer race between entry check and commitStageStarted benefits from same guard. Tests should force stale running snapshot and verify zero invocation, paused job, correct resume of incomplete children. No final review approval/commit yet.

### #92 final validation — concurrent branches and maintenance

Late child starts now lock the current research row before starting a checkpoint; if paused, the leased job is atomically paused and JobPausePersistedError prevents another worker write. An already-running sibling ordinary failure no longer writes its stale aggregate snapshot. Child AI pauses merge the current locked aggregate and preserve the first pause timestamp/events. Extended four-child integration reproduced running instead of paused before the fix, then passed: finished H01 retained, late H03 never invoked before resume, in-flight H04 retry cannot erase H02 pause, incomplete children resume and finalizer joins once.

Automatic job outcome repair and campaign sourcing now treat paused jobs as active blockers. Outbound safety regression proves maintenance does not repair a paused pre-send action and manual resume after cancellation causes no extra AI/provider send. Full outbound suite15pass74assertions. Combined paused-job/fanout/mission PostgreSQL4pass60assertions. Final authenticated browser4pass desktop/mobile (console pause/fallback display and full controlled mission resume). Types pass; architecture602files; backend build pass. Broad unit/HTTP run1042pass plus one independently reproduced pre-existing governed-MCP adapter failure, not caused by this change. Controlled transport proof does not establish live Anthropic/OpenRouter/Codex connectivity.

Two-axis review: Standards favorable targeted review; Spec favorable after the in-flight sibling fix, no confirmed remaining blocker in reviewed #92 corrections. Final web build passed; focused research/worker/resume unit suite41pass143assertions. No push, release, deployment or issue closure. Next #93: explicit legacy task backfill, preservation/transition of environment connections and workspace settings, installation/auth/backup documentation and complete repository/Compose gates.

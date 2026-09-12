# Runtime marketing skills — local candidate

Status: held from delivery. This change does not establish production readiness or visual acceptance.

Content Strategist and Brand Guardian have been adapted from the pinned upstream source documented in `packages/infrastructure/src/content/skills/README.md`. Bun text imports embed their bodies in the worker bundle. The API build succeeds but does not contain the roles it does not execute. No global skill installation, new provider, production configuration change or publication is required.

## Local verification

- 29 targeted pipeline and generation tests pass, including routing skill bodies to the production structured-model seam while keeping the factual auditor independent.
- Type checks, architecture checks and API/worker builds pass.
- Worker bundle contains both skill bodies. Prompt versions advance for brief, writer and critic; the factual auditor version stays unchanged.

## Actual Luna calibration

The rejected carousel opened with a fictional portal-access incident, then asked generic categorization, priority, diagnosis and assignment questions. Evaluation used its captured draft, media plan, workspace context, history and evidence. Calls used the existing VPS Codex CLI Luna connection, writing only private temporary evaluation artifacts; application records and publication state were not changed.

1. Initial adapted skills: Luna accepted all seven criteria, with no issues, in 25.888 seconds. This is a failed negative-control test and is retained as evidence.
2. After giving the critic the explicit rejected example and a requirement to cite the input-to-action explanation: Luna returned readerValue=revise and substantive blockers in 28.992 seconds. It identified the decorative scenario and slides that only ask questions.

The second result is calibration on a known example, not held-out validation. It does not prove generalization, good new writing, rendered legibility or brand fidelity. The critic also offered advice about URL presentation; source access remains governed by the existing attribution rules, not an assumed LinkedIn algorithm penalty.

Private traces: `skills-rejected-critique-v1.json` and `skills-rejected-critique-v2.json` in the operator's inbound-quality release-evidence directory. They contain workspace context and are intentionally not committed.

## Remaining acceptance

Generate and inspect new Luna outputs on the real workspace and unrelated offers; include useful short posts as positive controls to detect over-rejection. Inspect the actual media at reading size. Consolidate overlapping playbook instructions if evaluation shows conflicts. Complete review and release gates before deploying. The current production Inbound pause remains in place.

## Follow-up evidence

- An independently authored short text for an unrelated web studio was accepted by Luna in 19.988 seconds. It explains how to convert a vague redesign request into an observable acceptance criterion. This tests over-rejection on one positive control; it is not model-generated production output.
- A fresh full brief/writer/auditor/critic pass on the actual workspace finished after 16 model calls and 330.004 seconds of cumulative model latency. Final readiness was false with `ungrounded_statement`; no media was produced or stored. The pipeline blocked publication correctly, but repeated rewrites and the weak result fail the quality/latency objective.
- Inspection found the brief-to-writer handoff overwrote the proposed format using the calendar mix. It now preserves the enabled editorial choice and supplies a deterministic `preferredFormat` to the brief as a tie-breaker. Regression cases first failed, then passed for both preserving a text brief against a document-heavy mix and rejecting a disabled format before persistence/writing.
- The strategy skill now selects one decision from a broad source or idea instead of reproducing its whole table of contents. The creative critic checks whether an example's observation actually supports its inference. These final prompt changes still need a fresh provider run.
- The final backend image now explicitly includes the upstream MIT notice at `/app/licenses/ai-marketing-team.txt`; an image build/inspection remains part of release verification.

The new full-run result and trace are retained privately as `noosphere-skills-new-pipeline-result.json` and `noosphere-skills-new-pipeline-trace.json`. No failed experiment is counted as acceptance.

## Focused-brief experiment and remaining renderer defect

A subsequent actual Luna run with the narrowed brief skill and editorial format selection used eight calls (163.984 seconds cumulative model latency). It failed during draft repair because standalone carousel kickers `BRANCHE 1` and `BRANCHE 2` were treated as unsourced factual numbers. No publication was created.

The numeric validator now exempts only recognized, standalone navigation labels forming an ordered `1..N` sequence, with at least two entries. Six regression cases cover valid branch/step sequences, a skipped ordinal, a percentage in the label, unrelated labels, and an unsupported metric beside valid labels. The exact rejected model candidate passes this structural validation after the fix; its factual audit and editorial acceptance are still required. The focused unit suite passes 53 tests.

Policy v4 invalidates earlier approvals. Dedicated local PostgreSQL tests verify absent-policy and explicit v3 rejection at scheduling, and v3 rejection at execution. The two affected integration files pass seven tests. These tests use separate disposable local databases, not production.

The rejected candidate was rendered separately for inspection only, producing `noosphere-skills-focused-draft.pdf`. All six pages were inspected. Pages three and four truncate substantive item copy with an ellipsis; the remaining layouts also need editorial design work. This demonstrates a renderer limitation independent of the text-only critic. The diagnostic PDF is not a stored or approved production asset and is not a delivery candidate. Fix content fitting and verify the complete rendered copy before accepting another carousel.

## Complete-copy renderer follow-up

The same captured candidate now renders checklist and comparison pages with content-sized rows, including their body and callout. All six pages of `noosphere-skills-complete-draft.pdf` were inspected; the previously clipped SLA and routing sentences are fully visible. This remains a private diagnostic draft. Process/framework layouts and the overall editorial demonstration still need work.

Document wrapping now rejects text that cannot fit instead of silently appending an ellipsis. `CONTENT_MEDIA_TEXT_OVERFLOW` enters the existing two-attempt critique repair budget: writer, factual audit, critic and render run again. Persistent overflow completes as blocked with no media; unrelated storage errors still propagate. Targeted renderer and orchestration tests pass 44 cases, including readable long rows, excessive density, successful repair, budget exhaustion and storage failure. The PDF renderer manifest is `pdf-lib-sharp-v5`. No deployment or publication was performed.

## Remaining-layout correction

Independent review found omitted body/callout fields in process/framework layouts, unchecked labels/kickers, and a possible closing-body overlap with the opaque callout. Both structured layouts now retain intro, labels, item text and callout with cumulative geometry checks. Cover callout and closing kicker are rendered; structured items on those incompatible layouts explicitly fail into repair rather than disappearing. Insight and closing also reject vertical collisions.

The expanded focused suite passes 47 cases and both TypeScript checks pass. Tests compare embedded page-image bytes when individual body, callout, kicker or label fields change; they also reject unsupported cover items and closing overlap. A fresh local render of the captured six-page candidate confirms the formerly omitted process introduction and conclusion are visible. Character-count wrapping remains a heuristic, not a proof of glyph-level fit. Native visual review is still required.

The reviewer also caught a single-item automatic layout resolving to insight and dropping the item. Automatic slides with exactly one item now resolve to checklist. A page-image regression changes the item text and verifies it survives rendering. The focused suite now passes 48 tests; TypeScript checks pass.

## Actual Luna checkpoint replay

The repaired renderer/application build resumed the saved candidate at audit using actual Luna low. Ten calls took 208.883 seconds cumulative model latency. Audit removed an unsupported claim that a small sample is sufficient. Critique then requested visible attribution, followed by a discriminating diagnostic observation. The second rewrite removed the previously added attribution: final readiness was false (`editorial_sourceAttribution`, `editorial_blocker`). No media or publication was produced. This is failed acceptance evidence, not a success.

Critique repairs now carry the bounded loop's earlier feedback into subsequent rewrites to avoid forgetting already-corrected requirements. The writer is told to preserve prior corrections. The strategist additionally requires a discriminating observation rather than treating reassignment as proof of a fault. These final changes were made after this replay and need provider re-evaluation.

After the feedback-history correction, `bun run check` passes locally: 1,156 unit/HTTP tests, 58 crawler tests, types, architecture/self-hosting checks and backend/web builds. This is local implementation evidence, not production or editorial acceptance.

## Feedback-history replay and manual rejection

The next Luna replay finished in seven calls (138.164 seconds cumulative model latency), with model readiness true and a six-page PDF rendered successfully. All six native-rendered pages were inspected: complete copy, visible source attribution in caption and closing, no observed clipping on this candidate. The private files are `noosphere-skills-history-pipeline-{result,trace}.json` and `noosphere-skills-history-rendered.pdf`.

Manual editorial assessment still rejects the candidate: the carousel primarily restates observing/interpreting/checking; its fictional reclassification does not sufficiently demonstrate how to discriminate between plausible causes. The text-only critic's pass is therefore not acceptance. Repeatedly repairing this inherited brief is insufficient; a fresh brief must be evaluated using the updated strategy skill. No production publication was created or resumed.

## Fresh brief and source availability

A fresh brief on the inherited ITSM idea finished in nine Luna calls (182.277 seconds cumulative model latency), ready according to its auditor/critic, with six rendered pages. Manual inspection confirms the two observations now distinguish missing applicable knowledge from inconsistent routing, and all six pages are readable. The candidate remains a private evaluation, not deployed/published acceptance across the full product.

Fresh source discovery exposed an independent production failure: three documentation queries returned HTTP 200, provider searxng, no results and no reported errors through the crawler. Direct SearXNG inspection showed Brave/Google CSE rate-limit suspensions and DuckDuckGo/Startpage CAPTCHA errors. Direct DuckDuckGo fallback returned HTTP 202 with an interactive challenge form. No challenges were solved or bypassed.

The local crawler now treats empty SearXNG responses with unresponsive engines as provider failures, while preserving genuine no-match results and partial successes. The existing configured fallback handles that failure; a DuckDuckGo challenge is itself a failure rather than empty success. These changes still require deployment; no search settings were changed during diagnosis.

## Search alternatives checked

Read-only SearXNG requests explicitly naming alternative engines produced either provider errors or irrelevant Bing results (WhatsApp pages for a Microsoft Learn document-permission query). They were not accepted as evidence and no engine configuration was changed. No paid search API credentials are configured in the application. Primary Microsoft Learn URLs were located independently and submitted to the product crawler for a separate reading/generation test; that test cannot establish repaired automatic discovery.

## Independent primary-source generation

The product crawler successfully read both Microsoft Learn pages (document-level access overview and security-filter pattern), retaining bounded 8,000-character excerpts. A new idea/brief/draft generated from those sources used nine Luna calls and 143.727 seconds cumulative model latency. It selected a text post about distinguishing a hidden identity field from result filtering. Final readiness was false: the critic found the promised diagnostic unresolved; the auditor also flagged the statement that a hidden identity field does not prove protected results. This latter judgement needs calibration against the supplied source and the existing rule distinguishing logical caution from empirical claims. No new publication or media was created.

The implementation commits `369218c` and `d700360` were pushed to PR 112, which was converted to draft; auto-merge was absent. Production was not changed. The prior CI result belonged to b629057 and cannot validate these new commits.

## Luna reasoning comparison

A separate experiment reran writing onward on the primary-source brief with Luna medium, without changing persisted settings. `/proc` command inspection confirmed `model_reasoning_effort="medium"`. Five calls took 112.161 seconds cumulative model latency and finished ready. The draft preserves a concrete missing-filter observation, a bounded conclusion, an authorized/unauthorized-identity test and visible Microsoft attribution in French prose. This is a promising single text case, not broad provider/format acceptance or proof of an optimal default. Production reasoning remains unchanged.

The installed Codex CLI exposes native live web search. A private capability probe retains its isolated environment and disables shell/apps/plugins/etc., enabling only web search for a public query. The JSON transformation gateway in production is unchanged. Any discovered URLs must still be validated and read through the crawler before becoming evidence.

## Native web-search capability proof

The first private search-only probe returned an empty array without a web call: JSONL reported that the code-mode host was disabled. The installed CLI includes its host binary. Enabling only `features.code_mode_host=true` alongside `web_search="live"` allowed actual web search while retaining disabled shell, commands, apps, plugins and other tools. A repeat without the experimental `standalone_web_search` flag succeeded in 9.491 seconds on Luna low. Its event log records the exact public query and a native `web_search` action; four Microsoft Learn URLs were returned. No experimental flag is required for this observed path.

This is a private capability probe, not an application integration. The production JSON transformation gateway remains tool-disabled. A production discovery adapter must remain separate from writing/audit, resolve the workspace's authorized route, enforce a deadline and result bound, record failures and model usage, reject private/invalid URLs through the existing crawler protections, and read discovered pages before using them as evidence. Empty output without an actual search must not become successful discovery.

CI run 34719353152 on d700360 completed successfully, including repository checks, PostgreSQL integrations, browser journeys, production-mode Inbound actions and dependency audits. PR 112 remains draft, with its description updated to the full scope and outstanding acceptance work.

The four native-search URLs were then passed through the unchanged `CrawlerContentIdeaSource` reader in a private adapter harness. All four returned nonempty 8,000-character bounded excerpts with canonical URLs and content hashes. The evidence came from actual crawler page reads, not model summaries or search snippets. Private artifacts: `noosphere-native-search-{events.jsonl,result.json}` and `noosphere-native-source-evidence.json`. No database checkpoint, production storage object or publication was written.

## Source-discovery execution boundary

The source-discovery port now receives the job workspace and the persisted study deadline. Crawler searches use an abort signal (maximum 30 seconds), and search plus page reading share a maximum 90-second budget bounded by that deadline. Expired global budgets have a typed result: the processor completes partial without advancing the unsaved cursor, including on its last attempt. Real provider failures before the deadline retain their retry/failure behavior. Empty extracted pages do not hide deadline expiry.

Two deterministic failures preceded the change. Eighteen targeted tests now pass, including a real local HTTP request cancelled at the source deadline, exact request JSON without the signal/workspace/deadline, cursor preservation, final-attempt partial completion, provider failure, and empty-page plus aborted-read behavior. Both TypeScript checks passed. Independent specification and standards review found the partial-vs-failed edge cases; both were corrected with regressions. This is a prerequisite for workspace-scoped native discovery, not that adapter's completed integration.

## Integrated native discovery adapter

`WorkspaceContentIdeaSource` is wired into the worker. It resolves the content-idea task/workspace policy; only its primary ready instance Codex connection uses native search, with connection version checked. Other providers and legacy environment routes retain crawler discovery. Search-only subprocesses are separate from the existing JSON writer/auditor gateway. They disable shell, apps, browser, plugins and other tools, require a completed native search event, bound output count/URL/title, and leave page reading to the crawler. Search failure is not an empty successful result. Provider authentication/quota/timeouts retain pause semantics; global study exhaustion remains partial completion. Success and failure logs carry workspace, correlation ID, connection ID and version, with no credentials.

The first adapter experiment failed with a provider `invalid_json_schema` error because `uri` is unsupported in its response schema. Reusing the existing Codex schema conversion fixed this while retaining URL validation locally; a deterministic test reproduces that constraint. The corrected adapter used the configured Luna low connection to search for support-to-human escalation documentation: 10.277 seconds, four candidate URLs, three actual crawler page extractions (two Google Cloud pages and one UiPath page). This was a private harness using the real adapter and read-only configuration repositories, with recorder writes redirected to private files; it is not proof of deployed worker persistence. A completed search event does not individually establish each final URL's membership in the native search results. Subsequent page extraction provides the documentary evidence.

One extracted UiPath excerpt contains mostly navigation. A fresh downstream idea selected only the two Google Cloud documents. This exposes an extraction-quality limitation that remains to address; nonempty markdown alone is not sufficient source quality. The downstream Luna medium writing/audit experiment is separate from production settings and remains under evaluation.

`bun run check` passes after native integration: 1,171 unit/HTTP tests, 62 crawler tests, TypeScript checks, architecture checks and backend/web builds. Independent specification/standards review findings (URL length and trace linkage) are fixed and covered. Full deployment/release gates and production canary remain outstanding.

## Native-source downstream evaluation outcome

The fresh escalation idea/brief/writer/audit/critic experiment finished after 14 Luna medium calls and 298.345 seconds cumulative model latency. Final readiness is false: `editorial_assessment_invalid` and `multiple_questions`. The critic correctly identified and requested repair of an earlier confusion between an explicit human-agent request event and generic flow failure. Its final review nevertheless quoted an absent passage in the brand-voice assessment; the deterministic check rejected it. The final post also contains a prose diagnostic question and a reader CTA, which fail the current question-count policy.

Manual review does not accept this as a ready deliverable: the broad opening about silence and escalation still overstates what the vendor event documentation establishes. This is failed quality evidence even though source discovery and document reading succeeded. Preserve the final candidate as a regression for stale critic citations, policy consistency around diagnostic questions and reasoning that exceeds a source's narrower claim. Private artifacts: `noosphere-skills-secondary-pipeline-{result,trace}.json`, `noosphere-workspace-native-{record,evidence}.json`. No publishing or persisted model-setting change occurred.

## Bounded critic-citation repair (2026-09-13)

Schema-compliant assessments with missing or non-verbatim public excerpts receive one critic-only repair on the unchanged draft. The repair input provides a catalog of current public passages and omits the rejected assessment to avoid anchoring on its paraphrases. Persistent invalid assessments remain blocked and cannot trigger a writer rewrite to accommodate the critic's own error. Malformed schema output remains outside this narrowly scoped repair.

Fifty-four focused tests, both TypeScript checks, architecture validation and diff checks pass. Independent specification and standards reviews found no remaining blockers in this scope. The preceding native-discovery commit b3a4811 also passed full CI run 34721107150; that run does not validate this newer repair.

A private replay injected the captured invalid initial assessment, then made one actual Luna medium repair call using the passage catalog: 20.592 seconds, no invalid citation criteria, unchanged post. An earlier version retaining the rejected assessment failed once and passed on a repeat. These observations validate a bounded mechanism on one case, not statistical reliability or editorial quality. The post remains manually rejected for reasoning beyond its source and also fails the existing multiple-question policy. No production checkpoint, publication or persisted model-setting change occurred. Private evidence: noosphere-critic-repair-evaluation.json, explicitly marked replayedInitialAssessment with the actual call trace.

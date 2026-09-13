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

## Scoped-strategy fresh-brief trial (2026-09-13)

The strategist's general instructions no longer contain the category/reassignment/delay example that had leaked into an unrelated draft. They explicitly constrain vendor-specific findings to their documented scope and phrase prose diagnostic checks as statements when the ending already asks a reader question. Brief and writer prompt versions advance to v7 and v10. Readiness policy and critic/auditor requirements are unchanged.

A new brief and complete downstream generation reused the captured escalation idea, evidence and workspace context, with actual Luna medium calls and private in-memory persistence. It did not repeat discovery or idea selection and did not change production settings. Two initial harness bundles failed to load local renderer dependencies before any model call; the corrected bundle embeds JavaScript dependencies and resolves only the Linux native image packages from the container.

The successful execution took 13 model calls and 312.122 seconds cumulative model latency. Automatic readiness is true. Manual editorial acceptance is still refused: vendor event identifiers and long quotations dominate the post, one quotation ends by announcing an example that is not shown, and the operational recommendation is too thin for the managerial audience. The brief also contained a malformed final fragment. Intermediate critique correctly blocked an unexplained decision but does not establish sufficient final quality. This is a technical pass and an editorial rejection, not an accepted deliverable or evidence of acceptable generation latency. Private artifacts: noosphere-skills-scoped-pipeline-result.json and noosphere-skills-scoped-pipeline-trace.json. No publication or production record was created.

Full local bun run check passes: 1,174 unit/HTTP tests, 62 crawler tests, TypeScript and architecture checks, backend and web builds. Both independent reviews found no actionable issue in the narrowly scoped skill/version diff. Further work must address angle selection, brief completeness and final editorial evaluation; repeated prompt tightening alone has not met acceptance.

## Treatment selection and independent editorial context (2026-09-13)

The playbook contradicted the strategist's multiple editorial forms by requiring a worked diagnostic and application example in every brief. It now chooses a supported distinction, observation, tradeoff or method, requires a complete concise angle, and permits faithful public paraphrase rather than making the claim ledger a reason to quote source prose. Critic criteria explicitly cover audience-appropriate technical detail and unfinished quotations. Brief/writer/critic prompt versions are v8/v11/v9.

The critic receives current draft, evidence, strategy, business context, brand and recent public history. It no longer receives the upstream brief, idea, run instructions or favorable factual audit. The independent factual gate remains unchanged; only editorial review input is separated. Citation repair uses the same context boundary. The port now explicitly requires brandKit/evidence. A red regression exposed the original context leakage, then passed; both reviewers also caught and confirmed correction of the missing port fields. Full local check passes 1,175 unit/HTTP tests and 62 crawler tests, types, architecture and builds.

Actual Luna medium controls remain mixed: the previously rejected scoped-generation post passes with the revised instructions both before and after removing upstream context. The independently authored web-studio positive control also passes. Therefore the context boundary is structurally verified but has not demonstrated improved detection on this negative case. Do not claim reliable editorial approval from these tests.

A fresh brief and generation on the same saved escalation idea/evidence used 15 actual Luna medium calls, 344.636 seconds cumulative model latency. Automatic readiness is true. An intermediate critique did identify unexplained qualification and audience-inappropriate implementation identifiers. Final copy still asks the reader to establish whether the flow can qualify the request without explaining the operation, and ends with a large technical documentation paragraph. Manual acceptance remains refused, including latency. No idea discovery was rerun; no publication, model-setting or production checkpoint was changed.

The next investigation is upstream source-to-idea suitability: documentation of API handoff events does not establish a general support triage policy, yet the saved idea bundles human request, flow failure and specialist need into one decision rule. Repeated downstream rewrites preserve this unsupported editorial premise. Inspect actual discovery query construction and idea selection before adding further writer constraints. Private artifacts: noosphere-skills-treatment-pipeline-{result,trace}.json; noosphere-critic-treatment-{with-brief,evaluation,positive}.json.

## Offer/ICP context at idea selection (2026-09-13)

Discovery previously supplied only the editorial strategy summary to idea selection; offer/ICP source versions were loaded later for writing. Discovery now joins the offer/ICP versions pinned by the strategy with workspace equality and forwards the same shared business-context shape into both model paths. Strategy and business context enter the request and trace hashes. The v2 idea prompt treats positioning separately from factual evidence and requires an angle within what the supplied sources support for the audience; irrelevant or navigation-only sources may produce no ideas.

The forwarding regression failed before the change. Seven unit tests then passed. A dedicated disposable local PostgreSQL integration passed 17 assertions, including new offer/ICP versions not replacing the pinned versions and another workspace being denied. Full local check passed 1,176 unit/HTTP tests, 62 crawler tests, types, architecture and builds. Both independent reviews found no blocker in this change.

One actual Luna medium selection call using the saved real workspace context and previously extracted pages returned a single angle about specifying a handoff trigger/message/destination, explicitly excluding unsupported confidence/triage criteria. It selected the two Google documents and excluded the navigation-heavy UiPath extraction. This is a private model harness, not deployed discovery-worker persistence or a fresh web search.

Fresh downstream generation from this idea took 16 actual calls and 419.457 seconds cumulative model latency. It finished blocked by too_long and multiple_questions. An intermediate critic asked for criteria identifying uncertainty even though the idea deliberately limited itself to handoff preparation; this forced subsequent drafts toward an unrelated invented diagnostic. Thus the narrower idea is progress, but final editorial quality and latency remain rejected. Next: prevent critique from substituting the whole strategic pillar for the post's actual public promise, and validate on several editorial forms.

The trial exposed a deterministic false question count: URL parameters such as ?hl=fr counted as reader questions. The counter now excludes HTTP(S) URL text but stops at Markdown closing delimiters. The new test failed before the fix; a reviewer found a second boundary defect hiding genuine questions after Markdown links, reproduced it and confirmed its correction. Twenty focused tests (45 assertions), types and diff checks pass after this small follow-up. Re-evaluating the exact saved candidate now remains blocked by too_long alone; no new model call or approval occurred.

Private evidence: noosphere-idea-business-context-evaluation.json and noosphere-skills-context-pipeline-{result,trace}.json. No publication, production checkpoint, deployment or persisted model-setting change occurred.

## Review the public reading promise (2026-09-13)

The critic now receives only strategy audience and voice, not its collection-wide pillars or suggested CTAs. It retains business context, evidence, brand and public history. The shared guardian replaces domain-specific calibration examples with form-aware criteria: diagnostics need an input-to-action explanation; distinctions need a practical implication; preparation guidance must explain choices and consequences within that stage rather than decide whether to start another process. All forms still reject empty categories and unsupported implications. Writer/critic versions advance to v12/v10.

A regression failed when the collection pillars leaked into the critic and passes with the reduced context. Full local check passes 1,177 unit/HTTP tests, 62 crawler tests, types, architecture and builds. Both independent reviews found no actionable issue, without claiming model reliability.

Three actual Luna medium reviews each used one call and valid exact citations. On the captured preparation draft, the critic now asks for shorter, audience-appropriate technical detail rather than an unrelated uncertainty-detection rule. An independently authored useful preparation example passes. Its hollow checklist counterpart fails readerValue/coherence, although its additional source-attribution objection is questionable for proposed advice and remains a calibration limitation. Authored controls test critique only, not production generation or factual audit.

A fresh brief/writer/audit/critic execution from the narrowed idea took 12 calls and 307.224 seconds cumulative model latency. The critique stayed on the transfer-preparation topic and requested a missing-element example. Final readiness is false solely because body length is 1,581 characters versus the 1,500-character limit. The final text still devotes substantial space to vendor implementation details; no broad editorial acceptance is claimed. No publication, production checkpoint, deployment or persisted model-setting change occurred.

Next investigation: enforce the generated writer's length contract early enough to avoid exhausting the editorial repair budget on a draft that still exceeds the deterministic limit, without tightening the schema used to read historic stored drafts. Continue checking audience value and representative formats. Private artifacts: noosphere-critic-scope-evaluation.json and noosphere-skills-promise-pipeline-{result,trace}.json.


## Writer length preflight and remaining editorial false positive (2026-09-13)

Newly generated drafts are checked against the same 1,500-character body limit before persistence and factual audit. An overlength first candidate uses the existing second writer attempt with exact measured length, a request to rewrite rather than truncate, and synchronized claim-ledger instructions. A second oversized candidate fails before either save or audit. The historical 3,000-character read schema remains unchanged, as do resumed audit checkpoints and the final readiness gate. The two-attempt limit applies per writer helper invocation; this does not reduce the whole job to two calls. Writer prompt version is v13.

The two new regression cases failed before implementation and pass afterward. The focused set passes 58 tests; full local `bun run check` passes 1,179 unit/HTTP tests, 62 crawler tests, types, architecture and builds. Both independent code reviews found no blocker within this boundary.

A private replay injected the previously captured 1,581-character writer result without a model call. One actual Luna medium rewrite reduced it to 1,365 characters before audit. The subsequent pipeline used 13 actual model calls in total, 310.789 seconds cumulative model latency, ending with a 1,400-character post and automatic readiness true. This is a replay from saved brief/evidence, not fresh discovery or an end-to-end production run.

Manual editorial acceptance remains refused. The fictional billing example merely repeats that the procedure contains the listed elements, without showing concrete values, a mismatch or a useful consequence. Vendor identifiers and two long documentation links dominate the remaining space. The critic nevertheless passes every criterion. Keep this as a negative evaluation case: passing schema, length, factual audit and model critique does not establish audience value. Latency remains unacceptable for this single text result. Private evidence: `noosphere-skills-length-pipeline-{result,trace}.json`. No publication, production checkpoint, deployment or persisted model setting changed.

UI UX Pro Max was also consulted for presentation. Its local package is oriented toward mobile application interfaces; its generated glass/animation suggestions do not fit static editorial assets and were not adopted. Its relevant readability checks (text contrast, typographic hierarchy and spacing) supplement visual inspection, not editorial or factual approval. Workspace brand identity remains authoritative.


## Circular demonstration calibration (2026-09-13)

The guardian now requires the readerValue assessment to identify what the public explanation adds beyond its opening. A fictional example that merely says the recommended steps were followed is not a demonstration. The test applies to claimed demonstrations; short distinctions may instead explain different practical implications. Prompt versions advance to writer v14 / critic v11 because both consume the skill. No schema or deterministic acceptance gate changed.

Actual Luna medium critique of the captured 1,400-character post now rejects readerValue and coherence. An independently authored concrete preparation example passes every criterion, while an authored hollow checklist fails readerValue/coherence. The captured case used two actual calls, including citation repair; each authored control used one. The first instructions prompted an unnecessary request for actual anonymized customer data. A standards reviewer also identified ambiguity in telling the critic to remove the example mentally. The final wording instead compares the opening with what the example adds and expressly permits clearly labeled fictional demonstrations without requiring real customer data.

With the clarified wording, another real critique still rejects the captured post (two calls, including citation repair). A new short distinction without a scenario passes readerValue and coherence in one call, but is not approved overall: the critic flags missing attribution and the workspace's source/voice requirements. This demonstrates only that the new reader-value test does not universally require a scenario. It is not a fully accepted positive post. All terminal assessments have valid current citations. These bounded controls do not establish reliable editorial evaluation across topics or acceptable generation latency.

Both code reviews found no blocker in the final scope; the optional wording concern was addressed. Full local `bun run check` passes 1,179 unit/HTTP tests, 62 crawler tests, types, architecture and builds. Prior CI on 8ec64cc completed successfully; c13cd6b was pushed and its CI is running. Private artifacts: `noosphere-critic-demonstration-evaluation.json` and `noosphere-critic-demonstration-clarified.json`. No publication, production checkpoint, deployment or persisted model-setting change occurred. Next acceptance work must include fresh generation and unrelated topics/formats rather than only critique calibration on this source pair.


## Access-control carousel and page-count contract (2026-09-13)

A fresh brief and downstream generation reused the saved Microsoft Learn security-filter source and its Azure AI Search idea, with the actual workspace context and an isolated document-format override. It used Luna medium, writer v14 / critic v11, private in-memory persistence and private rendered output only. This did not rerun source discovery or idea selection.

The execution took 14 actual model calls and 425.165 seconds cumulative model latency. The first writer needed an unsourced-number correction. A subsequent draft passed editorial readiness but failed rendering: replaying that exact draft through the local deterministic renderer reproduced `CONTENT_MEDIA_TEXT_OVERFLOW`. Further writer/audit/critic passes did not complete the deliverable. Final readiness is false (`editorial_brandVoice`, `editorial_blocker`) because the post retains defensive wording about not proving IgnitionRAG capability. It still contains six slides. No final PDF is accepted. Private evidence: `noosphere-skills-access-carousel-{result,trace}.json`.

Inspection also found inconsistent page-count instructions: the domain and brief allow 3–9 pages, while the writer demanded 5–8 and the critic demanded two distinct middle layouts. These quotas could force padding for a short distinction. Writer v15 now chooses the fewest complete pages within 3–9; critic v12 accepts a substantive single middle page and still rejects repeated or decorative pages. Cover, closing, evidence, reader value and actual rendering gates remain intact. Both independent reviews found no blocker; full local `bun run check` passes 1,179 unit/HTTP tests, 62 crawler tests, types, architecture and builds. The completed v14 trial is not a validation of v15.

CI on c13cd6b completed successfully. Next validation: fresh writing under the aligned page-count instructions and early detection of actual text-fit failures before spending audit/critique calls. Source-scope wording also needs to remain natural without asserting unsupported product suitability. Production was not deployed, published to, resumed or reconfigured.


## Document fit before audit (2026-09-13)

Every newly written document now passes the same deterministic renderer, using its workspace logo, before draft persistence or factual audit. A text overflow reuses the writer helper's existing second attempt and existing media-overflow feedback. A persistent overflow stops before save/audit; no additional model retry budget was introduced. All four initial/repair writing paths use this check. Historical audit/critic checkpoints retain the final render gate.

The preflight performs a local PDF render and logo read but no object-storage write and no generative video call. Rendering is intentionally repeated after final readiness before storing the approved media, so no stale preview can be published after a rewrite. This adds local rendering work; it does not certify visual quality or alter editorial/factual criteria.

Two order-of-operations regressions failed before implementation, then passed for corrected and persistent overflow. Producer tests cover successful/rejected previews never stored, the supplied logo passed to the renderer, and no generative-video invocation. Full local `bun run check` passes 1,184 unit/HTTP tests, 62 crawler tests, types, architecture and builds. Both independent code reviews found no blocker.

A bundled private replay in the actual API container used the exact first editorially accepted draft from the failed Azure carousel and the real renderer/logo. The first captured writer return triggered layout failure; the second intercepted write received `CONTENT_READINESS_BLOCKER: media_text_overflow`. The harness deliberately stopped there with `EXPECTED_EARLY_LAYOUT_REPAIR`: zero actual model calls, no checkpoint, audit, critic or object write. This proves early routing on the real rejected artifact, not a newly generated accepted carousel or a latency measurement of the full pipeline. No production deployment, publication or settings change occurred.


## Located overflow and ordered item labels (2026-09-13)

Fresh brief/writing on the saved Azure idea/evidence with document preflight stopped after three actual Luna medium calls (81.424 seconds cumulative model latency), before any audit. The repaired writer introduced process-item labels `1 — Identité` and `2 — Résultat`, which the numeric grounding check incorrectly treated as unsupported measurements.

Numeric checking now recognizes a complete local 1..N sequence of structured item labels with an explicit list separator. Skipped sequences, percentages and numbers remaining inside labels or item text still require grounding. Public text returned for citation validation is unchanged. A red regression exposed the dash case; six cases pass after the fix, and the exact captured candidate now passes numeric grounding.

The renderer also preserves its existing overflow code while adding the affected page number and resolved layout. The writer receives this bounded detail instead of a generic whole-document repair request. A renderer regression failed before implementation; actual replay of the captured candidate identifies page 5, layout closing. Other renderer errors still propagate unchanged. Both independent reviews found no blocker; full local check passes 1,190 unit/HTTP tests, 62 crawler tests, types, architecture and builds. A small per-slide computation cleanup was subsequently checked with focused tests and TypeScript.

A private replay injected that candidate as the first writer result without a model call. One real rewrite then passed the layout preflight. Audit and two critic calls followed: four actual calls, 109.744 seconds cumulative model latency. Final readiness remains false (`editorial_assessment_invalid`, `editorial_audienceRelevance`, `editorial_blocker`). The final critic cites `Le champ d’identité...`, while the public text contains `... où le champ d’identité...`; capitalization makes the citation invalid. It also requests a clearer technical-support connection for the fictional HR-document example. These are recorded findings, not an accepted deliverable or a full fresh generation latency. No media was finally stored.

Private artifacts: `noosphere-skills-access-preflight-{result,trace}.json` and `noosphere-skills-access-repair-{result,trace}.json`. CI on 0d16fd5 passed. No production deployment, publication, checkpoint or settings change occurred. Next work: inspect the rendered candidate privately and resolve citation accuracy and the audience linkage without weakening the final evidence or editorial gate.

## Native PDF readability corrections (2026-09-13)

Private rendering of the blocked five-page candidate in the actual API container, using the configured brand and logo, revealed two presentation defects: the cover's decorative lime circle crossed the white callout, and process labels repeated the number already drawn in their badge. The renderer now omits those cover circles and removes only an ordinal prefix matching the current badge. Other numbers and the original public text remain intact. PDF and shared motion-graphics renderer manifests advance to v6 and v2 respectively.

All five original pages were visually inspected. The corrected native cover and process page were inspected again: the callout sits on navy and each process step has one visible ordinal. Private artifacts are `noosphere-access-private-review.pdf` and `noosphere-access-private-fixed.pdf`. These renders used local container files rather than object-storage writes; no model call or production checkpoint was created. No video was rendered for this visual acceptance.

Full local `bun run check` passes. Both independent static reviews found no blocker in this bounded diff. CI on b6c8a9a was still running at this check; this local validation does not establish CI or release acceptance for the visual changes.

The PDF remains blocked from publication: the recorded critic citation mismatch and audience objection are unresolved, and manual review still finds repeated explanation across the five pages. Better contrast is not editorial acceptance. No production deployment, publication, resumption or persisted settings change occurred.


## Exact model citation choices (2026-09-13)

The critic's model-facing schema now enumerates exact passages from current public body/media copy. It keeps the existing persisted assessment shape, verdicts, factual audit and final readiness validation. Passages from historical posts, sources or internal instructions are not choices. Long historical paragraphs use overlapping windows of at most 1,500 characters; when public copy contains short nonempty lines, full-text windows retain their contiguous multiline context. Critic prompt version advances to v13. No writer repair or additional retry budget was added.

A private prototype used actual Luna medium on the blocked access carousel and the previously captured hollow preparation post. Each needed one call with valid citations (25.340 and 34.454 seconds). The carousel received all passes; the hollow post was rejected for readerValue and coherence. The prototype's success therefore concerns citation validity, not reliable editorial approval.

The implemented model adapter was then exercised without the prototype schema override on the same two saved drafts. Each again used one real Luna medium call with valid citations (26.994 and 49.853 seconds). The hollow post remained blocked for readerValue/audienceRelevance; the carousel again received all passes despite the manual repetition objection. This is critique-only replay, not fresh generation, media acceptance or a latency benchmark. Private artifacts: `noosphere-critic-passage-enum.json` and `noosphere-critic-passage-native.json`.

The public-agent regression first failed because changed-case and absent citations were accepted by the model schema, then passed with exact choices while preserving revise verdicts. Both reviews identified a short-line edge case before commit; a second red-green regression now covers multiline short copy and the last words of a historical long paragraph. That final catalogue expansion was tested locally after the real replay; it is not a separate live-model result. Both reviews subsequently found no remaining blocker.

Full local `bun run check` passes (unit/HTTP tests, crawler tests, types, architecture and builds). CI on b6c8a9a completed successfully. No production deployment, publication, checkpoint write, resumption or persisted model change occurred. Reader-value reliability, representative generation across formats/topics and latency remain open acceptance requirements.


## Provider-compatible passage references and progression comparison (2026-09-13)

The first follow-up on the final multiline catalogue failed before model output. A captured provider diagnostic explicitly rejected newline literals in the structured-output enum. The generic classifier misreported authentication because the CLI output also contained that word; `codex login status` still reported a ChatGPT login. No login or persisted configuration was changed.

The model now selects bounded passage IDs from a `{ id, text }` catalogue instead of returning literal excerpts. Both routed and direct LangChain invocation validate the IDs and resolve them back to exact current public text before recording or returning the unchanged persisted assessment contract. Multiline strings remain in the input, not enum literals. Unknown IDs fail validation; reasons, revise verdicts and blockers are preserved. Critic prompt v14 identifies this wire-contract change. Explicit provider schema errors are classified as output errors, without retry or fallback, rather than authentication failures. Other generic CLI error classification remains unchanged.

Public-agent tests cover exact decoding, multiline passages, historical long tails, rejection of unknown IDs and absence of newline enum literals. A gateway regression reproduced the misleading authentication classification before the fix and now passes. Both independent reviews found no remaining blocker. Full local check passed 1,193 unit/HTTP tests, 62 crawler tests, types, architecture and builds before the final removal of the ineffective prompt addition described below; 33 focused tests pass afterward.

A proposed guardian extension asked the critic to identify the distinct contribution of every middle carousel page, allowing cover/closing summaries. Private actual Luna medium trials used the captured five-page carousel, an authored four-page reduction, and an authored duplicate-middle-page negative control. All citations were valid in one call per case (25.671, 23.136 and 19.167 seconds). Both original/reduced versions were approved; the duplicate control was rejected for coherence.

A further actual baseline critique removed that extension while retaining the new passage-ID transport. It also rejected the duplicate page in one call with valid citations. No incremental editorial benefit was demonstrated, so the proposed skill extension was removed rather than added to runtime prompts; writer remains v15. These are critique-only controls, not generated deliverables, factual audits of the edited variants or acceptance of the original carousel. Private artifacts: `noosphere-critic-page-progression.json` and `noosphere-critic-page-baseline.json`.

The initial enum implementation's local checks were insufficient to establish provider compatibility; the real replay exposed and corrected that gap. Editorial quality and latency remain open. No production deployment, publication, checkpoint write, resumption or persisted model-setting change occurred.


## Closing credits and caption/media ledger alignment (2026-09-13)

A fresh brief and writer execution from the saved Azure idea/evidence (discovery was not rerun) stopped before audit after three real Luna medium calls: 13.931 seconds for the brief, then 40.962 and 28.134 seconds for two writer attempts. Both generated a source-credit item in the closing slide. The renderer rejected all closing items unconditionally; the second writer shortened the callout but retained the useful source credit and failed again. This was a real failed generation, not a completed document.

Closing items now render below the body and above the callout with full-copy wrapping and cumulative height checks. Overlong copy still fails with its slide/layout location. PDF renderer manifest advances to v7; video scenes have no items and retain their manifest. The captured second draft now renders in the actual API container with the configured brand/logo. Its private four-page PDF is `noosphere-access-closing-credit.pdf`; the final page was visually inspected at native output and shows the full source title with no overlap or clipping. This preview has no editorial approval.

The domain already checks claims against body and visible media together, but writer instructions still required every claim to be repeated in body. Writer v16 aligns both initial and repair instructions with the existing public-copy contract; no factual gate or persisted schema changed. This permits complementary caption/slide copy but does not prove that the model uses that freedom well.

The closing-credit regression failed before implementation, then passed for rendered presence (changed embedded page image) and rejection of excessive copy. Both reviews found no blocker. Full local check passes 1,194 unit/HTTP tests, 62 crawler tests, types, architecture and builds. CI on 33b8209 completed successfully. A private replay now continues the captured draft through audit and critique using the corrected renderer; its terminal result is recorded separately below. No production deployment, publication, checkpoint write, resumption or persisted model-setting change occurred.


The resumed captured draft used six actual Luna medium calls totaling 160.970 seconds (three audits, two writer repairs, one critique). Final readiness is false: `ungrounded_statement` and `multiple_questions`. The auditor still identifies two paraphrased factual statements absent from the ledger; the body asks both whether the query contains the identity filter and where identity intervenes in the next review. The final copy remains technical and includes a defensive product disclaimer. No final media was stored. This replay is additional to the initial three-call failed generation; it must not be represented as a single successful 2m41s end-to-end run.

No media-only ledger claim appeared in this bounded repair, so aligning the prompt has not demonstrated reduced caption duplication. Keep factual coverage, source/angle selection, reader value and repair latency as outstanding work. Private evidence: `noosphere-skills-access-current-{result,trace}.json` and `noosphere-skills-access-resumed-{result,trace}.json`. The private credit PDF demonstrates the rendering correction only, using the captured pre-audit draft.


## Knowledge-management topic and source-selection probe (2026-09-13)

A fresh private text-only trial used the Consortium for Service Innovation article [Capture and Create Aren’t the Same](https://www.serviceinnovation.org/capture-and-create-arent-the-same/), manually located and then read through the actual CrawlerClient (6,174 characters). The real idea generator received the pinned business context and source evidence; its highest-priority idea continued through fresh brief, writer, factual audit and critic. The format override and Luna medium route existed only in the private harness. Production repositories were read for context, while generation persistence and recording were in memory/private files.

The terminal readiness result is true, with no blockers: nine model calls totaling 177.257 seconds, including idea generation (8.832 seconds). Brief-to-critique model time was 168.425 seconds, including three writer attempts and three audits. These sums exclude crawler and orchestration time and are not wall-clock latency measurements. The first audit identified four uncovered statements, the second one; the third reported none. The critic passed all seven criteria with resolved current-text citations. No document or video was rendered for this text-only trial.

Manual reading finds a relevant operational distinction between capturing ticket context and creating a new knowledge article, without an invented product-performance claim. However, the ending repeats the distinction and asks a broad friction question; KCS is not expanded and the attributed source has no clickable URL in the public body. Automated readiness therefore does not establish the desired editorial finish, representative format coverage, or reliable first-pass generation. Private artifacts: `noosphere-skills-kcs-{result,trace}.json`.

A separate actual WorkspaceContentIdeaSource trial used the unchanged baseline query derived from the support audience and the incident-friction pillar, limit three, Luna medium. Native search took 10.721 seconds and returned a CERT-FR contact page, an ALE support portal, and an Académie de Nantes educational PDF. The crawler returned evidence for the first two (2,871 and 8,000 characters); the private recorder does not establish why the third location produced no evidence. The first two locations do not by themselves explain knowledge retrieval in a support workflow. This one-query probe is not a full queued discovery run, and the manually selected KCS article does not prove that automatic discovery would find it.

A private comparison now exercises the same query with additional source-selection guidance: prefer substantive methods, examples, tradeoffs or findings; disambiguate using audience/task context; do not fill slots with contact/login/service landing pages. This changes only the private process input, not tracked runtime prompts, settings, checkpoints or deployment. The comparison result is recorded below when terminal. Private baseline artifacts: `noosphere-friction-discovery{,-trace}.json`.

The selection-guidance comparison completed. Native search took 18.117 seconds and returned a France Compétences activity export, its RNCP certification page, and a Réseau Canopé support job-description PDF. Only the RNCP page was returned as crawler evidence (8,000 characters). This does not demonstrate an improvement in editorial source relevance; the extra prompt text is not adopted. Private artifacts: `noosphere-friction-substantive-discovery{,-trace}.json`. A further private probe keeps the runtime search prompt unchanged and supplies a manually rewritten English query naming the support knowledge-management workflow. That probe is a diagnostic of query formulation, not an implemented automatic planner.

GitHub Actions run 34727024898 on 0737c93 is now terminal successful; the returned jobs list contains `bun run check`. This records that workflow result, not proof of every release gate, production deployment or live acceptance.

The manually rewritten-query probe completed with the unchanged runtime search prompt. Native search took 9.616 seconds and found the KCS Practices Guide technique “Capture the Requestor's Context”, a ScienceDirect technical-support knowledge-management paper, and the JMIS article “The Role of Knowledge Repositories in Technical Support Environments: Speed Versus Learning in User Performance”. The crawler returned the KCS technique (4,295 characters) and the JMIS article abstract (2,100 characters), both directly about the requested workflow. The abstract is from 2005, has encoding artifacts, and is not full-paper evidence; it must not support current performance claims or unavailable methodological details. The third location's read outcome is not established by this private trace.

This comparison changes both wording specificity and language, and the manually written query was informed by the already-read KCS source. It cannot attribute improvement solely to English or prove a generic automatic query planner. It does provide a concrete next test: generate bounded workflow-specific queries from arbitrary pinned audience/pillar/business context, without hardcoded domains or KCS topics, then compare actual retrieved evidence across multiple pillars/offers before adopting runtime changes. Private artifacts: `noosphere-friction-query-discovery{,-trace}.json`. No production prompt, model setting, publication, deployment, checkpoint or object-store write was made in these probes.


## Native query reformulation from editorial intent (2026-09-13)

The bounded private prototype now asks native search to interpret the supplied audience/pillar text as editorial intent, identify the concrete activity or decision, and formulate concise practitioner searches. It permits complementary wording/languages without changing the audience's problem or prescribing source domains. Unlike the earlier ineffective selection-only addition, this instruction explicitly changes how the search query is formed.

Three actual Luna medium cases completed with web-search events captured and actual crawler evidence:

- The original support knowledge-friction query returned the JMIS abstract (2,100 characters), rather than contact/support landing pages. Native search also located a ScienceDirect paper and a KCS PDF, but neither was returned as evidence. The 2005 abstract remains limited evidence; this is one favorable comparison, not a repeatability benchmark.
- The existing support-escalation pillar returned Zendesk and Intercom documentation with substantive escalation configuration text in their 8,000-character excerpts, plus a KONE customer-service page whose excerpt is largely navigation and images. Product-specific settings cannot establish universal support policies or IgnitionRAG capabilities.
- An independent synthetic restaurant-waste brief returned a University of Surrey record containing the abstract of a 2021 qualitative exploratory study comparing chain and independent restaurants (5,958-character excerpt including cookie text). It is relevant to measurement practices, but does not provide the detailed measurement protocol or full-paper evidence.

The private wrapper captured actual search events: reformulations included practitioner terminology and complementary searches. Prototype artifacts are `noosphere-query-planning-{results,trace}.json` and `noosphere-query-planning-events-{0,1,2}.json`. The prototype recorder inherited v1; it used the proposed instruction through a private runner override, not deployed v1 behavior. The tracked implementation now carries the same wording as separate lines and advances the recorder to `noosphere-native-source-discovery-v2`.

Existing isolation, result-count/deadline bounds, configured route/model, actual web-call requirement, crawler read, and failure/pause behavior remain unchanged. Seventeen focused native-search/workspace-source/crawler-source tests pass (75 assertions). No test claiming to assess semantic quality by matching prompt strings was added. Both independent static reviews found no blocking standards or specification issue. A fresh private discovery-to-text-generation run now exercises the actual implementation, without a prompt override or manually supplied source, using the escalation pillar; its terminal result must be recorded separately. The synthetic restaurant case is discovery-only, not a generated deliverable or configured customer workspace.

The results support a bounded source-search improvement, not overall Inbound acceptance. Source extraction, relevance consistency, first-pass drafting, rendered deliverables, alternative provider paths and production canary remain outstanding. No production setting, checkpoint, publication, deployment or object-store write occurred.

Full local `bun run check` also completed successfully for the query-reformulation change. Inspecting the individual steps (rather than only the job name) of CI run 34727024898 on 0737c93 confirms successful PostgreSQL integration tests, browser journeys, production-mode Inbound actions and both dependency audits. The same steps are successful in 34726210364. Neither prior-head result establishes the new head's CI or release-image gates.

The fresh implementation trial completed without a prompt override or handpicked source. The actual native v2 search on the escalation pillar found Microsoft Dynamics 365 Contact Center transparency documentation, Amazon Science contact-complexity research and a Vrije Universiteit Amsterdam record for “Hold on, I’ll connect you to a human agent”. The real idea generator selected an escalation-rule angle using the pinned offer/ICP. The full private text-generation chain ended ready with no blockers and no uncovered statements.

There were 12 model/native-search calls totaling 253.619 seconds: one native search, one idea generation, one brief, four writer invocations, three factual audits and two critiques. This excludes crawler/orchestration overhead. One writer repair exceeded the 1,500-character bound (1,609) and was regenerated; the first audit flagged an opening missing from the opinion/claim coverage, and the first critic requested removal of “Mon analyse” to match the configured voice. The second critic passed. Thus automatic discovery-to-ready text is demonstrated for this case, but first-pass reliability and latency remain unsatisfactory.

The final text includes a fictional invoice dispute, distinguishes a general FAQ from account-specific evidence, and links its Microsoft and research attributions. Manual review still objects to “Il faut alors transmettre le dossier”: the missing account-specific evidence identifies uncertainty, but the example does not establish that immediate human transfer is always necessary instead of another authorized verification. Source grounding and a passing critic have not eliminated this overstatement. The generated ready status must not be treated as broad editorial acceptance. The post is text-only; no carousel, image or video was rendered. Private artifacts: `noosphere-skills-escalation-discovered-{result,trace,ideas}.json` and readable `noosphere-escalation-generated-post.md`. All persistence remained private/in-memory; no production publication, checkpoint, model setting or deployment changed.


## Basis for necessary actions (2026-09-13)

The captured ready escalation post prescribed a human transfer when a general FAQ did not establish account-specific facts. A proposed guardian paragraph distinguishes insufficient evidence for one action from evidence that another action is mandatory. Necessary/exclusive recommendations must have a supporting source, explicit policy or scenario condition; otherwise the public explanation should give the discriminating check or a conditional recommendation. It explicitly permits proportionate precautions and does not demand exhaustive alternatives or invented organizational policies.

A private actual Luna medium prototype evaluated the captured post, an authored variant checking account data within authorized scope before conditional transfer, and the captured KCS distinction. All used one call and valid public-text citations. Only the original mandatory-transfer case was revised, under coherence; both positive controls passed. The same three cases then ran through the actual modified adapter with no injected prompt and reproduced those outcomes, again one call and valid citations each. These are critique-only comparisons, not freshly generated approved variants or repeated quality benchmarks. The authored variant is not a published or persisted replacement. Private files: `noosphere-critic-action-{basis,native}.json`.

The instruction now lives in the shared Brand Guardian skill consumed by writer and critic; recorded versions advance to writer v17 and critic v15. The factual auditor, schemas, readiness policy, retry budgets, bounds and persisted model settings are unchanged. Eight focused public-agent tests pass (119 assertions), including runtime skill delivery and recorder versions. Full local `bun run check` passes. Independent specification and standards reviews found no blocking issue or substantive overconstraint.

A private normal pipeline replay now resumes the captured post at critique, using the new skill to drive its existing bounded writer repair, audit and critique. It does not rerun discovery or brief and does not write any production checkpoint. The terminal repair result is recorded separately. Global editorial quality, latency, format coverage and deployed acceptance remain open.

The normal critique-stage replay did not reproduce the rejection: one actual critic call (17.055 seconds) approved the unchanged mandatory-transfer post and ended ready without a writer call. The coherence reason summarized the narrative but did not establish why transfer was necessary. This contradicts any claim of reliable enforcement from the two previous successful rejections. The new instruction is a calibration attempt with observed variance, not a proven guard. Private files: `noosphere-skills-escalation-action-repair-{result,trace}.json`. A fresh writer-stage replay from the same saved brief/evidence is now testing whether the shared skill improves the initial recommendation; it does not repeat discovery or hand-edit the generated text.

CI run 34727829705 on the source-query change 13adf5e completed successfully. It predates the action-basis skill change and must not be cited as CI for writer v17/critic v15.

The fresh writer-stage replay failed before audit after its two allowed writer invocations (25.020 and 23.295 seconds): the bodies contained 1,691 and 1,594 characters, both above the existing 1,500-character limit. The initial text made transfer conditional on an applicable procedure and available information, but that limited improvement is not a usable generation result. No audit or final critique ran. The process exited with CONTENT_DRAFT_TOO_LONG and recorded CONTENT_GENERATION_FAILED in its private repository. Files: `noosphere-skills-escalation-action-writer-{result,trace}.json`. Do not attribute the length failure causally to the added skill from this one sample; the previous writer also had over-limit repairs.

The existing length feedback already includes measured length and the maximum. A private single-call repair probe now tests an explicit 1,200-character target and required reduction from the measured length, leaving margin below the unchanged 1,500-character gate. This is proposed repair guidance only, without an additional runtime retry or relaxed bound.

The explicit-margin repair probe also exceeded the unchanged limit: 1,534 characters in one actual call. The proposed length-feedback change is not adopted. Private artifact: `noosphere-length-margin-probe.json`. Inspection of the saved brief shows several required dimensions (complexity, sensitivity, risk and conversational repairs), an illustrative case, and distinct explanations of two sources. This provides a concrete next hypothesis: the brief's mandatory scope competes with the focused short-text contract. It does not prove that two sources cannot fit or that the limit should be weakened. Test selection of essential versus optional material at brief creation before changing runtime guidance further.

The action-basis paragraph remains an explicit, reviewed calibration instruction, with both successful discrimination and a contradictory approval recorded. It is not a reliable enforcement guarantee or deployment-ready editorial acceptance. The failed writer and repair probes are retained alongside the successes rather than counted as completed deliverables.

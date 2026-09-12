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

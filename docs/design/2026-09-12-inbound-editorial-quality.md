# Inbound editorial quality recovery

## Objective and acceptance boundary

A product/service must lead to an audience-relevant strategy and useful, credible,
readable Inbound content in the configured brand formats. A job completing or a
model saying `ready` is not acceptance. Preserve Luna routing and existing tenant
boundaries, evidence requirements, immutable versions and release gates.

Automatic publication stays paused in the Noosphere canary while this is repaired.
Do not resume or publish merely to prove that a provider endpoint works.

## Verified incident, 12 September 2026

- Two scheduled posts were accepted by editorial policy v2 despite weak standalone
  value, anonymous source references and a repeated CTA offering a governance grid.
- Paused through the authenticated strategy UI. Database confirms enabled=false
  and two cancelled publications. Drafts and immutable snapshots are preserved.
- Both recorded critiques approve the content. One mentions mild generic wording
  as advice. Neither explicitly assesses a concrete reader takeaway or verifies
  availability of the resource promised by the CTA.
- Actual readiness replay is red: both user-rejected publications return ready=true.
  Command: `bun .scratch/inbound-quality/replay.ts`. Private captured inputs live
  outside git in the operator's release-evidence/inbound-quality directory.
- The writer prompt says to use complete offer context; ContentGenerationContext
  and boundedContext actually supply strategy, brand, idea and evidence, but no
  complete offer snapshot. Trace the repository path before deciding the fix.
- The writer explicitly prefers shortening on thin evidence and deleting claims
  on audit failure. Repeated repair may reduce reader value; this is a hypothesis
  requiring stage-by-stage captured output comparison.

## Rejected shortcut

Blocking every nonempty `genericPhrases` list rejected only one of the two real
posts and also broke the existing non-blocking polish contract. Experiment removed.
A phrase blacklist cannot establish usefulness. Do not turn this incident into a
ban on “Mon point de départ”, a minimum-length rule or mandatory aggressive hooks.

## Required implementation slices

1. Supply truthful business context: offer/version, audience problem, brand voice,
   actual capabilities, authorized resources and evidence. A strategy CTA alone
   must not establish that a promised deliverable exists.
2. Build useful briefs: one specific reader decision/problem, a supported angle,
   a concrete takeaway and an appropriate format. Thin or irrelevant research
   should trigger bounded research/reframing, not automatic filler publication.
3. Writer/repair playbook: useful explanation, worked hypothetical examples clearly
   labelled, actionable checks or reasoned tradeoffs. Avoid invented experience,
   outcomes, customers and lead magnets. Preserve substance during repair.
4. Evidence audit must distinguish external factual claims from proposed methods
   and illustrative scenarios; faithful quotation alone does not imply relevance.
5. Editorial assessment must explicitly cover audience relevance, reader utility,
   coherent reasoning, standalone source attribution, truthful CTA, voice and
   distinctness. Require concrete passages and reasons, not generic praise or a
   single aggregate score. The gate must validate assessment completeness.
6. Version the new policy. Old `ready` snapshots must not silently become eligible
   under it. Respect immutable records; regenerate/reassess into a new version.
7. Surface actionable blocking reasons and honest states in UI/MCP; keep retry
   counts/costs bounded. Do not present source discovery as publication readiness.
8. Validate text, image and carousel rendering/content, scheduling snapshots and
   isolation. No publication without separate authorization.

## Proof required before completion

- Real incident replay rejects both posts for relevant reasons, without matching
  their wording as a special case.
- Counterexamples accept useful short content, honest methods and clear opinions;
  reject anonymous quotation collages, empty paraphrases, invented resource CTAs,
  unsupported claims and repetitive posts across multiple unrelated offers.
- Use actual configured Luna runs on held-out briefs, inspect full rendered outputs
  and evidence, compare pre/post repair substance. Record every run, failure,
  latency and cost availability, not only selected successes.
- At least text, image and carousel validated in a non-publishing canary; verify
  business alignment and readability, not merely the existence of media files.
- Tests/checks, independent review and mandated CI/release gates pass. Deployment
  proof and authenticated UI/MCP proof remain separate from local tests.
- User can review the actual candidate posts and source provenance. Readiness claim
  must remain limited to tested cases; engagement/revenue impact is not yet proven.

## Current status

Containment and red baseline complete. No editorial correction delivered yet.
The first local implementation now loads the exact offer and ICP versions pinned
by the strategy and forwards their business context to all four model roles.
Its payload regression failed before the change and passes afterward. Dedicated
PostgreSQL integration passes (3 tests, 123 assertions), including newer-offer
publication without context drift and cross-workspace denial. These tests do not
prove reader utility, CTA truthfulness, or actual model output quality.
Remaining: explicit editorial assessment contract, generation/repair playbook,
real Luna evaluation with held-out cases, media review and release validation.
The active goal remains open; this document is not evidence of product readiness.

## Editorial contract implementation and live evaluation

Local policy v3 requires explicit audience relevance, reader value, coherence,
source attribution, CTA truthfulness and brand voice assessments. Each criterion
must contain a verdict, specific reason and exact public-copy excerpts. A failed
criterion blocks readiness regardless of the summary. Historical snapshots stay
readable but require reassessment; the existing publication policy-version guard
prevents silent reuse. Criterion repair reasons flow back to the writer.

The production model adapter uses the shared editorial playbook for all four
roles. Source summaries do not count as value; proposals and labelled examples
are distinct from factual claims; strategy CTAs do not prove resource existence.
This is implemented, not yet deployed.

Verified locally: 1115 unit/HTTP tests pass, TypeScript passes; generation
integration (3 tests/123 assertions) and autopilot repair (4 tests/16 assertions)
pass in separate disposable databases. Subsequent schema compatibility test
adds one more targeted test. Full release gates/review remain outstanding.

Real configured VPS provider, codex-cli gpt-5.6-luna low:
- Initial evaluation rejected at transport: z.record emitted propertyNames,
  unsupported by the structured output provider. Changed to six explicit required
  properties, preserving constraints; red/green schema regression recorded.
- Original first post rejected in 17.187 seconds for anonymous source attribution
  and unproven resource CTA.
- Original second post rejected in 21.357 seconds for coherence, anonymous source,
  unproven resource CTA and voice. Full assessments preserved outside git in
  release-evidence/inbound-quality/luna-reassessment.json.
- A fresh writer/auditor/critic repair experiment then failed final deterministic
  validation with CONTENT_DRAFT_UNSOURCED_NUMBER. No candidate was published or
  saved into application tables. This is not a successful replacement. Capture
  intermediate candidate outputs before validation on the next experiment and
  distinguish invented factual numbers from structural list numbering before
  changing number validation. Do not weaken evidence checks to force acceptance.

Still required: passing real generated replacements, held-out offers and negative
cases, media quality/format verification, UI reasons, review and release gates.
No automatic publication or production readiness claim is authorized by this
partial evidence. No application deployment occurred during these experiments.


## Follow-up evidence and source-collection root cause

The first complete Luna dry-run finished blocked after repair: the proposed method
remained asserted as an established benefit, and an auditor paraphrase failed to
cover the exact submitted claim. Writer guidance now preserves reader value with
a worked hypothetical decision, and the audit copies claim statements exactly.
The next complete dry-run improved to an actionable VPN-ticket example but still
failed source attribution: its HAL title was truncated. These failures remain in
the operator evidence directory; neither was persisted as application content.

The incident source was only a search-engine snippet (about 180 characters).
CrawlerClient.search explicitly requests scrapeContent=false, and the content
idea source previously promoted description ahead of markdown without a page read.
The source PDF returned no page content during a real VPS crawler read. It cannot
support that post as a read document. CrawlerContentIdeaSource now reads discovered
pages, uses their title/content, hashes the actual read text, and retains only
matching successful pages. No snippet/title fallback. Individual reads run with
concurrency two, stable request keys, a 40-second per-read timeout and a 90-second
collection budget. Partial successes survive another read failure. A total service
failure remains retryable rather than silently becoming empty successful evidence.

A real query collected four readable pages (France Num, Algos AI, OVHcloud, IBM).
A new dry-run generates an idea from these actual passages and runs the complete
Luna text pipeline. Its outcome is still pending; source presence is not quality.

Review corrections implemented locally: seventh explicit assessment criterion
for distinctness; execution-time rejection of queued obsolete-policy publications;
read views expose effective readiness=false with editorial_policy_outdated for
old snapshots, preserving stored history. The UI labels them as needing reassessment.
Numeric guard regressions were reproduced and fixed: a standalone leading statistic
is not a list, and numbers adjacent to a closing URL delimiter remain checked.

Checks this iteration: check completed successfully before the final read-isolation
refinement; 1122 unit/HTTP tests, generation integration 3/126 assertions, targeted
crawler/client tests 7/23 assertions. Latest source refinement has separate type
and discovery-integration verification. No deployment, new release, publication,
media acceptance or overall product-readiness claim yet.


The full-source dry-run is now terminal, still blocked. Its method and worked
hypothetical example have substantive reader value according to independent
review. Remaining issues include an unsupported conclusion about triage, missing
canonical IBM URL, and a critic excerpt copied from historical instead of current
copy. The literal question-mark counter also rejected diagnostic checklist
questions and a quoted source title. A targeted regression now permits those
while preserving the existing competing-reader-question rejection. The audit
playbook explicitly distinguishes normative reasoning from empirical assertions;
this latest prompt change still needs real-model evaluation. Prompt versions are
writer-v7, critic-v6 and brief/audit-v5.

Empty page extraction is now an explicit CONTENT_SOURCE_READ_FAILED rather than
successful empty discovery; an actual empty search still returns no candidates.
Reviewer-identified unresolved crawler issue: a stable idempotency key replays an
already failed/cancelled (or completed-but-empty) server job. Implement scoped,
bounded retry of terminal failures while continuing to reuse live jobs, and test
it against the real crawler API semantics before release. Do not hide this as a
transient user configuration issue.

Latest candidate available locally in operator evidence as
brouillon-essai-non-valide.md, explicitly unapproved and unpublished. Goal stays
active. No release or deployment was performed.

## Resumed validation, current uncommitted candidate

The bounded crawler retry now accepts explicit retries only for confirmed failed
or empty completed extractions. Pending/running/cancelled/successful jobs retain
their identity. Two retries are permitted within the in-memory job history; this
is not a cross-restart counter guarantee. A simultaneous-request regression proves
that two retries schedule one replacement and release their acquired slots.

The latest real Luna text replay (`pipeline-result-v8b.json`, private evidence)
completed writer/audit repairs and critique with no readiness blockers. Independent
review confirms a concrete decision, a clearly fictional example, an exact IBM
quote with an identifiable link, and distinction from the supplied history. This
is one accepted text candidate, not overall product or multi-format acceptance.
Non-numeric fictional examples currently rely on general audit/critique; the
structured scenario register specifically governs invented numeric example inputs.

The full integration suite now exits successfully in a uniquely named local test
database. The preceding two failures were a scratch database naming mismatch with
the cleanup guard; the guard was preserved. An attempted direct single-file rerun
without migrations failed preparation; the standard migrating runner succeeds.
A separate regression now preserves the original editorial repair reasons when
a second writer attempt must fix a deterministic draft error.

The deployed media runtime canary renders PNG, PDF and video successfully with
storage explicitly disabled. Actual Luna media content generation and visual
inspection are still in progress. No publication, pause change, application
deployment or production database mutation was performed by these evaluations.

## Media pixel failure found by visual acceptance

The first actual Luna image was accepted by editorial checks and rendered a valid
1080×1350 PNG, but every text element was absent. The old runtime canary also
reported success because it checked dimensions, file signatures and page count.
A direct VPS probe rendered two distinct text strings into identical blank PNGs.
The deployed sharp reported emscripten/resvg; the Docker runtime omitted native
sharp/libvips packages, leading to a WebAssembly fallback without usable fonts.

Dockerfile.backend now retains both native AMD64 packages. A rebuilt local AMD64
image passes the new same-layout/different-title pixel guard, plus PDF/video checks.
Re-rendering the captured actual candidate inside this image shows readable text.
The release workflow now runs that runtime guard before image scanning and push.
The image's internal visual-tone label is removed; useful carousel kickers use
the foreground text color for contrast. None of this is deployed yet.

The carousel first writer output was wrongly blocked by numeric validation because
ordered headings live on separate slides. Consecutive numbered slide headings now
use the same narrow structural-marker rule as prose lists. Numbers inside their
content and standalone numeric claims still require evidence (red/green tests).
The original first draft is being resumed at audit, retaining the recorded output.

Real Luna negative checks independently reject both invented customer gains
(including a misleading fictional label) and an unavailable resource CTA. All
outputs remain recorded in private evidence, including unsuccessful attempts.
Full local check passed before the latest media changes: 1131 unit/HTTP tests,
crawler tests, TypeScript and builds. Browser suite: 52 passed, 4 conditional skips;
a targeted controlled/provider-free run is checking those omitted scenarios.

# Inbound editorial quality: candidate validation

This document records local and isolated provider validation. It does not declare
production readiness, deployment, or permission to resume publishing.

## Behavior and failure boundaries

The generation pipeline receives the offer and ICP versions pinned by its strategy.
A shared runtime playbook drives the brief, writer, auditor and critic. Policy v3
requires seven explicit editorial assessments with reasons and current-copy excerpts.
Legacy ready versions display a reassessment requirement and cannot execute under
the new policy. MCP autopilot counters, home suggestions and activity use the same
current-policy readiness rule; a legacy ready record is presented as needing attention
without mutating its stored snapshot. Integration tests reproduced and corrected the
previous mismatch across those views. Source discovery reads actual pages; search snippets are insufficient.
Confirmed failed/empty reads have explicit bounded retries; concurrent retries share
one replacement job. A second writer attempt retains editorial repair feedback.

Numeric checks distinguish consecutive list/carousel markers from factual numbers.
Clearly labelled invented numeric example inputs require an independent scenario
audit. This is not a deterministic guarantee against every misleading nonnumeric
scenario: the general auditor and critic still make semantic judgments.

## Evidence

| Check | Result and boundary |
| --- | --- |
| Full `bun run check` | Passed; 1,133 unit/HTTP tests, crawler suite, types, architecture and builds |
| Full integration | 327 passed, isolated local database reset per file |
| Browser suite | 52 passed, four conditional cases skipped in first configuration |
| Conditional browser rerun | Eight passed, including the four omitted desktop/mobile cases; controlled Codex and provider-free environment |
| Bun dependency audit | Passed at high severity |
| Crawler dependency audit | No known vulnerabilities found |
| Local AMD64 backend image scan | No HIGH/CRITICAL fixed findings reported by pinned release scanner |
| Runtime rendering | PNG, PDF and video pass; different same-layout titles yield different decoded text pixels |
| Actual configured Luna | Original weak posts rejected; one text, one image plan and one six-page carousel accepted after bounded repair |
| Unrelated-offer Luna cases | Maintenance and training fixture offers produce useful, distinct reader methods after bounded repair; controlled product facts, not live customer proof |
| Negative Luna cases | Invented customer gains and an unavailable-resource CTA rejected for relevant reasons |
| Independent review | No remaining verified blocker in reviewed diff; multiline-heading numeric bypass found and fixed with regression |

The first direct single-file integration retry omitted migrations and failed; the
standard migrating runner passed. An earlier full run used a scratch database name
that did not satisfy the smoke cleanup guard; its two failures disappeared with a
valid disposable name. No guard was weakened.

## Actual media defect

A valid PNG initially contained decorations but no letters. The deployed image had
omitted native sharp/libvips packages and used WebAssembly rendering. Two different
text strings rendered to identical pixels. Native AMD64 runtime packages correct
this. The image-release workflow now checks text pixels before push. This check
catches the observed omission, but human visual review remains necessary for layout,
overflow, contrast and each actual generated document.

The image alternative text now derives from the same displayed lines as the card,
including truncation, rather than describing an imagined diagram. Dedicated media
tests cover renderer-to-storage propagation and a suffix outside the visible area.

The six-page actual carousel was reviewed visually; the subsequent contrast-only
render was checked on a representative interior page. Private full prompts, source
excerpts, output attempts, trace timings and rendered artifacts are retained outside
the repository. Provider-reported monetary cost was unavailable; no zero-cost claim
is made. Image/PDF bytes were stored in isolated scratch output, not published or
written to production object storage.

## Remaining acceptance work

- Continue evaluating quality across real customer offers; three controlled contexts
  do not establish general editorial quality or business impact.
- Execute CI and final release-image checks against the exact release commit.
- Deploy the reviewed candidate with existing publication pause preserved, then
  verify authenticated UI/MCP state and rendered media on that deployment.
- Validate persistent canary storage and scheduling snapshots without real-recipient
  actions. Do not resume automatic publishing without the required authorization.


### Alternating repair guidance (2026-09-13)

The native backup-document-v14 trace exposed a lost writer requirement: after an
unsupported-claim repair passed the next audit, the editorial repair received only
the latest critique. Its next draft reintroduced a previously contested premise.
The job processor now retains the bounded invocation’s audit and critique feedback
for subsequent writer repairs, with current feedback first and exact duplicates
removed. This is writer guidance, not evidence: auditor input, readiness rules,
negative-finding persistence and retry limits are unchanged. The history is local
to one `process` invocation; continuity across a restart is not claimed.

The new alternating audit → critique → audit regression failed first because the
critic repair lacked the earlier audit requirement. After the change, 116 targeted
generation/audit tests pass (267 assertions). Both specification and standards
reviews found no blocking defect. Real-model benefit remains under evaluation:
backup-repair-v15 reuses v14’s frozen brief and source context and starts at writer,
so its timing must be compared only with v14’s writer/audit/critic stages, not its
search and briefing. Old guidance can be redundant; the native trial must assess
whether retaining it helps rather than merely enlarging the input.

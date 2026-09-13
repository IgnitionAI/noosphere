# Complete audit coverage for unchanged Inbound content

Status: field-aware audit response, coverage receipt, readiness enforcement and durable historical-checkpoint reassessment implemented. Unsupported reviewed assertions now survive re-audits and restarts while their exact public text remains. Ledger synchronization, scenario/topic tracking and explicit evidence-based resolution remain unimplemented. Not accepted for deployment.

## Problem

The current auditor must label missing ledger statements as ungrounded, even when supplied evidence supports them. Successive audits of an unchanged draft report different omissions. A metadata repair covering only the first list therefore leaves the next audit to discover more. Whole-draft repairs can then destroy correct scenario declarations or exceed the caption length.

The all-passages prototype reviews47 public lines and preserves the caption/slides. It fills supported entries and removes missing-ledger findings from a subsequent audit, but also identifies unsupported diagnostic inferences that the subsequent audit silently ignores. Replacing one omission problem with dropped negative evidence is not acceptable. Its positive source context and authored negative control are calibration fixtures, not fresh editorial acceptance.

## Proposed boundary

Make the independent audit responsible for both complete public coverage and factual verdicts. Do not introduce another unconstrained writer pass merely to discover claims again.

- Enumerate field-aware public passages from the same domain representation used for public content validation. Preserve field identity and full text. Citation-oriented critic excerpts are not an exhaustive field inventory.
- Require one coverage record for each current passage ID. Mixed passages must expose factual spans as exact current substrings, alongside reasoning, opinions, hypothetical inputs and attribution. A whole paragraph labelled reasoning cannot excuse adjacent factual premises.
- Review factual spans whether or not the writer listed them. Supported substantive claims require nonempty supplied source keys and a contextual support reason. Unsupported findings remain independently blocking.
- Bibliographic attribution uses source title/URL/excerpt. A quotation does not establish author affiliation, endorsement or contextual support by itself.
- Bind coverage to the exact draft and evidence context. A public rewrite invalidates earlier coverage. Historical audit snapshots remain readable; absence of coverage cannot certify a newly generated result.
- After complete validation, synchronize only ledger metadata from supported, exact current spans. Preserve public copy, existing claims and scenario declarations. Never use partial-claim containment to authorize a broader assertion.
- Preserve negative findings on unchanged passages until explicitly resolved. A later audit omitting an earlier unsupported finding is not a resolution. Do not merge model votes into approval.
- Respect existing bounded attempts and ledger capacity. If complete metadata cannot fit, request substantive consolidation within that budget; do not truncate claims, expand retries or drop inconvenient findings.

Coverage records establish that the model addressed each passage, not that its semantic judgment is infallible. Independent editorial and visual acceptance remain required.

## Acceptance evidence required

1. A source-backed slide omitted from the initial writer ledger is audited and synchronized without a public rewrite.
2. Every passage ID appears exactly once; missing, duplicate, foreign or stale IDs and non-verbatim spans fail validation.
3. An explicit unsupported assertion remains blocking if a later review silently omits it. The prototype's diagnostic inferences are unresolved controls, not approved prose.
4. Mixed factual/opinion passages and explicit fictional cases retain their distinctions; mere writer labels cannot override contradictory evidence.
5. A reviewed fragment cannot cover a broader promise. Full-claim review with harmless surrounding editorial context remains valid.
6. Ledger capacity exhaustion retains normal substantive repair; source keys and classification cannot be invented to make metadata fit.
7. Current Luna full-generation trials on more than the captured access-control topic must produce useful posts and media. Inspect actual renderings; compare repeated runs and negative controls. No acceptance solely from manifests, coverage counts or model approval.

## Implemented prerequisite

Readiness now requires the reviewed text to contain the entire declared claim, rather than accepting containment in either direction. The broader-guarantee regression failed before the change and passes afterward. This does not yet implement complete coverage.


## Exact assertion continuity

The current slice checkpoints each independent audit before a repair can pause, retains the previous assessment through draft repair and critic-stage reopening, and marks those runs as pending audit. Completion is rejected until the run reaches critic again; an old retained audit is not approval. New audit snapshots carry unresolved prior unsupported assertions whose exact wording still occurs in caption or media. Model silence or a conflicting favorable vote cannot clear them. Removal releases that exact finding, with the replacement still subject to current coverage, grounding and editorial checks.

This also conservatively retains unsupported attribution entries flattened into reviewedClaims. It is not semantic paraphrase tracking or source-based adjudication. Scenario/topic findings and newly available evidence need their own explicit resolution semantics. Capacity overflow fails instead of truncating findings.

# Complete audit coverage for unchanged Inbound content

Status: field-aware audit response, coverage receipt, readiness enforcement and durable historical-checkpoint reassessment implemented. Unsupported reviewed assertions now survive re-audits and restarts while their exact public text remains. Ledger synchronization is implemented for fully audited supported exact spans. Scenario/topic tracking and explicit evidence-based resolution remain unimplemented. Not accepted for deployment.

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


## Audited ledger synchronization

Complete, current field coverage can now append missing supported substantive spans with one complete reviewed source set each. Existing ledger entries, all public fields, opinions and scenario declarations remain unchanged. Attribution, unsupported and unresolved spans are excluded; unrelated findings remain blocking. Unknown source keys or stale coverage prevent synchronization. Exhausting ledger capacity leaves the complete original inputs for bounded substantive repair.

The application checkpoints the synchronized draft and audit atomically before repair/critique. The repository permits only a normalized non-ledger-identical draft with the original ledger retained as a prefix. A resumed critic checkpoint can use its still-current independent audit to complete references without a new model call, through a guarded audit-stage transition. Crashes before or after the atomic checkpoint resume through ordinary pending-audit handling.

## Independent model input after a repair

Audit v9 excludes the previous audit snapshot from the model payload. The current draft, evidence and business context remain available. Durable previous objections stay in application state and are reconciled after the independent assessment; they are not supplied as candidate current quotations.

A private native Luna capture reproduced v8 quoting “La vérification utile comporte deux niveaux :” from the previous audit even though the current caption instead said “Pour décider si le contrôle est suffisant, séparez deux niveaux :”. All 36 field IDs were covered, but that non-current quotation correctly failed exact coverage. The fix removes this input contamination path without accepting approximate quotations or suppressing unresolved negatives. Model validity and editorial usefulness still require native verification.

## Missing declared-claim reassessment

A full-field receipt may classify a writer-declared factual title as non-factual and omit its verdict. The shared readiness matcher identifies declarations lacking full text and source-set coverage. After checkpointing a valid current audit, the processor permits one additional independent assessment with explicit current missing declarations. The copy is preserved, negative findings are retained, and a second omission remains blocking. The bound is per audit-stage invocation, not a persisted global call budget. Current critic checkpoints with missing declarations reopen the audit stage on resume. Invalid coverage is not accepted or repaired by this mechanism.

Native inspection found a truthful CTA_RESOURCE_UNVERIFIED rejection for a promised grid, but unaudited_claim prevented editorial repair. An experimental targeted Luna reassessment failed CONTENT_AUDIT_COVERAGE_INVALID; native recovery, useful final copy and rendered media remain unproven.

## Next audit contract: explicit declaration obligations (not implemented)

Repeated native re-audits shifted omissions between a declared title and a declared conditional sentence. The next contract should provide code-generated, required declaration-review slots for every exact occurrence of each current declaration in a public field. The model supplies kind, source keys, verdict and reason, not replacement statement text. Exhaustive field review remains responsible for undeclared assertions. Missing/duplicate/invented slots, invalid source keys, cross-field substitution, supported fragments of broader declarations and unlocated declarations must be rejected. Opposing field/declaration verdicts stay blocking.

Do not silently coerce a field’s classification because its declaration slot exists. Preserve separate judgments about the field’s non-factual remainder and the declared assertion. A companion declaration receipt is preferable to inventing a mixed/factual classification in the decoder; any aggregate receipt change must retain bidirectional validation of current public locations. Tests must cover successive omitted declarations, repeated wording in different contexts, mixed opinions/facts and a broader unsupported promise. This design has not yet been implemented or validated with Luna.

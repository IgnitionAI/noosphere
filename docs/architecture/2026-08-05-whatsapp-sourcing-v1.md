# WhatsApp sourcing V1

Status: approved for implementation on 2026-08-05.

## Outcome

Ignition Outbound runs one durable sourcing cycle per workspace every day at
06:00 Europe/Paris. The cycle continuously expands the inventory of public,
professional, metropolitan-French mobile endpoints that are attributable to an
ICP account and reachable on WhatsApp. It never sends a message.

The initial target of 10-20 new reachable endpoints per day is a calibration
objective, not a product promise or a hard ceiling.

## Locked scope

- France métropolitaine only in V1.
- Publicly displayed professional mobile endpoints only.
- Free sources only: official websites first, then allowlisted public maps and
  professional directories when official-web yield is insufficient.
- Every accepted endpoint keeps a bounded evidence capsule: canonical URL,
  visible excerpt, content hash, collection time and attributed company.
- Unipile establishes WhatsApp reachability only. It does not establish
  identity, professional ownership, consent or send eligibility.
- Reachability is scoped to workspace and selected provider account and expires
  after 30 days.
- Sourcing, CRM import and outbound sending are separate transitions.
- No human validation is required in the runtime pipeline. Ambiguity is rejected
  rather than escalated to a person.

## Deep modules and seams

### Daily sourcing cycle

The `DailySourcingCycle` module hides scheduling, a frozen daily budget,
fairness between active ICP versions and durable progress behind one operation:
reconcile due workspaces and enqueue bounded work.

One cycle exists per `(workspaceId, localDate)`. The effective configuration is
snapshotted when the cycle starts:

- 60 minutes wall time;
- 150 page attempts;
- 60 Unipile verification attempts;
- 4 pages maximum per company;
- 2 simultaneous page requests per domain.

Budget reservations are atomic and occur before an attempt. Failed attempts
consume budget. A cycle crossing midnight retains its original deadline and
budget. After a multi-day outage, only the current local date is scheduled.

Active WhatsApp ICP versions receive exploration quanta using a persisted
round-robin cursor across days. Remaining budget is allocated by the seven-day
moving yield of new admissible reachable endpoints per page. Campaigns consume
the resulting pool; they do not create independent sourcing budgets.

### Sourcing frontier

The `SourcingFrontier` module owns exploration progress for
`(workspaceId, icpVersionId, whatsapp)`. It records structured query batches,
source kind, metropolitan-French zone, result fingerprints, observed URLs,
yield and `nextEligibleAt`.

Provider cursors and rankings are never treated as stable. Recovery is
at-least-once and idempotent against logical observations, not a claim that a
mutable web search can be replayed byte-for-byte.

Saturated frontiers are progressively spaced. Pausing or replacing a campaign
does not erase the ICP frontier.

### Evidence-based endpoint qualification

Qualification is deterministic in V1:

1. Extract a number from visible public content.
2. Normalize it with libphonenumber semantics.
3. Accept only `+33` metropolitan mobile numbers whose national form starts
   with `06` or `07` and whose type is mobile.
4. Require explicit professional context.
5. Attribute it through the finite matrix below.
6. Verify reachability through the workspace-selected Unipile account.

Fixed lines, switchboards, ambiguous context, hidden or inferred values,
image-only values and OCR are rejected in V1. Kimi is not used to make an
admissibility decision.

Attribution matrix:

| Source | Identity match | Result |
|---|---|---|
| Official domain | Resolved domain plus matching company name or structured identity, no contradiction | Strong |
| Official domain | Domain only or conflicting identity | Weak or rejected |
| Allowlisted map/directory | Verified name or alias plus matching postal code/address or public establishment identifier | Strong |
| Allowlisted map/directory | Name without a second identity dimension | Weak |
| Person page | Person name, role and company adjacent to the number | Strong person endpoint |
| Any source | Company is clear but no named person | Strong company endpoint |
| Any source | Same number claimed simultaneously by unrelated companies | Conflict and rejected |

Franchises, subsidiaries and establishments remain separate unless a public
identifier proves they are the same entity.

Four assertions remain separate in storage and UI:

- public observation;
- company or person attribution;
- WhatsApp reachability;
- send eligibility.

The sourcing cycle produces the first three only. Existing campaign policy owns
the fourth.

### Temporal identity and CRM projection

A phone observation is temporal and may relate one E.164 endpoint to a company,
person or collective company endpoint. `(workspaceId, E164)` is not a permanent
one-to-one identity.

CRM import is automatic only when the observation is public, attribution is
strong, the number is an admissible metropolitan mobile, reachability is valid,
and no workspace suppression applies. A collective endpoint never receives an
invented person name, avatar or job title.

One CRM contact may match several ICPs, but only one active WhatsApp campaign
assignment is allowed at a time. The highest ICP-fit campaign wins; ties use a
stable key. Other campaigns show the existing assignment and neither count nor
send the contact twice.

Observation, temporal association, CRM projection and outbox insertion commit
atomically. A crash after an external reachability check may repeat that check
and consume budget, but cannot duplicate the logical observation, active
association or campaign assignment.

### Suppression and retention

Workspace WhatsApp suppressions store an HMAC-SHA256 fingerprint derived with a
workspace-scoped key. They never store a raw number. The suppression survives
deletion of evidence and prevents automatic re-import.

- rejected raw excerpts: 30 days;
- detailed sourcing batches: 90 days;
- seen fingerprints and aggregate metrics: 24 months;
- accepted evidence capsule: while the CRM relationship is active;
- inactive ICP frontiers: compact after 90 days.

Full crawled pages are not persisted in CRM.

### Network and provider safety

Crawler protections are non-regressable: HTTP(S) only; validation before the
initial request, every navigation, redirect and subresource; blocking of
private, loopback, link-local, multicast, reserved and cloud-metadata targets;
DNS rebinding protection; bounded response size, timeouts and redirects; robots
and per-domain throttling.

The Unipile reachability cache key is
`(workspaceId, providerAccountId, E164)`. Account changes or disconnection
invalidate affected cache entries. `403`, `429`, timeout and disconnection
produce `unknown`, never `unreachable` or an automatic CRM import.

## Operator experience

Campaigns show a compact `Pool de sourcing partagé` block:

- `Passage du jour en cours` or `Passage du jour terminé`;
- contacts assigned to this campaign today;
- last and next passage (`06:00, heure de Paris`);
- `Nouvelle tentative automatique` for retryable failures;
- `Reconnecter le compte WhatsApp` when operator action is required.

The interface says `contact sourcé` before reachability and
`contact WhatsApp vérifié` afterwards. It shows the verification date and
whether it came from a live call or a still-valid cache. Expired checks display
`à revérifier`.

The empty state distinguishes no admissible mobile, reachability checks waiting
and provider unavailability. A permanent note says that this step searches and
imports only and does not send a message. Technical identifiers and terms such
as EMA or provider account IDs remain in logs, not operator diagnostics.

## Release gates

- Daily cycle concurrency cannot exceed its frozen page or provider budgets.
- DST, duplicate scheduler and outage recovery create exactly one cycle for the
  current Paris local date.
- Crash injection before and after each durable transition produces one logical
  observation, association, CRM projection and campaign assignment.
- A black-box crawler test proves no connection to private or metadata targets
  through initial URL, redirect, DNS rebinding or subresource.
- Attribution fixtures cover homonyms, franchises, subsidiaries, collective
  endpoints and one number claimed by unrelated companies.
- Suppressed endpoints cannot be re-imported after raw evidence is removed.
- A live read-only Unipile contract test validates a successful reachability
  check; controlled contract tests cover disconnect, account change, `403`,
  `429` and timeout.
- The complete path `06:00 -> sourcing -> evidence -> reachability -> CRM`
  succeeds without sending a message.
- Frontier selection and deduplication remain within operational targets at two
  years of projected volume for 100 workspaces.

## Decision log

| Decision | Alternatives | Resolution |
|---|---|---|
| Progressive cascade | Parallel harvesting; autonomous browser agent | Cascade keeps evidence and cost controllable; autonomous navigation is not a V1 default. |
| Free sources | Paid enrichment provider | Official-web calibration first; allowlisted free adapters later. |
| Metropolitan France | All French territories; international | `+33` mobile `06/07` only in V1. |
| Deterministic admissibility | Kimi classification | Ambiguous cases are rejected; no model drift in the eligibility gate. |
| Workspace daily budget | Per-campaign budget | Prevent duplicate work and provider amplification. |
| Temporal observations | Permanent E.164 identity | Preserves reassignment, collective endpoints and contradictions. |
| Reachability only | Treat Unipile as identity proof | Provider result cannot prove company ownership or consent. |
| Shared CRM contact | Duplicate contact per ICP/campaign | One active WhatsApp assignment prevents duplicate outreach. |
| Evidence minimization | Persist complete pages | Bounded capsules preserve auditability with less retained data. |
| Factual UX | `prospect qualifié`, `recherche terminée` | Avoid implying commercial qualification or exhaustive coverage. |

Known V1 limits are explicit: yield is not guaranteed, free sources may be
unstable, image-only numbers are not extracted, and a 30-day reachability cache
accepts residual staleness risk.

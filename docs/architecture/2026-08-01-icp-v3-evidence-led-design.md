# ICP Research V3 — Evidence-led design

Status: vertical slice implemented; production qualification gates remain open
Date: 2026-08-01
Review disposition: `APPROVED` after structured Skeptic, Constraint Guardian,
User Advocate and Arbiter review

> UX override — 2026-08-02: the research engine validates its own report. The
> report is read-only and has no approve, correct, reject or publish workflow.
> If the user is dissatisfied, the only primary action is to start a new ICP
> study with an adjusted brief. This supersedes the manual approval language in
> the original review record without changing evidence or reliability gates.

## 1. Problem

The V2 research pipeline can be steered toward a benchmark answer by hidden
sector-specific instructions and deterministic selection rules. A result that
was seeded by the method can therefore look like an independent discovery.

V3 must produce prospectable hypotheses without claiming commercial
validation and without encoding expected industries in prompts, policies or
evaluation fixtures.

## 2. User outcome

V3 produces between zero and five prospectable ICP hypotheses. Zero is a valid
result.

An ICP is not an industry label. It is the combination:

```text
organization type × use case × buying context
```

The output is a hypothesis ready for a controlled prospecting test. It becomes
commercially validated only after real buyer conversations, confirmed pain,
qualified meetings or paid pilots.

The default mission objective is to obtain qualified commercial conversations
quickly. Other objectives may change ranking weights without changing the
research method.

## 3. Locked principles

1. Discovery is problem-first, not sector-first.
2. The product landing page proves positioning and may suggest hypotheses. It
   never proves demand or gives a candidate a ranking advantage.
3. Product hints, externally discovered signals and adjacent transfers retain
   distinct provenance.
4. Evidence quality is graded by what it demonstrates, not by a raw source
   count.
5. Attractiveness, executability and research confidence remain separate.
6. Directly observed markets and adjacent experiments remain separate.
7. Sourcing is read-only. Research cannot import, invite, message or launch a
   campaign.
8. The methodology is global and versioned. Workspace objectives, geography,
   constraints and exclusions are configurable.
9. Partial research is explicit and resumable. A missing AI stage is never
   disguised as a completed audit.
10. Automatic report validation means “eligible for a prospecting test”, never
    “market validated”. The user relaunches a study when the result is not
    satisfactory.

## 4. Conceptual model

### ProductFact

A product capability, limitation or constraint with provenance and one status:

- `available`
- `planned`
- `claimed`
- `unknown`
- `contradicted`

Source authority is explicit. Current verified product documentation and
operator-provided facts outrank a landing claim; roadmap content never becomes
an available capability.

### ProblemFrame

A problem definition without a predefined sector:

- actor;
- workflow;
- frequency;
- data or corpus involved;
- cost or risk of failure;
- current alternative;
- operational constraints;
- compatible product mechanism.

### OrganizationHypothesis

A potentially relevant organization type with:

- its originating `ProblemFrame`;
- discovery route;
- source observations;
- explicit assumptions;
- validation query;
- falsification query;
- origin: `user_content_hint`, `external_signal` or `adjacent_transfer`.

### MarketInvestigation

The evidence, counter-evidence and unknowns collected for exactly one
organization hypothesis.

### BuyingContext

Observed or inferred users, sponsor, economic buyer, purchase trigger, current
alternative and propensity to buy or build. Budget, cycle length and willingness
to buy remain `unknown` without direct evidence.

### SourcingTest

A read-only test of whether representative accounts and relevant functions can
be found using web sources, CRM data and LinkedIn through Unipile.

### IcpCandidate

The composed organization, use case and buying context, linked to every
supporting and contradicting claim.

### EvidenceAssessment

The evaluated relationship between an observation and a claim.

## 5. Evidence model

Evidence is a graph, not a list of URLs.

```text
Source → Observation → EvidenceLink → Claim
```

### Source

- canonical URL;
- publisher and root publisher;
- capture time;
- content hash;
- `originFamily` for syndicated or republished content;
- relationship to product, competitor, buyer or independent publisher.

### Observation

The exact bounded passage and context that was observed. An observation does
not inherit a broader conclusion from the page.

### Claim

An atomic assertion used in the ICP reasoning.

### EvidenceLink

One of:

- `supports`
- `contradicts`
- `context_only`

It records directness, specificity, geography, recency and whether the claim is
observed or inferred.

Syndicated copies share one `originFamily` and cannot create false
independence. A competitor solution page demonstrates positioning. A named
customer story demonstrates the adoption described in that story but remains a
commercial source. Hiring, procurement and independent buyer-side observations
retain their own scope.

Every important claim is visibly classified as:

- `observed`
- `inferred`
- `unknown`
- `contradicted`

An inference never becomes an observation because another model repeats it.

### Durable evidence capsule

The report retains a bounded evidence capsule containing the cited passage,
surrounding context, URL, title, capture date, hash and provenance. Full
normalized pages are temporary and expire after 30 days by default.

## 6. Discovery logic

For every `ProblemFrame`, the discovery agent explores four routes:

1. named adoption and customer cases;
2. status-quo solutions and alternatives;
3. buyer-side signals such as hiring, procurement, regulation and investment;
4. adjacent organizations sharing the same workflow, corpus and risk.

Every organization hypothesis must include a falsification plan covering at
least:

- whether the workflow is genuinely recurring;
- whether the problem is costly or risky enough;
- whether the organization already builds internally;
- whether a dominant alternative already solves it;
- whether a buyer and trigger are observable;
- whether the product can satisfy blocking constraints.

Changing only sector examples on a landing page may create an additional
hypothesis. It cannot change a candidate dimension or rank unless external
observations support the change.

Research saturation is recognized only after all four routes produced valid
tool responses and successful diverse queries stopped yielding new organization
types or source families. Tool failure is never market saturation.

## 7. Candidate states

### priority_for_test

Requires:

- a complete organization–use-case–buying-context triplet;
- explicit hypothesis origin;
- no blocking or contradicted product capability;
- an observable problem;
- a `verified` sourcing test;
- no unresolved contradiction that invalidates the core relationship.

A valid niche may contain fewer than 20 accounts. Twenty is a sampling target,
not a promotion threshold.

### adjacent_experiment

The problem transfer is plausible, but demand, buying context or sourcing
remains partially inferred. It is never displayed as observed demand.

### insufficient

A central relationship is unknown, contradicted or cannot currently be tested.
The reason is explicit.

### not_investigated

The hypothesis was not investigated because of mission budget. It is not a
rejection.

No candidate that skipped sourcing shares the same visual state as a sourced
candidate. If none qualifies as `priority_for_test`, the report says so.

## 8. Evaluation and ranking

No model creates a scientific-looking total score.

### Attractiveness

- problem intensity and recurrence;
- value or risk;
- urgency and triggers;
- product fit;
- competitive saturation.

### Executability

- observed acquisition behavior;
- propensity to build internally;
- buyer accessibility;
- sourcing quality;
- compatibility with the chosen sales motion.

### Research confidence

- claim coverage;
- observation quality and independence;
- recency and geographic relevance;
- contradictions and unknowns.

Each dimension uses an anchored rubric from 0 to 4:

```text
0 = unknown
1 = weak hypothesis
2 = indirect signal
3 = direct precise observation
4 = converging independent observations
```

An inference has a capped level. Unobserved budget, cycle or willingness remains
`unknown`. The model links observations to rubric levels; deterministic code
performs calculation and stable ordering.

Ranking always names the mission objective. Tie-breaking uses objective result,
then confidence, then a stable identifier.

## 9. Agents and responsibility separation

No agent may invent, validate and rank the same hypothesis.

| Component | Responsibility | Execution |
|---|---|---|
| `ProductInterpreter` | Product facts and unknowns | Deep Agent, internal or public sources in separate invocations |
| `ProblemMapper` | Structured problem frames | Structured agent |
| `OrganizationDiscoverer` | Evidence-originated hypotheses | Deep Agent |
| `MarketInvestigator` | Evidence and counter-evidence for one hypothesis | Bounded Deep Agent |
| `BuyingContextAnalyst` | Structured purchase context | Structured agent |
| `SourcingValidator` | Read-only account and role test | Primarily deterministic |
| `ICPComposer` | Assemble existing objects only | Structured agent, no web |
| `AdversarialReviewer` | Find contradictions and invalidation reasons | Deep Agent, blind to final rank |
| `ObjectiveRanker` | Apply the chosen objective | Deterministic policy |

Open-ended retrieval uses LangChain.js `createDeepAgent`. Structured
transformation uses `createAgent` with Zod. Orchestration, authorization,
transitions, deduplication and ranking remain TypeScript policies.

### Kimi model tiers

- Principal reasoning stages (`problem_mapping`, `organization_discovery`,
  `buying_context`, `icp_composition`, `adversarial_review`) use `k3` with
  `reasoning_effort=max`; `k3-256k` is their fallback.
- Bounded executors (`product_truth` and each `market_investigation`) use
  `k3-256k` with `reasoning_effort=low`; `k3` is their fallback with the same
  low effort.
- `sourcing_validation` and `objective_ranking` are deterministic policies and
  make no model call.
- The removed `kimi-for-coding` and `kimi-for-coding-highspeed` IDs are rejected
  by the workspace settings API.

## 10. Runtime architecture

The AI executor remains in the Bun/TypeScript modular monolith. The crawler
remains an isolated Python service because Crawl4AI and Playwright justify that
runtime.

```text
PostgreSQL orchestrator and queue
  → Bun/LangChain stage executors
    → Python crawler
    → read-only Unipile adapter
    → workspace CRM reader
    → workspace document retriever
  → durable checkpoints and evidence
```

The workflow is:

```text
product_truth
→ problem_mapping
→ organization_discovery
→ market_investigation[]
→ buying_context
→ sourcing_validation
→ icp_composition
→ adversarial_review
→ objective_ranking
→ completed | partial
```

`market_investigation[]` fans out into independently durable, bounded jobs.

## 11. Prompt and context architecture

Every invocation contains:

1. a global versioned methodology without industry answers;
2. a stage contract defining allowed claims, tools and Zod output;
3. mission objective, geography and constraints;
4. the smallest required structured snapshot.

Agents never receive the full transcript by default. The composer has no web
tool. The ranker receives only structured dimensions. The adversarial reviewer
does not receive the final ranking.

Tools remain business-specific and read-only. No agent receives generic fetch,
SQL, filesystem or send capabilities.

## 12. Confidentiality boundary

An invocation with access to internal documents never has access to web,
Unipile or another external tool. An invocation with external tools never
receives raw internal excerpts.

Only sanitized `ProductFact` objects cross that boundary. External query
construction accepts an allowlisted structure and passes a DLP scanner. This is
a technical data-flow constraint, not a prompt instruction.

The release gate includes a canary test with a unique internal secret and a
malicious public instruction. No crawler or Unipile query, URL, trace or log may
contain the canary.

Web content is returned in an evidence envelope, scripts are removed and
indirect prompt-injection fixtures are part of the evaluation corpus.

## 13. Sourcing protocol

The standard target is:

1. search for up to 20 matching accounts;
2. select up to 10 representative accounts;
3. locate at least two relevant functions per sampled account;
4. test whether proposed triggers are observable;
5. deduplicate web, CRM and LinkedIn results.

`SourcingTest` states are:

- `verified`
- `query_invalid`
- `provider_limited`
- `insufficient_coverage`
- `no_matches`
- `account_unavailable`
- `budget_exhausted`

Only `verified` affects executability. Other states leave sourcing `unknown`
and are never interpreted as proof that the market does not exist.

Account discovery starts with web and CRM data. Until Unipile account search is
validated live, Unipile is used only to associate people with known accounts.
The live contract gate requires bounded pagination, timeouts, 403/429 handling,
read-only endpoints, at most 12 calls and at most three minutes per standard
sourcing test.

The report states explicitly: no import, invitation or message was sent.

## 14. Budget, reliability and fairness

The global execution deadline is depth-aware and excludes queue wait time:
30 minutes for `quick`, 60 minutes for `standard` and 90 minutes for `deep`.
Each role also has a bounded wall-clock budget sized for its K3 reasoning tier.

Standard bounds:

- at most eight hypotheses in the shallow scan;
- at most four deep investigations;
- sourcing for at most the top three research candidates;
- all remaining candidates become `not_investigated` when budget stops work.

The run is `complete` only when every required stage within those bounds
finished. A stage or global budget exhaustion is terminal but successful at the
run level: the run becomes `partial`, preserves every completed checkpoint and
projects a report that names missing stages. Budget exhaustion never leaves a
V3 run as a bare `interrupted` status. `interrupted` remains reserved for
non-budget terminal failures that require recovery.

A durable tool-request registry stores normalized input hash, status, output
reference and content hash. Successful results are reused within a run. A
missing in-memory crawler job or polling 404 is retryable and reissued with the
same idempotency key.

“Exact resume” means no verified work is lost or duplicated. It does not mean
the external web remains unchanged.

Kimi calls use global and workspace concurrency limits, `Retry-After`, quota
circuit breaking and no fallback that resembles a completed audit.

The database enforces one active run per workspace. Queue leasing must remain
fair when another workspace has a large fan-out.

## 15. UX contract

The report displays:

- mission objective and methodology version;
- run status: queued, running, complete, partial or interrupted;
- hypothesis coverage: generated, scanned, investigated, sourced and skipped
  by budget;
- origin badge for every ICP;
- sourcing status for every ICP;
- observed, inferred, unknown and contradicted at claim level;
- separate attractiveness, executability and confidence;
- one primary next action.

When objective ranking returns at least one proposal, rank one is automatically
persisted as an approved immutable `ICPVersion` in the same transaction as the
final checkpoint and its outbox event. The primary action then becomes
`Trouver des prospects pour cet ICP` and links to discovery with that version.
No human publication action is required in V3. A partial report without a final
ranked proposal is never auto-published and keeps `Relancer une étude` as its
next action. Every projected partial candidate remains explicitly unverified.

The main UI uses commercial language. Agent names, checkpoints and graph
internals remain secondary diagnostic details.

A user must understand in less than ten seconds why an ICP is proposed, its
confidence, whether sourcing ran and what to do next.

## 16. Evaluation strategy

Evaluation never asserts that the correct answer is a fixed sector list.

### Deterministic invariants

- no predefined industry in global method prompts or selection policy;
- every material claim linked to an observation or marked unknown;
- workspace isolation;
- no external writes during research;
- no internal content in external queries.

### Anti-bias tests

- landing sector examples cannot improve a rank without external evidence;
- removing evidence changes coverage or confidence;
- syndicated copies remain one origin family;
- renaming a sector without changing observations does not change dimensions;
- promotional pages do not become observed buyer demand by repetition.

### Discovery quality

Human reviewers create hidden sets of acceptable problem–organization
hypotheses for diverse evaluation products. The system measures defensible
recall at K and inter-reviewer rubric agreement without demanding identical
labels.

### Commercial outcomes

Account eligibility, confirmed pain, qualified replies, meetings and paid
pilots are downstream measurements. They do not silently rewrite the global
method or become a pure score of research quality.

## 17. Operational gates

V3 cannot replace V2 until all of these pass:

1. DLP canary and indirect prompt-injection tests show zero exfiltration.
2. Crawler `kill -9`, disappeared-job and cache tests resume without lost or
   duplicated durable evidence.
3. Live Unipile sourcing satisfies the bounded read-only contract.
4. On the target VPS, 15 standard runs across three products yield at least
   14 runs within 25 minutes and none over 30 minutes.
5. Production Compose includes pinned images, healthchecks, restart policies
   and declared CPU/RAM limits; no OOM or sustained saturation occurs, and RSS
   remains below 80 percent of RAM during a standard run.
6. DNS-rebinding, private redirect and subresource black-box tests show zero
   packet reaching private or metadata addresses.
7. PostgreSQL growth remains under 20 MB per standard run; TTL cleanup and
   backup/restore of a resolvable report pass.
8. Per-run observability exposes model calls and tokens, crawler searches and
   pages, Unipile calls, embedding use, CPU duration and persisted bytes.

## 18. Incremental delivery

The first V3 increment is one end-to-end vertical slice evaluated on three
different products. It includes the core objects, at most four investigations,
read-only sourcing, an honest report and the critical security/reliability
gates.

Deferred until the slice proves value:

- automated shadow rollout;
- global learning from corrections;
- complete evidence-graph visualization;
- paid enrichment providers;
- ultra-fine replay of an interrupted agent conversation.

Human corrections remain scoped to the run or workspace. A global method
change requires an explicit versioned code and evaluation change.

## 19. Migration

V2 runs remain readable with their methodology and prompt version. They are not
silently recomputed. The existing IgnitionRAG benchmark-shaped report must not
be presented as an independent market validation.

V3 is introduced as a separate research version. V2 remains active until the
V3 release gates pass.

## 20. Decision log

| Decision | Alternatives considered | Resolution |
|---|---|---|
| Result level | Market idea, prospectable ICP, commercially validated ICP | Produce prospectable ICP; validate commercially downstream |
| Landing influence | Ignore, privilege, or use as neutral hypothesis source | Neutral hypothesis source only |
| Discovery starting point | Organization, problem or competitor | Problem-first; competitors validate |
| ICP identity | Company, persona or contextual triplet | Organization × use case × buying context |
| Evidence | Source count, free model judgment or graded semantics | Graded claim-level evidence |
| Ranking objective | Revenue, strategy or configurable | Configurable; qualified conversations by default |
| Adjacent markets | Exclude, mix or separate | Separate experiment lane |
| Output count | Exactly five, exhaustive or variable | Zero to five, no filler |
| Prospectability | Criteria only, read-only test or auto-import | Read-only sourcing test |
| Sourcing data | Web, web plus existing channels, or paid providers | Web + CRM + bounded Unipile; paid providers deferred |
| Standard latency | 5–10, 15–25 or 45–75 minutes | 15–25 minute target with global deadline |
| Concurrency | Unlimited or per-workspace | One active run per workspace with global fairness |
| Internal documents | Full, excerpts or no provider use | Minimal excerpts; revised to strict internal/external invocation separation |
| Failure behavior | Fail all, opaque partial or durable partial | Explicit durable partial and exact resume semantics |
| Method customization | Global, versioned core or workspace prompts | Versioned global core with workspace objectives/constraints |
| Evaluation | Exact labels, rubric or LLM judge | Rubric, anti-bias invariants and later commercial outcomes |
| Architecture | One Deep Agent, staged pipeline or agent jury | Staged pipeline; bounded parallel investigation |
| Runtime | Bun plus crawler, or additional Python AI service | Bun/LangChain.js; Python crawler only |
| Retention | Keep all, delete all or differentiated | Durable evidence capsules; temporary full pages and raw outputs |
| Migration | Mutate V2 or introduce V3 | Separate V3, gated replacement |

## 21. Structured review record

### Skeptic

Initial disposition: `REVISE`. Accepted objections included promotion
ambiguity, unobservable commercial dimensions, evaluation recall, impossible
unbounded latency, provider-confounded sourcing, evidence independence,
landing anchoring, source authority, saturation, resume semantics, retention,
prompt injection, YAGNI and correction scope.

### Constraint Guardian

Disposition: `REVISE`. Accepted operational gates include global SLO, technical
anti-exfiltration boundary, durable crawler cache, live Unipile contract, Kimi
circuit breaking, black-box SSRF validation, production VPS limits, workspace
fairness, storage lifecycle and run-level observability.

### User Advocate

Disposition: `REVISE`. Accepted UX invariants prevent confusion between product
hints and external discovery, hypothesis and commercial validation, provider
failure and absent market, partial and complete research, or sourced and
untested candidates.

### Arbiter

Final disposition: `APPROVED`. All material objections were accepted and
resolved. Approval covers the design only and does not authorize V3 to replace
V2 before the operational gates pass.

# MCP canary validation — 2026-09-10

Status: local development evidence; no VPS deployment or external delivery acceptance.

## Scope and provenance

The pending MCP changes were copied from the dirty main checkout into a separate
worktree based on `f116092e492bc787b23dbf14b6be5d475ff43231`. The original checkout,
Setup IA worktree and Hermes were not modified. No provider recipient was contacted.

The MCP lot expands the catalog to 49 tools and adds public OAuth dynamic client
registration. Review also corrected streamed request limits, pagination, offer draft
revision guards, preparation defaults, LinkedIn destination checks and email reply
identifier conversion. Preparation defaults to `executeWhenAllowed: false` even for
owners; explicit execution still requires the proper scopes and final business policy.

## Catalog classification

Every tool below is bound to the authenticated workspace. Categories describe possible
consequences, not client-side authorization: an MCP annotation is never an access check.

| Classification | Tools | Boundary |
| --- | --- | --- |
| Read only | `workspace_get_summary`, `crm_search`, `company_get_brief`, `prospect_get_360`, `pipeline_list`, `opportunity_get`, `conversation_list`, `conversation_get`, `campaign_list`, `campaign_get_status`, `offer_list`, `offer_get`, `research_list`, `research_get`, `call_list`, `knowledge_source_list`, `knowledge_claim_list`, `content_get_calendar`, `content_autopilot_get`, `operations_get_health`, `operation_get`, `approval_list`, `approval_get` | Read scopes, active membership, workspace filtering and role redaction. |
| Diagnostic read only | `noosphere_ping`, `tracer` | Protocol diagnostics, no business mutation. |
| Internal record or draft creation/update | `company_upsert`, `contact_upsert`, `opportunity_update`, `opportunity_change_stage`, `prospect_add_note`, `content_idea_create`, `content_draft_create`, `prospect_schedule_dry_run`, `offer_create`, `offer_update`, `campaign_create`, `knowledge_source_create`, `knowledge_claim_create` | Operator/admin/owner plus `mcp:write`; request-key replay ledger. No delivery confirmation is implied. |
| Internal approval or authoritative version | `offer_publish`, `knowledge_source_validate`, `knowledge_claim_validate` | Same write-role gate; changes the evidence/configuration agents can use. Publishing an offer creates an immutable internal version, not a social post. |
| Authorized autonomous job | `research_launch` | Durable research job; may invoke configured AI services. Queued state is not completed research. |
| Automation administration | `conversation_set_automation`, `content_autopilot_configure` | Write-role gate, not instance administration. These settings can enable future jobs under workspace policy and must not be presented as harmless drafts. |
| Governed action preparation | `conversation_prepare_reply`, `content_prepare_publication`, `meeting_prepare_proposal`, `campaign_prepare_activation` | Default proposal only. Explicit `executeWhenAllowed: true` can request execution for a qualified owner/admin; final business policy still applies. Campaign activation execution adapter is unavailable. |
| Governed action approval | `approval_decide` | Approval role/scope and durable policy checks; acceptance/queueing does not prove delivery. |

Total: 23 business reads + 2 diagnostics + 13 internal writes + 3 authoritative
mutations + 1 research job + 2 automation settings + 4 preparations + 1 decision = 49.

## Regression evidence

- Full `bun run check` passed before the final offer-publication guard: 1,007
  unit/HTTP tests, crawler checks, typecheck, architecture checks and production build.
- `MCP_LOCAL_FIXTURES_INTEGRATION=1 MCP_LOCAL_GOVERNED_EFFECTS_INTEGRATION=1
  bun run test:integration` passed: 279 tests, 4 environment-specific skips.
- LinkedIn fixtures reject wrong CRM recipient, foreign account and group thread before
  POST; verified direct threads send once. An independent email still succeeds when
  LinkedIn verification fails.
- Email fixtures resolve the local Unipile email ID to the upstream `provider_id`,
  reject wrong-account/missing/mismatched identities before POST, and exercise the
  governed, manual and automatic reply call sites.
- A successful HTTP response without a message/invitation identity is `unknown`, never
  an invented success. Read preflight failures remain `not_sent`.
- Shared-email-account, multi-campaign regression scopes the inbound event to its
  conversation and campaign; replaying the event does not duplicate classification.
- Existing integration suites cover durable replay, ambiguous provider results,
  reconciliation and expired execution leases. These are controlled fixtures, not
  evidence of a real worker being killed during an external send.

Unipile v1 identifier contracts were checked against the official
[email object](https://developer.unipile.com/docs/email-object),
[send email](https://developer.unipile.com/docs/send-email) and
[chat attendees](https://developer.unipile.com/reference/chatscontroller_listattendees)
documentation. Real account response compatibility remains to be accepted.

## Combined Setup IA and MCP validation

The isolated branch now contains both lots, with journal indexes and timestamps in
strict order from `0107` through `0116`. Conflicts preserved the expanded catalog,
transactional repositories, `AI_SETUP_REQUIRED`, and shared instance AI availability.

- Combined `bun run check`: 1,072 unit/HTTP tests, 43 crawler tests, typecheck,
  architecture/self-hosting checks and production build passed.
- Final combined integration suite: 316 passed, 4 skipped; includes migration from the
  pre-Setup schema and the offer-publication concurrency guard.
- Follow-up composition regression: 3 PostgreSQL tests / 19 assertions passed after
  reproducing missing AI checks in MCP research/autopilot constructors. Research
  rejection rolls back its draft, job and write ledger. Disabling autopilot remains
  possible without an available model.
- Follow-up SDK annotation regression: provider-backed jobs expose `openWorldHint`;
  automation replacements expose `destructiveHint`. Roles and scopes are unchanged.
- A fresh database applied the full combined journal. Against that database, Caddy
  HTTPS and both official SDK paths passed isolation, redaction, revocation and rate
  limiting. HTTPS dynamic registration returned 201 with no client secret; database
  inspection confirmed the client has no user/workspace binding before consent.
- Authenticated desktop/mobile browser verification: 44 passed, zero skips. The
  first run had 2 conditional no-AI skips because a synthetic Kimi key was present;
  rerunning with all environment API keys absent exercised all 44 journeys.
- Combined database dump/restore to a fresh `template0` database passed: one
  synthetic company, one write ledger entry and its accepted audit survived. The
  dump was 669,694 bytes and stored with mode 0600. This remains local PostgreSQL
  evidence, not an off-site backup or object-storage restore.

## Local HTTPS, restart and database restoration

These separate checks ran on Setup IA commit `9429429`, before this MCP lot. They
therefore prove the existing edge/persistence path, not the new dynamic registration
or expanded catalog. The API and Caddy were local, bound to loopback only.

- Caddy HTTPS on `https://localhost:18443`, private local CA, official MCP SDK.
- Modern and legacy SDK paths passed; rate limit, foreign-workspace isolation,
  viewer redaction and active-membership revocation passed.
- Synthetic company creation returned a persisted result. After gracefully restarting
  the API process, replaying the exact request key returned that same result.
- Database checks found exactly one company, one write-operation ledger entry and
  one accepted MCP OAuth audit event for that operation.
- A custom-format PostgreSQL dump was restored into a fresh `template0` database.
  The same three persisted records survived. An initial restore into the default
  template failed due to the pre-existing ParadeDB schema; no database was deleted.
- SDK checks passed again after restart with the persisted token identities.

Tokens were seeded through the repository smoke fixture with hashed opaque bearers.
This is not an interactive authorization-code/consent flow, a publicly reachable
ChatGPT connection, an off-site Restic restore, or a storage-object restore.

## Migration and deployment gates

The MCP journal includes dynamic registration migration `0107` and the additive
`0116_offer_draft_revision.sql`. Setup IA has migrations `0108` through `0115`.
The combined journal now contains all migrations in that order. Before any
VPS application, inspect the target migration history: applying Setup IA first and then an older migration can cause
Drizzle to skip the older entry. No production migration has been applied.

The draft revision counter is separate from published offer versions. Existing data
is preserved; migrations remain forward-only. Rollback must restore the exact
recorded application images and preserve the database and encryption key.

Hosted CI is blocked by the unsuppressed NLTK dependency advisory documented in the
baseline report. VPS address/access, public DNS/HTTPS and an explicitly authorized
provider recipient are still missing. No deployed commit or live-delivery success
is claimed. Canary promotion and risky migration/permission approval remain open.

## Restart audit correlation correction

The combined HTTPS replay preserved the entity and ledger but exposed an existing
bootstrap defect: seven internal-write paths generated a different correlation UUID
from the accepted OAuth audit. The response still had a valid `auditId`, but tracing
by `correlationId` could not join the records. All seven paths now retain the atomic
write correlation; note events and dry-run jobs receive it too. Historical ledger
results remain immutable.

Six concrete commands reproduced the mismatch (6 red tests). After correction,
6 PostgreSQL tests / 39 assertions and TypeScript passed. A new synthetic HTTPS
write was then replayed after another graceful API process restart: the exact
result survived, the catalog contained 49 tools, and the entity, ledger and accepted
audit each matched once, including the same correlation UUID. This is API restart
evidence, not interruption of an external-send worker.

Hosted [Check run 34471406649](https://github.com/IgnitionAI/noosphere/actions/runs/34471406649)
passed migrations, repository checks and Bun audit on combined commit `675f6a4`.
It failed the crawler audit on `nltk 3.10.3 / PYSEC-2026-3740`; subsequent hosted
integration/browser steps did not run. The final correlation-only patch has local
regression/type evidence; the hosted run above predates it. No audit suppression
or weakening was introduced.

## Reproduction and remaining acceptance

From this branch, with dedicated disposable database URLs supplied privately:

```sh
bun run check
MCP_LOCAL_FIXTURES_INTEGRATION=1 MCP_LOCAL_GOVERNED_EFFECTS_INTEGRATION=1 bun run test:integration
E2E_CONTROLLED_CODEX=true bun run test:e2e
```

The browser run additionally requires the isolated fixture executable
`tests/fixtures/codex-service-fixture.ts` as `CODEX_BINARY_PATH`, a private temporary
`INSTANCE_CODEX_HOME`, and absent environment API keys to cover no-AI journeys.
The integration runner only resets the explicitly dedicated test database.

Related draft PRs: [baseline #94](https://github.com/IgnitionAI/noosphere/pull/94),
[Setup IA #95](https://github.com/IgnitionAI/noosphere/pull/95),
[MCP #96](https://github.com/IgnitionAI/noosphere/pull/96). The stacked PR requires
explicit workflow dispatch because Check triggers automatically only for PRs into
main/dev: `gh workflow run check.yml --ref fix/canary-mcp-contracts`.

Before the external-recipient scenario, obtain the dedicated Noosphere SSH target,
verify its identity/DNS/backups, and receive an explicitly authorized test account
and recipient. No existing account should be inferred as that authorization.
Resume the governed reply with this exact MCP shape only after selecting and
verifying that authorized conversation and the approved message:

```json
{"name":"conversation_prepare_reply","arguments":{"requestKey":"<fresh UUID>","conversationId":"<authorized test conversation UUID>","body":"<approved test message>","executeWhenAllowed":true}}
```

For a role requiring approval, use the returned approval item through
`approval_decide`; read the returned durable operation through `operation_get`.
Neither a queued response nor an accepted proposal is delivery proof. Record the
provider confirmation, ingested reply, CRM/inbox reconciliation and controlled
worker interruption before declaring the live loop complete. This command is a
resume contract, not evidence that the missing external scenario ran.

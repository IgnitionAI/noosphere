import type {
  ContextReceiptRecorder,
  ProspectMemoryEventRepository,
  ProspectMemoryPolicy,
  ProspectMemoryPolicyReader,
  ProspectMemoryPolicyWriter,
  ProspectMemorySnapshotRepository,
} from "@outbound/application/prospect-memory/prospect-memory";
import { disabledProspectMemoryFeatureFlags } from "@outbound/application/prospect-memory/prospect-memory";
import { aiProviderIds, type AiProviderId } from "@outbound/application/ai/model-gateway";
import {
  PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  PROSPECT_MEMORY_RENDERER_VERSION,
  PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
  prospectMemoryCapabilities,
  prospectMemoryEventKinds,
  prospectMemoryStatuses,
  type ContextReceipt,
  type ProspectMemoryAssertion,
  type ProspectMemoryCapability,
  type ProspectMemoryEvent,
  type ProspectMemoryEventKind,
  type ProspectMemorySnapshot,
  type ProspectMemoryStatus,
} from "@outbound/domain/prospect-memory/prospect-memory";
import type { SqlClient } from "@outbound/infrastructure/database/client";

interface MemoryEventRow {
  id: string;
  sequence_id: string | number;
  workspace_id: string;
  source_contact_id: string;
  canonical_contact_id: string;
  source_kind: string;
  source_id: string;
  source_version: string | number;
  kind: string;
  occurred_at: Date;
  observed_at: Date;
  valid_from: Date;
  valid_to: Date | null;
  supersedes_event_id: string | null;
  payload: unknown;
  schema_version: number;
  inserted?: boolean;
}

interface SnapshotRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  version: number;
  watermark: string | number;
  first_sequence_id: string | number;
  privacy_epoch: number;
  status: string;
  current_state: unknown;
  commercial_state: unknown;
  assertions: unknown;
  relationship_summary: string;
  recommended_tone: string | null;
  contradictions: unknown;
  missing_information: unknown;
  model_provider: string | null;
  model: string | null;
  prompt_version: string;
  policy_version: string;
  schema_version: number;
  renderer_version: number;
  content_hash: string;
  generated_at: Date;
}

export class PostgresProspectMemoryEventRepository implements ProspectMemoryEventRepository {
  constructor(private readonly sql: SqlClient) {}

  async append(
    input: Omit<ProspectMemoryEvent, "id" | "sequenceId">,
  ): Promise<{ readonly inserted: boolean; readonly event: ProspectMemoryEvent }> {
    if (input.validFrom > input.observedAt) {
      throw new Error("PROSPECT_MEMORY_FUTURE_VALIDITY_UNSUPPORTED");
    }
    if (input.validTo && input.validTo <= input.validFrom) {
      throw new Error("PROSPECT_MEMORY_VALIDITY_INVALID");
    }
    const payload = this.sql.json(input.payload as never);
    const rows = await this.sql<MemoryEventRow[]>`
      with inserted as (
        insert into prospect_memory_events (
          workspace_id, source_contact_id, canonical_contact_id,
          source_kind, source_id, source_version, kind,
          occurred_at, observed_at, valid_from, valid_to,
          supersedes_event_id, payload, schema_version
        ) values (
          ${input.workspaceId}, ${input.sourceContactId}, ${input.canonicalContactId},
          ${input.sourceKind}, ${input.sourceId}, ${input.sourceVersion}, ${input.kind},
          ${input.occurredAt}, ${input.observedAt}, ${input.validFrom}, ${input.validTo},
          ${input.supersedesEventId}, ${payload}, ${input.schemaVersion}
        )
        on conflict (workspace_id, source_kind, source_id, source_version) do nothing
        returning *, true as inserted
      )
      select * from inserted
      union all
      select existing.*, false as inserted
      from prospect_memory_events existing
      where existing.workspace_id = ${input.workspaceId}
        and existing.source_kind = ${input.sourceKind}
        and existing.source_id = ${input.sourceId}
        and existing.source_version = ${input.sourceVersion}
        and not exists (select 1 from inserted)
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("PROSPECT_MEMORY_EVENT_APPEND_FAILED");
    return { inserted: row.inserted === true, event: memoryEventFromRow(row) };
  }

  async listAfter(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly sequenceId: number;
    readonly targetSequenceId?: number;
    readonly limit: number;
  }): Promise<readonly ProspectMemoryEvent[]> {
    if (!Number.isSafeInteger(input.sequenceId) || input.sequenceId < 0) {
      throw new Error("PROSPECT_MEMORY_SEQUENCE_INVALID");
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error("PROSPECT_MEMORY_EVENT_LIMIT_INVALID");
    }
    const target = input.targetSequenceId ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(target) || target < input.sequenceId) {
      throw new Error("PROSPECT_MEMORY_TARGET_SEQUENCE_INVALID");
    }
    const rows = await this.sql<MemoryEventRow[]>`
      select *
      from prospect_memory_events
      where workspace_id = ${input.workspaceId}
        and (
          canonical_contact_id = ${input.contactId}
          or source_contact_id = ${input.contactId}
          or source_contact_id in (
            select id from contacts
            where workspace_id = ${input.workspaceId}
              and merged_into_id = ${input.contactId}
          )
        )
        and sequence_id > ${input.sequenceId}
        and sequence_id <= ${target}
      order by sequence_id asc
      limit ${input.limit}
    `;
    return rows.map(memoryEventFromRow);
  }

  async latestSequence(workspaceId: string, contactId: string): Promise<number> {
    const rows = await this.sql<{ sequence_id: string | number | null }[]>`
      select max(sequence_id) as sequence_id
      from prospect_memory_events
      where workspace_id = ${workspaceId}
        and (
          canonical_contact_id = ${contactId}
          or source_contact_id = ${contactId}
          or source_contact_id in (
            select id from contacts
            where workspace_id = ${workspaceId}
              and merged_into_id = ${contactId}
          )
        )
    `;
    return safeInteger(rows[0]?.sequence_id ?? 0, "PROSPECT_MEMORY_SEQUENCE_UNSAFE");
  }

  async aggregateValidEventKinds(input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly asOf: Date;
  }): Promise<Readonly<Partial<Record<ProspectMemoryEventKind, number>>>> {
    const rows = await this.sql<{ kind: string; value: string | number }[]>`
      select event.kind, count(*) as value
      from prospect_memory_events event
      where event.workspace_id = ${input.workspaceId}
        and (
          event.canonical_contact_id = ${input.contactId}
          or event.source_contact_id = ${input.contactId}
          or event.source_contact_id in (
            select id from contacts
            where workspace_id = ${input.workspaceId}
              and merged_into_id = ${input.contactId}
          )
        )
        and event.valid_from <= ${input.asOf}
        and (event.valid_to is null or event.valid_to > ${input.asOf})
        and not exists (
          select 1
          from prospect_memory_events superseder
          where superseder.workspace_id = event.workspace_id
            and superseder.supersedes_event_id = event.id
            and superseder.valid_from <= ${input.asOf}
            and (superseder.valid_to is null or superseder.valid_to > ${input.asOf})
        )
      group by event.kind
    `;
    const result: Partial<Record<ProspectMemoryEventKind, number>> = {};
    for (const row of rows) {
      if (!prospectMemoryEventKinds.includes(row.kind as ProspectMemoryEventKind)) continue;
      result[row.kind as ProspectMemoryEventKind] = safeInteger(
        row.value,
        "PROSPECT_MEMORY_AGGREGATE_COUNT_UNSAFE",
      );
    }
    return result;
  }
}

export class PostgresProspectMemorySnapshotRepository implements ProspectMemorySnapshotRepository {
  constructor(private readonly sql: SqlClient) {}

  async findCurrent(workspaceId: string, contactId: string): Promise<ProspectMemorySnapshot | null> {
    const rows = await this.sql<SnapshotRow[]>`
      select snapshot.*
      from prospect_memory_snapshots snapshot
      join contacts contact
        on contact.workspace_id = snapshot.workspace_id
       and contact.id = snapshot.contact_id
      where snapshot.workspace_id = ${workspaceId}
        and snapshot.contact_id = ${contactId}
        and snapshot.superseded_at is null
        and snapshot.invalidated_at is null
        and snapshot.privacy_epoch = contact.privacy_epoch
        and contact.anonymized_at is null
      limit 1
    `;
    return rows[0] ? snapshotFromRow(rows[0]) : null;
  }

  async publishIfCurrent(input: {
    readonly snapshot: ProspectMemorySnapshot;
    readonly expectedVersion: number;
    readonly expectedPrivacyEpoch: number;
  }): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const contactRows = await transaction<{ privacy_epoch: number; anonymized_at: Date | null }[]>`
        select privacy_epoch, anonymized_at
        from contacts
        where workspace_id = ${input.snapshot.workspaceId}
          and id = ${input.snapshot.contactId}
        for update
      `;
      const contact = contactRows[0];
      if (
        !contact
        || contact.anonymized_at
        || contact.privacy_epoch !== input.expectedPrivacyEpoch
        || input.snapshot.privacyEpoch !== input.expectedPrivacyEpoch
      ) return false;

      const currentRows = await transaction<{ id: string; version: number }[]>`
        select id, version
        from prospect_memory_snapshots
        where workspace_id = ${input.snapshot.workspaceId}
          and contact_id = ${input.snapshot.contactId}
          and superseded_at is null
          and invalidated_at is null
        for update
      `;
      const current = currentRows[0] ?? null;
      if ((current?.version ?? 0) !== input.expectedVersion) return false;

      if (current) {
        await transaction`
          update prospect_memory_snapshots
          set superseded_at = ${input.snapshot.generatedAt}
          where id = ${current.id}
        `;
      }

      await transaction`
        insert into prospect_memory_snapshots (
          id, workspace_id, contact_id, version, watermark, first_sequence_id,
          privacy_epoch, status, current_state, commercial_state, assertions,
          relationship_summary, recommended_tone, contradictions, missing_information,
          model_provider, model, prompt_version, policy_version, schema_version,
          renderer_version, content_hash, generated_at
        ) values (
          ${input.snapshot.id}, ${input.snapshot.workspaceId}, ${input.snapshot.contactId},
          ${input.snapshot.version}, ${input.snapshot.watermark}, ${input.snapshot.firstSequenceId},
          ${input.snapshot.privacyEpoch}, ${input.snapshot.status},
          ${transaction.json(input.snapshot.currentState as never)},
          ${transaction.json(input.snapshot.commercialState as never)},
          ${transaction.json(input.snapshot.assertions as never)},
          ${input.snapshot.relationshipSummary}, ${input.snapshot.recommendedTone},
          ${transaction.json(input.snapshot.contradictions as never)},
          ${transaction.json(input.snapshot.missingInformation as never)},
          ${input.snapshot.modelProvider}, ${input.snapshot.model}, ${input.snapshot.promptVersion},
          ${input.snapshot.policyVersion}, ${input.snapshot.schemaVersion},
          ${input.snapshot.rendererVersion}, ${input.snapshot.contentHash}, ${input.snapshot.generatedAt}
        )
      `;
      return true;
    });
  }
}

export class PostgresContextReceiptRecorder implements ContextReceiptRecorder {
  constructor(private readonly sql: SqlClient) {}

  async record(receipt: ContextReceipt): Promise<string> {
    const sourceEventIds = this.sql.json(receipt.sourceEventIds as never);
    const sourceHashes = this.sql.json(receipt.sourceHashes as never);
    const excludedSourceEventIds = this.sql.json(receipt.excludedSourceEventIds as never);
    const normalizedRetrievalQueries = this.sql.json(receipt.normalizedRetrievalQueries as never);
    const rows = await this.sql<ReceiptIdentityRow[]>`
      with inserted as (
        insert into prospect_memory_context_receipts (
          id, workspace_id, contact_id, request_key, capability,
          snapshot_id, snapshot_version, watermark, privacy_epoch, renderer_version,
          source_event_ids, source_hashes, excluded_source_event_ids,
          normalized_retrieval_queries, estimated_input_tokens, context_hash, created_at
        ) values (
          ${receipt.id}, ${receipt.workspaceId}, ${receipt.contactId}, ${receipt.requestKey}, ${receipt.capability},
          ${receipt.snapshotId}, ${receipt.snapshotVersion}, ${receipt.watermark},
          ${receipt.privacyEpoch}, ${receipt.rendererVersion},
          ${sourceEventIds}, ${sourceHashes}, ${excludedSourceEventIds},
          ${normalizedRetrievalQueries}, ${receipt.estimatedInputTokens}, ${receipt.contextHash}, ${receipt.createdAt}
        )
        on conflict (workspace_id, request_key) do nothing
        returning id, contact_id, capability, snapshot_id, snapshot_version,
                  watermark, privacy_epoch, renderer_version, source_event_ids,
                  source_hashes, excluded_source_event_ids, normalized_retrieval_queries,
                  estimated_input_tokens, context_hash
      )
      select * from inserted
      union all
      select existing.id, existing.contact_id, existing.capability,
             existing.snapshot_id, existing.snapshot_version, existing.watermark,
             existing.privacy_epoch, existing.renderer_version,
             existing.source_event_ids, existing.source_hashes,
             existing.excluded_source_event_ids, existing.normalized_retrieval_queries,
             existing.estimated_input_tokens, existing.context_hash
      from prospect_memory_context_receipts existing
      where existing.workspace_id = ${receipt.workspaceId}
        and existing.request_key = ${receipt.requestKey}
        and not exists (select 1 from inserted)
      limit 1
    `;
    const persisted = rows[0];
    if (!persisted) throw new Error("PROSPECT_MEMORY_RECEIPT_WRITE_FAILED");
    if (!sameReceiptIdentity(persisted, receipt)) {
      throw new Error("PROSPECT_MEMORY_RECEIPT_REQUEST_KEY_REUSED");
    }
    return persisted.id;
  }
}

interface ReceiptIdentityRow {
  readonly id: string;
  readonly contact_id: string;
  readonly capability: string;
  readonly snapshot_id: string | null;
  readonly snapshot_version: number | null;
  readonly watermark: string | number;
  readonly privacy_epoch: number;
  readonly renderer_version: number;
  readonly source_event_ids: unknown;
  readonly source_hashes: unknown;
  readonly excluded_source_event_ids: unknown;
  readonly normalized_retrieval_queries: unknown;
  readonly estimated_input_tokens: number;
  readonly context_hash: string;
}

function sameReceiptIdentity(row: ReceiptIdentityRow, receipt: ContextReceipt): boolean {
  return row.contact_id === receipt.contactId
    && row.capability === receipt.capability
    && row.snapshot_id === receipt.snapshotId
    && row.snapshot_version === receipt.snapshotVersion
    && safeInteger(row.watermark, "PROSPECT_MEMORY_RECEIPT_WATERMARK_UNSAFE") === receipt.watermark
    && row.privacy_epoch === receipt.privacyEpoch
    && row.renderer_version === receipt.rendererVersion
    && row.estimated_input_tokens === receipt.estimatedInputTokens
    && row.context_hash === receipt.contextHash
    && sameJson(row.source_event_ids, receipt.sourceEventIds)
    && sameJson(row.source_hashes, receipt.sourceHashes)
    && sameJson(row.excluded_source_event_ids, receipt.excludedSourceEventIds)
    && sameJson(row.normalized_retrieval_queries, receipt.normalizedRetrievalQueries);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class PostgresProspectMemoryPolicyReader implements ProspectMemoryPolicyReader, ProspectMemoryPolicyWriter {
  constructor(private readonly sql: SqlClient) {}

  async find(workspaceId: string): Promise<ProspectMemoryPolicy> {
    const rows = await this.sql<{
      capture_enabled: boolean;
      shadow_enabled: boolean;
      setter_enabled: boolean;
      enabled_capabilities: unknown;
      processing_profiles: unknown;
      max_daily_semantic_refreshes: number;
      max_daily_cost_usd: string | number;
    }[]>`
      select capture_enabled, shadow_enabled, setter_enabled, enabled_capabilities,
             processing_profiles, max_daily_semantic_refreshes, max_daily_cost_usd
      from workspace_prospect_memory_settings
      where workspace_id = ${workspaceId}
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      return {
        flags: disabledProspectMemoryFeatureFlags,
        processingProfiles: [],
        maxDailySemanticRefreshes: 0,
        maxDailyCostUsd: 0,
      };
    }
    return {
      flags: {
        prospectMemoryCapture: row.capture_enabled,
        prospectMemoryShadow: row.shadow_enabled,
        prospectMemorySetter: row.setter_enabled,
        enabledCapabilities: parseCapabilities(row.enabled_capabilities),
      },
      processingProfiles: parseProcessingProfiles(row.processing_profiles),
      maxDailySemanticRefreshes: row.max_daily_semantic_refreshes,
      maxDailyCostUsd: Number(row.max_daily_cost_usd),
    };
  }

  async save(input: Parameters<ProspectMemoryPolicyWriter["save"]>[0]): Promise<ProspectMemoryPolicy> {
    await this.sql`
      insert into workspace_prospect_memory_settings (
        workspace_id, capture_enabled, shadow_enabled, setter_enabled,
        enabled_capabilities, processing_profiles,
        max_daily_semantic_refreshes, max_daily_cost_usd,
        updated_by, created_at, updated_at
      ) values (
        ${input.workspaceId},
        ${input.policy.flags.prospectMemoryCapture},
        ${input.policy.flags.prospectMemoryShadow},
        ${input.policy.flags.prospectMemorySetter},
        ${this.sql.json(input.policy.flags.enabledCapabilities as never)},
        ${this.sql.json(input.policy.processingProfiles.map((profile) => ({
          ...profile,
          reviewedAt: profile.reviewedAt.toISOString(),
        })) as never)},
        ${input.policy.maxDailySemanticRefreshes},
        ${input.policy.maxDailyCostUsd},
        ${input.updatedBy},
        ${input.updatedAt},
        ${input.updatedAt}
      )
      on conflict (workspace_id) do update set
        capture_enabled = excluded.capture_enabled,
        shadow_enabled = excluded.shadow_enabled,
        setter_enabled = excluded.setter_enabled,
        enabled_capabilities = excluded.enabled_capabilities,
        processing_profiles = excluded.processing_profiles,
        max_daily_semantic_refreshes = excluded.max_daily_semantic_refreshes,
        max_daily_cost_usd = excluded.max_daily_cost_usd,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `;
    return this.find(input.workspaceId);
  }
}

function memoryEventFromRow(row: MemoryEventRow): ProspectMemoryEvent {
  const sequenceId = safeInteger(row.sequence_id, "PROSPECT_MEMORY_SEQUENCE_UNSAFE");
  const kind = parseEventKind(row.kind);
  if (row.schema_version !== PROSPECT_MEMORY_EVENT_SCHEMA_VERSION) {
    throw new Error("PROSPECT_MEMORY_EVENT_SCHEMA_UNSUPPORTED");
  }
  return {
    id: row.id,
    sequenceId,
    workspaceId: row.workspace_id,
    sourceContactId: row.source_contact_id,
    canonicalContactId: row.canonical_contact_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceVersion: safeInteger(row.source_version, "PROSPECT_MEMORY_SOURCE_VERSION_UNSAFE"),
    kind,
    occurredAt: row.occurred_at,
    observedAt: row.observed_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    supersedesEventId: row.supersedes_event_id,
    payload: isRecord(row.payload) ? row.payload : {},
    schemaVersion: PROSPECT_MEMORY_EVENT_SCHEMA_VERSION,
  };
}

function snapshotFromRow(row: SnapshotRow): ProspectMemorySnapshot {
  if (row.schema_version !== PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("PROSPECT_MEMORY_SNAPSHOT_SCHEMA_UNSUPPORTED");
  }
  if (row.renderer_version !== PROSPECT_MEMORY_RENDERER_VERSION) {
    throw new Error("PROSPECT_MEMORY_RENDERER_UNSUPPORTED");
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    contactId: row.contact_id,
    version: row.version,
    watermark: safeInteger(row.watermark, "PROSPECT_MEMORY_WATERMARK_UNSAFE"),
    firstSequenceId: safeInteger(row.first_sequence_id, "PROSPECT_MEMORY_SEQUENCE_UNSAFE"),
    privacyEpoch: row.privacy_epoch,
    status: parseStatus(row.status),
    currentState: row.current_state as ProspectMemorySnapshot["currentState"],
    commercialState: row.commercial_state as ProspectMemorySnapshot["commercialState"],
    assertions: parseAssertions(row.assertions),
    relationshipSummary: row.relationship_summary,
    recommendedTone: row.recommended_tone,
    contradictions: parseStringArray(row.contradictions),
    missingInformation: parseStringArray(row.missing_information),
    modelProvider: row.model_provider,
    model: row.model,
    promptVersion: row.prompt_version,
    policyVersion: row.policy_version,
    schemaVersion: PROSPECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    rendererVersion: PROSPECT_MEMORY_RENDERER_VERSION,
    contentHash: row.content_hash,
    generatedAt: row.generated_at,
  };
}

function parseAssertions(value: unknown): readonly ProspectMemoryAssertion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((assertion) => ({
    ...(assertion as unknown as ProspectMemoryAssertion),
    validUntil: typeof assertion.validUntil === "string" ? new Date(assertion.validUntil) : null,
  }));
}

function parseCapabilities(value: unknown): readonly ProspectMemoryCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is ProspectMemoryCapability =>
    typeof candidate === "string"
    && (prospectMemoryCapabilities as readonly string[]).includes(candidate));
}

function parseProcessingProfiles(value: unknown): ProspectMemoryPolicy["processingProfiles"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const provider = typeof candidate.provider === "string" && (aiProviderIds as readonly string[]).includes(candidate.provider)
      ? candidate.provider as AiProviderId
      : null;
    if (!provider || candidate.encryptedInTransit !== true || candidate.trainingUse !== "none") return [];
    const reviewedAt = typeof candidate.reviewedAt === "string" ? new Date(candidate.reviewedAt) : null;
    const retention = Number(candidate.providerRetentionDays);
    const regionOrJurisdiction = typeof candidate.regionOrJurisdiction === "string"
      ? candidate.regionOrJurisdiction.trim()
      : "";
    const operatorAccessPolicy = typeof candidate.operatorAccessPolicy === "string"
      ? candidate.operatorAccessPolicy.trim()
      : "";
    const deletionProcedure = typeof candidate.deletionProcedure === "string"
      ? candidate.deletionProcedure.trim()
      : "";
    if (
      !reviewedAt
      || Number.isNaN(reviewedAt.getTime())
      || !Number.isInteger(retention)
      || retention < 0
      || !regionOrJurisdiction
      || !operatorAccessPolicy
      || candidate.subprocessorsReviewed !== true
      || !deletionProcedure
    ) return [];
    return [{
      provider,
      encryptedInTransit: true as const,
      trainingUse: "none" as const,
      providerRetentionDays: retention,
      regionOrJurisdiction,
      operatorAccessPolicy,
      subprocessorsReviewed: true as const,
      deletionProcedure,
      personalDataAllowed: candidate.personalDataAllowed === true,
      allowedCapabilities: parseCapabilities(candidate.allowedCapabilities),
      reviewedAt,
    }];
  });
}

function parseEventKind(value: string): ProspectMemoryEventKind {
  if (!(prospectMemoryEventKinds as readonly string[]).includes(value)) {
    throw new Error("PROSPECT_MEMORY_EVENT_KIND_UNSUPPORTED");
  }
  return value as ProspectMemoryEventKind;
}

function parseStatus(value: string): ProspectMemoryStatus {
  if (!(prospectMemoryStatuses as readonly string[]).includes(value)) {
    throw new Error("PROSPECT_MEMORY_STATUS_UNSUPPORTED");
  }
  return value as ProspectMemoryStatus;
}

function parseStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeInteger(value: string | number, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import {
  PROSPECT_MEMORY_BACKFILL_JOB_TYPE,
  type CaptureProspectMemoryMutationResult,
} from "@outbound/application/prospect-memory/prospect-memory";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { Database, SqlClient } from "@outbound/infrastructure/database/client";
import { eq } from "drizzle-orm";
import { workspaceProspectMemorySettings } from "@outbound/infrastructure/database/schema";
import { captureProspectMemoryMutation } from "./capture-prospect-memory-mutation";

const BACKFILL_SCHEMA_VERSION = 1;
const PAGE_SIZE = 100;
const stages = [
  "contacts",
  "identities",
  "employments",
  "messages",
  "campaigns",
  "decisions",
  "calls",
  "social",
] as const;
type BackfillStage = (typeof stages)[number];

interface BackfillPayload {
  readonly workspaceId: string;
  readonly stage: BackfillStage;
  readonly cursor: string | null;
  readonly captured: number;
  readonly excluded: number;
  readonly duplicates: number;
}

interface BackfillRow {
  readonly id: string;
  readonly contact_id: string;
  readonly occurred_at: Date;
  readonly source_kind: string;
  readonly kind: "message_received" | "message_sent" | "call_recorded" | "social_interaction" | "contact_updated" | "employment_updated" | "campaign_changed" | "decision_changed" | "identity_linked";
  readonly payload: Record<string, unknown>;
}

/**
 * Low-priority, restartable migration of authoritative rows into the memory
 * journal. Pages and rows have stable keys, so retrying after any crash is
 * harmless. The processor never invokes a model and never sends a message.
 */
export class ProspectMemoryBackfillJobProcessor {
  constructor(
    private readonly database: Database,
    private readonly sql: SqlClient,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    if (job.type !== PROSPECT_MEMORY_BACKFILL_JOB_TYPE) throw new Error("PROSPECT_MEMORY_BACKFILL_JOB_TYPE_INVALID");
    const payload = parsePayload(job);
    const rows = await this.#readPage(payload);
    let captured = payload.captured;
    let excluded = payload.excluded;
    let duplicates = payload.duplicates;

    if (rows.length) {
      const observedAt = this.clock.now();
      const results = await this.database.transaction(async (tx) => {
        const pageResults: CaptureProspectMemoryMutationResult[] = [];
        for (const row of rows) {
          pageResults.push(await captureProspectMemoryMutation(tx, {
            workspaceId: payload.workspaceId,
            sourceContactId: row.contact_id,
            sourceKind: row.source_kind,
            sourceId: row.id,
            sourceVersion: BACKFILL_SCHEMA_VERSION,
            kind: row.kind,
            occurredAt: row.occurred_at,
            observedAt,
            payload: row.payload,
            correlationId: `prospect-memory-backfill:${payload.workspaceId}:${payload.stage}`,
          }));
        }
        return pageResults;
      });
      for (const result of results) {
        if (result.outcome === "captured") captured += 1;
        else if (result.outcome === "duplicate") duplicates += 1;
        else excluded += 1;
      }
    }

    const next = nextPayload(payload, rows, { captured, excluded, duplicates });
    if (next) await this.#enqueue(next, job.correlationId);
    else console.info(JSON.stringify({
      event: "prospect_memory_backfill_completed",
      workspaceId: payload.workspaceId,
      captured,
      excluded,
      duplicates,
      schemaVersion: BACKFILL_SCHEMA_VERSION,
      sentEffect: false,
    }));
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }

  async #enqueue(payload: BackfillPayload, correlationId: string): Promise<void> {
    await this.queue.enqueue({
      id: this.ids.generate(),
      workspaceId: payload.workspaceId,
      type: PROSPECT_MEMORY_BACKFILL_JOB_TYPE,
      payload,
      idempotencyKey: backfillKey(payload),
      correlationId,
      maxAttempts: 3,
      priority: -100,
      availableAt: this.clock.now(),
    });
  }

  async #readPage(payload: BackfillPayload): Promise<readonly BackfillRow[]> {
    const after = payload.cursor ?? "00000000-0000-0000-0000-000000000000";
    switch (payload.stage) {
      case "contacts":
        return this.sql<BackfillRow[]>`
          select c.id, c.id as contact_id, c.updated_at as occurred_at,
                 'contact'::text as source_kind, 'contact_updated'::text as kind,
                 jsonb_build_object('fields', jsonb_build_array('identity','status','locale','preferredChannel')) as payload
          from contacts c
          where c.workspace_id = ${payload.workspaceId} and c.id > ${after} and c.anonymized_at is null
          order by c.id limit ${PAGE_SIZE}
        `;
      case "identities":
        return this.sql<BackfillRow[]>`
          select i.id, i.contact_id, i.updated_at as occurred_at,
                 'contact_identity'::text as source_kind, 'identity_linked'::text as kind,
                 jsonb_build_object('identityType', i.type, 'verificationStatus', i.verification_status) as payload
          from contact_identities i join contacts c on c.workspace_id = i.workspace_id and c.id = i.contact_id
          where i.workspace_id = ${payload.workspaceId} and i.id > ${after} and c.anonymized_at is null
          order by i.id limit ${PAGE_SIZE}
        `;
      case "employments":
        return this.sql<BackfillRow[]>`
          select e.id, e.contact_id, e.created_at as occurred_at,
                 'contact_employment'::text as source_kind, 'employment_updated'::text as kind,
                 jsonb_build_object('companyId', e.company_id, 'title', e.title, 'isCurrent', e.is_current) as payload
          from contact_employments e join contacts c on c.workspace_id = e.workspace_id and c.id = e.contact_id
          where e.workspace_id = ${payload.workspaceId} and e.id > ${after} and c.anonymized_at is null
          order by e.id limit ${PAGE_SIZE}
        `;
      case "messages":
        return this.sql<BackfillRow[]>`
          select m.id, c.contact_id, coalesce(m.sent_at, m.received_at, m.created_at) as occurred_at,
                 'message'::text as source_kind,
                 case when m.direction = 'inbound' then 'message_received' else 'message_sent' end as kind,
                 jsonb_build_object('conversationId', c.id, 'channel', c.channel, 'direction', m.direction, 'senderType', m.sender_type) as payload
          from messages m join conversations c on c.workspace_id = m.workspace_id and c.id = m.conversation_id
          join contacts contact on contact.workspace_id = c.workspace_id and contact.id = c.contact_id
          where m.workspace_id = ${payload.workspaceId} and m.id > ${after} and contact.anonymized_at is null
          order by m.id limit ${PAGE_SIZE}
        `;
      case "campaigns":
        return this.sql<BackfillRow[]>`
          select cp.id, cp.contact_id, cp.updated_at as occurred_at,
                 'campaign_prospect'::text as source_kind, 'campaign_changed'::text as kind,
                 jsonb_build_object('campaignId', cp.campaign_id, 'status', cp.status, 'state', cp.state) as payload
          from campaign_prospects cp join contacts c on c.workspace_id = cp.workspace_id and c.id = cp.contact_id
          where cp.workspace_id = ${payload.workspaceId} and cp.id > ${after} and cp.contact_id is not null and c.anonymized_at is null
          order by cp.id limit ${PAGE_SIZE}
        `;
      case "decisions":
        return this.sql<BackfillRow[]>`
          select d.id, d.contact_id, d.updated_at as occurred_at,
                 'prospect_decision'::text as source_kind, 'decision_changed'::text as kind,
                 jsonb_build_object('campaignId', d.campaign_id, 'decisionKind', d.kind, 'status', d.status, 'dueAt', d.due_at) as payload
          from prospect_decisions d join contacts c on c.workspace_id = d.workspace_id and c.id = d.contact_id
          where d.workspace_id = ${payload.workspaceId} and d.id > ${after} and c.anonymized_at is null
          order by d.id limit ${PAGE_SIZE}
        `;
      case "calls":
        return this.sql<BackfillRow[]>`
          select b.id, b.contact_id, b.updated_at as occurred_at,
                 'calendar_booking'::text as source_kind, 'call_recorded'::text as kind,
                 jsonb_build_object('campaignId', b.campaign_id, 'status', b.status, 'startAt', b.start_at) as payload
          from calendar_bookings b join contacts c on c.workspace_id = b.workspace_id and c.id = b.contact_id
          where b.workspace_id = ${payload.workspaceId} and b.id > ${after} and b.contact_id is not null and c.anonymized_at is null
          order by b.id limit ${PAGE_SIZE}
        `;
      case "social":
        return this.sql<BackfillRow[]>`
          select s.id, t.contact_id, coalesce(s.occurred_at, s.first_seen_at) as occurred_at,
                 'social_interaction'::text as source_kind, 'social_interaction'::text as kind,
                 jsonb_build_object('type', s.type, 'direction', s.direction, 'reaction', s.reaction, 'socialContentId', s.social_content_id) as payload
          from social_interactions s
          join lateral (
            select touch.contact_id
            from attribution_touches touch
            where touch.workspace_id = s.workspace_id
              and touch.social_interaction_id = s.id
              and touch.contact_id is not null
              and touch.status = 'active'
              and touch.kind = 'identity'
              and touch.certainty = 'evidence'
            order by touch.confidence desc, touch.id
            limit 1
          ) t on true
          join contacts c on c.workspace_id = s.workspace_id and c.id = t.contact_id
          where s.workspace_id = ${payload.workspaceId} and s.id > ${after} and c.anonymized_at is null
          order by s.id limit ${PAGE_SIZE}
        `;
    }
  }
}

/** Enqueues one root backfill per enabled workspace and schema version. */
export class ProspectMemoryBackfillScheduler {
  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async reconcile(): Promise<number> {
    const enabled = await this.database
      .select({ workspaceId: workspaceProspectMemorySettings.workspaceId })
      .from(workspaceProspectMemorySettings)
      .where(eq(workspaceProspectMemorySettings.captureEnabled, true));
    let inserted = 0;
    for (const row of enabled) {
      const payload: BackfillPayload = { workspaceId: row.workspaceId, stage: stages[0], cursor: null, captured: 0, excluded: 0, duplicates: 0 };
      const result = await this.queue.enqueue({
        id: this.ids.generate(),
        workspaceId: row.workspaceId,
        type: PROSPECT_MEMORY_BACKFILL_JOB_TYPE,
        payload,
        idempotencyKey: backfillKey(payload),
        correlationId: `prospect-memory-backfill:${row.workspaceId}:v${BACKFILL_SCHEMA_VERSION}`,
        maxAttempts: 3,
        priority: -100,
        availableAt: this.clock.now(),
      });
      if (result.inserted) inserted += 1;
    }
    return inserted;
  }
}

function nextPayload(
  current: BackfillPayload,
  rows: readonly BackfillRow[],
  counts: Pick<BackfillPayload, "captured" | "excluded" | "duplicates">,
): BackfillPayload | null {
  if (rows.length === PAGE_SIZE) {
    return { ...current, ...counts, cursor: rows.at(-1)!.id };
  }
  const stageIndex = stages.indexOf(current.stage);
  const nextStage = stages[stageIndex + 1];
  return nextStage ? { ...counts, workspaceId: current.workspaceId, stage: nextStage, cursor: null } : null;
}

function backfillKey(payload: BackfillPayload): string {
  return `prospect-memory:backfill:v${BACKFILL_SCHEMA_VERSION}:${payload.stage}:${payload.cursor ?? "start"}`;
}

function parsePayload(job: LeasedJob): BackfillPayload {
  const value = job.payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PROSPECT_MEMORY_BACKFILL_PAYLOAD_INVALID");
  const payload = value as Record<string, unknown>;
  const stage = typeof payload.stage === "string" && stages.includes(payload.stage as BackfillStage)
    ? payload.stage as BackfillStage
    : null;
  if (
    payload.workspaceId !== job.workspaceId || !stage
    || (payload.cursor !== null && typeof payload.cursor !== "string")
    || !isCount(payload.captured) || !isCount(payload.excluded) || !isCount(payload.duplicates)
  ) throw new Error("PROSPECT_MEMORY_BACKFILL_PAYLOAD_INVALID");
  return {
    workspaceId: job.workspaceId,
    stage,
    cursor: payload.cursor as string | null,
    captured: payload.captured,
    excluded: payload.excluded,
    duplicates: payload.duplicates,
  };
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, inArray, isNotNull, lt, sql as drizzleSql } from "drizzle-orm";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { WorkspaceRetentionPolicy } from "@outbound/domain/workspaces/workspace-data-policy";
import type { Database, SqlClient } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  contacts,
  jobs,
  outboxEvents,
  prospectMemoryContextReceipts,
  prospectMemoryEvents,
  prospectMemorySnapshots,
  workspaceExports,
  workspaceInvitations,
} from "@outbound/infrastructure/database/schema";

const EXPORT_TTL_MS = 72 * 60 * 60 * 1_000;
const REDACTED_COLUMNS = [
  "encrypted_secret",
  "encrypted_api_key",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
] as const;

export interface WorkspaceArchiveStorage {
  put(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void>;
  get(input: { objectKey: string }): Promise<{
    body: ReadableStream<Uint8Array>;
    contentLength: number | null;
  }>;
}

export class S3WorkspaceArchiveStorage implements WorkspaceArchiveStorage {
  readonly #client: S3Client;

  constructor(private readonly options: { bucket: string; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }) {
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(input: { objectKey: string; body: Uint8Array; contentType: string }) {
    await this.#client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: input.objectKey, Body: input.body, ContentType: "application/gzip" }));
  }

  async get(input: { objectKey: string }) {
    const object = await this.#client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: input.objectKey }));
    if (!object.Body) throw new Error("WORKSPACE_EXPORT_OBJECT_EMPTY");
    return {
      body: object.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentLength: object.ContentLength ?? null,
    };
  }
}

export class PostgresWorkspaceExportSnapshot {
  constructor(private readonly sql: SqlClient) {}

  async build(workspaceId: string) {
    const [workspace] = await this.sql<{ id: string; slug: string; name: string; status: string; created_at: Date; updated_at: Date }[]>`
      select id, slug, name, status, created_at, updated_at from workspaces where id = ${workspaceId}
    `;
    if (!workspace) throw new Error("WORKSPACE_NOT_FOUND");
    const members = await this.sql`
      select wm.user_id, wm.role, wm.status, wm.joined_at, u.name, u.email
      from workspace_members wm
      join auth_users u on u.id = wm.user_id
      where wm.workspace_id = ${workspaceId}
      order by wm.joined_at, wm.user_id
    `;
    const tableRows = await this.sql<{ table_name: string }[]>`
      select distinct table_name
      from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
      order by table_name
    `;
    const tables: Record<string, unknown[]> = {};
    for (const { table_name: tableName } of tableRows) {
      if (!/^[a-z][a-z0-9_]*$/.test(tableName)) throw new Error("WORKSPACE_EXPORT_TABLE_INVALID");
      const redactions = REDACTED_COLUMNS.map((column) => `'${column}'`).join(",");
      const [result] = await this.sql.unsafe<{ rows: unknown[] }[]>(
        `select coalesce(jsonb_agg(to_jsonb(t) - array[${redactions}]::text[] order by to_jsonb(t)::text), '[]'::jsonb) as rows from "public"."${tableName}" t where workspace_id = $1`,
        [workspaceId],
      );
      tables[tableName] = result?.rows ?? [];
    }
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), workspace: { ...workspace, members }, tables };
  }
}

export class WorkspaceDataExportProcessor {
  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly snapshots: PostgresWorkspaceExportSnapshot,
    private readonly storage: WorkspaceArchiveStorage,
    private readonly clock: Clock,
  ) {}

  async process(job: LeasedJob) {
    const payload = exportPayload(job.payload);
    const [current] = await this.database.select().from(workspaceExports).where(and(eq(workspaceExports.workspaceId, job.workspaceId), eq(workspaceExports.id, payload.exportId))).limit(1);
    if (!current) throw new Error("WORKSPACE_EXPORT_NOT_FOUND");
    if (current.status === "completed") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    await this.database.update(workspaceExports).set({ status: "processing", failureCode: null, updatedAt: this.clock.now() }).where(and(eq(workspaceExports.workspaceId, job.workspaceId), eq(workspaceExports.id, payload.exportId)));
    try {
      const snapshot = redactWorkspaceExportValue(await this.snapshots.build(job.workspaceId));
      const body = Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ ...(snapshot as Record<string, unknown>), exportedAt: this.clock.now().toISOString() })), { level: 9 });
      const objectKey = `${job.workspaceId}/workspace-exports/${payload.exportId}/export.json.gz`;
      await this.storage.put({ objectKey, body, contentType: "application/json" });
      const expiresAt = new Date(this.clock.now().getTime() + EXPORT_TTL_MS);
      const checksumSha256 = createHash("sha256").update(body).digest("hex");
      await this.database.transaction(async (tx) => {
        await tx.update(workspaceExports).set({ status: "completed", objectKey, sizeBytes: body.byteLength, checksumSha256, expiresAt, completedAt: this.clock.now(), failureCode: null, updatedAt: this.clock.now() }).where(and(eq(workspaceExports.workspaceId, job.workspaceId), eq(workspaceExports.id, payload.exportId)));
        const [event] = await tx.insert(outboxEvents).values({ workspaceId: job.workspaceId, aggregateType: "WorkspaceExport", aggregateId: payload.exportId, eventType: "WorkspaceDataExportCompleted", payload: { exportId: payload.exportId, expiresAt: expiresAt.toISOString(), sizeBytes: body.byteLength, checksumSha256 } }).returning({ id: outboxEvents.id });
        if (!event) throw new Error("WORKSPACE_EXPORT_EVENT_FAILED");
        await tx.insert(auditLogs).values({ workspaceId: job.workspaceId, actorUserId: current.requestedBy, action: "WorkspaceDataExportCompleted", subjectType: "WorkspaceExport", subjectId: payload.exportId, changes: { expiresAt: expiresAt.toISOString(), sizeBytes: body.byteLength, checksumSha256 }, sourceEventId: event.id });
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      await this.database.update(workspaceExports).set({ status: "failed", failureCode: error instanceof Error ? error.message.slice(0, 120) : "WORKSPACE_EXPORT_FAILED", updatedAt: this.clock.now() }).where(and(eq(workspaceExports.workspaceId, job.workspaceId), eq(workspaceExports.id, payload.exportId)));
      throw error;
    }
  }
}

export class WorkspaceRetentionPurgeProcessor {
  constructor(private readonly database: Database, private readonly queue: JobQueue, private readonly clock: Clock) {}

  async process(job: LeasedJob) {
    const payload = retentionPayload(job.payload);
    const invitationCutoff = daysAgo(this.clock.now(), payload.retention.invitationsDays);
    const jobsCutoff = daysAgo(this.clock.now(), payload.retention.jobsDays);
    const auditCutoff = daysAgo(this.clock.now(), payload.retention.auditDays);
    const memoryEventsCutoff = daysAgo(this.clock.now(), payload.retention.memoryEventsDays);
    const memorySnapshotsCutoff = daysAgo(this.clock.now(), payload.retention.memorySnapshotsDays);
    const memoryReceiptsCutoff = daysAgo(this.clock.now(), payload.retention.memoryReceiptsDays);
    await this.database.transaction(async (tx) => {
      const invitations = await tx.delete(workspaceInvitations).where(and(eq(workspaceInvitations.workspaceId, job.workspaceId), inArray(workspaceInvitations.status, ["accepted", "revoked", "expired"]), lt(workspaceInvitations.updatedAt, invitationCutoff))).returning({ id: workspaceInvitations.id });
      const retainedJobs = await tx.delete(jobs).where(and(eq(jobs.workspaceId, job.workspaceId), inArray(jobs.status, ["completed", "dead_lettered"]), lt(jobs.updatedAt, jobsCutoff))).returning({ id: jobs.id });
      const events = await tx.delete(outboxEvents).where(and(eq(outboxEvents.workspaceId, job.workspaceId), isNotNull(outboxEvents.publishedAt), lt(outboxEvents.createdAt, jobsCutoff))).returning({ id: outboxEvents.id });
      const expiredMemoryEvents = await tx.delete(prospectMemoryEvents).where(and(
        eq(prospectMemoryEvents.workspaceId, job.workspaceId),
        lt(prospectMemoryEvents.observedAt, memoryEventsCutoff),
      )).returning({ contactId: prospectMemoryEvents.canonicalContactId });
      const contactsWithExpiredMemory = [...new Set(expiredMemoryEvents.map((entry) => entry.contactId))];
      const privacyEpochBumps = contactsWithExpiredMemory.length
        ? await tx.update(contacts).set({
            privacyEpoch: drizzleSql`${contacts.privacyEpoch} + 1`,
            updatedAt: this.clock.now(),
          }).where(and(
            eq(contacts.workspaceId, job.workspaceId),
            inArray(contacts.id, contactsWithExpiredMemory),
          )).returning({ id: contacts.id })
        : [];
      const sourceInvalidatedSnapshots = contactsWithExpiredMemory.length
        ? await tx.delete(prospectMemorySnapshots).where(and(
            eq(prospectMemorySnapshots.workspaceId, job.workspaceId),
            inArray(prospectMemorySnapshots.contactId, contactsWithExpiredMemory),
          )).returning({ id: prospectMemorySnapshots.id })
        : [];
      const sourceInvalidatedReceipts = contactsWithExpiredMemory.length
        ? await tx.delete(prospectMemoryContextReceipts).where(and(
          eq(prospectMemoryContextReceipts.workspaceId, job.workspaceId),
          inArray(prospectMemoryContextReceipts.contactId, contactsWithExpiredMemory),
        )).returning({ id: prospectMemoryContextReceipts.id })
        : [];
      const agedSnapshots = await tx.execute<{ id: string }>(drizzleSql`
        with ranked as (
          select id, row_number() over (partition by contact_id order by version desc) as version_rank
          from prospect_memory_snapshots
          where workspace_id = ${job.workspaceId}
        )
        delete from prospect_memory_snapshots snapshot
        using ranked
        where snapshot.id = ranked.id
          and snapshot.workspace_id = ${job.workspaceId}
          and (ranked.version_rank > 21 or (ranked.version_rank > 1 and snapshot.generated_at < ${memorySnapshotsCutoff.toISOString()}::timestamptz))
        returning snapshot.id
      `);
      const memoryReceipts = await tx.delete(prospectMemoryContextReceipts).where(and(
        eq(prospectMemoryContextReceipts.workspaceId, job.workspaceId),
        lt(prospectMemoryContextReceipts.createdAt, memoryReceiptsCutoff),
      )).returning({ id: prospectMemoryContextReceipts.id });
      await tx.execute(drizzleSql.raw("set local app.retention_purge = 'on'"));
      const audits = await tx.delete(auditLogs).where(and(eq(auditLogs.workspaceId, job.workspaceId), lt(auditLogs.createdAt, auditCutoff))).returning({ id: auditLogs.id });
      const summary = {
        invitations: invitations.length,
        jobs: retainedJobs.length,
        outboxEvents: events.length,
        auditLogs: audits.length,
        prospectMemoryEvents: expiredMemoryEvents.length,
        prospectMemorySnapshots: sourceInvalidatedSnapshots.length + agedSnapshots.length,
        prospectMemoryReceipts: sourceInvalidatedReceipts.length + memoryReceipts.length,
        prospectMemoryPrivacyEpochs: privacyEpochBumps.length,
        retention: payload.retention,
      };
      const [event] = await tx.insert(outboxEvents).values({ workspaceId: job.workspaceId, aggregateType: "Workspace", aggregateId: job.workspaceId, eventType: "WorkspaceRetentionPurged", payload: summary }).returning({ id: outboxEvents.id });
      if (!event) throw new Error("WORKSPACE_RETENTION_EVENT_FAILED");
      await tx.insert(auditLogs).values({ workspaceId: job.workspaceId, actorUserId: null, action: "WorkspaceRetentionPurged", subjectType: "Workspace", subjectId: job.workspaceId, changes: summary, correlationId: job.correlationId, sourceEventId: event.id });
    });
    await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
  }
}

function exportPayload(value: unknown): { exportId: string } {
  if (!value || typeof value !== "object" || !("exportId" in value) || typeof value.exportId !== "string") throw new Error("WORKSPACE_EXPORT_JOB_INVALID");
  return { exportId: value.exportId };
}

function retentionPayload(value: unknown): { retention: WorkspaceRetentionPolicy } {
  if (!value || typeof value !== "object" || !("retention" in value) || !value.retention || typeof value.retention !== "object") throw new Error("WORKSPACE_RETENTION_JOB_INVALID");
  const retention = value.retention as Record<string, unknown>;
  if (![retention.invitationsDays, retention.jobsDays, retention.auditDays, retention.memoryEventsDays, retention.memorySnapshotsDays, retention.memoryReceiptsDays].every((entry) => typeof entry === "number" && Number.isInteger(entry))) throw new Error("WORKSPACE_RETENTION_JOB_INVALID");
  return { retention: {
    invitationsDays: retention.invitationsDays as number,
    jobsDays: retention.jobsDays as number,
    auditDays: retention.auditDays as number,
    memoryEventsDays: retention.memoryEventsDays as number,
    memorySnapshotsDays: retention.memorySnapshotsDays as number,
    memoryReceiptsDays: retention.memoryReceiptsDays as number,
  } };
}

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

export function redactWorkspaceExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWorkspaceExportValue);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    /secret|token|password|api[_-]?key|credential|encrypted/i.test(key)
      ? "[REDACTED]"
      : redactWorkspaceExportValue(entry),
  ]));
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  authUsers,
  contactIdentities,
  contactSuppressions,
  contacts,
  jobs,
  outboxEvents,
  workspaceInvitations,
  workspaceExports,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresWorkspaceDataLifecycle } from "@outbound/infrastructure/workspaces/postgres-workspace-data-lifecycle";
import {
  PostgresWorkspaceExportSnapshot,
  WorkspaceDataExportProcessor,
  WorkspaceRetentionPurgeProcessor,
  type WorkspaceArchiveStorage,
} from "@outbound/infrastructure/workspaces/workspace-data-export";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-053 workspace settings and data lifecycle", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const suppressionId = crypto.randomUUID();
  const now = new Date("2026-08-09T06:00:00.000Z");
  const service = new PostgresWorkspaceDataLifecycle(database.db, { now: () => now }, { generate: () => crypto.randomUUID() });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f053-${workspaceId}`, name: "F-053" },
      { id: otherWorkspaceId, slug: `f053-other-${otherWorkspaceId}`, name: "F-053 Other" },
    ]);
    await database.db.insert(authUsers).values({ id: ownerId, name: "F-053 Owner", email: `f053-${ownerId}@example.com` });
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Alice", lastName: "Martin", source: "manual" });
    await database.db.insert(contactIdentities).values({ id: identityId, workspaceId, contactId, type: "email", value: "alice@example.com", normalizedValue: "alice@example.com", source: "manual" });
    await database.db.insert(contactSuppressions).values({ id: suppressionId, workspaceId, contactId, channel: "global", identityType: "email", normalizedValue: "alice@example.com", identityFingerprint: suppressionFingerprint({ workspaceId, identityType: "email", normalizedValue: "alice@example.com", secret: "f053-test-secret" }), reason: "privacy", createdBy: ownerId });
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from workspace_exports where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from contact_suppressions where workspace_id = ${workspaceId}`;
      await sql`delete from contact_identities where workspace_id = ${workspaceId}`;
      await sql`delete from contacts where workspace_id = ${workspaceId}`;
      await sql`delete from workspace_data_settings where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from auth_users where id = ${ownerId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("persists profile and operational settings and schedules a confirmed retention reduction", async () => {
    expect(await service.getPolicy(workspaceId)).toMatchObject({ channelLimits: { linkedin: 20, email: 50, whatsapp: 30 }, retention: { invitationsDays: 90, jobsDays: 90, auditDays: 365 } });
    const profile = await service.updateProfile({ workspaceId, actorUserId: ownerId, name: "F-053 Renommé" });
    expect(profile).toMatchObject({ name: "F-053 Renommé", slug: `f053-${workspaceId}` });
    await service.updateSendingPreferences({ workspaceId, actorUserId: ownerId, sending: { timezone: "Europe/Madrid", activeDays: [1, 2, 3, 4], windowStart: "08:30", windowEnd: "18:30" } });
    await service.updateChannelLimits({ workspaceId, actorUserId: ownerId, channelLimits: { linkedin: 25, email: 80, whatsapp: 35 } });
    await expect(service.updateRetentionPolicy({ workspaceId, actorUserId: ownerId, retention: { invitationsDays: 90, jobsDays: 60, auditDays: 365 }, confirmation: "" })).rejects.toThrow("TYPED_CONFIRMATION_REQUIRED");
    await service.updateRetentionPolicy({ workspaceId, actorUserId: ownerId, retention: { invitationsDays: 90, jobsDays: 60, auditDays: 365 }, confirmation: "MODIFIER LA RÉTENTION" });
    expect(await service.getPolicy(workspaceId)).toMatchObject({ sending: { timezone: "Europe/Madrid" }, channelLimits: { email: 80 }, retention: { jobsDays: 60 } });
    const purgeJobs = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "workspace.retention.purge")));
    expect(purgeJobs).toHaveLength(1);
  });

  test("requests one export per key and isolates export lookup", async () => {
    const first = await service.requestExport({ workspaceId, actorUserId: ownerId, requestKey: "export-key-1" });
    const replay = await service.requestExport({ workspaceId, actorUserId: ownerId, requestKey: "export-key-1" });
    expect(replay.id).toBe(first.id);
    expect(await service.getExport(workspaceId, first.id)).toMatchObject({ status: "pending" });
    expect(await service.getExport(otherWorkspaceId, first.id)).toBeNull();
    const exportJobs = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "workspace.data.export")));
    expect(exportJobs).toHaveLength(1);
    expect(await database.db.select().from(workspaceExports).where(eq(workspaceExports.workspaceId, workspaceId))).toHaveLength(1);
  });

  test("builds one workspace-only archive and expires it after 72 hours", async () => {
    const [job] = await queue.lease({ workerId: "f053-export", types: ["workspace.data.export"], limit: 1, leaseMs: 30_000, now });
    expect(job).toBeDefined();
    const storage = new MemoryArchiveStorage();
    await new WorkspaceDataExportProcessor(database.db, queue, new PostgresWorkspaceExportSnapshot(database.client), storage, { now: () => now }).process(job!);
    const [completed] = await database.db.select().from(workspaceExports).where(eq(workspaceExports.workspaceId, workspaceId));
    expect(completed).toMatchObject({ status: "completed", expiresAt: new Date("2026-08-12T06:00:00.000Z") });
    const compressed = Uint8Array.from(storage.objects.get(completed!.objectKey!)!);
    const payload = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(compressed))) as { workspace: { id: string }; tables: Record<string, unknown[]> };
    expect(payload.workspace.id).toBe(workspaceId);
    expect(JSON.stringify(payload)).not.toContain(otherWorkspaceId);
    expect(JSON.stringify(payload)).not.toContain("encrypted_secret");
  });

  test("requeues a failed export idempotently with the same request key", async () => {
    const failed = await service.requestExport({ workspaceId, actorUserId: ownerId, requestKey: "export-key-retry" });
    await database.db.update(workspaceExports).set({ status: "failed", failureCode: "STORAGE_UNAVAILABLE", updatedAt: now }).where(eq(workspaceExports.id, failed.id));
    await database.db.update(jobs).set({ status: "dead_lettered", completedAt: now, updatedAt: now }).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.idempotencyKey, `workspace-export:${failed.id}`)));

    const retried = await service.requestExport({ workspaceId, actorUserId: ownerId, requestKey: "export-key-retry" });
    const replay = await service.requestExport({ workspaceId, actorUserId: ownerId, requestKey: "export-key-retry" });

    expect(retried).toMatchObject({ id: failed.id, status: "pending", failureCode: null });
    expect(replay).toMatchObject({ id: failed.id, status: "pending" });
    const exportJobs = await database.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "workspace.data.export")));
    expect(exportJobs.filter((job) => (job.payload as { exportId?: string }).exportId === failed.id)).toHaveLength(2);

    await database.db.update(jobs).set({ status: "completed", completedAt: now, updatedAt: now }).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "workspace.data.export")));
    await database.db.update(workspaceExports).set({ status: "failed", updatedAt: now }).where(eq(workspaceExports.id, failed.id));
  });

  test("anonymizes irreversibly while preserving suppression fingerprints and audit facts", async () => {
    await expect(service.anonymizeContact({ workspaceId, contactId, actorUserId: ownerId, confirmation: "anonymiser" })).rejects.toThrow("TYPED_CONFIRMATION_REQUIRED");
    await service.anonymizeContact({ workspaceId, contactId, actorUserId: ownerId, confirmation: "ANONYMISER" });
    const [contact] = await database.db.select().from(contacts).where(eq(contacts.id, contactId));
    const [identity] = await database.db.select().from(contactIdentities).where(eq(contactIdentities.id, identityId));
    const [suppression] = await database.db.select().from(contactSuppressions).where(eq(contactSuppressions.id, suppressionId));
    expect(contact).toMatchObject({ firstName: "Anonymisé", status: "suppressed", anonymizedAt: now });
    expect(identity?.normalizedValue).not.toBe("alice@example.com");
    expect(suppression).toMatchObject({ normalizedValue: "alice@example.com" });
    expect((await service.listAuditLogs({ workspaceId, action: "ContactAnonymized", limit: 20 })).data).toHaveLength(1);
  });

  test("purges only expired retained rows asynchronously and records the purge", async () => {
    const old = new Date("2025-01-01T00:00:00.000Z");
    const invitationId = crypto.randomUUID();
    const oldJobId = crypto.randomUUID();
    const oldEventId = crypto.randomUUID();
    const oldAuditId = crypto.randomUUID();
    await database.db.insert(workspaceInvitations).values({ id: invitationId, workspaceId, email: "expired@example.com", proposedRole: "viewer", status: "expired", expiresAt: old, invitedBy: ownerId, createdAt: old, updatedAt: old });
    await database.db.insert(jobs).values({ id: oldJobId, workspaceId, type: "fixture.completed", payload: {}, idempotencyKey: oldJobId, correlationId: oldJobId, status: "completed", maxAttempts: 1, availableAt: old, completedAt: old, createdAt: old, updatedAt: old });
    await database.db.insert(outboxEvents).values({ id: oldEventId, workspaceId, aggregateType: "Fixture", aggregateId: oldEventId, eventType: "FixtureOld", payload: {}, publishedAt: old, createdAt: old });
    await database.db.insert(auditLogs).values({ id: oldAuditId, workspaceId, actorUserId: ownerId, action: "FixtureOld", subjectType: "Fixture", subjectId: oldAuditId, changes: {}, sourceEventId: oldEventId, createdAt: old });
    const [job] = await queue.lease({ workerId: "f053-retention", types: ["workspace.retention.purge"], limit: 1, leaseMs: 30_000, now });
    expect(job).toBeDefined();
    await new WorkspaceRetentionPurgeProcessor(database.db, queue, { now: () => now }).process(job!);
    expect(await database.db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId))).toHaveLength(0);
    expect(await database.db.select().from(jobs).where(eq(jobs.id, oldJobId))).toHaveLength(0);
    expect(await database.db.select().from(outboxEvents).where(eq(outboxEvents.id, oldEventId))).toHaveLength(0);
    expect(await database.db.select().from(auditLogs).where(eq(auditLogs.id, oldAuditId))).toHaveLength(0);
    expect((await service.listAuditLogs({ workspaceId, action: "WorkspaceRetentionPurged", limit: 20 })).data).toHaveLength(1);
  });
});

class MemoryArchiveStorage implements WorkspaceArchiveStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(input: { objectKey: string; body: Uint8Array }): Promise<void> { this.objects.set(input.objectKey, input.body); }
  async createDownloadUrl(): Promise<string> { return "https://download.invalid/export"; }
}

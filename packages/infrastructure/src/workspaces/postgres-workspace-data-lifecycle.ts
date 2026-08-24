import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { PROSPECT_MEMORY_REFRESH_JOB_TYPE } from "@outbound/application/prospect-memory/prospect-memory";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import {
  assertTypedConfirmation,
  defaultWorkspaceDataPolicy,
  retentionWasReduced,
  validateWorkspaceDataPolicy,
  type WorkspaceDataPolicy,
  type WorkspaceRetentionPolicy,
} from "@outbound/domain/workspaces/workspace-data-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  auditLogs,
  authUsers,
  contactIdentities,
  contactSuppressions,
  contacts,
  jobs,
  outboxEvents,
  prospectMemoryContextReceipts,
  prospectMemoryEvents,
  prospectMemorySnapshots,
  workspaceDataSettings,
  workspaceExports,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";
import { captureProspectMemoryMutation } from "@outbound/infrastructure/prospect-memory/capture-prospect-memory-mutation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class WorkspaceDataLifecycleError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WorkspaceDataLifecycleError";
  }
}

export class PostgresWorkspaceDataLifecycle {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async getProfile(workspaceId: string) {
    const [workspace] = await this.database.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return workspace ?? null;
  }

  async updateProfile(input: { workspaceId: string; actorUserId: string; name: string }) {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new WorkspaceDataLifecycleError("WORKSPACE_NAME_INVALID", 422);
    return this.database.transaction(async (tx) => {
      const [before] = await tx.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).for("update").limit(1);
      if (!before) throw new WorkspaceDataLifecycleError("WORKSPACE_NOT_FOUND", 404);
      if (before.name === name) return before;
      const [updated] = await tx.update(workspaces).set({ name, updatedAt: this.clock.now() }).where(eq(workspaces.id, input.workspaceId)).returning();
      if (!updated) throw new WorkspaceDataLifecycleError("WORKSPACE_UPDATE_FAILED", 409);
      await recordMutation(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        eventType: "WorkspaceProfileUpdated",
        subjectType: "Workspace",
        subjectId: input.workspaceId,
        changes: { before: { name: before.name }, after: { name: updated.name }, slug: updated.slug },
      });
      return updated;
    });
  }

  async getPolicy(workspaceId: string): Promise<WorkspaceDataPolicy> {
    const [row] = await this.database.select().from(workspaceDataSettings).where(eq(workspaceDataSettings.workspaceId, workspaceId)).limit(1);
    return row ? policyFromRow(row) : defaultWorkspaceDataPolicy();
  }

  async readDispatchPolicy(workspaceId: string) {
    const policy = await this.getPolicy(workspaceId);
    return { limits: policy.channelLimits, timezone: policy.sending.timezone };
  }

  async updateSendingPreferences(input: { workspaceId: string; actorUserId: string; sending: WorkspaceDataPolicy["sending"] }) {
    const current = await this.getPolicy(input.workspaceId);
    const next = validateWorkspaceDataPolicy({ ...current, sending: input.sending });
    await this.persistPolicy(input.workspaceId, input.actorUserId, next, "WorkspaceSendingPreferencesChanged", { before: current.sending, after: next.sending });
    return next.sending;
  }

  async updateChannelLimits(input: { workspaceId: string; actorUserId: string; channelLimits: WorkspaceDataPolicy["channelLimits"] }) {
    const current = await this.getPolicy(input.workspaceId);
    const next = validateWorkspaceDataPolicy({ ...current, channelLimits: input.channelLimits });
    await this.persistPolicy(input.workspaceId, input.actorUserId, next, "WorkspaceChannelLimitsChanged", { before: current.channelLimits, after: next.channelLimits });
    return next.channelLimits;
  }

  async updateRetentionPolicy(input: { workspaceId: string; actorUserId: string; retention: WorkspaceRetentionPolicy; confirmation: string }) {
    const current = await this.getPolicy(input.workspaceId);
    const next = validateWorkspaceDataPolicy({ ...current, retention: input.retention });
    const reduced = retentionWasReduced(current.retention, next.retention);
    if (reduced) {
      try {
        assertTypedConfirmation(input.confirmation, "MODIFIER LA RÉTENTION");
      } catch {
        throw new WorkspaceDataLifecycleError("TYPED_CONFIRMATION_REQUIRED", 400);
      }
    }
    await this.database.transaction(async (tx) => {
      await upsertPolicy(tx, input.workspaceId, input.actorUserId, next, this.clock.now());
      const eventId = await recordMutation(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        eventType: "RetentionPolicyChanged",
        subjectType: "Workspace",
        subjectId: input.workspaceId,
        changes: { before: current.retention, after: next.retention, purgeScheduled: reduced },
      });
      if (reduced) {
        const jobId = this.ids.generate();
        await tx.insert(jobs).values({
          id: jobId,
          workspaceId: input.workspaceId,
          type: "workspace.retention.purge",
          payload: { workspaceId: input.workspaceId, retention: next.retention, eventId },
          idempotencyKey: `retention:${Object.values(next.retention).join(":")}`,
          correlationId: `retention:${eventId}`,
          maxAttempts: 3,
          availableAt: this.clock.now(),
        }).onConflictDoNothing();
      }
    });
    return next.retention;
  }

  async requestExport(input: { workspaceId: string; actorUserId: string; requestKey: string }) {
    const requestKey = input.requestKey.trim();
    if (!requestKey || requestKey.length > 200) throw new WorkspaceDataLifecycleError("EXPORT_REQUEST_KEY_INVALID", 422);
    return this.database.transaction(async (tx) => {
      const [replay] = await tx.select().from(workspaceExports).where(and(eq(workspaceExports.workspaceId, input.workspaceId), eq(workspaceExports.requestKey, requestKey))).for("update").limit(1);
      if (replay && replay.status !== "failed") return replay;
      const [active] = await tx.select({ id: workspaceExports.id }).from(workspaceExports).where(and(eq(workspaceExports.workspaceId, input.workspaceId), ne(workspaceExports.status, "completed"), ne(workspaceExports.status, "failed"))).limit(1);
      if (active) throw new WorkspaceDataLifecycleError("WORKSPACE_EXPORT_ALREADY_RUNNING", 409);
      if (replay) {
        const [retried] = await tx.update(workspaceExports).set({
          status: "pending",
          objectKey: null,
          sizeBytes: null,
          checksumSha256: null,
          expiresAt: null,
          completedAt: null,
          failureCode: null,
          requestedBy: input.actorUserId,
          updatedAt: this.clock.now(),
        }).where(and(eq(workspaceExports.workspaceId, input.workspaceId), eq(workspaceExports.id, replay.id))).returning();
        if (!retried) throw new WorkspaceDataLifecycleError("WORKSPACE_EXPORT_RETRY_FAILED", 409);
        const eventId = await recordMutation(tx, {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          eventType: "WorkspaceDataExportRequested",
          subjectType: "WorkspaceExport",
          subjectId: replay.id,
          changes: { requestKey, retry: true },
        });
        const retryJobId = this.ids.generate();
        await tx.insert(jobs).values({
          id: retryJobId,
          workspaceId: input.workspaceId,
          type: "workspace.data.export",
          payload: { workspaceId: input.workspaceId, exportId: replay.id },
          idempotencyKey: `workspace-export:${replay.id}:retry:${retryJobId}`,
          correlationId: `workspace-export:${eventId}`,
          maxAttempts: 3,
          availableAt: this.clock.now(),
        });
        return retried;
      }
      const exportId = this.ids.generate();
      const [created] = await tx.insert(workspaceExports).values({ id: exportId, workspaceId: input.workspaceId, requestKey, requestedBy: input.actorUserId, createdAt: this.clock.now(), updatedAt: this.clock.now() }).returning();
      if (!created) throw new WorkspaceDataLifecycleError("WORKSPACE_EXPORT_CREATE_FAILED", 409);
      const eventId = await recordMutation(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        eventType: "WorkspaceDataExportRequested",
        subjectType: "WorkspaceExport",
        subjectId: exportId,
        changes: { requestKey },
      });
      await tx.insert(jobs).values({
        id: this.ids.generate(),
        workspaceId: input.workspaceId,
        type: "workspace.data.export",
        payload: { workspaceId: input.workspaceId, exportId },
        idempotencyKey: `workspace-export:${exportId}`,
        correlationId: `workspace-export:${eventId}`,
        maxAttempts: 3,
        availableAt: this.clock.now(),
      });
      return created;
    });
  }

  async getExport(workspaceId: string, exportId: string) {
    const [result] = await this.database.select().from(workspaceExports).where(and(eq(workspaceExports.workspaceId, workspaceId), eq(workspaceExports.id, exportId))).limit(1);
    return result ?? null;
  }

  async anonymizeContact(input: { workspaceId: string; contactId: string; actorUserId: string; confirmation: string }) {
    try {
      assertTypedConfirmation(input.confirmation, "ANONYMISER");
    } catch {
      throw new WorkspaceDataLifecycleError("TYPED_CONFIRMATION_REQUIRED", 400);
    }
    return this.database.transaction(async (tx) => {
      const [contact] = await tx.select().from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId))).for("update").limit(1);
      if (!contact) throw new WorkspaceDataLifecycleError("CONTACT_NOT_FOUND", 404);
      if (contact.anonymizedAt) return contact;
      const now = this.clock.now();
      const identities = await tx.select().from(contactIdentities).where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.contactId, input.contactId)));
      for (const identity of identities) {
        await tx.insert(contactSuppressions).values({
          id: this.ids.generate(),
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          channel: "global",
          identityType: identity.type,
          normalizedValue: identity.normalizedValue,
          identityFingerprint: suppressionFingerprint({ workspaceId: input.workspaceId, identityType: identity.type, normalizedValue: identity.normalizedValue }),
          reason: "contact_anonymized",
          createdBy: input.actorUserId,
          createdAt: this.clock.now(),
        }).onConflictDoNothing();
        const replacement = anonymizedIdentity(identity.type, identity.id);
        await tx.update(contactIdentities).set({ value: replacement, normalizedValue: replacement, verificationStatus: "invalid", updatedAt: this.clock.now() }).where(eq(contactIdentities.id, identity.id));
      }
      await captureProspectMemoryMutation(tx, {
        workspaceId: input.workspaceId,
        sourceContactId: input.contactId,
        sourceKind: "contact",
        sourceId: input.contactId,
        sourceVersion: contact.privacyEpoch + 1,
        kind: "contact_anonymized",
        occurredAt: now,
        observedAt: now,
        payload: { contactId: input.contactId, nextPrivacyEpoch: contact.privacyEpoch + 1 },
        correlationId: `contact-anonymized:${input.contactId}:${contact.privacyEpoch + 1}`,
      });
      const [updated] = await tx.update(contacts).set({
        firstName: "Anonymisé",
        lastName: input.contactId.slice(0, 8),
        photoUrl: null,
        preferredChannel: null,
        status: "suppressed",
        anonymizedAt: now,
        privacyEpoch: sql`${contacts.privacyEpoch} + 1`,
        updatedAt: now,
      }).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId))).returning();
      if (!updated) throw new WorkspaceDataLifecycleError("CONTACT_ANONYMIZATION_FAILED", 409);
      // Derived memory may contain personal conversation excerpts. Once the
      // privacy epoch changes, remove it locally instead of merely hiding it.
      await tx.delete(prospectMemoryContextReceipts).where(and(
        eq(prospectMemoryContextReceipts.workspaceId, input.workspaceId),
        eq(prospectMemoryContextReceipts.contactId, input.contactId),
      ));
      await tx.delete(prospectMemorySnapshots).where(and(
        eq(prospectMemorySnapshots.workspaceId, input.workspaceId),
        eq(prospectMemorySnapshots.contactId, input.contactId),
      ));
      await tx.delete(prospectMemoryEvents).where(and(
        eq(prospectMemoryEvents.workspaceId, input.workspaceId),
        sql`(${prospectMemoryEvents.canonicalContactId} = ${input.contactId} or ${prospectMemoryEvents.sourceContactId} = ${input.contactId})`,
      ));
      await tx.update(jobs).set({
        status: "dead_lettered",
        completedAt: now,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        lastErrorCode: "PROSPECT_ANONYMIZED",
        lastErrorMessage: "The prospect was anonymized before memory reconstruction completed.",
        updatedAt: now,
      }).where(and(
        eq(jobs.workspaceId, input.workspaceId),
        eq(jobs.type, PROSPECT_MEMORY_REFRESH_JOB_TYPE),
        inArray(jobs.status, ["pending", "retry", "running"]),
        sql`${jobs.payload}->>'contactId' = ${input.contactId}`,
      ));
      await recordMutation(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        eventType: "ContactAnonymized",
        subjectType: "Contact",
        subjectId: input.contactId,
        changes: { identityCount: identities.length, memoryDerivedPurged: true, suppressionsPreserved: true },
      });
      return updated;
    });
  }

  async listAuditLogs(input: { workspaceId: string; actorUserId?: string; action?: string; from?: Date; to?: Date; limit: number }) {
    const limit = Math.max(1, Math.min(100, input.limit));
    const conditions = [eq(auditLogs.workspaceId, input.workspaceId)];
    if (input.actorUserId) conditions.push(eq(auditLogs.actorUserId, input.actorUserId));
    if (input.action) conditions.push(eq(auditLogs.action, input.action));
    if (input.from) conditions.push(gte(auditLogs.createdAt, input.from));
    if (input.to) conditions.push(lte(auditLogs.createdAt, input.to));
    const data = await this.database.select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      actorName: authUsers.name,
      actorEmail: authUsers.email,
      action: auditLogs.action,
      subjectType: auditLogs.subjectType,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
      correlationId: auditLogs.correlationId,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs).leftJoin(authUsers, eq(authUsers.id, auditLogs.actorUserId)).where(and(...conditions)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit);
    return { data };
  }

  private async persistPolicy(workspaceId: string, actorUserId: string, policy: WorkspaceDataPolicy, eventType: string, changes: Record<string, unknown>) {
    await this.database.transaction(async (tx) => {
      await upsertPolicy(tx, workspaceId, actorUserId, policy, this.clock.now());
      await recordMutation(tx, { workspaceId, actorUserId, eventType, subjectType: "Workspace", subjectId: workspaceId, changes });
    });
  }
}

async function upsertPolicy(tx: Transaction, workspaceId: string, actorUserId: string, policy: WorkspaceDataPolicy, now: Date) {
  const values = settingsValues(workspaceId, actorUserId, policy, now);
  const { createdAt: _createdAt, ...updates } = values;
  await tx.insert(workspaceDataSettings).values(values).onConflictDoUpdate({
    target: workspaceDataSettings.workspaceId,
    set: updates,
  });
}

function settingsValues(workspaceId: string, actorUserId: string, policy: WorkspaceDataPolicy, now: Date) {
  return {
    workspaceId,
    timezone: policy.sending.timezone,
    activeDays: [...policy.sending.activeDays],
    windowStart: policy.sending.windowStart,
    windowEnd: policy.sending.windowEnd,
    linkedinDailyLimit: policy.channelLimits.linkedin,
    emailDailyLimit: policy.channelLimits.email,
    whatsappDailyLimit: policy.channelLimits.whatsapp,
    invitationsRetentionDays: policy.retention.invitationsDays,
    jobsRetentionDays: policy.retention.jobsDays,
    auditRetentionDays: policy.retention.auditDays,
    memoryEventsRetentionDays: policy.retention.memoryEventsDays,
    memorySnapshotsRetentionDays: policy.retention.memorySnapshotsDays,
    memoryReceiptsRetentionDays: policy.retention.memoryReceiptsDays,
    updatedBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
}

function policyFromRow(row: typeof workspaceDataSettings.$inferSelect): WorkspaceDataPolicy {
  const defaults = defaultWorkspaceDataPolicy();
  return validateWorkspaceDataPolicy({
    sending: {
      timezone: row.timezone,
      activeDays: Array.isArray(row.activeDays) ? row.activeDays.filter((value): value is number => typeof value === "number") : defaults.sending.activeDays,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    },
    channelLimits: { linkedin: row.linkedinDailyLimit, email: row.emailDailyLimit, whatsapp: row.whatsappDailyLimit },
    retention: {
      invitationsDays: row.invitationsRetentionDays,
      jobsDays: row.jobsRetentionDays,
      auditDays: row.auditRetentionDays,
      memoryEventsDays: row.memoryEventsRetentionDays,
      memorySnapshotsDays: row.memorySnapshotsRetentionDays,
      memoryReceiptsDays: row.memoryReceiptsRetentionDays,
    },
  });
}

async function recordMutation(tx: Transaction, input: { workspaceId: string; actorUserId: string | null; eventType: string; subjectType: string; subjectId: string; changes: Record<string, unknown> }) {
  const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: input.subjectType, aggregateId: input.subjectId, eventType: input.eventType, payload: input.changes }).returning({ id: outboxEvents.id });
  if (!event) throw new WorkspaceDataLifecycleError("WORKSPACE_EVENT_FAILED", 409);
  await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.eventType, subjectType: input.subjectType, subjectId: input.subjectId, changes: input.changes, sourceEventId: event.id });
  return event.id;
}

function anonymizedIdentity(type: string, id: string): string {
  if (type === "email") return `anonymized+${id}@invalid.local`;
  if (type === "linkedin") return `https://linkedin.invalid/anonymized/${id}`;
  return `anonymized-${id}`;
}

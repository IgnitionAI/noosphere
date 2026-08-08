import { and, asc, desc, eq, inArray, lte, isNull, sql } from "drizzle-orm";
import { transitionOutreachAction, retryDelayMs } from "@outbound/domain/campaigns/outreach-action";
import type { Database } from "@outbound/infrastructure/database/client";
import type { NewJob } from "@outbound/application/jobs/job-queue";
import { decryptSecret } from "@outbound/infrastructure/security/secret-crypto";
import { UnipileSendError, type UnipileClient } from "@outbound/infrastructure/integrations/unipile-client";
import {
  approvalItems, auditLogs, campaignEnrollments, campaigns, connectedAccounts, contactSuppressions,
  contacts, contactIdentities, outreachActions, outreachAttempts, outboxEvents, sequenceVersions,
} from "@outbound/infrastructure/database/schema";

export class OutreachSchedulerError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, unknown>> = {}) { super(code); }
}

export interface OutreachActionView {
  readonly id: string;
  readonly campaignId: string;
  readonly enrollmentId: string;
  readonly contactId: string;
  readonly sequenceVersionId: string;
  readonly approvalItemId: string | null;
  readonly connectedAccountId: string | null;
  readonly stepPosition: number;
  readonly channel: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly status: string;
  readonly idempotencyKey: string;
  readonly scheduledAt: Date;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly providerMessageId: string | null;
  readonly sentAt: Date | null;
  readonly responseReceivedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PostgresOutreachScheduler {
  constructor(private readonly db: Database, private readonly provider?: UnipileClient) {}

  async list(input: { workspaceId: string; campaignId?: string; status?: string }) {
    const conditions = [eq(outreachActions.workspaceId, input.workspaceId)];
    if (input.campaignId) conditions.push(eq(outreachActions.campaignId, input.campaignId));
    if (input.status) conditions.push(eq(outreachActions.status, input.status as never));
    const rows = await this.db.select().from(outreachActions).where(and(...conditions)).orderBy(asc(outreachActions.scheduledAt), asc(outreachActions.stepPosition)).limit(500);
    return rows.map(toView);
  }

  async get(input: { workspaceId: string; actionId: string }) {
    const rows = await this.db.select().from(outreachActions).where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.id, input.actionId))).limit(1);
    return rows[0] ? toView(rows[0]) : null;
  }

  async planEnrollment(input: { workspaceId: string; enrollmentId: string; userId?: string; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({ enrollment: campaignEnrollments, campaign: campaigns }).from(campaignEnrollments).innerJoin(campaigns, and(eq(campaignEnrollments.workspaceId, campaigns.workspaceId), eq(campaignEnrollments.campaignId, campaigns.id))).where(and(eq(campaignEnrollments.workspaceId, input.workspaceId), eq(campaignEnrollments.id, input.enrollmentId))).limit(1);
      const source = rows[0];
      if (!source) throw new OutreachSchedulerError("ENROLLMENT_NOT_FOUND");
      const sequenceRows = await tx.select().from(sequenceVersions).where(and(eq(sequenceVersions.workspaceId, input.workspaceId), eq(sequenceVersions.id, source.enrollment.sequenceVersionId))).limit(1);
      const sequence = sequenceRows[0];
      if (!sequence) throw new OutreachSchedulerError("SEQUENCE_VERSION_NOT_FOUND");
      const contactRows = await tx.select().from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, source.enrollment.contactId))).limit(1);
      const contact = contactRows[0];
      if (!contact) throw new OutreachSchedulerError("CONTACT_NOT_FOUND");
      const identityRows = await tx.select().from(contactIdentities).where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.contactId, contact.id), eq(contactIdentities.type, "email")));
      const recipient = identityRows[0]?.normalizedValue;
      if (!recipient) throw new OutreachSchedulerError("NO_EMAIL_CHANNEL");
      const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
      const planned: OutreachActionView[] = [];
      let delayDays = 0;
      for (const raw of steps) {
        if (!raw || typeof raw !== "object") continue;
        const step = raw as { position?: unknown; kind?: unknown; delayDays?: unknown; subject?: unknown; body?: unknown };
        if (step.kind !== "email") continue;
        const position = Number(step.position);
        if (!Number.isSafeInteger(position)) continue;
        delayDays += Number.isFinite(Number(step.delayDays)) ? Math.max(0, Number(step.delayDays)) : 0;
        const scheduledAt = new Date(source.enrollment.enrolledAt.getTime() + delayDays * 86_400_000);
        const idempotencyKey = `${input.enrollmentId}:${source.enrollment.sequenceVersionId}:${position}`;
        const existing = await tx.select({ id: outreachActions.id }).from(outreachActions).where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.idempotencyKey, idempotencyKey))).limit(1);
        if (existing[0]) continue;
        let approvalItemId: string | null = null;
        if (position === 1) {
          approvalItemId = crypto.randomUUID();
          await tx.insert(approvalItems).values({ id: approvalItemId, workspaceId: input.workspaceId, campaignId: source.enrollment.campaignId, contactId: contact.id, enrollmentId: input.enrollmentId, itemType: "first_contact", channel: "email", stepPosition: position, contentOriginal: { subject: typeof step.subject === "string" ? step.subject : null, body: typeof step.body === "string" ? step.body : "" }, context: { sequenceVersionId: source.enrollment.sequenceVersionId }, sourceUpdatedAt: contact.updatedAt });
        }
        const values = {
          id: crypto.randomUUID(), workspaceId: input.workspaceId, campaignId: source.enrollment.campaignId, enrollmentId: input.enrollmentId,
          contactId: contact.id, sequenceVersionId: source.enrollment.sequenceVersionId, approvalItemId, stepPosition: position, channel: "email", recipient,
          subject: typeof step.subject === "string" ? step.subject : null, body: typeof step.body === "string" ? step.body : "",
          idempotencyKey, scheduledAt, status: position === 1 ? "awaiting_approval" as const : "planned" as const,
        };
        const inserted = await tx.insert(outreachActions).values(values).onConflictDoNothing({ target: [outreachActions.workspaceId, outreachActions.idempotencyKey] }).returning();
        if (inserted[0]) planned.push(toView(inserted[0]));
      }
      if (planned.length && input.userId) {
        const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "CampaignEnrollment", aggregateId: input.enrollmentId, eventType: "OutreachActionsPlanned", payload: { type: "OutreachActionsPlanned", enrollmentId: input.enrollmentId, actionIds: planned.map((action) => action.id) } }).returning({ id: outboxEvents.id });
        if (event) await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: "OutreachActionsPlanned", subjectType: "CampaignEnrollment", subjectId: input.enrollmentId, changes: { actionIds: planned.map((action) => action.id) }, sourceEventId: event.id });
      }
      return planned;
    });
  }

  async markDue(input: { workspaceId?: string; now?: Date; limit?: number; queue?: { enqueue(job: NewJob): Promise<{ inserted: boolean }> } }) {
    const now = input.now ?? new Date();
    const conditions = [inArray(outreachActions.status, ["planned", "suspended"]), lte(outreachActions.scheduledAt, now), ...(input.workspaceId ? [eq(outreachActions.workspaceId, input.workspaceId)] : [])];
    const candidates = await this.db.select().from(outreachActions).where(and(...conditions)).orderBy(asc(outreachActions.scheduledAt)).limit(input.limit ?? 100);
    let count = 0;
    for (const candidate of candidates) {
      const result = await this.db.transaction(async (tx) => {
        const locked = await this.locked(tx, candidate.workspaceId, candidate.id);
        if (!locked || !["planned", "suspended"].includes(locked.status) || locked.scheduledAt > now) return null;
        const campaignRows = await tx.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.workspaceId, locked.workspaceId), eq(campaigns.id, locked.campaignId))).limit(1);
        if (campaignRows[0]?.status !== "active") return null;
        const updated = await tx.update(outreachActions).set({ status: "due", nextAttemptAt: null, updatedAt: now }).where(and(eq(outreachActions.id, locked.id), inArray(outreachActions.status, ["planned", "suspended"]))).returning();
        const action = updated[0];
        if (!action) return null;
        const eventId = await this.recordEvent(tx, action.workspaceId, action.id, "OutreachActionDue", { actionId: action.id, campaignId: action.campaignId, idempotencyKey: action.idempotencyKey });
        await tx.insert(auditLogs).values({ workspaceId: action.workspaceId, actorUserId: null, action: "OutreachActionDue", subjectType: "OutreachAction", subjectId: action.id, changes: { status: "due" }, sourceEventId: eventId });
        return action;
      });
      if (result) {
        count += 1;
        if (input.queue) await input.queue.enqueue({ id: crypto.randomUUID(), workspaceId: result.workspaceId, type: "outreach.action.execute", payload: { actionId: result.id }, idempotencyKey: `${result.idempotencyKey}:${result.scheduledAt.toISOString()}`, correlationId: result.id, maxAttempts: result.maxAttempts, availableAt: now });
      }
    }
    return count;
  }

  async execute(input: { workspaceId: string; actionId: string; now?: Date }) {
    if (!this.provider?.send) throw new OutreachSchedulerError("PROVIDER_NOT_CONFIGURED");
    const sender = this.provider.send.bind(this.provider);
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const action = await this.locked(tx, input.workspaceId, input.actionId);
      if (!action) throw new OutreachSchedulerError("OUTREACH_ACTION_NOT_FOUND");
      if (["sent", "cancelled", "awaiting_approval", "planned"].includes(action.status)) return toView(action);
      if (action.status !== "due") return toView(action);
      const campaignRows = await tx.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.workspaceId, input.workspaceId), eq(campaigns.id, action.campaignId))).limit(1);
      if (campaignRows[0]?.status !== "active") return this.suspend(tx, action, "CAMPAIGN_NOT_ACTIVE", now);
      const contactRows = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, action.contactId))).limit(1);
      if (!contactRows[0]) return this.cancelled(tx, action, "CONTACT_NOT_FOUND", now);
      const suppressionRows = await tx.select({ id: contactSuppressions.id }).from(contactSuppressions).where(and(eq(contactSuppressions.workspaceId, input.workspaceId), eq(contactSuppressions.contactId, action.contactId), eq(contactSuppressions.channel, "global"), isNull(contactSuppressions.liftedAt))).limit(1);
      if (suppressionRows[0]) return this.cancelled(tx, action, "CONTACT_SUPPRESSED", now);
      if (action.responseReceivedAt) return this.cancelled(tx, action, "RESPONSE_RECEIVED", now);
      if (action.approvalItemId) {
        const approvalRows = await tx.select({ status: approvalItems.status }).from(approvalItems).where(eq(approvalItems.id, action.approvalItemId)).limit(1);
        if (approvalRows[0]?.status !== "approved") return this.awaitingApproval(tx, action, now);
      } else if (action.stepPosition === 1) return this.awaitingApproval(tx, action, now);
      const accounts = await tx.select().from(connectedAccounts).where(and(eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.provider, "unipile"), eq(connectedAccounts.status, "connected"))).orderBy(desc(connectedAccounts.updatedAt)).limit(10);
      const account = accounts.find((candidate) => hasEmailCapability(candidate.capabilities));
      if (!account) return this.suspend(tx, action, "ACCOUNT_UNAVAILABLE", now);
      const sending = await tx.update(outreachActions).set({ status: "sending", connectedAccountId: account.id, attemptCount: action.attemptCount + 1, updatedAt: now }).where(and(eq(outreachActions.id, action.id), eq(outreachActions.status, "due"))).returning();
      const current = sending[0];
      if (!current) return toView(action);
      const attemptNo = current.attemptCount;
      await tx.insert(outreachAttempts).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actionId: current.id, attempt: attemptNo, status: "sending", startedAt: now });
      try {
        const sent = await sender({ providerAccountId: account.providerAccountId, accessToken: decryptSecret(account.encryptedSecret), recipient: current.recipient, subject: current.subject, body: current.body, idempotencyKey: current.idempotencyKey });
        const updatedRows = await tx.update(outreachActions).set({ status: "sent", providerMessageId: sent.providerMessageId, sentAt: now, lastErrorCode: null, lastErrorMessage: null, updatedAt: now }).where(and(eq(outreachActions.id, current.id), eq(outreachActions.status, "sending"))).returning();
        await tx.update(outreachAttempts).set({ status: "sent", providerMessageId: sent.providerMessageId, completedAt: now }).where(and(eq(outreachAttempts.actionId, current.id), eq(outreachAttempts.attempt, attemptNo)));
        const acceptedEvent = await this.recordEvent(tx, input.workspaceId, current.id, "OutreachActionAccepted", { actionId: current.id, idempotencyKey: current.idempotencyKey, providerMessageId: sent.providerMessageId });
        await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: null, action: "OutreachActionAccepted", subjectType: "OutreachAction", subjectId: current.id, changes: { status: "sent", providerMessageId: sent.providerMessageId }, sourceEventId: acceptedEvent });
        return toView(updatedRows[0] ?? current);
      } catch (error) {
        const sendError = error instanceof UnipileSendError ? error : new UnipileSendError("SEND_FAILED", error instanceof Error ? error.message : String(error));
        await tx.update(outreachAttempts).set({ status: sendError.code === "RATE_LIMITED" ? "rate_limited" : "failed", errorCode: sendError.code, errorMessage: sendError.message, completedAt: now }).where(and(eq(outreachAttempts.actionId, current.id), eq(outreachAttempts.attempt, attemptNo)));
        if (sendError.code === "RATE_LIMITED") {
          const next = new Date(now.getTime() + (sendError.retryAfterMs ?? retryDelayMs(attemptNo)));
          const rows = await tx.update(outreachActions).set({ status: "planned", scheduledAt: next, nextAttemptAt: next, lastErrorCode: sendError.code, lastErrorMessage: sendError.message, updatedAt: now }).where(eq(outreachActions.id, current.id)).returning();
          return toView(rows[0] ?? current);
        }
        const terminal = attemptNo >= current.maxAttempts;
        const rows = await tx.update(outreachActions).set({ status: terminal ? "failed" : "planned", scheduledAt: terminal ? current.scheduledAt : new Date(now.getTime() + retryDelayMs(attemptNo)), nextAttemptAt: terminal ? null : new Date(now.getTime() + retryDelayMs(attemptNo)), lastErrorCode: sendError.code, lastErrorMessage: sendError.message, updatedAt: now }).where(eq(outreachActions.id, current.id)).returning();
        return toView(rows[0] ?? current);
      }
    });
  }

  async cancel(input: { workspaceId: string; actionId: string; userId: string; now?: Date }) { return this.mutate(input, "cancel"); }
  async retry(input: { workspaceId: string; actionId: string; userId: string; now?: Date }) { return this.mutate(input, "retry"); }

  async recordResponse(input: { workspaceId: string; actionId: string; at?: Date }) {
    const at = input.at ?? new Date();
    const rows = await this.db.update(outreachActions).set({ responseReceivedAt: at, updatedAt: at }).where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.id, input.actionId))).returning();
    if (!rows[0]) throw new OutreachSchedulerError("OUTREACH_ACTION_NOT_FOUND");
    return toView(rows[0]);
  }

  private async mutate(input: { workspaceId: string; actionId: string; userId: string; now?: Date }, transition: "cancel" | "retry") {
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const action = await this.locked(tx, input.workspaceId, input.actionId);
      if (!action) throw new OutreachSchedulerError("OUTREACH_ACTION_NOT_FOUND");
      let result;
      try { result = transitionOutreachAction(action.status, transition); } catch (error) { throw new OutreachSchedulerError(error instanceof Error ? error.message : "OUTREACH_ACTION_CONFLICT"); }
      if (!result.changed) return toView(action);
      const rows = await tx.update(outreachActions).set({ status: result.status, ...(transition === "cancel" ? { cancelledAt: now } : { scheduledAt: now, nextAttemptAt: null, lastErrorCode: null, lastErrorMessage: null }), updatedAt: now }).where(eq(outreachActions.id, action.id)).returning();
      const updated = rows[0]!;
      const eventType = transition === "cancel" ? "OutreachActionCancelled" : "OutreachActionRetried";
      const eventId = await this.recordEvent(tx, input.workspaceId, action.id, eventType, { actionId: action.id, idempotencyKey: action.idempotencyKey });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: eventType, subjectType: "OutreachAction", subjectId: action.id, changes: { status: updated.status }, sourceEventId: eventId });
      return toView(updated);
    });
  }

  private async locked(tx: any, workspaceId: string, actionId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${actionId}`}, 0))`);
    const rows = await tx.select().from(outreachActions).where(and(eq(outreachActions.workspaceId, workspaceId), eq(outreachActions.id, actionId))).limit(1);
    return rows[0] ?? null;
  }
  private async recordEvent(tx: any, workspaceId: string, aggregateId: string, eventType: string, payload: unknown) {
    const [event] = await tx.insert(outboxEvents).values({ workspaceId, aggregateType: "OutreachAction", aggregateId, eventType, payload: { type: eventType, ...(payload as Record<string, unknown>) } }).returning({ id: outboxEvents.id });
    if (!event) throw new OutreachSchedulerError("OUTBOX_EVENT_CREATE_FAILED");
    return event.id;
  }
  private async cancelled(tx: any, action: typeof outreachActions.$inferSelect, code: string, now: Date) { const rows = await tx.update(outreachActions).set({ status: "cancelled", lastErrorCode: code, lastErrorMessage: code, cancelledAt: now, updatedAt: now }).where(eq(outreachActions.id, action.id)).returning(); return toView(rows[0] ?? action); }
  private async suspend(tx: any, action: typeof outreachActions.$inferSelect, code: string, now: Date) { const next = new Date(now.getTime() + 60_000); const rows = await tx.update(outreachActions).set({ status: "suspended", scheduledAt: next, nextAttemptAt: next, lastErrorCode: code, lastErrorMessage: code, updatedAt: now }).where(eq(outreachActions.id, action.id)).returning(); return toView(rows[0] ?? action); }
  private async awaitingApproval(tx: any, action: typeof outreachActions.$inferSelect, now: Date) { const rows = await tx.update(outreachActions).set({ status: "awaiting_approval", lastErrorCode: "APPROVAL_REQUIRED", updatedAt: now }).where(eq(outreachActions.id, action.id)).returning(); return toView(rows[0] ?? action); }
}

function hasEmailCapability(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const email = (value as Record<string, unknown>).email;
  if (email === true) return true;
  return Boolean(email && typeof email === "object" && (email as Record<string, unknown>).sending === true);
}

function toView(row: typeof outreachActions.$inferSelect): OutreachActionView {
  return { id: row.id, campaignId: row.campaignId, enrollmentId: row.enrollmentId, contactId: row.contactId, sequenceVersionId: row.sequenceVersionId, approvalItemId: row.approvalItemId, connectedAccountId: row.connectedAccountId, stepPosition: row.stepPosition, channel: row.channel, recipient: row.recipient, subject: row.subject, status: row.status, idempotencyKey: row.idempotencyKey, scheduledAt: row.scheduledAt, attemptCount: row.attemptCount, maxAttempts: row.maxAttempts, nextAttemptAt: row.nextAttemptAt, lastErrorCode: row.lastErrorCode, lastErrorMessage: row.lastErrorMessage, providerMessageId: row.providerMessageId, sentAt: row.sentAt, responseReceivedAt: row.responseReceivedAt, cancelledAt: row.cancelledAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

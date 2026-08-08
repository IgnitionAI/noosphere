import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { decideApprovalItem, type ApprovalDecision } from "@outbound/domain/campaigns/approval-item";
import type { Database } from "@outbound/infrastructure/database/client";
import { approvalItems, auditLogs, contactSuppressions, contacts, outboxEvents } from "@outbound/infrastructure/database/schema";

export class ApprovalRepositoryError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, unknown>> = {}) { super(code); }
}

export interface ApprovalItemView {
  readonly id: string;
  readonly campaignId: string | null;
  readonly contactId: string | null;
  readonly enrollmentId: string | null;
  readonly itemType: string;
  readonly channel: string;
  readonly stepPosition: number | null;
  readonly contentOriginal: unknown;
  readonly contentEdited: unknown;
  readonly context: unknown;
  readonly sourceUpdatedAt: Date | null;
  readonly status: string;
  readonly decisionBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionJustification: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PostgresApprovalRepository {
  constructor(private readonly db: Database) {}

  async list(input: { workspaceId: string; campaignId?: string; status?: "pending" | "approved" | "rejected" | "invalidated"; limit: number }) {
    const conditions = [eq(approvalItems.workspaceId, input.workspaceId)];
    if (input.campaignId) conditions.push(eq(approvalItems.campaignId, input.campaignId));
    if (input.status) conditions.push(eq(approvalItems.status, input.status));
    const rows = await this.db.select().from(approvalItems).where(and(...conditions)).orderBy(desc(approvalItems.createdAt)).limit(input.limit);
    const result: ApprovalItemView[] = [];
    for (const row of rows) {
      const current = await this.invalidateIfStale(this.db, row);
      if (!input.status || current.status === input.status) result.push(toView(current));
    }
    return result;
  }

  async get(input: { workspaceId: string; itemId: string }) {
    const rows = await this.db.select().from(approvalItems).where(and(eq(approvalItems.workspaceId, input.workspaceId), eq(approvalItems.id, input.itemId))).limit(1);
    const row = rows[0];
    return row ? toView(await this.invalidateIfStale(this.db, row)) : null;
  }

  async create(input: {
    id?: string;
    workspaceId: string;
    campaignId?: string | null;
    contactId?: string | null;
    enrollmentId?: string | null;
    itemType: string;
    channel: string;
    stepPosition?: number | null;
    contentOriginal: unknown;
    context?: unknown;
    sourceUpdatedAt?: Date | null;
  }) {
    const rows = await this.db.insert(approvalItems).values({
      id: input.id ?? crypto.randomUUID(), workspaceId: input.workspaceId,
      campaignId: input.campaignId ?? null, contactId: input.contactId ?? null, enrollmentId: input.enrollmentId ?? null,
      itemType: input.itemType, channel: input.channel, stepPosition: input.stepPosition ?? null,
      contentOriginal: input.contentOriginal, context: input.context ?? {}, sourceUpdatedAt: input.sourceUpdatedAt ?? new Date(),
    }).returning();
    return toView(rows[0]!);
  }

  async update(input: { workspaceId: string; itemId: string; contentEdited: unknown }) {
    if (input.contentEdited === null || input.contentEdited === undefined) throw new ApprovalRepositoryError("EDITED_CONTENT_REQUIRED");
    return this.db.transaction(async (tx) => {
      const item = await this.locked(tx, input.workspaceId, input.itemId);
      if (!item) throw new ApprovalRepositoryError("APPROVAL_ITEM_NOT_FOUND");
      const current = await this.invalidateIfStale(tx, item);
      if (current.status === "invalidated") throw new ApprovalRepositoryError("APPROVAL_ITEM_INVALIDATED");
      if (current.status !== "pending") throw new ApprovalRepositoryError("APPROVAL_ITEM_DECISION_CONFLICT");
      const rows = await tx.update(approvalItems).set({ contentEdited: input.contentEdited, updatedAt: new Date() }).where(eq(approvalItems.id, input.itemId)).returning();
      return toView(rows[0]!);
    });
  }

  async decide(input: { workspaceId: string; itemId: string; decision: ApprovalDecision; userId: string; justification?: string }) {
    return this.db.transaction(async (tx) => this.decideInTransaction(tx, input));
  }

  async bulkDecide(input: { workspaceId: string; decisions: readonly { itemId: string; decision: ApprovalDecision; justification?: string }[]; userId: string }) {
    const result = { approved: [] as string[], rejected: [] as string[], invalidated: [] as string[], conflicts: [] as { itemId: string; code: string }[] };
    await this.db.transaction(async (tx) => {
      for (const decision of input.decisions) {
        try {
          const item = await this.decideInTransaction(tx, { ...decision, workspaceId: input.workspaceId, userId: input.userId });
          if (item.status === "approved") result.approved.push(item.id);
          if (item.status === "rejected") result.rejected.push(item.id);
        } catch (error) {
          const code = error instanceof ApprovalRepositoryError ? error.code : error instanceof Error ? error.message : "DECISION_FAILED";
          if (code === "APPROVAL_ITEM_INVALIDATED") result.invalidated.push(decision.itemId);
          else result.conflicts.push({ itemId: decision.itemId, code });
        }
      }
    });
    return result;
  }

  private async decideInTransaction(tx: any, input: { workspaceId: string; itemId: string; decision: ApprovalDecision; userId: string; justification?: string }) {
    const item = await this.locked(tx, input.workspaceId, input.itemId);
    if (!item) throw new ApprovalRepositoryError("APPROVAL_ITEM_NOT_FOUND");
    const current = await this.invalidateIfStale(tx, item);
    let transition: { status: "approved" | "rejected" | "pending" | "invalidated"; changed: boolean };
    try { transition = decideApprovalItem(current.status, input.decision, input.justification); }
    catch (error) { throw new ApprovalRepositoryError(error instanceof Error ? error.message : "APPROVAL_ITEM_DECISION_FAILED"); }
    if (!transition.changed) return toView(current);
    const decidedAt = new Date();
    const rows = await tx.update(approvalItems).set({ status: transition.status, decisionBy: input.userId, decidedAt, ...(input.decision === "reject" ? { rejectionJustification: input.justification!.trim() } : {}), updatedAt: decidedAt }).where(eq(approvalItems.id, input.itemId)).returning();
    const updated = rows[0]!;
    const eventType = input.decision === "approve" ? "ApprovalItemApproved" : "ApprovalItemRejected";
    const payload = { type: eventType, approvalItemId: input.itemId, workspaceId: input.workspaceId, campaignId: updated.campaignId, contactId: updated.contactId, contentOriginal: updated.contentOriginal, contentEdited: updated.contentEdited, ...(input.decision === "reject" ? { justification: input.justification } : {}) };
    const [event] = await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, aggregateType: "ApprovalItem", aggregateId: input.itemId, eventType, payload }).returning({ id: outboxEvents.id });
    await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.userId, action: eventType, subjectType: "ApprovalItem", subjectId: input.itemId, changes: payload, sourceEventId: event.id });
    return toView(updated);
  }

  private async locked(tx: any, workspaceId: string, itemId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${itemId}`}, 0))`);
    const rows = await tx.select().from(approvalItems).where(and(eq(approvalItems.workspaceId, workspaceId), eq(approvalItems.id, itemId))).limit(1);
    return rows[0] ?? null;
  }

  private async invalidateIfStale(executor: any, row: typeof approvalItems.$inferSelect) {
    if (row.status !== "pending") return row;
    let reason: string | null = row.contactId ? null : "contact_deleted";
    if (!reason && row.contactId) {
      const contactRows = await executor.select({ updatedAt: contacts.updatedAt }).from(contacts).where(eq(contacts.id, row.contactId)).limit(1);
      const contact = contactRows[0];
      if (!contact) reason = "contact_deleted";
      else if (row.sourceUpdatedAt && contact.updatedAt > row.sourceUpdatedAt) reason = "contact_data_changed";
      if (!reason) {
        const suppression = await executor.select({ id: contactSuppressions.id }).from(contactSuppressions).where(and(eq(contactSuppressions.workspaceId, row.workspaceId), eq(contactSuppressions.contactId, row.contactId), eq(contactSuppressions.channel, "global"), isNull(contactSuppressions.liftedAt))).limit(1);
        if (suppression[0]) reason = "contact_suppressed";
      }
    }
    if (!reason) return row;
    const rows = await executor.update(approvalItems).set({ status: "invalidated", invalidationReason: reason, updatedAt: new Date() }).where(and(eq(approvalItems.id, row.id), eq(approvalItems.status, "pending"))).returning();
    return rows[0] ?? row;
  }
}

function toView(row: typeof approvalItems.$inferSelect): ApprovalItemView {
  return { id: row.id, campaignId: row.campaignId, contactId: row.contactId, enrollmentId: row.enrollmentId, itemType: row.itemType, channel: row.channel, stepPosition: row.stepPosition, contentOriginal: row.contentOriginal, contentEdited: row.contentEdited, context: row.context, sourceUpdatedAt: row.sourceUpdatedAt, status: row.status, decisionBy: row.decisionBy, decidedAt: row.decidedAt, rejectionJustification: row.rejectionJustification, invalidationReason: row.invalidationReason, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

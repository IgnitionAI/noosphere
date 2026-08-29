import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  canTransitionOpportunity,
  isOpportunityStage,
  pipelineColumn,
  type OpportunityStage,
} from "@outbound/domain/pipeline/opportunity";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  campaigns,
  companies,
  contactEmployments,
  contacts,
  icpVersions,
  auditLogs,
  offerVersions,
  opportunities,
  opportunityStageHistory,
  outboxEvents,
  workspaceLostReasons,
  workspaceMembers,
} from "@outbound/infrastructure/database/schema";

export const DEFAULT_LOST_REASONS = [
  { key: "budget", label: "Budget indisponible" },
  { key: "timing", label: "Mauvais timing" },
  { key: "no_need", label: "Pas de besoin" },
  { key: "competitor", label: "Concurrent choisi" },
  { key: "no_response", label: "Sans réponse" },
  { key: "other", label: "Autre" },
] as const;

export class PostgresOpportunityRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async list(workspaceId: string, options: { readonly cursor?: string; readonly limit?: number } = {}) {
    const cursor = options.cursor === undefined ? null : decodeOpportunityCursor(options.cursor);
    const conditions = [eq(opportunities.workspaceId, workspaceId)];
    if (cursor) {
      conditions.push(or(
        lt(opportunities.updatedAt, cursor.updatedAt),
        and(eq(opportunities.updatedAt, cursor.updatedAt), lt(opportunities.id, cursor.id)),
      )!);
    }
    const query = this.database
      .select({
        id: opportunities.id,
        contactId: opportunities.contactId,
        campaignId: opportunities.campaignId,
        stage: opportunities.stage,
        amount: opportunities.amount,
        currency: opportunities.currency,
        probability: opportunities.probability,
        ownerUserId: opportunities.ownerUserId,
        nextAction: opportunities.nextAction,
        expectedCloseDate: opportunities.expectedCloseDate,
        closedAt: opportunities.closedAt,
        lostReason: opportunities.lostReason,
        lostComment: opportunities.lostComment,
        offerVersionId: opportunities.offerVersionId,
        createdAt: opportunities.createdAt,
        updatedAt: opportunities.updatedAt,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        companyName: companies.name,
        jobTitle: contactEmployments.title,
        campaignName: campaigns.name,
        icpName: icpVersions.name,
      })
      .from(opportunities)
      .innerJoin(contacts, and(
        eq(contacts.workspaceId, opportunities.workspaceId),
        eq(contacts.id, opportunities.contactId),
      ))
      .leftJoin(contactEmployments, and(
        eq(contactEmployments.workspaceId, opportunities.workspaceId),
        eq(contactEmployments.contactId, opportunities.contactId),
        eq(contactEmployments.isCurrent, true),
      ))
      .leftJoin(companies, and(
        eq(companies.workspaceId, contactEmployments.workspaceId),
        eq(companies.id, contactEmployments.companyId),
      ))
      .leftJoin(campaigns, and(
        eq(campaigns.workspaceId, opportunities.workspaceId),
        eq(campaigns.id, opportunities.campaignId),
      ))
      .leftJoin(icpVersions, and(
        eq(icpVersions.workspaceId, campaigns.workspaceId),
        eq(icpVersions.id, campaigns.icpVersionId),
      ))
      .where(and(...conditions))
      .orderBy(desc(opportunities.updatedAt), desc(opportunities.id));
    const rows = options.limit === undefined ? await query : await query.limit(options.limit + 1);
    const hasMore = options.limit !== undefined && rows.length > options.limit;
    const pageRows = options.limit === undefined ? rows : rows.slice(0, options.limit);
    const opportunityIds = pageRows.map((row) => row.id);
    const contactIds = [...new Set(pageRows.map((row) => row.contactId))];
    const [historyRows, bookingRows] = await Promise.all([
      opportunityIds.length
        ? this.database
            .select()
            .from(opportunityStageHistory)
            .where(and(
              eq(opportunityStageHistory.workspaceId, workspaceId),
              inArray(opportunityStageHistory.opportunityId, opportunityIds),
            ))
            .orderBy(asc(opportunityStageHistory.createdAt))
        : [],
      contactIds.length
        ? this.database
            .select({
              contactId: calendarBookings.contactId,
              campaignId: calendarBookings.campaignId,
              status: calendarBookings.status,
              startAt: calendarBookings.startAt,
              endAt: calendarBookings.endAt,
              meetingUrl: calendarBookings.meetingUrl,
              updatedAt: calendarBookings.updatedAt,
            })
            .from(calendarBookings)
            .where(and(
              eq(calendarBookings.workspaceId, workspaceId),
              inArray(calendarBookings.contactId, contactIds),
            ))
            .orderBy(desc(calendarBookings.updatedAt))
        : [],
    ]);
    const histories = groupBy(historyRows, (row) => row.opportunityId);
    const bookings = new Map<string, typeof bookingRows[number]>();
    for (const booking of bookingRows) {
      if (!booking.contactId) continue;
      const key = `${booking.contactId}:${booking.campaignId ?? "none"}`;
      if (!bookings.has(key)) bookings.set(key, booking);
    }
    const data = pageRows.map((row) => ({
      ...row,
      column: pipelineColumn(row.stage),
      meeting: bookings.get(`${row.contactId}:${row.campaignId ?? "none"}`)
        ?? bookings.get(`${row.contactId}:none`)
        ?? null,
      history: histories.get(row.id) ?? [],
    }));
    return {
      data,
      nextCursor: hasMore && data.at(-1) ? encodeOpportunityCursor(data.at(-1)!.updatedAt, data.at(-1)!.id) : null,
      metrics: {
        total: data.length,
        qualified: data.filter((item) => item.column === "qualified").length,
        meetings: data.filter((item) => item.stage === "meeting_booked").length,
        followUp: data.filter((item) => item.column === "follow_up").length,
        won: data.filter((item) => item.stage === "won").length,
      },
    };
  }

  async update(input: {
    workspaceId: string;
    opportunityId: string;
    actorUserId: string;
    actorRole?: string;
    expectedRevision?: number;
    amount?: number | null | undefined;
    currency?: string | null | undefined;
    probability?: number | undefined;
    ownerUserId?: string | null | undefined;
    nextAction?: string | null | undefined;
    expectedCloseDate?: Date | null | undefined;
    now: Date;
  }) {
    return this.database.transaction(async (tx) => {
      const [current] = await tx.select().from(opportunities).where(and(
        eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId),
      )).for("update").limit(1);
      if (!current) throw new OpportunityPipelineError("OPPORTUNITY_NOT_FOUND", 404);
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) throw new OpportunityPipelineError("MCP_WRITE_VERSION_CONFLICT", 409);
      if (current.stage === "won" || current.stage === "lost") throw new OpportunityPipelineError("OPPORTUNITY_LOCKED", 409);
      if (input.actorRole === "operator" && current.ownerUserId && current.ownerUserId !== input.actorUserId) throw new OpportunityPipelineError("OPPORTUNITY_FORBIDDEN", 403);
      const changes: Record<string, unknown> = {};
      if (input.amount !== undefined) {
        if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount < 0)) throw new OpportunityPipelineError("OPPORTUNITY_AMOUNT_INVALID", 422, { field: "amount" });
        changes.amount = input.amount;
      }
      if (input.currency !== undefined) {
        if (input.currency !== null && !/^[A-Z]{3}$/.test(input.currency)) throw new OpportunityPipelineError("OPPORTUNITY_CURRENCY_INVALID", 422, { field: "currency" });
        changes.currency = input.currency;
      }
      if (input.probability !== undefined) {
        if (!Number.isInteger(input.probability) || input.probability < 0 || input.probability > 100) throw new OpportunityPipelineError("OPPORTUNITY_PROBABILITY_INVALID", 422, { field: "probability" });
        changes.probability = input.probability;
      }
      if (input.ownerUserId !== undefined) {
        if (input.ownerUserId) {
          const [member] = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(
            eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.ownerUserId), eq(workspaceMembers.status, "active"),
          )).limit(1);
          if (!member) throw new OpportunityPipelineError("OPPORTUNITY_OWNER_INVALID", 422, { field: "ownerUserId" });
        }
        changes.ownerUserId = input.ownerUserId;
      }
      if (input.nextAction !== undefined) changes.nextAction = input.nextAction;
      if (input.expectedCloseDate !== undefined) changes.expectedCloseDate = input.expectedCloseDate;
      if (!Object.keys(changes).length) return current;
      changes.revision = sql`${opportunities.revision} + 1`;
      changes.updatedAt = input.now;
      const [updated] = await tx.update(opportunities).set(changes).where(and(
        eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId),
      )).returning();
      if (!updated) throw new OpportunityPipelineError("OPPORTUNITY_UPDATE_FAILED", 409);
      const event = await this.recordEvent(tx, {
        workspaceId: input.workspaceId,
        opportunityId: input.opportunityId,
        eventType: "OpportunityUpdated",
        actorUserId: input.actorUserId,
        payload: { changed: Object.keys(changes).filter((key) => key !== "updatedAt"), before: redactChanges(current), after: redactChanges(updated) },
      });
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "OpportunityUpdated",
        subjectType: "Opportunity",
        subjectId: input.opportunityId,
        changes: { before: redactChanges(current), after: redactChanges(updated) },
        sourceEventId: event.id,
      });
      return updated;
    });
  }

  async close(input: {
    workspaceId: string;
    opportunityId: string;
    actorUserId: string;
    actorRole?: string;
    stage: "won" | "lost";
    amount?: number | null | undefined;
    currency?: string | null | undefined;
    offerVersionId?: string | null | undefined;
    lostReason?: string | null | undefined;
    lostComment?: string | null | undefined;
    now: Date;
  }) {
    return this.database.transaction(async (tx) => {
      const [current] = await tx.select().from(opportunities).where(and(
        eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId),
      )).for("update").limit(1);
      if (!current) throw new OpportunityPipelineError("OPPORTUNITY_NOT_FOUND", 404);
      if (current.stage === input.stage) return current;
      if (current.stage === "won" || current.stage === "lost") throw new OpportunityPipelineError("OPPORTUNITY_LOCKED", 409);
      if (input.actorRole === "operator" && current.ownerUserId && current.ownerUserId !== input.actorUserId) throw new OpportunityPipelineError("OPPORTUNITY_FORBIDDEN", 403);
      if (input.stage === "won") {
        const amount = input.amount ?? current.amount;
        const currency = input.currency ?? current.currency;
        const offerVersionId = input.offerVersionId ?? current.offerVersionId;
        if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) throw new OpportunityPipelineError("OPPORTUNITY_WON_AMOUNT_REQUIRED", 422, { field: "amount" });
        if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new OpportunityPipelineError("OPPORTUNITY_WON_CURRENCY_REQUIRED", 422, { field: "currency" });
        if (!offerVersionId) throw new OpportunityPipelineError("OPPORTUNITY_WON_OFFER_VERSION_REQUIRED", 422, { field: "offerVersionId" });
        const [offer] = await tx.select({ id: offerVersions.id }).from(offerVersions).where(and(
          eq(offerVersions.workspaceId, input.workspaceId), eq(offerVersions.id, offerVersionId),
        )).limit(1);
        if (!offer) throw new OpportunityPipelineError("OPPORTUNITY_OFFER_VERSION_INVALID", 422, { field: "offerVersionId" });
        return this.persistClose(tx, current, input, { amount, currency, offerVersionId, lostReason: null, lostComment: null });
      }
      const lostReason = input.lostReason ?? current.lostReason;
      if (!lostReason) throw new OpportunityPipelineError("OPPORTUNITY_LOST_REASON_REQUIRED", 422, { field: "lostReason" });
      const reasons = await tx.select({ key: workspaceLostReasons.key }).from(workspaceLostReasons).where(and(
        eq(workspaceLostReasons.workspaceId, input.workspaceId), eq(workspaceLostReasons.key, lostReason), eq(workspaceLostReasons.active, true),
      )).limit(1);
      if (!reasons[0] && !DEFAULT_LOST_REASONS.some((reason) => reason.key === lostReason)) throw new OpportunityPipelineError("OPPORTUNITY_LOST_REASON_INVALID", 422, { field: "lostReason" });
      return this.persistClose(tx, current, input, { amount: input.amount ?? current.amount, currency: input.currency ?? current.currency, offerVersionId: current.offerVersionId, lostReason, lostComment: input.lostComment ?? current.lostComment });
    });
  }

  private async persistClose(tx: any, current: typeof opportunities.$inferSelect, input: { workspaceId: string; opportunityId: string; actorUserId: string; stage: "won" | "lost"; now: Date }, values: { amount: number | null; currency: string | null; offerVersionId: string | null; lostReason: string | null; lostComment: string | null }) {
    const [updated] = await tx.update(opportunities).set({
      stage: input.stage,
      amount: values.amount,
      currency: values.currency,
      offerVersionId: values.offerVersionId,
      lostReason: values.lostReason,
      lostComment: values.lostComment,
      closedAt: input.now,
      updatedAt: input.now,
    }).where(and(eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId))).returning();
    if (!updated) throw new OpportunityPipelineError("OPPORTUNITY_CLOSE_FAILED", 409);
    await tx.insert(opportunityStageHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, opportunityId: input.opportunityId, fromStage: current.stage, toStage: input.stage, source: "operator", reason: values.lostReason ?? "won", createdAt: input.now });
    const event = await this.recordEvent(tx, { workspaceId: input.workspaceId, opportunityId: input.opportunityId, eventType: input.stage === "won" ? "OpportunityWon" : "OpportunityLost", actorUserId: input.actorUserId, payload: { opportunityId: input.opportunityId, fromStage: current.stage, toStage: input.stage, amount: values.amount, currency: values.currency, offerVersionId: values.offerVersionId, lostReason: values.lostReason } });
    await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.stage === "won" ? "OpportunityWon" : "OpportunityLost", subjectType: "Opportunity", subjectId: input.opportunityId, changes: { before: redactChanges(current), after: redactChanges(updated) }, sourceEventId: event.id });
    return updated;
  }

  async reopen(input: { workspaceId: string; opportunityId: string; actorUserId: string; now: Date }) {
    return this.database.transaction(async (tx) => {
      const [current] = await tx.select().from(opportunities).where(and(eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId))).for("update").limit(1);
      if (!current) throw new OpportunityPipelineError("OPPORTUNITY_NOT_FOUND", 404);
      if (current.stage !== "won" && current.stage !== "lost") return current;
      // Keep the effective closure timestamp for analytics history; a later
      // dedicated close overwrites it with the new effective close date.
      const [updated] = await tx.update(opportunities).set({ stage: "qualified", updatedAt: input.now }).where(and(eq(opportunities.workspaceId, input.workspaceId), eq(opportunities.id, input.opportunityId))).returning();
      if (!updated) throw new OpportunityPipelineError("OPPORTUNITY_REOPEN_FAILED", 409);
      await tx.insert(opportunityStageHistory).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, opportunityId: input.opportunityId, fromStage: current.stage, toStage: "qualified", source: "reopen", reason: "explicit_reopen", createdAt: input.now });
      const event = await this.recordEvent(tx, { workspaceId: input.workspaceId, opportunityId: input.opportunityId, eventType: "OpportunityReopened", actorUserId: input.actorUserId, payload: { opportunityId: input.opportunityId, fromStage: current.stage, toStage: "qualified" } });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "OpportunityReopened", subjectType: "Opportunity", subjectId: input.opportunityId, changes: { before: redactChanges(current), after: redactChanges(updated) }, sourceEventId: event.id });
      return updated;
    });
  }

  async forecast(input: { workspaceId: string; from?: Date | undefined; to?: Date | undefined }) {
    const conditions = [eq(opportunities.workspaceId, input.workspaceId), sql`${opportunities.expectedCloseDate} is not null`];
    if (input.from) conditions.push(sql`${opportunities.expectedCloseDate} >= ${input.from.toISOString()}`);
    if (input.to) conditions.push(sql`${opportunities.expectedCloseDate} < ${input.to.toISOString()}`);
    const rows = await this.database.select({ stage: opportunities.stage, ownerUserId: opportunities.ownerUserId, amount: opportunities.amount, probability: opportunities.probability, expectedCloseDate: opportunities.expectedCloseDate }).from(opportunities).where(and(...conditions));
    const grouped = new Map<string, { period: string; stage: string; ownerUserId: string | null; amount: number; weightedRevenue: number; count: number }>();
    for (const row of rows) {
      if (!row.expectedCloseDate) continue;
      const period = row.expectedCloseDate.toISOString().slice(0, 10);
      const key = `${period}:${row.stage}:${row.ownerUserId ?? "unassigned"}`;
      const amount = Number(row.amount ?? 0);
      const current = grouped.get(key) ?? { period, stage: row.stage, ownerUserId: row.ownerUserId, amount: 0, weightedRevenue: 0, count: 0 };
      current.amount += amount;
      current.weightedRevenue += amount * (row.probability ?? 0) / 100;
      current.count += 1;
      grouped.set(key, current);
    }
    return { data: [...grouped.values()].sort((a, b) => a.period.localeCompare(b.period) || a.stage.localeCompare(b.stage) || (a.ownerUserId ?? "").localeCompare(b.ownerUserId ?? "")) };
  }

  async listLostReasons(workspaceId: string) {
    const custom = await this.database.select({ key: workspaceLostReasons.key, label: workspaceLostReasons.label }).from(workspaceLostReasons).where(and(eq(workspaceLostReasons.workspaceId, workspaceId), eq(workspaceLostReasons.active, true))).orderBy(asc(workspaceLostReasons.key));
    const keys = new Set(custom.map((reason) => reason.key));
    return [...DEFAULT_LOST_REASONS.filter((reason) => !keys.has(reason.key)), ...custom];
  }

  async upsertLostReason(input: { workspaceId: string; key: string; label: string; actorUserId: string }) {
    const [row] = await this.database.insert(workspaceLostReasons).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, key: input.key, label: input.label, createdBy: input.actorUserId }).onConflictDoUpdate({ target: [workspaceLostReasons.workspaceId, workspaceLostReasons.key], set: { label: input.label, active: true, updatedAt: new Date() } }).returning();
    return row;
  }

  async changeStage(input: {
    workspaceId: string;
    opportunityId: string;
    stage: OpportunityStage;
    reason: string | null;
    actorUserId?: string;
    actorRole?: string;
    expectedRevision?: number;
    now: Date;
  }) {
    return this.database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(opportunities)
        .where(and(
          eq(opportunities.workspaceId, input.workspaceId),
          eq(opportunities.id, input.opportunityId),
        ))
        .for("update")
        .limit(1);
      if (!current) throw new OpportunityPipelineError("OPPORTUNITY_NOT_FOUND", 404);
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) throw new OpportunityPipelineError("MCP_WRITE_VERSION_CONFLICT", 409);
      if (input.actorRole === "operator" && current.ownerUserId && current.ownerUserId !== input.actorUserId) throw new OpportunityPipelineError("OPPORTUNITY_FORBIDDEN", 403);
      if (!isOpportunityStage(current.stage)) {
        throw new OpportunityPipelineError("OPPORTUNITY_STAGE_CORRUPTED", 409);
      }
      if (!canTransitionOpportunity(current.stage, input.stage)) {
        throw new OpportunityPipelineError("OPPORTUNITY_TRANSITION_INVALID", 409);
      }
      const [updated] = await tx.update(opportunities).set({
        stage: input.stage,
        revision: sql`${opportunities.revision} + 1`,
        updatedAt: input.now,
      }).where(and(
        eq(opportunities.workspaceId, input.workspaceId),
        eq(opportunities.id, input.opportunityId),
        eq(opportunities.revision, current.revision),
      )).returning();
      if (!updated) throw new OpportunityPipelineError("MCP_WRITE_VERSION_CONFLICT", 409);
      await tx.insert(opportunityStageHistory).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        opportunityId: input.opportunityId,
        fromStage: current.stage,
        toStage: input.stage,
        source: "operator",
        reason: input.reason,
        createdAt: input.now,
      });
      const event = await this.recordEvent(tx, {
        workspaceId: input.workspaceId,
        opportunityId: input.opportunityId,
        eventType: "OpportunityStageChanged",
        actorUserId: null,
        payload: {
          opportunityId: input.opportunityId,
          fromStage: current.stage,
          toStage: input.stage,
          reason: input.reason,
        },
        createdAt: input.now,
      });
      await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorUserId: null, action: "OpportunityStageChanged", subjectType: "Opportunity", subjectId: input.opportunityId, changes: { fromStage: current.stage, toStage: input.stage, reason: input.reason }, sourceEventId: event.id });
      return updated;
    });
  }

  private async recordEvent(tx: any, input: { workspaceId: string; opportunityId: string; eventType: string; actorUserId: string | null; payload: Record<string, unknown>; createdAt?: Date }) {
    const [event] = await tx.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      aggregateType: "Opportunity",
      aggregateId: input.opportunityId,
      eventType: input.eventType,
      payload: input.payload,
      createdAt: input.createdAt,
    }).returning({ id: outboxEvents.id });
    if (!event) throw new OpportunityPipelineError("OPPORTUNITY_EVENT_FAILED", 409);
    return event;
  }
}

export class OpportunityPipelineError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

function redactChanges(row: { amount?: number | null; currency?: string | null; probability?: number; stage?: string; ownerUserId?: string | null; expectedCloseDate?: Date | null; closedAt?: Date | null; lostReason?: string | null; offerVersionId?: string | null }) {
  return {
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    probability: row.probability ?? 0,
    stage: row.stage ?? null,
    ownerUserId: row.ownerUserId ?? null,
    expectedCloseDate: row.expectedCloseDate?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    lostReason: row.lostReason ?? null,
    offerVersionId: row.offerVersionId ?? null,
  };
}

function encodeOpportunityCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeOpportunityCursor(value: string): { readonly updatedAt: Date; readonly id: string } {
  if (!value || value.length > 512) throw new Error("OPPORTUNITY_CURSOR_INVALID");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt) : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime()) || typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error("invalid");
    return { updatedAt, id: parsed.id };
  } catch {
    throw new Error("OPPORTUNITY_CURSOR_INVALID");
  }
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

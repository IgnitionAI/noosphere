import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  canTransitionOpportunity,
  isOpportunityStage,
  pipelineColumn,
  type OpportunityStage,
} from "@outbound/domain/pipeline/opportunity";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  calendarBookings,
  campaigns,
  companies,
  contactEmployments,
  contacts,
  icpVersions,
  opportunities,
  opportunityStageHistory,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export class PostgresOpportunityRepository {
  constructor(private readonly database: Database) {}

  async list(workspaceId: string) {
    const rows = await this.database
      .select({
        id: opportunities.id,
        contactId: opportunities.contactId,
        campaignId: opportunities.campaignId,
        stage: opportunities.stage,
        nextAction: opportunities.nextAction,
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
      .where(eq(opportunities.workspaceId, workspaceId))
      .orderBy(desc(opportunities.updatedAt));
    const opportunityIds = rows.map((row) => row.id);
    const contactIds = [...new Set(rows.map((row) => row.contactId))];
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
    const data = rows.map((row) => ({
      ...row,
      column: pipelineColumn(row.stage),
      meeting: bookings.get(`${row.contactId}:${row.campaignId ?? "none"}`)
        ?? bookings.get(`${row.contactId}:none`)
        ?? null,
      history: histories.get(row.id) ?? [],
    }));
    return {
      data,
      metrics: {
        total: data.length,
        qualified: data.filter((item) => item.column === "qualified").length,
        meetings: data.filter((item) => item.stage === "meeting_booked").length,
        followUp: data.filter((item) => item.column === "follow_up").length,
        won: data.filter((item) => item.stage === "won").length,
      },
    };
  }

  async changeStage(input: {
    workspaceId: string;
    opportunityId: string;
    stage: OpportunityStage;
    reason: string | null;
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
        .limit(1);
      if (!current) throw new OpportunityPipelineError("OPPORTUNITY_NOT_FOUND", 404);
      if (!isOpportunityStage(current.stage)) {
        throw new OpportunityPipelineError("OPPORTUNITY_STAGE_CORRUPTED", 409);
      }
      if (!canTransitionOpportunity(current.stage, input.stage)) {
        throw new OpportunityPipelineError("OPPORTUNITY_TRANSITION_INVALID", 409);
      }
      await tx.update(opportunities).set({
        stage: input.stage,
        updatedAt: input.now,
      }).where(and(
        eq(opportunities.workspaceId, input.workspaceId),
        eq(opportunities.id, input.opportunityId),
      ));
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
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Opportunity",
        aggregateId: input.opportunityId,
        eventType: "OpportunityStageChanged",
        payload: {
          opportunityId: input.opportunityId,
          fromStage: current.stage,
          toStage: input.stage,
          reason: input.reason,
        },
        createdAt: input.now,
      });
      return { ...current, stage: input.stage, updatedAt: input.now };
    });
  }
}

export class OpportunityPipelineError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

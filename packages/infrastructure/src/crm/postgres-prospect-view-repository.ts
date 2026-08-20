import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaignProspects,
  calendarBookings,
  campaigns,
  companies,
  contactEmployments,
  contactIdentities,
  contacts,
  conversationCommands,
  conversations,
  icpVersions,
  messages,
  opportunities,
  outreachActions,
  prospectDiscoveryCandidates,
  prospectDecisions,
  replyClassifications,
} from "@outbound/infrastructure/database/schema";

export class PostgresProspectViewRepository {
  constructor(private readonly db: Database) {}

  async list(input: {
    workspaceId: string;
    search?: string;
    icpVersionId?: string;
    campaignId?: string;
    campaignScope?: "in_campaign" | "outside_campaign";
    channel?: "linkedin" | "email" | "whatsapp";
    status?: "active" | "suppressed";
    updatedSince?: Date;
    limit: number;
  }) {
    const conditions: SQL[] = [eq(contacts.workspaceId, input.workspaceId)];
    if (input.status) conditions.push(eq(contacts.status, input.status));
    if (input.updatedSince) conditions.push(gte(contacts.updatedAt, input.updatedSince));
    if (input.search) {
      const pattern = `%${input.search}%`;
      conditions.push(or(ilike(contacts.firstName, pattern), ilike(contacts.lastName, pattern))!);
    }
    if (input.icpVersionId) {
      conditions.push(sql`exists (
        select 1 from campaign_prospects cp
        join campaigns c on c.workspace_id = cp.workspace_id and c.id = cp.campaign_id
        where cp.workspace_id = ${input.workspaceId}
          and cp.contact_id = ${contacts.id}
          and c.icp_version_id = ${input.icpVersionId}
      )`);
    }
    if (input.campaignId) {
      conditions.push(sql`exists (
        select 1 from campaign_prospects cp
        where cp.workspace_id = ${input.workspaceId}
          and cp.contact_id = ${contacts.id}
          and cp.campaign_id = ${input.campaignId}
      )`);
    } else if (input.campaignScope === "in_campaign") {
      conditions.push(sql`exists (
        select 1 from campaign_prospects cp
        where cp.workspace_id = ${input.workspaceId}
          and cp.contact_id = ${contacts.id}
      )`);
    } else if (input.campaignScope === "outside_campaign") {
      conditions.push(sql`not exists (
        select 1 from campaign_prospects cp
        where cp.workspace_id = ${input.workspaceId}
          and cp.contact_id = ${contacts.id}
      )`);
    }
    if (input.channel) {
      conditions.push(sql`exists (
        select 1 from contact_identities ci
        where ci.workspace_id = ${input.workspaceId}
          and ci.contact_id = ${contacts.id}
          and ci.type = ${input.channel}
          and ci.verification_status <> 'invalid'
      )`);
    }
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.updatedAt), desc(contacts.createdAt))
      .limit(input.limit);
    const data = await this.#hydrate(input.workspaceId, rows);
    const icps = await this.db
      .selectDistinct({ id: icpVersions.id, name: icpVersions.name })
      .from(icpVersions)
      .innerJoin(
        campaigns,
        and(eq(campaigns.workspaceId, icpVersions.workspaceId), eq(campaigns.icpVersionId, icpVersions.id)),
      )
      .where(and(eq(icpVersions.workspaceId, input.workspaceId), sql`${icpVersions.publishedAt} is not null`))
      .orderBy(icpVersions.name);
    const campaignOptions = await this.db
      .select({ id: campaigns.id, name: campaigns.name, channel: campaigns.channel })
      .from(campaigns)
      .where(and(
        eq(campaigns.workspaceId, input.workspaceId),
        sql`${campaigns.archivedAt} is null`,
        ne(campaigns.status, "archived"),
      ))
      .orderBy(campaigns.name);
    return { data, filters: { icps, campaigns: campaignOptions } };
  }

  async get(input: { workspaceId: string; contactId: string }) {
    const [contact] = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId)))
      .limit(1);
    if (!contact) return null;
    const [summary] = await this.#hydrate(input.workspaceId, [contact]);
    if (!summary) return null;
    const [identities, employments, outreachRows, decisionRows] = await Promise.all([
      this.db
        .select()
        .from(contactIdentities)
        .where(and(eq(contactIdentities.workspaceId, input.workspaceId), eq(contactIdentities.contactId, input.contactId))),
      this.db
        .select({
          id: contactEmployments.id,
          companyId: contactEmployments.companyId,
          companyName: companies.name,
          title: contactEmployments.title,
          startedOn: contactEmployments.startedOn,
          endedOn: contactEmployments.endedOn,
          isCurrent: contactEmployments.isCurrent,
        })
        .from(contactEmployments)
        .innerJoin(companies, and(eq(companies.workspaceId, contactEmployments.workspaceId), eq(companies.id, contactEmployments.companyId)))
        .where(and(eq(contactEmployments.workspaceId, input.workspaceId), eq(contactEmployments.contactId, input.contactId))),
      this.db
        .select({
          id: outreachActions.id,
          campaignId: outreachActions.campaignId,
          channel: outreachActions.channel,
          stepKind: outreachActions.stepKind,
          status: outreachActions.status,
          contentSnapshot: outreachActions.contentSnapshot,
          dueAt: outreachActions.dueAt,
          sentAt: outreachActions.sentAt,
          errorCode: outreachActions.lastErrorCode,
          errorMessage: outreachActions.lastErrorMessage,
        })
        .from(outreachActions)
        .where(and(
          eq(outreachActions.workspaceId, input.workspaceId),
          eq(outreachActions.contactId, input.contactId),
        ))
        .orderBy(outreachActions.dueAt),
      this.db
        .select({
          id: prospectDecisions.id,
          campaignId: prospectDecisions.campaignId,
          outreachActionId: prospectDecisions.outreachActionId,
          kind: prospectDecisions.kind,
          reason: prospectDecisions.reason,
          observation: prospectDecisions.observation,
          proposedAction: prospectDecisions.proposedAction,
          dueAt: prospectDecisions.dueAt,
          priority: prospectDecisions.priority,
          status: prospectDecisions.status,
          attempts: prospectDecisions.attempts,
          maxAttempts: prospectDecisions.maxAttempts,
          correlationId: prospectDecisions.correlationId,
          result: prospectDecisions.result,
          policyDecision: prospectDecisions.policyDecision,
          lastErrorCode: prospectDecisions.lastErrorCode,
          lastErrorMessage: prospectDecisions.lastErrorMessage,
          startedAt: prospectDecisions.startedAt,
          completedAt: prospectDecisions.completedAt,
          createdAt: prospectDecisions.createdAt,
          updatedAt: prospectDecisions.updatedAt,
        })
        .from(prospectDecisions)
        .where(and(
          eq(prospectDecisions.workspaceId, input.workspaceId),
          eq(prospectDecisions.contactId, input.contactId),
        ))
        .orderBy(desc(prospectDecisions.createdAt))
        .limit(50),
    ]);
    const conversationDetail = summary.conversation
      ? await this.#conversationDetail(input.workspaceId, summary.conversation.id)
      : null;
    const conversation = summary.conversation && conversationDetail
      ? { ...summary.conversation, ...conversationDetail }
      : null;
    const conversationActivity = conversation?.messages.map((message) =>
      conversationActivityView(message, conversation)
    ) ?? [];
    const activity = [
      ...outreachRows.map(outreachActivityView),
      ...conversationActivity,
    ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const nextDecision = decisionRows
      .filter((decision) => ["pending", "running", "awaiting_approval"].includes(decision.status))
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())[0] ?? null;
    return { ...summary, identities, employments, conversation, activity, decisions: decisionRows, nextDecision };
  }

  async #hydrate(workspaceId: string, rows: readonly typeof contacts.$inferSelect[]) {
    if (!rows.length) return [];
    const contactIds = rows.map((row) => row.id);
    const [identityRows, employmentRows, matchRows, conversationRows, outreachRows, bookingRows, opportunityRows] = await Promise.all([
      this.db
        .select({ contactId: contactIdentities.contactId, type: contactIdentities.type, verificationStatus: contactIdentities.verificationStatus })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.workspaceId, workspaceId), inArray(contactIdentities.contactId, contactIds))),
      this.db
        .select({ contactId: contactEmployments.contactId, companyId: companies.id, companyName: companies.name, title: contactEmployments.title })
        .from(contactEmployments)
        .innerJoin(companies, and(eq(companies.workspaceId, contactEmployments.workspaceId), eq(companies.id, contactEmployments.companyId)))
        .where(and(eq(contactEmployments.workspaceId, workspaceId), inArray(contactEmployments.contactId, contactIds), eq(contactEmployments.isCurrent, true))),
      this.db
        .select({
          contactId: campaignProspects.contactId,
          campaignId: campaigns.id,
          campaignName: campaigns.name,
          channel: campaigns.channel,
          icpVersionId: icpVersions.id,
          icpName: icpVersions.name,
          score: campaignProspects.score,
          eligible: campaignProspects.eligible,
          scoreExplanation: campaignProspects.scoreExplanation,
          aiAssessment: campaignProspects.aiAssessment,
          candidateId: campaignProspects.candidateId,
          headline: prospectDiscoveryCandidates.headline,
          companyName: prospectDiscoveryCandidates.companyName,
          updatedAt: campaignProspects.updatedAt,
        })
        .from(campaignProspects)
        .innerJoin(campaigns, and(eq(campaigns.workspaceId, campaignProspects.workspaceId), eq(campaigns.id, campaignProspects.campaignId)))
        .innerJoin(icpVersions, and(eq(icpVersions.workspaceId, campaigns.workspaceId), eq(icpVersions.id, campaigns.icpVersionId)))
        .innerJoin(prospectDiscoveryCandidates, and(eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId), eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId)))
        .where(and(eq(campaignProspects.workspaceId, workspaceId), inArray(campaignProspects.contactId, contactIds))),
      this.db
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
          campaignId: conversations.campaignId,
          channel: conversations.channel,
          status: conversations.status,
          unreadCount: conversations.unreadCount,
          lastMessageAt: conversations.lastMessageAt,
        })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, workspaceId), inArray(conversations.contactId, contactIds)))
        .orderBy(desc(conversations.lastMessageAt)),
      this.db
        .select({
          id: outreachActions.id,
          contactId: outreachActions.contactId,
          campaignId: outreachActions.campaignId,
          channel: outreachActions.channel,
          stepKind: outreachActions.stepKind,
          status: outreachActions.status,
          contentSnapshot: outreachActions.contentSnapshot,
          dueAt: outreachActions.dueAt,
          sentAt: outreachActions.sentAt,
          errorCode: outreachActions.lastErrorCode,
          errorMessage: outreachActions.lastErrorMessage,
        })
        .from(outreachActions)
        .where(and(
          eq(outreachActions.workspaceId, workspaceId),
          inArray(outreachActions.contactId, contactIds),
        ))
        .orderBy(desc(sql`coalesce(${outreachActions.sentAt}, ${outreachActions.dueAt})`)),
      this.db
        .select({
          contactId: calendarBookings.contactId,
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
        .orderBy(desc(calendarBookings.updatedAt)),
      this.db
        .select({
          contactId: opportunities.contactId,
          stage: opportunities.stage,
          nextAction: opportunities.nextAction,
          updatedAt: opportunities.updatedAt,
        })
        .from(opportunities)
        .where(and(
          eq(opportunities.workspaceId, workspaceId),
          inArray(opportunities.contactId, contactIds),
        ))
        .orderBy(desc(opportunities.updatedAt)),
    ]);
    const latestConversations = new Map<string, typeof conversationRows[number]>();
    for (const conversation of conversationRows) {
      if (!latestConversations.has(conversation.contactId)) latestConversations.set(conversation.contactId, conversation);
    }
    const selectedConversationIds = [...latestConversations.values()].map((conversation) => conversation.id);
    const [messageRows, decisionRows, commandRows] = selectedConversationIds.length
      ? await Promise.all([
          this.db
            .select({ id: messages.id, conversationId: messages.conversationId, direction: messages.direction, senderType: messages.senderType, body: messages.body, sentAt: messages.sentAt, receivedAt: messages.receivedAt, createdAt: messages.createdAt })
            .from(messages)
            .where(and(eq(messages.workspaceId, workspaceId), inArray(messages.conversationId, selectedConversationIds)))
            .orderBy(desc(messages.createdAt)),
          this.db
            .select({ conversationId: messages.conversationId, intent: replyClassifications.intent, confidence: replyClassifications.confidence, action: replyClassifications.action, rationale: replyClassifications.rationale, metadata: replyClassifications.metadata, createdAt: replyClassifications.createdAt })
            .from(replyClassifications)
            .innerJoin(messages, and(eq(messages.workspaceId, replyClassifications.workspaceId), eq(messages.id, replyClassifications.messageId)))
            .where(and(eq(replyClassifications.workspaceId, workspaceId), inArray(messages.conversationId, selectedConversationIds)))
            .orderBy(desc(replyClassifications.createdAt)),
          this.db
            .select({ conversationId: conversationCommands.conversationId, mode: conversationCommands.mode, status: conversationCommands.status, errorCode: conversationCommands.errorCode, createdAt: conversationCommands.createdAt })
            .from(conversationCommands)
            .where(and(eq(conversationCommands.workspaceId, workspaceId), inArray(conversationCommands.conversationId, selectedConversationIds)))
            .orderBy(desc(conversationCommands.createdAt)),
        ])
      : [[], [], []];
    const identities = groupBy(identityRows, (row) => row.contactId);
    const employments = new Map(employmentRows.map((row) => [row.contactId, row]));
    const matches = groupBy(matchRows.filter((row) => row.contactId !== null), (row) => row.contactId!);
    const latestOutreach = new Map<string, ReturnType<typeof outreachActivityView>>();
    for (const action of outreachRows) {
      if (!latestOutreach.has(action.contactId)) latestOutreach.set(action.contactId, outreachActivityView(action));
    }
    const latestBookings = new Map<string, typeof bookingRows[number]>();
    for (const booking of bookingRows) {
      if (booking.contactId && !latestBookings.has(booking.contactId)) latestBookings.set(booking.contactId, booking);
    }
    const latestOpportunities = new Map<string, typeof opportunityRows[number]>();
    for (const opportunity of opportunityRows) {
      if (!latestOpportunities.has(opportunity.contactId)) latestOpportunities.set(opportunity.contactId, opportunity);
    }
    return rows.map((row) => {
      const contactMatches = (matches.get(row.id) ?? []).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
      const bestMatch = contactMatches[0] ?? null;
      const conversation = latestConversations.get(row.id) ?? null;
      const lastMessage = conversation ? messageRows.find((message) => message.conversationId === conversation.id) ?? null : null;
      const decision = conversation ? decisionRows.find((item) => item.conversationId === conversation.id) ?? null : null;
      const command = conversation ? commandRows.find((item) => item.conversationId === conversation.id) ?? null : null;
      const channelRows = identities.get(row.id) ?? [];
      const latestConversationActivity = conversation && lastMessage
        ? conversationActivityView({ id: lastMessage.id, ...messageView(lastMessage) }, conversation)
        : null;
      const latestOutreachActivity = latestOutreach.get(row.id) ?? null;
      const latestActivity = !latestConversationActivity
        ? latestOutreachActivity
        : !latestOutreachActivity
          ? latestConversationActivity
          : latestConversationActivity.occurredAt >= latestOutreachActivity.occurredAt
            ? latestConversationActivity
            : latestOutreachActivity;
      return {
        ...row,
        currentEmployment: employments.get(row.id) ?? null,
        channels: {
          linkedin: channelRows.some((identity) => identity.type === "linkedin" && identity.verificationStatus !== "invalid"),
          email: channelRows.some((identity) => identity.type === "email" && identity.verificationStatus !== "invalid"),
          whatsapp: channelRows.some((identity) => identity.type === "whatsapp" && identity.verificationStatus !== "invalid"),
        },
        icpMatches: contactMatches.map((match) => ({
          campaignId: match.campaignId,
          campaignName: match.campaignName,
          channel: match.channel,
          icpVersionId: match.icpVersionId,
          icpName: match.icpName,
          score: match.score,
          eligible: match.eligible,
          scoreExplanation: match.scoreExplanation,
          aiAssessment: match.aiAssessment,
          candidateId: match.candidateId,
          headline: match.headline,
          companyName: match.companyName,
          updatedAt: match.updatedAt,
        })),
        aiOpinion: bestMatch ? assessment(bestMatch.aiAssessment, bestMatch.score, bestMatch.scoreExplanation) : null,
        meeting: latestBookings.get(row.id) ?? null,
        opportunity: latestOpportunities.get(row.id) ?? null,
        latestActivity,
        conversation: conversation ? {
          ...conversation,
          lastMessage: lastMessage ? messageView(lastMessage) : null,
          decision: decision ? decisionView(decision) : null,
          latestCommand: command ?? null,
        } : null,
      };
    });
  }

  async #conversationDetail(workspaceId: string, conversationId: string) {
    const [messageRows, decisionRows, commandRows] = await Promise.all([
      this.db.select().from(messages).where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversationId))).orderBy(messages.createdAt),
      this.db
        .select({ messageId: replyClassifications.messageId, intent: replyClassifications.intent, confidence: replyClassifications.confidence, action: replyClassifications.action, rationale: replyClassifications.rationale, metadata: replyClassifications.metadata, createdAt: replyClassifications.createdAt })
        .from(replyClassifications)
        .innerJoin(messages, and(eq(messages.workspaceId, replyClassifications.workspaceId), eq(messages.id, replyClassifications.messageId)))
        .where(and(eq(replyClassifications.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
        .orderBy(desc(replyClassifications.createdAt)),
      this.db.select().from(conversationCommands).where(and(eq(conversationCommands.workspaceId, workspaceId), eq(conversationCommands.conversationId, conversationId))).orderBy(desc(conversationCommands.createdAt)).limit(10),
    ]);
    const decisions = new Map(decisionRows.map((row) => [row.messageId, decisionView(row)]));
    return {
      messages: messageRows.map((message) => ({ id: message.id, ...messageView(message), decision: decisions.get(message.id) ?? null })),
      decision: decisionRows[0] ? decisionView(decisionRows[0]) : null,
      commands: commandRows,
    };
  }
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function messageView(row: { direction: string; senderType: string; body: string; sentAt: Date | null; receivedAt: Date | null; createdAt: Date }) {
  return { direction: row.direction, senderType: row.senderType, body: row.body, occurredAt: row.receivedAt ?? row.sentAt ?? row.createdAt };
}

function outreachActivityView(row: {
  id: string;
  campaignId: string;
  channel: "linkedin" | "email" | "whatsapp";
  stepKind: string;
  status: string;
  contentSnapshot: unknown;
  dueAt: Date;
  sentAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}) {
  const snapshot = record(row.contentSnapshot);
  const generationPending = snapshot.generationPending === true;
  return {
    id: row.id,
    campaignId: row.campaignId,
    channel: row.channel,
    source: "outreach_action" as const,
    direction: "outbound" as const,
    senderType: "ai",
    status: row.status,
    stepKind: row.stepKind,
    subject: generationPending ? null : stringOrNull(snapshot.subject),
    body: generationPending ? null : stringOrNull(snapshot.body),
    occurredAt: row.sentAt ?? row.dueAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

function conversationActivityView(
  message: {
    id?: string;
    direction: string;
    senderType: string;
    body: string;
    occurredAt: Date;
  },
  conversation: { id: string; campaignId: string | null; channel: "linkedin" | "email" | "whatsapp" },
) {
  return {
    id: message.id ?? `${conversation.id}:${message.occurredAt.toISOString()}`,
    campaignId: conversation.campaignId,
    channel: conversation.channel,
    source: "conversation" as const,
    direction: message.direction as "inbound" | "outbound",
    senderType: message.senderType,
    status: message.direction === "inbound" ? "received" as const : "sent" as const,
    stepKind: null,
    subject: null,
    body: message.body,
    occurredAt: message.occurredAt,
    errorCode: null,
    errorMessage: null,
  };
}

function decisionView(row: { intent: string; confidence: string; action: string; rationale: string; metadata: unknown; createdAt: Date }) {
  const metadata = record(row.metadata);
  return { intent: row.intent, confidence: Number(row.confidence), action: row.action, rationale: row.rationale, provider: stringOrNull(metadata.provider), model: stringOrNull(metadata.model), createdAt: row.createdAt };
}

function assessment(value: unknown, score: number | null, explanation: unknown) {
  const data = record(value);
  const factors = Array.isArray(explanation) ? explanation.map(record) : [];
  return {
    score,
    summary: stringOrNull(data.summary) ?? "Qualification calculée à partir des correspondances ICP observées.",
    strengths: stringArray(data.strengths).length
      ? stringArray(data.strengths)
      : factors.filter((factor) => Number(factor.contribution) > 0).map((factor) => String(factor.explanation ?? "")).filter(Boolean),
    risks: stringArray(data.risks).length
      ? stringArray(data.risks)
      : factors.filter((factor) => Number(factor.contribution) < 0).map((factor) => String(factor.explanation ?? "")).filter(Boolean),
    recommendedAngle: stringOrNull(data.recommendedAngle),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

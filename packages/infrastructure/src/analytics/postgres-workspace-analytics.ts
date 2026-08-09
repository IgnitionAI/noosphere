import { sql, type SQL } from "drizzle-orm";
import type {
  AnalyticsBreakdownRow,
  AnalyticsCosts,
  AnalyticsDimension,
  AnalyticsFilters,
  AnalyticsFunnel,
  FunnelMetrics,
} from "@outbound/application/analytics/workspace-analytics";
import type { Database } from "@outbound/infrastructure/database/client";
import { auditLogs } from "@outbound/infrastructure/database/schema";

type CountRow = { count: number | string };
type MoneyRow = { value: number | string | null };
type FactCountRow = { key: string | null; count: number | string };
type FactMoneyRow = FactCountRow & { revenue: number | string | null };
type ActionBreakdownRow = FactCountRow & {
  planned: number | string;
  attempts: number | string;
  sent: number | string;
  responded: number | string;
  positive_replies: number | string;
};

/** Deterministic read model: every number comes from fact tables, never outbox events. */
export class PostgresWorkspaceAnalytics {
  constructor(private readonly database: Database) {}

  async funnel(input: AnalyticsFilters): Promise<AnalyticsFunnel> {
    const from = input.from.toISOString();
    const to = input.to.toISOString();
    const [prospectsFound, profilesEnriched, actionsPlanned, attempts, actionsSent, actionsAccepted, responded, positiveReplies, meetingsBooked, opportunities, revenue] = await Promise.all([
      this.count(sql`SELECT count(DISTINCT pc.id)::int AS count FROM prospect_discovery_candidates pc JOIN prospect_discovery_runs dr ON dr.id = pc.run_id AND dr.workspace_id = pc.workspace_id WHERE pc.workspace_id = ${input.workspaceId} AND pc.created_at >= ${from} AND pc.created_at < ${to} ${this.discoveryFilters(input, "dr")}`),
      this.count(sql`SELECT count(DISTINCT ej.entity_id)::int AS count FROM enrichment_jobs ej WHERE ej.workspace_id = ${input.workspaceId} AND ej.entity_type = 'contact' AND ej.created_at >= ${from} AND ej.created_at < ${to} ${this.contactScope(input, sql.raw("ej.entity_id"))}`),
      this.count(sql`SELECT count(DISTINCT oa.id)::int AS count FROM outreach_actions oa WHERE oa.workspace_id = ${input.workspaceId} AND oa.created_at >= ${from} AND oa.created_at < ${to} ${this.actionFilters(input, "oa")}`),
      this.count(sql`SELECT count(DISTINCT at.id)::int AS count FROM outreach_attempts at JOIN outreach_actions oa ON oa.id = COALESCE(at.action_id, at.outreach_action_id) AND oa.workspace_id = at.workspace_id WHERE at.workspace_id = ${input.workspaceId} AND at.attempted_at >= ${from} AND at.attempted_at < ${to} ${this.actionFilters(input, "oa")}`),
      this.count(sql`SELECT count(DISTINCT oa.id)::int AS count FROM outreach_actions oa WHERE oa.workspace_id = ${input.workspaceId} AND oa.sent_at >= ${from} AND oa.sent_at < ${to} AND oa.sent_at IS NOT NULL ${this.actionFilters(input, "oa")}`),
      this.count(sql`SELECT count(DISTINCT oa.id)::int AS count FROM outreach_actions oa WHERE oa.workspace_id = ${input.workspaceId} AND oa.status = 'sent' AND oa.sent_at >= ${from} AND oa.sent_at < ${to} ${this.actionFilters(input, "oa")}`),
      this.count(sql`SELECT count(DISTINCT oa.id)::int AS count FROM outreach_actions oa WHERE oa.workspace_id = ${input.workspaceId} AND oa.response_received_at >= ${from} AND oa.response_received_at < ${to} ${this.actionFilters(input, "oa")}`),
      this.count(sql`SELECT count(DISTINCT m.id)::int AS count FROM messages m JOIN conversations cv ON cv.id = m.conversation_id AND cv.workspace_id = m.workspace_id JOIN reply_classifications rc ON rc.message_id = m.id AND rc.workspace_id = m.workspace_id WHERE m.workspace_id = ${input.workspaceId} AND m.direction = 'inbound' AND rc.intent = 'positive' AND COALESCE(m.received_at, m.created_at) >= ${from} AND COALESCE(m.received_at, m.created_at) < ${to} ${this.conversationFilters(input, "cv")}`),
      this.count(sql`SELECT count(DISTINCT cb.id)::int AS count FROM calendar_bookings cb WHERE cb.workspace_id = ${input.workspaceId} AND cb.status = 'booked' AND cb.start_at >= ${from} AND cb.start_at < ${to} ${this.bookingFilters(input, "cb")}`),
      this.count(sql`SELECT count(DISTINCT op.id)::int AS count FROM opportunities op WHERE op.workspace_id = ${input.workspaceId} AND op.created_at >= ${from} AND op.created_at < ${to} ${this.opportunityFilters(input, "op")}`),
      this.money(sql`SELECT COALESCE(sum(op.amount), 0) AS value FROM opportunities op WHERE op.workspace_id = ${input.workspaceId} AND op.stage = 'won' AND op.updated_at >= ${from} AND op.updated_at < ${to} ${this.opportunityFilters(input, "op")}`),
    ]);
    return { period: { from: input.from, to: input.to }, metrics: { prospectsFound, profilesEnriched, actionsPlanned, attempts, actionsSent, actionsAccepted, responded, positiveReplies, meetingsBooked, opportunities, revenue } };
  }

  async breakdown(input: AnalyticsFilters & { dimension: AnalyticsDimension }): Promise<readonly AnalyticsBreakdownRow[]> {
    const dimension = input.dimension;
    const from = input.from.toISOString();
    const to = input.to.toISOString();
    const key = actionDimensionKey(dimension);
    const join = actionDimensionJoins(dimension);
    const actionRows = await this.database.execute<ActionBreakdownRow>(sql`SELECT ${sql.raw(key)} AS key, count(DISTINCT oa.id)::int AS planned, count(DISTINCT at.id)::int AS attempts, count(DISTINCT oa.id) FILTER (WHERE oa.sent_at IS NOT NULL)::int AS sent, count(DISTINCT oa.id) FILTER (WHERE oa.response_received_at IS NOT NULL)::int AS responded, count(DISTINCT m.id) FILTER (WHERE rc.intent = 'positive')::int AS positive_replies FROM outreach_actions oa LEFT JOIN outreach_attempts at ON at.workspace_id = oa.workspace_id AND COALESCE(at.action_id, at.outreach_action_id) = oa.id LEFT JOIN campaigns c ON c.workspace_id = oa.workspace_id AND c.id = oa.campaign_id LEFT JOIN conversations cv ON cv.workspace_id = oa.workspace_id AND cv.campaign_id = oa.campaign_id LEFT JOIN messages m ON m.workspace_id = cv.workspace_id AND m.conversation_id = cv.id AND m.direction = 'inbound' LEFT JOIN reply_classifications rc ON rc.workspace_id = m.workspace_id AND rc.message_id = m.id ${join} WHERE oa.workspace_id = ${input.workspaceId} AND oa.created_at >= ${from} AND oa.created_at < ${to} ${this.actionFilters(input, "oa")} GROUP BY ${sql.raw(key)} ORDER BY planned DESC, key`);
    const [prospectRows, enrichedRows, meetingRows, opportunityRows] = await Promise.all([
      this.breakdownProspects(input),
      this.breakdownEnriched(input),
      this.breakdownMeetings(input),
      this.breakdownOpportunities(input),
    ]);
    const rows = new Map<string, AnalyticsBreakdownRow>();
    const ensure = (keyValue: string | null): AnalyticsBreakdownRow => {
      const normalizedKey = keyValue ?? "unknown";
      const existing = rows.get(normalizedKey);
      if (existing) return existing;
      const created: AnalyticsBreakdownRow = {
        key: normalizedKey,
        label: normalizedKey,
        ...breakdownDefaults(dimension, input),
      };
      rows.set(normalizedKey, created);
      return created;
    };
    for (const row of actionRows) Object.assign(ensure(row.key), {
      actionsPlanned: Number(row.planned),
      attempts: Number(row.attempts),
      actionsSent: Number(row.sent),
      actionsAccepted: Number(row.sent),
      responded: Number(row.responded),
      positiveReplies: Number(row.positive_replies),
    });
    for (const row of prospectRows) Object.assign(ensure(row.key), { prospectsFound: Number(row.count) });
    for (const row of enrichedRows) Object.assign(ensure(row.key), { profilesEnriched: Number(row.count) });
    for (const row of meetingRows) Object.assign(ensure(row.key), { meetingsBooked: Number(row.count) });
    for (const row of opportunityRows) Object.assign(ensure(row.key), { opportunities: Number(row.count), revenue: Number(row.revenue ?? 0) });
    return [...rows.values()].sort((left, right) => right.actionsPlanned - left.actionsPlanned || left.key.localeCompare(right.key));
  }

  private async breakdownProspects(input: AnalyticsFilters & { dimension: AnalyticsDimension }): Promise<readonly FactCountRow[]> {
    if (input.dimension === "campaign" || input.dimension === "channel" || input.channel) return [];
    const key = input.dimension === "icp" ? "dr.icp_version_id::text" : input.dimension === "role" ? "COALESCE(ce.title, 'unknown')" : "COALESCE(s.signal_type::text, 'unknown')";
    const joins = input.dimension === "role"
      ? sql`LEFT JOIN contact_employments ce ON ce.workspace_id = pc.workspace_id AND ce.contact_id = pc.imported_contact_id AND ce.is_current = true`
      : input.dimension === "signal"
        ? sql`LEFT JOIN signals s ON s.workspace_id = pc.workspace_id AND s.contact_id = pc.imported_contact_id AND s.expires_at > now()`
        : sql``;
    const filters = input.dimension === "icp" && input.icpVersionId
      ? sql`AND dr.icp_version_id = ${input.icpVersionId}`
      : input.dimension === "role" && input.role
        ? sql`AND ce.title = ${input.role}`
        : input.dimension === "signal" && input.signalType
          ? sql`AND s.signal_type = ${input.signalType}`
          : sql``;
    const rows = await this.database.execute<FactCountRow>(sql`SELECT ${sql.raw(key)} AS key, count(DISTINCT pc.id)::int AS count FROM prospect_discovery_candidates pc JOIN prospect_discovery_runs dr ON dr.id = pc.run_id AND dr.workspace_id = pc.workspace_id ${joins} WHERE pc.workspace_id = ${input.workspaceId} AND pc.created_at >= ${input.from.toISOString()} AND pc.created_at < ${input.to.toISOString()} ${filters} GROUP BY ${sql.raw(key)}`);
    return rows;
  }

  private async breakdownEnriched(input: AnalyticsFilters & { dimension: AnalyticsDimension }): Promise<readonly FactCountRow[]> {
    if ((input.dimension !== "role" && input.dimension !== "signal") || input.channel) return [];
    const key = input.dimension === "role" ? "COALESCE(ce.title, 'unknown')" : "COALESCE(s.signal_type::text, 'unknown')";
    const joins = input.dimension === "role"
      ? sql`LEFT JOIN contact_employments ce ON ce.workspace_id = ej.workspace_id AND ce.contact_id = ej.entity_id AND ce.is_current = true`
      : sql`LEFT JOIN signals s ON s.workspace_id = ej.workspace_id AND s.contact_id = ej.entity_id AND s.expires_at > now()`;
    const filters = input.dimension === "role" && input.role
      ? sql`AND ce.title = ${input.role}`
      : input.dimension === "signal" && input.signalType
        ? sql`AND s.signal_type = ${input.signalType}`
        : sql``;
    const rows = await this.database.execute<FactCountRow>(sql`SELECT ${sql.raw(key)} AS key, count(DISTINCT ej.entity_id)::int AS count FROM enrichment_jobs ej ${joins} WHERE ej.workspace_id = ${input.workspaceId} AND ej.entity_type = 'contact' AND ej.created_at >= ${input.from.toISOString()} AND ej.created_at < ${input.to.toISOString()} ${filters} GROUP BY ${sql.raw(key)}`);
    return rows;
  }

  private async breakdownMeetings(input: AnalyticsFilters & { dimension: AnalyticsDimension }): Promise<readonly FactCountRow[]> {
    if (input.dimension === "channel" || input.channel) return [];
    const key = factDimensionKey(input.dimension, "cb", "c", "ce", "s");
    const joins = factDimensionJoins(input.dimension, "cb", "c", "ce", "s");
    const filters = factFilters(input, "cb", "c", "ce", "s");
    const rows = await this.database.execute<FactCountRow>(sql`SELECT ${sql.raw(key)} AS key, count(DISTINCT cb.id)::int AS count FROM calendar_bookings cb LEFT JOIN campaigns c ON c.workspace_id = cb.workspace_id AND c.id = cb.campaign_id ${joins} WHERE cb.workspace_id = ${input.workspaceId} AND cb.status = 'booked' AND cb.start_at >= ${input.from.toISOString()} AND cb.start_at < ${input.to.toISOString()} ${filters} GROUP BY ${sql.raw(key)}`);
    return rows;
  }

  private async breakdownOpportunities(input: AnalyticsFilters & { dimension: AnalyticsDimension }): Promise<readonly FactMoneyRow[]> {
    if (input.dimension === "channel" || input.channel) return [];
    const key = factDimensionKey(input.dimension, "op", "c", "ce", "s");
    const joins = factDimensionJoins(input.dimension, "op", "c", "ce", "s");
    const filters = factFilters(input, "op", "c", "ce", "s");
    const rows = await this.database.execute<FactMoneyRow>(sql`SELECT ${sql.raw(key)} AS key, count(DISTINCT op.id)::int AS count, COALESCE(sum(op.amount) FILTER (WHERE op.stage = 'won'), 0) AS revenue FROM opportunities op LEFT JOIN campaigns c ON c.workspace_id = op.workspace_id AND c.id = op.campaign_id ${joins} WHERE op.workspace_id = ${input.workspaceId} AND op.created_at >= ${input.from.toISOString()} AND op.created_at < ${input.to.toISOString()} ${filters} GROUP BY ${sql.raw(key)}`);
    return rows;
  }

  async costs(input: AnalyticsFilters): Promise<AnalyticsCosts> {
    const from = input.from.toISOString();
    const to = input.to.toISOString();
    const [totalAiCost, prospects, meetings] = await Promise.all([
      this.money(sql`SELECT COALESCE(sum(ar.cost), 0) AS value FROM ai_runs ar WHERE ar.workspace_id = ${input.workspaceId} AND ar.created_at >= ${from} AND ar.created_at < ${to}`),
      this.count(sql`SELECT count(DISTINCT pc.id)::int AS count FROM prospect_discovery_candidates pc JOIN prospect_discovery_runs dr ON dr.id = pc.run_id AND dr.workspace_id = pc.workspace_id WHERE pc.workspace_id = ${input.workspaceId} AND pc.created_at >= ${from} AND pc.created_at < ${to} ${this.discoveryFilters(input, "dr")}`),
      this.count(sql`SELECT count(DISTINCT cb.id)::int AS count FROM calendar_bookings cb WHERE cb.workspace_id = ${input.workspaceId} AND cb.status = 'booked' AND cb.start_at >= ${from} AND cb.start_at < ${to} ${this.bookingFilters(input, "cb")}`),
    ]);
    return { totalAiCost, costPerProspect: prospects ? totalAiCost / prospects : 0, costPerMeeting: meetings ? totalAiCost / meetings : 0 };
  }

  async exportCsv(input: AnalyticsFilters & { actorUserId: string; dimension?: AnalyticsDimension }): Promise<string> {
    const funnel = await this.funnel(input);
    const breakdown = input.dimension ? await this.breakdown({ ...input, dimension: input.dimension }) : [];
    const rows = [["metric", "value"], ...Object.entries(funnel.metrics).map(([metric, value]) => [metric, String(value)])];
    if (breakdown.length) rows.push([], ["breakdown_key", "planned", "sent", "responded", "opportunities", "revenue"], ...breakdown.map((row) => [row.key, String(row.actionsPlanned), String(row.actionsSent), String(row.responded), String(row.opportunities), String(row.revenue)]));
    await this.database.insert(auditLogs).values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "analytics.exported", subjectType: "Workspace", subjectId: input.workspaceId, changes: { from: input.from.toISOString(), to: input.to.toISOString(), dimension: input.dimension ?? null }, sourceEventId: crypto.randomUUID() });
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }

  private async count(query: SQL): Promise<number> { const [row] = await this.database.execute<CountRow>(query); return Number(row?.count ?? 0); }
  private async money(query: SQL): Promise<number> { const [row] = await this.database.execute<MoneyRow>(query); return Number(row?.value ?? 0); }

  private actionFilters(input: AnalyticsFilters, alias: string): SQL {
    const parts: SQL[] = [];
    if (input.campaignId) parts.push(sql`AND ${sql.raw(alias)}.campaign_id = ${input.campaignId}`);
    if (input.icpVersionId) parts.push(sql`AND EXISTS (SELECT 1 FROM campaigns fc WHERE fc.workspace_id = ${sql.raw(alias)}.workspace_id AND fc.id = ${sql.raw(alias)}.campaign_id AND fc.icp_version_id = ${input.icpVersionId})`);
    if (input.channel) parts.push(sql`AND ${sql.raw(alias)}.channel = ${input.channel}`);
    if (input.signalType) parts.push(sql`AND EXISTS (SELECT 1 FROM signals fs WHERE fs.workspace_id = ${sql.raw(alias)}.workspace_id AND fs.contact_id = ${sql.raw(alias)}.contact_id AND fs.signal_type = ${input.signalType} AND fs.expires_at > now())`);
    if (input.role) parts.push(sql`AND EXISTS (SELECT 1 FROM contact_employments fr WHERE fr.workspace_id = ${sql.raw(alias)}.workspace_id AND fr.contact_id = ${sql.raw(alias)}.contact_id AND fr.is_current = true AND fr.title = ${input.role})`);
    return joinParts(parts);
  }
  private conversationFilters(input: AnalyticsFilters, alias: string): SQL { return input.campaignId ? sql`AND ${sql.raw(alias)}.campaign_id = ${input.campaignId}` : sql``; }
  private bookingFilters(input: AnalyticsFilters, alias: string): SQL { return input.campaignId ? sql`AND ${sql.raw(alias)}.campaign_id = ${input.campaignId}` : sql``; }
  private opportunityFilters(input: AnalyticsFilters, alias: string): SQL { return input.campaignId ? sql`AND ${sql.raw(alias)}.campaign_id = ${input.campaignId}` : sql``; }
  private discoveryFilters(input: AnalyticsFilters, alias: string): SQL {
    const parts: SQL[] = [];
    if (input.campaignId) parts.push(sql`AND ${sql.raw(alias)}.campaign_id = ${input.campaignId}`);
    if (input.icpVersionId) parts.push(sql`AND ${sql.raw(alias)}.icp_version_id = ${input.icpVersionId}`);
    if (input.channel) parts.push(sql`AND ${sql.raw(alias)}.channel = ${input.channel}`);
    return joinParts(parts);
  }
  private contactScope(input: AnalyticsFilters, entity: SQL): SQL {
    const parts: SQL[] = [];
    if (input.campaignId) parts.push(sql`AND EXISTS (SELECT 1 FROM campaign_prospects cp JOIN campaigns cc ON cc.workspace_id = cp.workspace_id AND cc.id = cp.campaign_id WHERE cp.workspace_id = ${input.workspaceId} AND cp.contact_id = ${entity} AND cp.campaign_id = ${input.campaignId})`);
    if (input.signalType) parts.push(sql`AND EXISTS (SELECT 1 FROM signals cs WHERE cs.workspace_id = ${input.workspaceId} AND cs.contact_id = ${entity} AND cs.signal_type = ${input.signalType} AND cs.expires_at > now())`);
    return joinParts(parts);
  }
}

function joinParts(parts: readonly SQL[]): SQL { return parts.length ? sql.join([...parts], sql.raw(" ")) : sql``; }
function csvCell(value: string): string { return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

function actionDimensionKey(dimension: AnalyticsDimension): string {
  return dimension === "campaign"
    ? "oa.campaign_id::text"
    : dimension === "icp"
      ? "c.icp_version_id::text"
      : dimension === "channel"
        ? "oa.channel::text"
        : dimension === "role"
          ? "COALESCE(ce.title, 'unknown')"
          : "COALESCE(s.signal_type::text, 'unknown')";
}

function actionDimensionJoins(dimension: AnalyticsDimension): SQL {
  return dimension === "role"
    ? sql`LEFT JOIN contact_employments ce ON ce.workspace_id = oa.workspace_id AND ce.contact_id = oa.contact_id AND ce.is_current = true`
    : dimension === "signal"
      ? sql`LEFT JOIN signals s ON s.workspace_id = oa.workspace_id AND s.contact_id = oa.contact_id AND s.expires_at > now()`
      : sql``;
}

function factDimensionKey(dimension: AnalyticsDimension, factAlias: string, campaignAlias: string, roleAlias: string, signalAlias: string): string {
  return dimension === "campaign"
    ? `${factAlias}.campaign_id::text`
    : dimension === "icp"
      ? `${campaignAlias}.icp_version_id::text`
      : dimension === "role"
        ? `COALESCE(${roleAlias}.title, 'unknown')`
        : `COALESCE(${signalAlias}.signal_type::text, 'unknown')`;
}

function factDimensionJoins(dimension: AnalyticsDimension, factAlias: string, _campaignAlias: string, roleAlias: string, signalAlias: string): SQL {
  return dimension === "role"
    ? sql`LEFT JOIN contact_employments ${sql.raw(roleAlias)} ON ${sql.raw(roleAlias)}.workspace_id = ${sql.raw(factAlias)}.workspace_id AND ${sql.raw(roleAlias)}.contact_id = ${sql.raw(factAlias)}.contact_id AND ${sql.raw(roleAlias)}.is_current = true`
    : dimension === "signal"
      ? sql`LEFT JOIN signals ${sql.raw(signalAlias)} ON ${sql.raw(signalAlias)}.workspace_id = ${sql.raw(factAlias)}.workspace_id AND ${sql.raw(signalAlias)}.contact_id = ${sql.raw(factAlias)}.contact_id AND ${sql.raw(signalAlias)}.expires_at > now()`
      : sql``;
}

function factFilters(input: AnalyticsFilters, factAlias: string, campaignAlias: string, roleAlias: string, signalAlias: string): SQL {
  const parts: SQL[] = [];
  if (input.campaignId) parts.push(sql`AND ${sql.raw(factAlias)}.campaign_id = ${input.campaignId}`);
  if (input.icpVersionId) parts.push(sql`AND ${sql.raw(campaignAlias)}.icp_version_id = ${input.icpVersionId}`);
  if (input.role) parts.push(sql`AND ${sql.raw(roleAlias)}.title = ${input.role}`);
  if (input.signalType) parts.push(sql`AND ${sql.raw(signalAlias)}.signal_type = ${input.signalType}`);
  return joinParts(parts);
}

function breakdownDefaults(dimension: AnalyticsDimension, input?: AnalyticsFilters): Omit<AnalyticsBreakdownRow, "key" | "label"> {
  const attributable = {
    prospectsFound: !input?.channel && (dimension === "icp" || dimension === "role" || dimension === "signal"),
    profilesEnriched: !input?.channel && (dimension === "role" || dimension === "signal"),
    meetingsBooked: !input?.channel && dimension !== "channel",
    opportunities: !input?.channel && dimension !== "channel",
    revenue: !input?.channel && dimension !== "channel",
  };
  return {
    prospectsFound: attributable.prospectsFound ? 0 : null,
    profilesEnriched: attributable.profilesEnriched ? 0 : null,
    actionsPlanned: 0,
    attempts: 0,
    actionsSent: 0,
    actionsAccepted: 0,
    responded: 0,
    positiveReplies: 0,
    meetingsBooked: attributable.meetingsBooked ? 0 : null,
    opportunities: attributable.opportunities ? 0 : null,
    revenue: attributable.revenue ? 0 : null,
  };
}

import { and, asc, eq, inArray, lte, ne, or } from "drizzle-orm";
import {
  buildAutonomousSourcingFilters,
  PROSPECT_DISCOVERY_JOB_TYPE,
  type AutonomousSourcingFilters,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  channelAssessments,
  dailyProspectingSchedules,
  dailySourcingCycles,
  icpVersions,
  jobs,
  outboxEvents,
  prospectDiscoveryRuns,
  prospectingPlans,
  sourcingFrontiers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { normalizeStrategy } from "./campaign-sourcing-reconciler";

const DEFAULT_DAILY_BUDGET = {
  wallTimeMinutes: 60,
  pageLimit: 150,
  verificationLimit: 60,
  maxPagesPerCompany: 4,
  maxConcurrentPerDomain: 2,
} as const;

type CampaignRow = {
  campaignId: string;
  workspaceId: string;
  icpVersionId: string;
  channel: "linkedin" | "email" | "whatsapp" | null;
  strategy: unknown;
  icpName: string;
};

export class DailyProspectingScheduler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly defaults: { localTime: string; timezone: string } = {
      localTime: "06:00",
      timezone: "Europe/Paris",
    },
  ) {}

  async reconcile(limit = 25): Promise<number> {
    const now = this.clock.now();
    await this.#ensureWorkspaceSchedules(now);
    return this.database.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(dailyProspectingSchedules)
        .where(
          and(
            eq(dailyProspectingSchedules.enabled, true),
            lte(dailyProspectingSchedules.nextRunAt, now),
          ),
        )
        .limit(limit)
        .for("update", { skipLocked: true });
      let scheduledRuns = 0;
      for (const schedule of due) {
        const localDate = zonedDateKey(now, schedule.timezone);
        const campaignRows = await this.#activeCampaigns(tx, schedule.workspaceId);
        scheduledRuns += await this.#scheduleSharedWhatsappCycle(
          tx,
          schedule.workspaceId,
          localDate,
          now,
          campaignRows,
        );
        for (const campaign of campaignRows.filter((row) => row.channel !== "whatsapp")) {
          scheduledRuns += await this.#scheduleLegacyChannelRun(tx, campaign, localDate, now);
        }
        await tx
          .update(dailyProspectingSchedules)
          .set({
            lastScheduledDate: localDate,
            lastRunAt: now,
            nextRunAt: nextDailyOccurrence(now, schedule.localTime, schedule.timezone),
            updatedAt: now,
          })
          .where(eq(dailyProspectingSchedules.workspaceId, schedule.workspaceId));
      }
      return scheduledRuns;
    });
  }

  #activeCampaigns(tx: DbTx, workspaceId: string): Promise<CampaignRow[]> {
    return tx
      .select({
        campaignId: campaigns.id,
        workspaceId: campaigns.workspaceId,
        icpVersionId: campaigns.icpVersionId,
        channel: campaigns.channel,
        strategy: channelAssessments.strategy,
        icpName: icpVersions.name,
      })
      .from(campaigns)
      .innerJoin(
        prospectingPlans,
        and(
          eq(prospectingPlans.workspaceId, campaigns.workspaceId),
          eq(prospectingPlans.id, campaigns.planId),
        ),
      )
      .innerJoin(
        channelAssessments,
        and(
          eq(channelAssessments.workspaceId, campaigns.workspaceId),
          eq(channelAssessments.id, campaigns.assessmentId),
        ),
      )
      .innerJoin(
        icpVersions,
        and(
          eq(icpVersions.workspaceId, campaigns.workspaceId),
          eq(icpVersions.id, campaigns.icpVersionId),
        ),
      )
      .where(
        and(
          eq(campaigns.workspaceId, workspaceId),
          or(
            eq(campaigns.status, "active"),
            and(eq(campaigns.status, "draft"), eq(campaigns.automationStage, "sourcing")),
          ),
          eq(prospectingPlans.status, "ready"),
          ne(campaigns.automationStage, "completed"),
          eq(channelAssessments.status, "completed"),
        ),
      );
  }

  async #scheduleSharedWhatsappCycle(
    tx: DbTx,
    workspaceId: string,
    localDate: string,
    now: Date,
    campaignsForWorkspace: readonly CampaignRow[],
  ): Promise<number> {
    const whatsappCampaigns = canonicalCampaignsByIcp(
      campaignsForWorkspace.filter((row) => row.channel === "whatsapp"),
    );
    if (!whatsappCampaigns.length) return 0;
    const cycleId = crypto.randomUUID();
    const deadlineAt = new Date(now.getTime() + DEFAULT_DAILY_BUDGET.wallTimeMinutes * 60_000);
    const [inserted] = await tx
      .insert(dailySourcingCycles)
      .values({
        id: cycleId,
        workspaceId,
        localDate,
        timezone: "Europe/Paris",
        deadlineAt,
        pageLimit: DEFAULT_DAILY_BUDGET.pageLimit,
        verificationLimit: DEFAULT_DAILY_BUDGET.verificationLimit,
        maxPagesPerCompany: DEFAULT_DAILY_BUDGET.maxPagesPerCompany,
        maxConcurrentPerDomain: DEFAULT_DAILY_BUDGET.maxConcurrentPerDomain,
        activeIcpCount: whatsappCampaigns.length,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const [cycle] = inserted
      ? [inserted]
      : await tx
          .select()
          .from(dailySourcingCycles)
          .where(
            and(
              eq(dailySourcingCycles.workspaceId, workspaceId),
              eq(dailySourcingCycles.localDate, localDate),
            ),
          )
          .limit(1);
    if (!cycle || cycle.status === "completed" || cycle.status === "partial") return 0;
    const [existingRun] = await tx
      .select({ id: prospectDiscoveryRuns.id })
      .from(prospectDiscoveryRuns)
      .where(eq(prospectDiscoveryRuns.sourcingCycleId, cycle.id))
      .limit(1);
    if (existingRun) return 0;

    const frontiers = [];
    for (const campaign of whatsappCampaigns) {
      const strategy = normalizeStrategy(campaign.strategy, "whatsapp", campaign.icpName);
      const querySeed = `${strategy.query} France`;
      const queryFingerprint = sha256(`${querySeed}|web|fr-metropolitan`);
      const [created] = await tx
        .insert(sourcingFrontiers)
        .values({
          id: crypto.randomUUID(),
          workspaceId,
          icpVersionId: campaign.icpVersionId,
          channel: "whatsapp",
          sourceKind: "web",
          regionKey: "fr-metropolitan",
          querySeed,
          queryFingerprint,
          nextEligibleAt: now,
          metadata: { sourcePolicy: "official-web-v1" },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      const [frontier] = created
        ? [created]
        : await tx
            .select()
            .from(sourcingFrontiers)
            .where(
              and(
                eq(sourcingFrontiers.workspaceId, workspaceId),
                eq(sourcingFrontiers.icpVersionId, campaign.icpVersionId),
                eq(sourcingFrontiers.channel, "whatsapp"),
                eq(sourcingFrontiers.sourceKind, "web"),
                eq(sourcingFrontiers.regionKey, "fr-metropolitan"),
                eq(sourcingFrontiers.queryFingerprint, queryFingerprint),
              ),
            )
            .limit(1);
      if (frontier && frontier.nextEligibleAt <= now && frontier.status !== "paused") {
        frontiers.push({ campaign, frontier });
      }
    }
    const ordered = [...frontiers].sort((left, right) => {
      const leftRun = left.frontier.lastRunAt?.getTime() ?? 0;
      const rightRun = right.frontier.lastRunAt?.getTime() ?? 0;
      return leftRun - rightRun || left.frontier.id.localeCompare(right.frontier.id);
    });
    const allocations = allocateCompanyQuanta(
      ordered,
      Math.floor(cycle.pageLimit / cycle.maxPagesPerCompany),
    );
    let scheduled = 0;
    for (const item of ordered) {
      const companyLimit = allocations.get(item.frontier.id) ?? 0;
      if (companyLimit <= 0) continue;
      const [activeRun] = await tx
        .select({ id: prospectDiscoveryRuns.id })
        .from(prospectDiscoveryRuns)
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, workspaceId),
            eq(prospectDiscoveryRuns.icpVersionId, item.campaign.icpVersionId),
            eq(prospectDiscoveryRuns.channel, "whatsapp"),
            eq(prospectDiscoveryRuns.status, "running"),
          ),
        )
        .limit(1);
      if (activeRun) continue;
      const runId = crypto.randomUUID();
      const filters: Extract<AutonomousSourcingFilters, { channel: "email" | "whatsapp" }> = {
        channel: "whatsapp",
        query: rotatedQuery(item.frontier.querySeed, item.frontier.rotationOrdinal),
        sourceKinds: ["web"],
        limit: companyLimit,
      };
      await tx.insert(prospectDiscoveryRuns).values({
        id: runId,
        workspaceId,
        icpVersionId: item.campaign.icpVersionId,
        campaignId: item.campaign.campaignId,
        sourcingCycleId: cycle.id,
        sourcingFrontierId: item.frontier.id,
        trigger: "daily",
        provider: "crawler",
        channel: "whatsapp",
        filters,
        status: "running",
        createdBy: null,
        createdAt: now,
      });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: PROSPECT_DISCOVERY_JOB_TYPE,
        payload: { workspaceId, runId },
        idempotencyKey: `${cycle.id}:${item.campaign.icpVersionId}:whatsapp-sourcing:v1`,
        correlationId: `sourcing-cycle:${cycle.id}:icp:${item.campaign.icpVersionId}`,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(outboxEvents).values({
        workspaceId,
        aggregateType: "DailySourcingCycle",
        aggregateId: cycle.id,
        eventType: "WhatsappIcpSourcingScheduled",
        payload: {
          cycleId: cycle.id,
          runId,
          icpVersionId: item.campaign.icpVersionId,
          campaignId: item.campaign.campaignId,
          companyLimit,
        },
        createdAt: now,
      });
      scheduled += 1;
    }
    await tx
      .update(dailySourcingCycles)
      .set({
        status: scheduled > 0 ? "running" : "completed",
        scheduledRunCount: scheduled,
        startedAt: scheduled > 0 ? now : null,
        completedAt: scheduled > 0 ? null : now,
        summary: scheduled > 0
          ? { state: "daily_pass_running" }
          : { state: "no_frontier_due" },
        updatedAt: now,
      })
      .where(eq(dailySourcingCycles.id, cycle.id));
    return scheduled;
  }

  async #scheduleLegacyChannelRun(
    tx: DbTx,
    campaign: CampaignRow,
    localDate: string,
    now: Date,
  ): Promise<number> {
    if (!campaign.channel) return 0;
    const [activeRun] = await tx
      .select({ id: prospectDiscoveryRuns.id })
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, campaign.workspaceId),
          eq(prospectDiscoveryRuns.icpVersionId, campaign.icpVersionId),
          eq(prospectDiscoveryRuns.channel, campaign.channel),
          eq(prospectDiscoveryRuns.status, "running"),
        ),
      )
      .limit(1);
    if (activeRun) return 0;
    const idempotencyKey = `${campaign.campaignId}:daily-sourcing:${localDate}:v1`;
    const [existingJob] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, campaign.workspaceId),
          eq(jobs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingJob) return 0;
    const runId = crypto.randomUUID();
    const strategy = normalizeStrategy(campaign.strategy, campaign.channel, campaign.icpName);
    await tx.insert(prospectDiscoveryRuns).values({
      id: runId,
      workspaceId: campaign.workspaceId,
      icpVersionId: campaign.icpVersionId,
      campaignId: campaign.campaignId,
      trigger: "daily",
      provider: campaign.channel === "linkedin" ? "unipile" : "crawler",
      channel: campaign.channel,
      filters: buildAutonomousSourcingFilters(campaign.channel, strategy),
      status: "running",
      createdBy: null,
      createdAt: now,
    });
    await tx.insert(jobs).values({
      id: crypto.randomUUID(),
      workspaceId: campaign.workspaceId,
      type: PROSPECT_DISCOVERY_JOB_TYPE,
      payload: { workspaceId: campaign.workspaceId, runId },
      idempotencyKey,
      correlationId: `campaign:${campaign.campaignId}:daily:${localDate}`,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(outboxEvents).values({
      workspaceId: campaign.workspaceId,
      aggregateType: "Campaign",
      aggregateId: campaign.campaignId,
      eventType: "CampaignDailySourcingScheduled",
      payload: { campaignId: campaign.campaignId, runId, localDate },
      createdAt: now,
    });
    return 1;
  }

  async #ensureWorkspaceSchedules(now: Date): Promise<void> {
    const activeWorkspaces = await this.database
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.status, "active"));
    if (!activeWorkspaces.length) return;
    await this.database
      .insert(dailyProspectingSchedules)
      .values(activeWorkspaces.map((workspace) => ({
        workspaceId: workspace.id,
        enabled: true,
        localTime: this.defaults.localTime,
        timezone: this.defaults.timezone,
        nextRunAt: firstDailyOccurrence(now, this.defaults.localTime, this.defaults.timezone),
        createdAt: now,
        updatedAt: now,
      })))
      .onConflictDoNothing();
  }
}

type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function canonicalCampaignsByIcp(rows: readonly CampaignRow[]): CampaignRow[] {
  const selected = new Map<string, CampaignRow>();
  for (const row of rows) {
    const current = selected.get(row.icpVersionId);
    if (!current || row.campaignId.localeCompare(current.campaignId) < 0) {
      selected.set(row.icpVersionId, row);
    }
  }
  return [...selected.values()];
}

function allocateCompanyQuanta<T extends { frontier: { id: string; yieldEma: string } }>(
  frontiers: readonly T[],
  totalCompanies: number,
): Map<string, number> {
  const result = new Map<string, number>();
  let remaining = totalCompanies;
  for (const item of frontiers) {
    if (remaining <= 0) break;
    const quantum = Math.min(4, remaining);
    result.set(item.frontier.id, quantum);
    remaining -= quantum;
  }
  const byYield = [...frontiers].sort((left, right) =>
    Number(right.frontier.yieldEma) - Number(left.frontier.yieldEma)
    || left.frontier.id.localeCompare(right.frontier.id));
  while (remaining > 0 && byYield.length > 0) {
    let allocated = false;
    for (const item of byYield) {
      if (remaining <= 0) break;
      const current = result.get(item.frontier.id) ?? 0;
      if (current >= 20) continue;
      result.set(item.frontier.id, current + 1);
      remaining -= 1;
      allocated = true;
    }
    if (!allocated) break;
  }
  return result;
}

function rotatedQuery(seed: string, ordinal: number): string {
  const rotations = [
    "contact professionnel",
    "équipe portable",
    "implantations mobile",
    "annuaire entreprise téléphone",
  ];
  return `${seed} ${rotations[Math.abs(ordinal) % rotations.length]}`;
}

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function nextDailyOccurrence(after: Date, localTime: string, timezone: string): Date {
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("INVALID_DAILY_PROSPECTING_TIME");
  const parts = zonedParts(after, timezone);
  for (let dayOffset = 0; dayOffset < 4; dayOffset += 1) {
    const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour, minute));
    let candidate = new Date(calendar.getTime() - timezoneOffsetMs(calendar, timezone));
    candidate = new Date(calendar.getTime() - timezoneOffsetMs(candidate, timezone));
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error("DAILY_PROSPECTING_NEXT_RUN_UNRESOLVED");
}

export function firstDailyOccurrence(now: Date, localTime: string, timezone: string): Date {
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("INVALID_DAILY_PROSPECTING_TIME");
  const parts = zonedParts(now, timezone);
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute));
  let today = new Date(calendar.getTime() - timezoneOffsetMs(calendar, timezone));
  today = new Date(calendar.getTime() - timezoneOffsetMs(today, timezone));
  return today <= now ? new Date(now.getTime() - 1_000) : today;
}

function zonedDateKey(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return localAsUtc - date.getTime();
}

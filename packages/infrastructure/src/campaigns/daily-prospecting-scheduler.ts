import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { buildAutonomousSourcingFilters, PROSPECT_DISCOVERY_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  channelAssessments,
  dailyProspectingSchedules,
  icpVersions,
  jobs,
  outboxEvents,
  prospectDiscoveryRuns,
  prospectingPlans,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { normalizeStrategy } from "./campaign-sourcing-reconciler";

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
        const campaignRows = await tx
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
              eq(campaigns.workspaceId, schedule.workspaceId),
              eq(campaigns.status, "active"),
              eq(prospectingPlans.status, "ready"),
              ne(campaigns.automationStage, "completed"),
              inArray(channelAssessments.status, ["completed"]),
            ),
          );
        for (const campaign of campaignRows) {
          if (!campaign.channel) continue;
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
          if (activeRun) continue;
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
          if (existingJob) continue;
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
          scheduledRuns += 1;
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
        nextRunAt: nextDailyOccurrence(new Date(now.getTime() - 1_000), this.defaults.localTime, this.defaults.timezone),
        createdAt: now,
        updatedAt: now,
      })))
      .onConflictDoNothing();
  }
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

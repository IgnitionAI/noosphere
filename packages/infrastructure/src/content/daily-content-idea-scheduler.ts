import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import type { ContentIdeaRepository } from "@outbound/application/content/content-ideas";
import type { Database } from "@outbound/infrastructure/database/client";
import { contentIdeaSchedules, editorialStrategies } from "@outbound/infrastructure/database/schema";
import { firstDailyOccurrence, nextDailyOccurrence } from "@outbound/infrastructure/campaigns/daily-prospecting-scheduler";

export class DailyContentIdeaScheduler {
  constructor(
    private readonly database: Database,
    private readonly repository: ContentIdeaRepository,
    private readonly clock: Clock,
    private readonly defaults: { localTime: string; timezone: string } = { localTime: "06:00", timezone: "Europe/Paris" },
  ) {}

  async reconcile(limit = 25): Promise<number> {
    const now = this.clock.now();
    await this.#ensureSchedules(now);
    const due = await this.database.select().from(contentIdeaSchedules).where(and(
      eq(contentIdeaSchedules.enabled, true),
      lte(contentIdeaSchedules.nextRunAt, now),
    )).limit(limit);
    let scheduled = 0;
    for (const schedule of due) {
      const date = zonedDateKey(now, schedule.timezone);
      await this.repository.createDiscovery({
        workspaceId: schedule.workspaceId,
        userId: null,
        requestKey: `daily:${date}`,
        trigger: "daily",
        now,
      });
      await this.database.update(contentIdeaSchedules).set({
        lastRunAt: now,
        nextRunAt: nextDailyOccurrence(now, schedule.localTime, schedule.timezone),
        updatedAt: now,
      }).where(and(
        eq(contentIdeaSchedules.workspaceId, schedule.workspaceId),
        lte(contentIdeaSchedules.nextRunAt, now),
      ));
      scheduled += 1;
    }
    return scheduled;
  }

  async #ensureSchedules(now: Date): Promise<void> {
    const active = await this.database.select({ workspaceId: editorialStrategies.workspaceId }).from(editorialStrategies).where(and(
      eq(editorialStrategies.status, "active"),
      sql`${editorialStrategies.currentVersion} > 0`,
      sql`${editorialStrategies.deletedAt} is null`,
    )).orderBy(desc(editorialStrategies.updatedAt));
    for (const row of active) {
      await this.database.insert(contentIdeaSchedules).values({
        workspaceId: row.workspaceId,
        enabled: true,
        localTime: this.defaults.localTime,
        timezone: this.defaults.timezone,
        nextRunAt: firstDailyOccurrence(now, this.defaults.localTime, this.defaults.timezone),
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
    }
  }
}

function zonedDateKey(date: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

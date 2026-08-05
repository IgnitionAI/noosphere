import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { DailySourcingBudget } from "@outbound/application/crm/whatsapp-sourcing-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { dailySourcingCycles } from "@outbound/infrastructure/database/schema";

export class PostgresDailySourcingBudget implements DailySourcingBudget {
  constructor(private readonly database: Database) {}

  async reserve(input: Parameters<DailySourcingBudget["reserve"]>[0]) {
    if (!input.cycleId) {
      return { accepted: true, remaining: null, deadlineAt: null };
    }
    const counter = input.resource === "page"
      ? dailySourcingCycles.pageAttempts
      : dailySourcingCycles.verificationAttempts;
    const limit = input.resource === "page"
      ? dailySourcingCycles.pageLimit
      : dailySourcingCycles.verificationLimit;
    const [row] = await this.database
      .update(dailySourcingCycles)
      .set({
        [input.resource === "page" ? "pageAttempts" : "verificationAttempts"]:
          sql`${counter} + ${input.amount}`,
        status: "running",
        startedAt: sql`coalesce(${dailySourcingCycles.startedAt}, ${input.now.toISOString()}::timestamptz)`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(dailySourcingCycles.id, input.cycleId),
          inArray(dailySourcingCycles.status, ["scheduled", "running"]),
          gt(dailySourcingCycles.deadlineAt, input.now),
          sql`${counter} + ${input.amount} <= ${limit}`,
        ),
      )
      .returning({
        used: counter,
        limit,
        deadlineAt: dailySourcingCycles.deadlineAt,
      });
    if (row) {
      return {
        accepted: true,
        remaining: row.limit - row.used,
        deadlineAt: row.deadlineAt,
      };
    }
    const [cycle] = await this.database
      .select({
        used: counter,
        limit,
        deadlineAt: dailySourcingCycles.deadlineAt,
      })
      .from(dailySourcingCycles)
      .where(eq(dailySourcingCycles.id, input.cycleId))
      .limit(1);
    return {
      accepted: false,
      remaining: cycle ? Math.max(0, cycle.limit - cycle.used) : 0,
      deadlineAt: cycle?.deadlineAt ?? null,
    };
  }
}

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  dailySourcingCycles,
  phoneObservations,
  sourcingFrontiers,
  whatsappReachabilityChecks,
} from "@outbound/infrastructure/database/schema";

export class SourcingRetentionReconciler {
  constructor(private readonly database: Database, private readonly clock: Clock) {}

  async reconcile(): Promise<number> {
    const now = this.clock.now();
    const redacted = await this.database
      .update(phoneObservations)
      .set({
        rawValue: null,
        e164: null,
        evidenceSnippet: "Donnée brute supprimée après la période de rétention.",
        rawRetainUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          isNotNull(phoneObservations.rawRetainUntil),
          lt(phoneObservations.rawRetainUntil, now),
          isNotNull(phoneObservations.rejectionReason),
        ),
      )
      .returning({ id: phoneObservations.id });
    const expiredChecks = await this.database
      .delete(whatsappReachabilityChecks)
      .where(lt(
        whatsappReachabilityChecks.expiresAt,
        new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000),
      ))
      .returning({ e164: whatsappReachabilityChecks.e164 });
    const compactedFrontiers = await this.database
      .update(sourcingFrontiers)
      .set({
        metadata: sql`jsonb_build_object(
          'compacted', true,
          'queryFingerprint', ${sourcingFrontiers.queryFingerprint}
        )`,
        updatedAt: now,
      })
      .where(
        and(
          eq(sourcingFrontiers.status, "paused"),
          lt(sourcingFrontiers.updatedAt, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000)),
          sql`coalesce((${sourcingFrontiers.metadata} ->> 'compacted')::boolean, false) = false`,
        ),
      )
      .returning({ id: sourcingFrontiers.id });
    const deletedCycles = await this.database
      .delete(dailySourcingCycles)
      .where(lt(
        dailySourcingCycles.createdAt,
        new Date(now.getTime() - 730 * 24 * 60 * 60 * 1_000),
      ))
      .returning({ id: dailySourcingCycles.id });
    return redacted.length + expiredChecks.length + compactedFrontiers.length + deletedCycles.length;
  }
}

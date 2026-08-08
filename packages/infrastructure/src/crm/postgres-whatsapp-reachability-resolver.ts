import { and, eq, gt } from "drizzle-orm";
import type {
  DailySourcingBudget,
  WhatsappReachabilityResolver,
  WhatsappReachabilityResult,
} from "@outbound/application/crm/whatsapp-sourcing-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { whatsappReachabilityChecks } from "@outbound/infrastructure/database/schema";
import type { ProspectSource } from "./unipile-prospect-source";

export class PostgresWhatsappReachabilityResolver implements WhatsappReachabilityResolver {
  constructor(
    private readonly database: Database,
    private readonly source: ProspectSource,
    private readonly budget: DailySourcingBudget,
  ) {}

  async resolve(
    input: Parameters<WhatsappReachabilityResolver["resolve"]>[0],
  ): Promise<WhatsappReachabilityResult> {
    const providerAccountId = await this.source.resolveHealthyAccount?.("whatsapp").catch(() => null) ?? null;
    if (!providerAccountId) {
      return unknownResult(input.now, null, "WHATSAPP_ACCOUNT_DISCONNECTED");
    }
    const [cached] = await this.database
      .select()
      .from(whatsappReachabilityChecks)
      .where(
        and(
          eq(whatsappReachabilityChecks.workspaceId, input.workspaceId),
          eq(whatsappReachabilityChecks.providerAccountId, providerAccountId),
          eq(whatsappReachabilityChecks.e164, input.e164),
          gt(whatsappReachabilityChecks.expiresAt, input.now),
        ),
      )
      .limit(1);
    if (cached) {
      return {
        status: cached.status,
        providerAccountId,
        checkedAt: cached.checkedAt,
        expiresAt: cached.expiresAt,
        source: "cache",
        errorCode: cached.lastErrorCode,
      };
    }
    const reservation = await this.budget.reserve({
      cycleId: input.sourcingCycleId,
      resource: "whatsapp_verification",
      amount: 1,
      now: input.now,
    });
    if (!reservation.accepted) {
      return unknownResult(input.now, providerAccountId, "SOURCING_VERIFICATION_BUDGET_EXHAUSTED");
    }
    const result = this.source.verifyWhatsappReachability
      ? await this.source.verifyWhatsappReachability(input.phone)
      : await legacyVerification(this.source, input.phone, providerAccountId, input.now);
    const workspaceId = input.workspaceId;
    await this.database
      .insert(whatsappReachabilityChecks)
      .values({
        workspaceId,
        providerAccountId,
        e164: input.e164,
        status: result.status,
        checkedAt: result.checkedAt,
        expiresAt: result.expiresAt,
        lastErrorCode: result.errorCode,
        source: "unipile",
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          whatsappReachabilityChecks.workspaceId,
          whatsappReachabilityChecks.providerAccountId,
          whatsappReachabilityChecks.e164,
        ],
        set: {
          status: result.status,
          checkedAt: result.checkedAt,
          expiresAt: result.expiresAt,
          lastErrorCode: result.errorCode,
          updatedAt: input.now,
        },
      });
    return result;
  }
}

function unknownResult(
  now: Date,
  providerAccountId: string | null,
  errorCode: string,
): WhatsappReachabilityResult {
  return {
    status: "unknown",
    providerAccountId,
    checkedAt: now,
    expiresAt: now,
    source: "live",
    errorCode,
  };
}

async function legacyVerification(
  source: ProspectSource,
  phone: string,
  providerAccountId: string,
  now: Date,
): Promise<WhatsappReachabilityResult> {
  const channel = await source.verifyWhatsappNumber?.(phone).catch(() => null);
  return {
    status: channel?.status === "verified" ? "verified" : "unknown",
    providerAccountId,
    checkedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    source: "live",
    errorCode: channel ? null : "UNIPILE_VERIFICATION_UNAVAILABLE",
  };
}

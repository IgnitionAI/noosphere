import { and, eq, lt, or } from "drizzle-orm";
import type {
  ResearchToolRequestClaim,
  ResearchToolRequestRegistry,
} from "@outbound/application/gtm/product-research-ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { researchToolRequests } from "@outbound/infrastructure/database/schema";

export class PostgresResearchToolRequestRegistry implements ResearchToolRequestRegistry {
  constructor(private readonly db: Database) {}

  async claim(input: {
    workspaceId: string;
    runId: string;
    toolName: string;
    normalizedInputHash: string;
    normalizedInput: Readonly<Record<string, unknown>>;
    now: Date;
    leaseMs: number;
  }): Promise<ResearchToolRequestClaim> {
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const inserted = await this.db
      .insert(researchToolRequests)
      .values({
        workspaceId: input.workspaceId,
        runId: input.runId,
        toolName: input.toolName,
        normalizedInputHash: input.normalizedInputHash,
        normalizedInput: input.normalizedInput,
        status: "running",
        leaseToken,
        leaseExpiresAt,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: researchToolRequests.id });
    if (inserted.length === 1) return { kind: "execute", leaseToken };

    const whereKey = and(
      eq(researchToolRequests.workspaceId, input.workspaceId),
      eq(researchToolRequests.runId, input.runId),
      eq(researchToolRequests.toolName, input.toolName),
      eq(researchToolRequests.normalizedInputHash, input.normalizedInputHash),
    );
    const rows = await this.db
      .select()
      .from(researchToolRequests)
      .where(whereKey)
      .limit(1);
    const current = rows[0];
    if (!current) throw new Error("RESEARCH_TOOL_REQUEST_CLAIM_LOST");
    if (current.status === "completed" && current.output && current.contentHash) {
      return { kind: "cache_hit", output: current.output, contentHash: current.contentHash };
    }
    if (current.status === "failed" && !current.retryable) {
      return { kind: "in_progress", retryAt: new Date(8640000000000000) };
    }

    const reclaimed = await this.db
      .update(researchToolRequests)
      .set({
        status: "running",
        leaseToken,
        leaseExpiresAt,
        retryable: true,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          whereKey,
          or(
            eq(researchToolRequests.status, "failed"),
            lt(researchToolRequests.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning({ id: researchToolRequests.id });
    if (reclaimed.length === 1) return { kind: "execute", leaseToken };
    return {
      kind: "in_progress",
      retryAt: current.leaseExpiresAt ?? new Date(input.now.getTime() + input.leaseMs),
    };
  }

  async complete(input: {
    leaseToken: string;
    output: string;
    contentHash: string;
    now: Date;
  }): Promise<void> {
    const rows = await this.db
      .update(researchToolRequests)
      .set({
        status: "completed",
        output: input.output,
        contentHash: input.contentHash,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(researchToolRequests.leaseToken, input.leaseToken),
          eq(researchToolRequests.status, "running"),
        ),
      )
      .returning({ id: researchToolRequests.id });
    if (rows.length !== 1) throw new Error("RESEARCH_TOOL_REQUEST_LEASE_LOST");
  }

  async fail(input: {
    leaseToken: string;
    retryable: boolean;
    errorCode: string;
    now: Date;
  }): Promise<void> {
    const rows = await this.db
      .update(researchToolRequests)
      .set({
        status: "failed",
        retryable: input.retryable,
        lastErrorCode: input.errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(eq(researchToolRequests.leaseToken, input.leaseToken))
      .returning({ id: researchToolRequests.id });
    if (rows.length !== 1) throw new Error("RESEARCH_TOOL_REQUEST_LEASE_LOST");
  }
}

import { and, eq } from "drizzle-orm";
import type { McpExecutionContext, McpWriteCapabilities, McpWriteCommand, McpWriteLedger, McpWriteResult } from "@outbound/application/mcp/mcp-write-capabilities";
import type { Database, DatabaseTransaction } from "@outbound/infrastructure/database/client";
import { mcpOauthAuditEvents, mcpWriteOperations } from "@outbound/infrastructure/database/schema";

type AuditOutcome = "accepted" | "denied" | "replayed" | "stale" | "failed" | "in_progress";
export type PostgresMcpWriteTransaction = DatabaseTransaction;

/** Durable idempotency ledger. Row locks serialize replays across replicas.
 * A bounded lease allows an interrupted `running` write to be reclaimed.
 */
export class PostgresMcpWriteLedger implements McpWriteLedger {
  private readonly leaseOwner = crypto.randomUUID();
  private readonly leaseDurationMs = 5 * 60 * 1000;

  constructor(private readonly db: Database) {}

  /**
   * Claim, domain mutation and completion share one PostgreSQL transaction.
   * Repositories constructed with `tx` may open savepoints, but cannot commit
   * independently of this outer transaction.
   */
  async runAtomic<Name extends McpWriteCommand["operation"]>(
    context: McpExecutionContext,
    command: McpWriteCommand<Name>,
    effect: (tx: PostgresMcpWriteTransaction, correlationId: string) => Promise<McpWriteResult>,
  ): Promise<McpWriteResult> {
    const correlationId = crypto.randomUUID();
    const [audit] = await this.db.insert(mcpOauthAuditEvents).values({
      action: "mcp_write", clientId: context.clientId, userId: context.userId, workspaceId: context.workspaceId,
      subjectId: command.operation, actorType: "mcp", tool: command.operation, correlationId, outcome: "in_progress",
    }).returning({ id: mcpOauthAuditEvents.id });
    try {
      const result = await this.db.transaction(async (tx) => {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
        const [existing] = await tx.select().from(mcpWriteOperations).where(and(
          eq(mcpWriteOperations.workspaceId, context.workspaceId), eq(mcpWriteOperations.clientId, context.clientId),
          eq(mcpWriteOperations.tool, command.operation), eq(mcpWriteOperations.requestKey, command.requestKey),
        )).for("update").limit(1);
        if (existing) {
          if (existing.inputHash !== command.inputHash) throw new Error("MCP_WRITE_IDEMPOTENCY_CONFLICT");
          if (existing.status === "completed" && existing.result) return { result: existing.result as McpWriteResult, replay: true };
          throw new Error("MCP_WRITE_RECOVERY_REQUIRED");
        }

        const [row] = await tx.insert(mcpWriteOperations).values({
          workspaceId: context.workspaceId, clientId: context.clientId, userId: context.userId, tool: command.operation,
          requestKey: command.requestKey, inputHash: command.inputHash, status: "running", result: null, correlationId,
          leaseOwner: this.leaseOwner, leaseExpiresAt,
        }).onConflictDoNothing().returning();
        if (!row) {
          const [conflicting] = await tx.select().from(mcpWriteOperations).where(and(
            eq(mcpWriteOperations.workspaceId, context.workspaceId), eq(mcpWriteOperations.clientId, context.clientId),
            eq(mcpWriteOperations.tool, command.operation), eq(mcpWriteOperations.requestKey, command.requestKey),
          )).for("update").limit(1);
          if (conflicting?.inputHash !== command.inputHash) throw new Error("MCP_WRITE_IDEMPOTENCY_CONFLICT");
          if (conflicting?.status === "completed" && conflicting.result) return { result: conflicting.result as McpWriteResult, replay: true };
          throw new Error("MCP_WRITE_RECOVERY_REQUIRED");
        }
        const effectResult = await effect(tx, correlationId);
        const persistedResult: McpWriteResult = audit?.id && !effectResult.auditId ? { ...effectResult, auditId: audit.id } : effectResult;
        if (audit?.id) {
          await tx.update(mcpOauthAuditEvents).set({ outcome: "accepted" }).where(eq(mcpOauthAuditEvents.id, audit.id));
        }
        const [completed] = await tx.update(mcpWriteOperations).set({
          status: "completed", result: persistedResult, updatedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
        }).where(and(eq(mcpWriteOperations.id, row.id), eq(mcpWriteOperations.status, "running"), eq(mcpWriteOperations.leaseOwner, this.leaseOwner))).returning({ id: mcpWriteOperations.id });
        if (!completed) throw new Error("MCP_WRITE_LEASE_LOST");
        return { result: persistedResult, replay: false };
      });
      if (result.replay) await this.setAuditOutcome(audit?.id, "replayed");
      return result.result;
    } catch (error) {
      await this.setAuditOutcome(audit?.id, this.outcomeForError(error));
      throw error;
    }
  }

  async recordAudit(context: McpExecutionContext, tool: McpWriteCommand["operation"], outcome: string): Promise<void> {
    await this.db.insert(mcpOauthAuditEvents).values({
      action: "mcp_write", actorType: "mcp", clientId: context.clientId, userId: context.userId,
      workspaceId: context.workspaceId, subjectId: tool, tool, correlationId: crypto.randomUUID(),
      outcome: this.normalizeAuditOutcome(outcome),
    });
  }

  async run<Name extends McpWriteCommand["operation"]>(
    context: McpExecutionContext,
    command: McpWriteCommand<Name>,
    effect: () => Promise<McpWriteResult>,
  ): Promise<McpWriteResult> {
    const correlationId = crypto.randomUUID();
    const [audit] = await this.db.insert(mcpOauthAuditEvents).values({
      action: "mcp_write", clientId: context.clientId, userId: context.userId, workspaceId: context.workspaceId,
      subjectId: command.operation, actorType: "mcp", tool: command.operation, correlationId, outcome: "accepted",
    }).returning({ id: mcpOauthAuditEvents.id });
    let decision: { result: McpWriteResult | null; execute: boolean; recovery: boolean };
    try {
      decision = await this.db.transaction(async (tx) => {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
        const [row] = await tx.select().from(mcpWriteOperations).where(and(
          eq(mcpWriteOperations.workspaceId, context.workspaceId), eq(mcpWriteOperations.clientId, context.clientId),
          eq(mcpWriteOperations.tool, command.operation), eq(mcpWriteOperations.requestKey, command.requestKey),
        )).for("update").limit(1);
        if (row && row.inputHash !== command.inputHash) throw new Error("MCP_WRITE_IDEMPOTENCY_CONFLICT");
        if (row?.status === "completed" && row.result) return { result: row.result as McpWriteResult, execute: false, recovery: false };
        if (row?.status === "running" && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime()) throw new Error("MCP_WRITE_IN_PROGRESS");
        // An expired lease means the previous process may have committed the
        // domain effect immediately before crashing. Never run it a second
        // time without an explicit, domain-specific reconciliation path.
        if (row?.status === "running") {
          await tx.update(mcpWriteOperations).set({ leaseOwner: this.leaseOwner, leaseExpiresAt, updatedAt: now }).where(eq(mcpWriteOperations.id, row.id));
          return { result: null, execute: false, recovery: true };
        }
        if (row?.status === "running" || row?.status === "failed") {
          await tx.update(mcpWriteOperations).set({ status: "running", updatedAt: now, leaseOwner: this.leaseOwner, leaseExpiresAt }).where(eq(mcpWriteOperations.id, row.id));
          return { result: null, execute: true, recovery: false };
        }
        await tx.insert(mcpWriteOperations).values({
          workspaceId: context.workspaceId, clientId: context.clientId, userId: context.userId, tool: command.operation,
          requestKey: command.requestKey, inputHash: command.inputHash, status: "running", result: null, correlationId,
          leaseOwner: this.leaseOwner, leaseExpiresAt,
        });
        return { result: null, execute: true, recovery: false };
      });
    } catch (error) {
      await this.setAuditOutcome(audit?.id, this.outcomeForError(error));
      throw error;
    }
    if (!decision.execute && decision.result) {
      await this.setAuditOutcome(audit?.id, "replayed");
      return decision.result;
    }
    if (decision.recovery) {
      await this.setAuditOutcome(audit?.id, "in_progress");
      throw new Error("MCP_WRITE_RECOVERY_REQUIRED");
    }
    let result: McpWriteResult;
    try {
      result = await effect();
    } catch (error) {
      await this.db.update(mcpWriteOperations).set({ status: "failed", updatedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }).where(and(
        eq(mcpWriteOperations.workspaceId, context.workspaceId), eq(mcpWriteOperations.clientId, context.clientId),
        eq(mcpWriteOperations.tool, command.operation), eq(mcpWriteOperations.requestKey, command.requestKey),
        eq(mcpWriteOperations.status, "running"), eq(mcpWriteOperations.leaseOwner, this.leaseOwner),
      ));
      await this.setAuditOutcome(audit?.id, this.outcomeForError(error));
      throw error;
    }
    const persistedResult: McpWriteResult = audit?.id && !result.auditId ? { ...result, auditId: audit.id } : result;
    const [completed] = await this.db.update(mcpWriteOperations).set({
      status: "completed", result: persistedResult, updatedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
    }).where(and(
      eq(mcpWriteOperations.workspaceId, context.workspaceId), eq(mcpWriteOperations.clientId, context.clientId),
      eq(mcpWriteOperations.tool, command.operation), eq(mcpWriteOperations.requestKey, command.requestKey),
      eq(mcpWriteOperations.status, "running"), eq(mcpWriteOperations.leaseOwner, this.leaseOwner),
    )).returning({ id: mcpWriteOperations.id });
    if (!completed) {
      await this.setAuditOutcome(audit?.id, "failed");
      throw new Error("MCP_WRITE_LEASE_LOST");
    }
    await this.setAuditOutcome(audit?.id, "accepted");
    return persistedResult;
  }

  private normalizeAuditOutcome(value: string): AuditOutcome {
    switch (value) {
      case "accepted": return "accepted";
      case "replay":
      case "replayed": return "replayed";
      case "stale": return "stale";
      case "in_progress": return "in_progress";
      case "failed": return "failed";
      default: return "denied";
    }
  }

  private outcomeForError(error: unknown): AuditOutcome {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("VERSION_CONFLICT") || code.includes("STALE")) return "stale";
    if (code === "MCP_WRITE_IN_PROGRESS") return "in_progress";
    if (code.includes("IDEMPOTENCY_CONFLICT")) return "denied";
    return "failed";
  }

  private async setAuditOutcome(id: string | undefined, outcome: AuditOutcome): Promise<void> {
    if (!id) return;
    try {
      await this.db.update(mcpOauthAuditEvents).set({ outcome }).where(eq(mcpOauthAuditEvents.id, id));
    } catch {
      // Audit updates must not turn a completed internal mutation into an unknown result.
    }
  }
}

/** Infrastructure composition for MCP writes; the public capability port stays
 * application-owned while the transaction type remains inside infrastructure.
 */
export function createPostgresAtomicMcpWriteCapabilities(
  db: Database,
  effect: <Name extends McpWriteCommand["operation"]>(
    tx: PostgresMcpWriteTransaction,
    context: McpExecutionContext,
    command: McpWriteCommand<Name>,
    correlationId: string,
  ) => Promise<McpWriteResult>,
): McpWriteCapabilities {
  const ledger = new PostgresMcpWriteLedger(db);
  return Object.freeze({
    execute: <Name extends McpWriteCommand["operation"]>(context: McpExecutionContext, command: McpWriteCommand<Name>) =>
      ledger.runAtomic(context, command, (tx, correlationId) => effect(tx, context, command, correlationId)),
    recordAudit: (context: McpExecutionContext, tool: McpWriteCommand["operation"], outcome: string) => ledger.recordAudit(context, tool, outcome),
  });
}

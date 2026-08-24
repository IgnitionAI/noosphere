import { and, eq, inArray } from "drizzle-orm";
import { CONVERSATION_COMMAND_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  automatedReplies,
  conversationCommands,
  conversations,
  jobs,
} from "@outbound/infrastructure/database/schema";

export class PostgresConversationCommandRepository {
  constructor(private readonly database: Database) {}

  async create(input: {
    workspaceId: string;
    conversationId: string;
    requestedBy: string;
    mode: "manual" | "setter";
    executionMode?: "live" | "dry_run";
    body: string | null;
    idempotencyKey?: string;
    now: Date;
  }) {
    const executionMode = input.executionMode ?? "live";
    if (input.mode === "manual" && executionMode === "dry_run") {
      throw new Error("MANUAL_CONVERSATION_COMMAND_DRY_RUN_INVALID");
    }
    return this.database.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, input.workspaceId),
            eq(conversations.id, input.conversationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      const commandId = crypto.randomUUID();
      const idempotencyKey = input.idempotencyKey
        ?? `${input.conversationId}:${input.mode}:${executionMode}:${commandId}`;
      const [existing] = await tx
        .select()
        .from(conversationCommands)
        .where(and(
          eq(conversationCommands.workspaceId, input.workspaceId),
          eq(conversationCommands.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (existing) {
        const sameCommand = existing.conversationId === input.conversationId
          && existing.mode === input.mode
          && existing.executionMode === executionMode
          && (existing.requestedBody ?? null) === (input.mode === "manual" ? input.body : null);
        if (!sameCommand) throw new Error("CONVERSATION_COMMAND_IDEMPOTENCY_CONFLICT");
        return existing;
      }
      if (input.mode === "manual") {
        await tx.update(conversations).set({ automationMode: "human", updatedAt: input.now }).where(and(
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.id, input.conversationId),
        ));
        await tx.update(automatedReplies).set({
          status: "cancelled",
          errorCode: "HUMAN_ACTIVITY_DETECTED",
          errorMessage: "Une réponse manuelle suspend le Setter sur ce thread.",
          updatedAt: input.now,
        }).where(and(
          eq(automatedReplies.workspaceId, input.workspaceId),
          eq(automatedReplies.conversationId, input.conversationId),
          inArray(automatedReplies.status, ["scheduled", "sending"]),
        ));
      }
      const [pending] = await tx
        .select({ id: conversationCommands.id })
        .from(conversationCommands)
        .where(
          and(
            eq(conversationCommands.workspaceId, input.workspaceId),
            eq(conversationCommands.conversationId, input.conversationId),
            inArray(conversationCommands.status, ["scheduled", "sending"]),
          ),
        )
        .limit(1);
      if (pending) throw new Error("CONVERSATION_COMMAND_ALREADY_PENDING");
      const [created] = await tx.insert(conversationCommands).values({
        id: commandId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        requestedBy: input.requestedBy,
        mode: input.mode,
        executionMode,
        requestedBody: input.mode === "manual" ? input.body : null,
        status: "scheduled",
        idempotencyKey,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning();
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        type: CONVERSATION_COMMAND_JOB_TYPE,
        payload: { workspaceId: input.workspaceId, commandId },
        idempotencyKey: `${idempotencyKey}:execute:v1`,
        correlationId: `conversation:${input.conversationId}`,
        maxAttempts: 3,
        availableAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return created!;
    });
  }

  async setAutomationMode(input: {
    workspaceId: string;
    conversationId: string;
    mode: "setter" | "human" | "disabled";
    now: Date;
  }) {
    return this.database.transaction(async (tx) => {
      const [conversation] = await tx.select({
        id: conversations.id,
        campaignId: conversations.campaignId,
      }).from(conversations).where(and(
        eq(conversations.workspaceId, input.workspaceId),
        eq(conversations.id, input.conversationId),
      )).limit(1).for("update");
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      if (input.mode === "setter" && !conversation.campaignId) {
        throw new Error("OUTSIDE_CAMPAIGN_SETTER_FORBIDDEN");
      }
      const [updated] = await tx.update(conversations).set({
        automationMode: input.mode,
        updatedAt: input.now,
      }).where(and(
        eq(conversations.workspaceId, input.workspaceId),
        eq(conversations.id, input.conversationId),
      )).returning({
        id: conversations.id,
        campaignId: conversations.campaignId,
        automationMode: conversations.automationMode,
      });
      if (input.mode !== "setter") {
        await tx.update(automatedReplies).set({
          status: "cancelled",
          errorCode: input.mode === "human" ? "HUMAN_TAKEOVER" : "CONVERSATION_AUTOMATION_DISABLED",
          errorMessage: input.mode === "human"
            ? "Une personne reprend la conversation."
            : "L’automatisation est désactivée sur ce thread.",
          updatedAt: input.now,
        }).where(and(
          eq(automatedReplies.workspaceId, input.workspaceId),
          eq(automatedReplies.conversationId, input.conversationId),
          inArray(automatedReplies.status, ["scheduled", "sending"]),
        ));
      }
      return updated!;
    });
  }
}

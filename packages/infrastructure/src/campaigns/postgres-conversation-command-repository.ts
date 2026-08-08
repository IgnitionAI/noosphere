import { and, eq, inArray } from "drizzle-orm";
import { CONVERSATION_COMMAND_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { Database } from "@outbound/infrastructure/database/client";
import {
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
    body: string | null;
    idempotencyKey?: string;
    now: Date;
  }) {
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
      const commandId = crypto.randomUUID();
      const idempotencyKey = input.idempotencyKey
        ?? `${input.conversationId}:${input.mode}:${commandId}`;
      const [created] = await tx.insert(conversationCommands).values({
        id: commandId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        requestedBy: input.requestedBy,
        mode: input.mode,
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
}

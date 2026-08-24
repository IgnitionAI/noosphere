export interface ConversationDraftImprovement {
  readonly body: string;
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly memorySnapshotId?: string | null;
    readonly memorySnapshotVersion?: number | null;
    readonly memoryReceiptId?: string | null;
    readonly memoryWatermark?: number | null;
    readonly memoryMode?: "shadow" | "active" | "unavailable";
  };
}

export interface ConversationDraftImprover {
  improve(input: {
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly draft: string;
  }): Promise<ConversationDraftImprovement>;
}

export class ConversationDraftNotFoundError extends Error {
  constructor() {
    super("CONVERSATION_NOT_FOUND");
  }
}

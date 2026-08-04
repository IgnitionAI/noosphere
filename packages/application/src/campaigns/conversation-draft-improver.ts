export interface ConversationDraftImprovement {
  readonly body: string;
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
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

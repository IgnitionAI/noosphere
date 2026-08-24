export type AttentionSeverity = "info" | "warning" | "critical";

export const noosphereLenses = ["inbound", "symbiosis", "outbound"] as const;
export type NoosphereLens = (typeof noosphereLenses)[number];

export const activityInteractionTypes = ["reply", "comment", "reaction", "mention"] as const;
export type ActivityInteractionType = (typeof activityInteractionTypes)[number];

export type EngineOperationalStatus = "not_configured" | "idle" | "running" | "degraded" | "paused";

export interface EngineOperationalState {
  readonly status: EngineOperationalStatus;
  readonly label: string;
  readonly summary: string;
  readonly lastActivityAt: Date | null;
  readonly nextAction: { readonly label: string; readonly href: string } | null;
}

export interface NextOutcome {
  readonly id: string;
  readonly type: "publication" | "research" | "conversation" | "call";
  readonly source: "inbound" | "outbound" | "mixed" | "unknown";
  readonly label: string;
  readonly detail: string;
  readonly expectedAt: Date | null;
  readonly href: string;
}

export interface AttentionItem {
  readonly id: string;
  readonly type: "account" | "job" | "campaign" | "decision" | "conversation";
  readonly severity: AttentionSeverity;
  readonly message: string;
  readonly resourceId: string | null;
  readonly resourceHref: string | null;
  readonly ageSeconds: number;
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

export interface WorkspaceOperationalSummary {
  readonly asOf: Date;
  readonly counts: {
    readonly activeCampaigns: number;
    readonly prospects: number;
    readonly contactedProspects: number;
    readonly publishedContents: number;
    readonly openConversations: number;
    readonly openOpportunities: number;
    readonly bookedCalls: number;
    readonly attention: number;
  };
  readonly attention: readonly AttentionItem[];
  readonly jobs: {
    readonly active: number;
    readonly failed: number;
    readonly running: readonly { readonly id: string; readonly type: string; readonly status: string; readonly updatedAt: Date }[];
  };
  readonly nextAutomaticResearch: Date | null;
  readonly accountHealth: {
    readonly connected: number;
    readonly degraded: number;
    readonly disconnected: number;
    readonly activeAlerts: number;
  };
  /** Compatibility fields above remain available for one release. */
  readonly engines: {
    readonly inbound: EngineOperationalState;
    readonly outbound: EngineOperationalState;
  };
  readonly nextOutcomes: readonly NextOutcome[];
  readonly attentionPagination: { readonly nextCursor: string | null };
}

export type ActivityItemKind = "campaign" | "job" | "conversation" | "call" | "publication" | "signal";

export interface ActivityItem {
  readonly id: string;
  readonly kind: ActivityItemKind;
  readonly source: "inbound" | "outbound" | "mixed" | "unknown";
  readonly status: "pending" | "running" | "completed" | "attention";
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: Date;
  readonly href: string;
  readonly correlationId: string | null;
}

export interface ActivityWorkspacePage {
  readonly lens: NoosphereLens;
  readonly asOf: Date;
  readonly state: "not_configured" | "idle" | "active" | "attention";
  readonly quality: "fresh" | "partial" | "stale";
  readonly headline: string;
  readonly counters: readonly { readonly key: string; readonly label: string; readonly value: number }[];
  readonly items: readonly ActivityItem[];
  readonly pagination: { readonly nextCursor: string | null };
}

export type SetupReadinessState = "ready" | "optional" | "attention" | "missing";

export interface SetupReadinessItem {
  readonly key: "product" | "icp" | "accounts" | "automation" | "calendar" | "knowledge";
  readonly label: string;
  readonly state: SetupReadinessState;
  readonly reason: string;
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly requiredForLaunch: boolean;
}

export interface SetupReadinessView {
  readonly ready: boolean;
  readonly asOf: Date;
  readonly items: readonly SetupReadinessItem[];
}

export interface CampaignWorkspaceView {
  readonly campaign: unknown;
  readonly autopilot: unknown;
  readonly engagement: unknown;
  readonly population: { readonly total: number; readonly eligible: number; readonly contacted: number; readonly replies: number };
  readonly nextAction: { readonly label: string; readonly href: string } | null;
  readonly timeline: readonly { readonly key: string; readonly label: string; readonly status: "done" | "active" | "pending" | "attention" }[];
}

export interface ConversationWorkspaceView {
  readonly id: string;
  readonly kind: "message_thread" | "social_thread";
  readonly source: "inbound" | "outbound" | "mixed" | "unknown";
  readonly contactId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly connectedAccountId: string | null;
  readonly accountName: string | null;
  readonly channel: "linkedin" | "email" | "whatsapp";
  readonly origin: "campaign" | "outside_campaign";
  readonly automationMode: "setter" | "human" | "disabled";
  readonly subject: string | null;
  readonly status: string;
  readonly unreadCount: number;
  readonly socialEventCount: number;
  readonly lastMessage: { readonly body: string; readonly direction: string; readonly at: Date } | null;
  readonly lastMessageAt: Date;
}

export interface ConversationWorkspaceDetail extends ConversationWorkspaceView {
  readonly messages: readonly {
    readonly id: string;
    readonly providerMessageId: string;
    readonly direction: "inbound" | "outbound";
    readonly senderType: string;
    readonly body: string;
    readonly at: Date;
  }[];
  readonly socialEvents: readonly {
    readonly id: string;
    readonly type: "comment" | "reply" | "mention";
    readonly actorName: string | null;
    readonly body: string;
    readonly at: Date;
    readonly postText: string;
    readonly postUrl: string | null;
    readonly proofHref: string;
  }[];
  readonly decision: {
    readonly intent: string;
    readonly confidence: number;
    readonly action: string;
    readonly rationale: string;
    readonly createdAt: Date;
  } | null;
  readonly latestCommand: {
    readonly id: string;
    readonly mode: "manual" | "setter";
    readonly executionMode: "live" | "dry_run";
    readonly status: string;
    readonly generatedBody: string | null;
    readonly generationMetadata: Readonly<Record<string, unknown>>;
    readonly errorMessage: string | null;
    readonly createdAt: Date;
  } | null;
}

export interface ConversationWorkspacePage {
  readonly data: readonly ConversationWorkspaceView[];
  readonly pagination: { readonly page: number; readonly pageSize: number; readonly total: number; readonly hasNext: boolean };
  readonly sync: {
    readonly totalAccounts: number;
    readonly readyAccounts: number;
    readonly backfillingAccounts: number;
    readonly errorAccounts: number;
    readonly lastSuccessAt: Date | null;
  };
}

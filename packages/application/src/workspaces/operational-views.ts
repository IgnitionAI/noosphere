export type AttentionSeverity = "info" | "warning" | "critical";

export interface AttentionItem {
  readonly id: string;
  readonly type: "account" | "job" | "campaign" | "decision" | "conversation";
  readonly severity: AttentionSeverity;
  readonly message: string;
  readonly resourceId: string | null;
  readonly resourceHref: string | null;
  readonly ageSeconds: number;
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly createdAt: Date;
}

export interface WorkspaceOperationalSummary {
  readonly asOf: Date;
  readonly counts: {
    readonly activeCampaigns: number;
    readonly prospects: number;
    readonly openConversations: number;
    readonly openOpportunities: number;
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
    readonly status: string;
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

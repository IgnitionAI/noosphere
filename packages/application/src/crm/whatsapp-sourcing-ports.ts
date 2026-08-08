export type SourcingBudgetResource = "page" | "whatsapp_verification";

export interface DailySourcingBudget {
  reserve(input: {
    readonly cycleId: string | null;
    readonly resource: SourcingBudgetResource;
    readonly amount: number;
    readonly now: Date;
  }): Promise<{
    readonly accepted: boolean;
    readonly remaining: number | null;
    readonly deadlineAt: Date | null;
  }>;
}

export interface WhatsappReachabilityResult {
  readonly status: "verified" | "not_registered" | "unknown";
  readonly providerAccountId: string | null;
  readonly checkedAt: Date;
  readonly expiresAt: Date;
  readonly source: "live" | "cache";
  readonly errorCode: string | null;
}

export interface WhatsappReachabilityResolver {
  resolve(input: {
    readonly workspaceId: string;
    readonly phone: string;
    readonly e164: string;
    readonly sourcingCycleId: string | null;
    readonly now: Date;
  }): Promise<WhatsappReachabilityResult>;
}

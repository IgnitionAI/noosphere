import type { AIPolicyRules, MessagingStrategyRules } from "@outbound/domain/gtm/messaging-strategy";

export interface MessagingStrategyView {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly draftRules: MessagingStrategyRules;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly versions?: readonly MessagingStrategyVersionView[];
}

export interface MessagingStrategyVersionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyId: string;
  readonly version: number;
  readonly rules: MessagingStrategyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
  readonly createdAt: Date;
}

export interface AIPolicyView {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly draftRules: AIPolicyRules;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly versions?: readonly AIPolicyVersionView[];
}

export interface AIPolicyVersionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyId: string;
  readonly version: number;
  readonly rules: AIPolicyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
  readonly createdAt: Date;
}

export interface MessagingStrategyRepository {
  listStrategies(workspaceId: string): Promise<readonly MessagingStrategyView[]>;
  getStrategy(input: { workspaceId: string; strategyId: string }): Promise<MessagingStrategyView | null>;
  createStrategy(input: { id: string; workspaceId: string; name: string; draftRules: MessagingStrategyRules; createdBy: string }): Promise<MessagingStrategyView>;
  updateStrategy(input: { workspaceId: string; strategyId: string; name?: string; draftRules?: MessagingStrategyRules }): Promise<MessagingStrategyView>;
  publishStrategy(input: { id: string; workspaceId: string; strategyId: string; userId: string; publishedAt: Date }): Promise<MessagingStrategyVersionView>;

  listPolicies(workspaceId: string): Promise<readonly AIPolicyView[]>;
  getPolicy(input: { workspaceId: string; policyId: string }): Promise<AIPolicyView | null>;
  createPolicy(input: { id: string; workspaceId: string; name: string; draftRules: AIPolicyRules; createdBy: string }): Promise<AIPolicyView>;
  updatePolicy(input: { workspaceId: string; policyId: string; name?: string; draftRules?: AIPolicyRules }): Promise<AIPolicyView>;
  publishPolicy(input: { id: string; workspaceId: string; policyId: string; userId: string; publishedAt: Date }): Promise<AIPolicyVersionView>;
}

import type {
  AIPolicyRules,
  MessagingStrategyRules,
} from "@outbound/domain/gtm/messaging-strategy";
import type { IdGenerator } from "@outbound/application/shared/ports";
import type { MessagingStrategyRepository } from "@outbound/application/gtm/messaging-strategy-ports";

export class MessagingStrategyApplication {
  constructor(
    private readonly repository: MessagingStrategyRepository,
    private readonly ids: IdGenerator,
  ) {}

  listStrategies(workspaceId: string) { return this.repository.listStrategies(workspaceId); }
  getStrategy(input: { workspaceId: string; strategyId: string }) { return this.repository.getStrategy(input); }
  createStrategy(input: { workspaceId: string; name: string; draftRules: MessagingStrategyRules; userId: string }) {
    return this.repository.createStrategy({ ...input, id: this.ids.generate(), createdBy: input.userId });
  }
  updateStrategy(input: { workspaceId: string; strategyId: string; name?: string; draftRules?: MessagingStrategyRules }) {
    return this.repository.updateStrategy(input);
  }
  publishStrategy(input: { workspaceId: string; strategyId: string; userId: string; publishedAt: Date }) {
    return this.repository.publishStrategy({ ...input, id: this.ids.generate() });
  }

  listPolicies(workspaceId: string) { return this.repository.listPolicies(workspaceId); }
  getPolicy(input: { workspaceId: string; policyId: string }) { return this.repository.getPolicy(input); }
  createPolicy(input: { workspaceId: string; name: string; draftRules: AIPolicyRules; userId: string }) {
    return this.repository.createPolicy({ ...input, id: this.ids.generate(), createdBy: input.userId });
  }
  updatePolicy(input: { workspaceId: string; policyId: string; name?: string; draftRules?: AIPolicyRules }) {
    return this.repository.updatePolicy(input);
  }
  publishPolicy(input: { workspaceId: string; policyId: string; userId: string; publishedAt: Date }) {
    return this.repository.publishPolicy({ ...input, id: this.ids.generate() });
  }
}

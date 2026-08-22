import type {
  AiCapability,
  ModelRoute,
} from "@outbound/application/ai/model-gateway";

export interface WorkspaceAiModelPolicy {
  readonly researchModels: readonly string[];
  readonly synthesisModels: readonly string[];
  readonly defaultRoutes?: readonly ModelRoute[];
  readonly capabilityRoutes?: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
}

export interface WorkspaceAiSettingsView extends WorkspaceAiModelPolicy {
  readonly defaultRoutes: readonly ModelRoute[];
  readonly capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
  readonly source: "workspace" | "environment";
  readonly updatedAt: Date | null;
}

export interface WorkspaceAiSettingsRepository {
  find(workspaceId: string): Promise<WorkspaceAiModelPolicy & { updatedAt: Date } | null>;
  upsert(input: {
    workspaceId: string;
    userId: string;
    researchModels: readonly string[];
    synthesisModels: readonly string[];
    defaultRoutes: readonly ModelRoute[];
    capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
    now: Date;
  }): Promise<WorkspaceAiModelPolicy & { updatedAt: Date }>;
}

export interface WorkspaceAiModelPolicyReader {
  find(workspaceId: string): Promise<WorkspaceAiModelPolicy | null>;
}

export interface WorkspaceAiRoutingPolicyReader {
  find(workspaceId: string): Promise<WorkspaceAiModelPolicy | null>;
}

export class WorkspaceAiSettingsApplication {
  constructor(
    private readonly repository: WorkspaceAiSettingsRepository,
    private readonly defaults: WorkspaceAiModelPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(workspaceId: string): Promise<WorkspaceAiSettingsView> {
    const settings = await this.repository.find(workspaceId);
    return normalizePolicy(settings ?? this.defaults, settings ? "workspace" : "environment", settings?.updatedAt ?? null);
  }

  async update(input: {
    workspaceId: string;
    userId: string;
    defaultRoutes: readonly ModelRoute[];
    capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
  }): Promise<WorkspaceAiSettingsView> {
    const current = await this.get(input.workspaceId);
    const settings = await this.repository.upsert({
      ...input,
      researchModels: current.researchModels,
      synthesisModels: current.synthesisModels,
      now: this.now(),
    });
    return normalizePolicy(settings, "workspace", settings.updatedAt);
  }
}

export function routesForCapability(
  policy: WorkspaceAiModelPolicy | null | undefined,
  capability: AiCapability,
  fallback: readonly ModelRoute[],
): readonly ModelRoute[] {
  const override = policy?.capabilityRoutes?.[capability];
  if (override && override.length > 0) return override;
  if (policy?.defaultRoutes && policy.defaultRoutes.length > 0) return policy.defaultRoutes;
  return fallback;
}

function normalizePolicy(
  policy: WorkspaceAiModelPolicy,
  source: WorkspaceAiSettingsView["source"],
  updatedAt: Date | null,
): WorkspaceAiSettingsView {
  return {
    researchModels: policy.researchModels,
    synthesisModels: policy.synthesisModels,
    defaultRoutes: policy.defaultRoutes?.length
      ? policy.defaultRoutes
      : [{ provider: "kimi-code", model: policy.researchModels[0] ?? "k3", reasoningEffort: "max" }],
    capabilityRoutes: policy.capabilityRoutes ?? {},
    source,
    updatedAt,
  };
}

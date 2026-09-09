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
  readonly source: "workspace" | "environment" | "instance";
  readonly effectiveDefaultRoutes?: readonly ModelRoute[];
  readonly availableModels?: readonly AuthorizedWorkspaceModel[];
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

export interface AuthorizedWorkspaceModel extends ModelRoute {
  readonly connectionName: string;
}

export interface WorkspaceInstanceAiModels {
  getDefault(): Promise<ModelRoute | null>;
  listAllowed(): Promise<readonly AuthorizedWorkspaceModel[]>;
}

export class WorkspaceModelNotAuthorizedError extends Error {
  readonly code = "AI_MODEL_NOT_AUTHORIZED";
  constructor() { super("Select a model authorized by the instance administrator"); }
}

export class WorkspaceAiSettingsApplication {
  constructor(
    private readonly repository: WorkspaceAiSettingsRepository,
    private readonly defaults: WorkspaceAiModelPolicy,
    private readonly now: () => Date = () => new Date(),
    private readonly instance?: WorkspaceInstanceAiModels,
  ) {}

  async get(workspaceId: string): Promise<WorkspaceAiSettingsView> {
    const settings = await this.repository.find(workspaceId);
    if (this.instance) {
      const [route, availableModels] = await Promise.all([this.instance.getDefault(), this.instance.listAllowed()]);
      const resolve = (routes: readonly ModelRoute[]) => routes.map((selected) => {
        const current = availableModels.find((model) => model.connectionId === selected.connectionId && model.provider === selected.provider && model.model === selected.model);
        return current ? { ...selected, reasoningEffort: current.reasoningEffort } : selected;
      });
      const defaultRoutes = resolve(settings?.defaultRoutes ?? []);
      return {
        researchModels: settings?.researchModels ?? this.defaults.researchModels,
        synthesisModels: settings?.synthesisModels ?? this.defaults.synthesisModels,
        defaultRoutes,
        capabilityRoutes: Object.fromEntries(Object.entries(settings?.capabilityRoutes ?? {}).map(([capability, routes]) => [capability, resolve(routes)])),
        effectiveDefaultRoutes: defaultRoutes.length ? defaultRoutes : route ? [route] : this.defaults.defaultRoutes ?? [],
        availableModels,
        source: defaultRoutes.length ? "workspace" : route ? "instance" : "environment",
        updatedAt: settings?.updatedAt ?? null,
      };
    }
    return normalizePolicy(settings ?? this.defaults, settings ? "workspace" : "environment", settings?.updatedAt ?? null);
  }

  async update(input: {
    workspaceId: string;
    userId: string;
    defaultRoutes: readonly ModelRoute[];
    capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
  }): Promise<WorkspaceAiSettingsView> {
    if (this.instance) {
      const allowed = await this.instance.listAllowed();
      for (const route of [...input.defaultRoutes, ...Object.values(input.capabilityRoutes).flat()]) {
        if (!route.connectionId || !allowed.some((candidate) =>
          candidate.connectionId === route.connectionId && candidate.provider === route.provider &&
          candidate.model === route.model && candidate.reasoningEffort === route.reasoningEffort)) {
          throw new WorkspaceModelNotAuthorizedError();
        }
      }
    }
    const current = await this.get(input.workspaceId);
    const settings = await this.repository.upsert({
      ...input,
      researchModels: current.researchModels,
      synthesisModels: current.synthesisModels,
      now: this.now(),
    });
    return this.instance ? this.get(input.workspaceId) : normalizePolicy(settings, "workspace", settings.updatedAt);
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

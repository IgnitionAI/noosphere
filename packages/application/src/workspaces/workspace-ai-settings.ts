export interface WorkspaceAiModelPolicy {
  readonly researchModels: readonly string[];
  readonly synthesisModels: readonly string[];
}

export interface WorkspaceAiSettingsView extends WorkspaceAiModelPolicy {
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
    now: Date;
  }): Promise<WorkspaceAiModelPolicy & { updatedAt: Date }>;
}

export interface WorkspaceAiModelPolicyReader {
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
    return settings
      ? { ...settings, source: "workspace" }
      : { ...this.defaults, source: "environment", updatedAt: null };
  }

  async update(input: {
    workspaceId: string;
    userId: string;
    researchModels: readonly string[];
    synthesisModels: readonly string[];
  }): Promise<WorkspaceAiSettingsView> {
    const settings = await this.repository.upsert({ ...input, now: this.now() });
    return { ...settings, source: "workspace" };
  }
}

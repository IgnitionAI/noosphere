export interface AiRunRecorder {
  record(input: {
    readonly workspaceId: string;
    readonly purpose: string;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly promptVersionId?: string;
    readonly aiConfigurationId?: string;
    readonly shadow: boolean;
    readonly inputHash: string;
    readonly output: unknown;
    readonly status: "completed" | "failed";
    readonly cost: number | null;
    readonly latencyMs: number;
  }): Promise<{ id: string }>;
}

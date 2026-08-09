export interface ActiveAiConfiguration {
  readonly configurationId: string;
  readonly capability: "icp_research" | "message_generation" | "setter";
  readonly provider: "kimi-code";
  readonly model: string;
  readonly promptVersionId: string;
  readonly promptVersion: number;
  readonly promptContent: string;
}

export interface ActiveAiConfigurationReader {
  find(workspaceId: string, capability: ActiveAiConfiguration["capability"]): Promise<ActiveAiConfiguration | null>;
}

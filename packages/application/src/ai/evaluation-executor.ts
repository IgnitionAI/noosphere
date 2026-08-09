import type { EvaluationOutput } from "@outbound/domain/ai/evaluation";

export interface EvaluationExecution {
  readonly output: EvaluationOutput;
  readonly cost: number | null;
  readonly latencyMs: number;
}

export interface EvaluationExecutor {
  execute(input: {
    readonly workspaceId: string;
    readonly capability: "icp_research" | "message_generation" | "setter";
    readonly provider: string;
    readonly model: string;
    readonly prompt: string;
    readonly caseInput: unknown;
  }): Promise<EvaluationExecution>;
}

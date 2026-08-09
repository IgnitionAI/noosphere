import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { EvaluationExecutor } from "@outbound/application/ai/evaluation-executor";
import type { EvaluationOutput } from "@outbound/domain/ai/evaluation";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const evaluationOutputSchema = z.object({
  classification: z.string().trim().max(200).optional(),
  ctaPresent: z.boolean().optional(),
  knowledgeClaimIds: z.array(z.string().uuid()).max(50).default([]),
  content: z.string().max(50_000).optional(),
  qualitative: z.object({
    messageQuality: z.number().min(0).max(1).optional(),
    explanation: z.string().max(2_000).optional(),
  }).optional(),
}).passthrough();

export class LangChainEvaluationExecutor implements EvaluationExecutor {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;
  readonly #inputRate: number | null;
  readonly #outputRate: number | null;

  constructor(environment: Readonly<Record<string, string | undefined>> = process.env) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
    this.#inputRate = optionalNonNegativeNumber(environment.KIMI_EVALUATION_INPUT_USD_PER_MILLION);
    this.#outputRate = optionalNonNegativeNumber(environment.KIMI_EVALUATION_OUTPUT_USD_PER_MILLION);
  }

  async execute(input: Parameters<EvaluationExecutor["execute"]>[0]) {
    if (input.provider !== this.#configuration.provider || input.provider !== "kimi-code") {
      throw new Error("EVALUATION_PROVIDER_NOT_CONFIGURED");
    }
    const startedAt = performance.now();
    const model = new ChatOpenAI(buildChatModelFields(this.#configuration, input.model, "low"));
    const structured = model.withStructuredOutput(evaluationOutputSchema, { method: "functionCalling", includeRaw: true });
    const response = await structured.invoke([
      {
        role: "system",
        content: [
          input.prompt,
          "You are running in an offline evaluation harness.",
          "Never send a message, call an external tool, mutate business state or claim that you did.",
          "Return only the requested evaluated output. Do not score your own response.",
          "knowledgeClaimIds must contain only identifiers explicitly present in the case input; otherwise return an empty array.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(input.caseInput) },
    ]);
    const usage = (response.raw as typeof response.raw & { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
    return {
      output: response.parsed as EvaluationOutput,
      cost: estimateCost(usage?.input_tokens, usage?.output_tokens, this.#inputRate, this.#outputRate),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}

function optionalNonNegativeNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("KIMI evaluation token rates must be non-negative numbers");
  return parsed;
}

function estimateCost(inputTokens: number | undefined, outputTokens: number | undefined, inputRate: number | null, outputRate: number | null) {
  if (inputRate === null || outputRate === null || inputTokens === undefined || outputTokens === undefined) return null;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

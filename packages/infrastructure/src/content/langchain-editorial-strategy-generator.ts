import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type {
  EditorialStrategyGenerator,
  EditorialStrategyGrounding,
} from "@outbound/application/content/editorial-strategy";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { ModelGatewayError, type ModelRoute } from "@outbound/application/ai/model-gateway";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

type StrategyModelInvoker = (input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly grounding: EditorialStrategyGrounding;
  readonly attempt: number;
  readonly validationIssues: readonly string[];
}) => Promise<unknown>;

const promptVersion = "noosphere-editorial-strategy-v2";
const maxStructuredOutputAttempts = 2;

export class LangChainEditorialStrategyGenerator implements EditorialStrategyGenerator {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: StrategyModelInvoker = invokeStrategyModel,
    private readonly routedModel?: WorkspaceStructuredModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async generate(input: Parameters<EditorialStrategyGenerator["generate"]>[0]) {
    const startedAt = performance.now();
    const workspacePolicy = this.routedModel ? null : await this.modelPolicyReader?.find(input.workspaceId);
    let model = workspacePolicy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
    let provider: string = this.#configuration.provider;
    const fields = buildChatModelFields(this.#configuration, model, "max");
    const inputHash = new Bun.CryptoHasher("sha256").update(JSON.stringify(input.grounding)).digest("hex");
    let validationIssues: readonly string[] = [];

    for (let attempt = 1; attempt <= maxStructuredOutputAttempts; attempt += 1) {
      let rawOutput: unknown;
      try {
        if (this.routedModel) {
          const spec = strategyModelSpec(input.grounding, attempt, validationIssues);
          const result = await this.routedModel.invoke({
            workspaceId: input.workspaceId,
            capability: "content_strategy",
            requestKey: `content-strategy:${inputHash}:${attempt}`,
            fallbackRoutes: this.fallbackRoutes(),
            systemPrompt: spec.system,
            payload: spec.payload,
            outputName: "submit_editorial_strategy",
            outputDescription: "Submit the complete grounded LinkedIn editorial strategy.",
            schema: editorialStrategySnapshotSchema,
          });
          rawOutput = result.output;
          provider = result.metadata.provider;
          model = result.metadata.model;
        } else {
          rawOutput = await this.invokeModel({ fields, grounding: input.grounding, attempt, validationIssues });
        }
      } catch (error) {
        if (!isRecoverableStructuredOutputError(error)) throw error;
        validationIssues = [error instanceof Error ? error.message : "EDITORIAL_STRATEGY_TOOL_CALL_MISSING"];
        if (attempt < maxStructuredOutputAttempts) continue;
        await this.recordFailure({ workspaceId: input.workspaceId, provider, model, inputHash, startedAt, validationIssues });
        throw new Error("EDITORIAL_STRATEGY_OUTPUT_INVALID");
      }

      const parsed = editorialStrategySnapshotSchema.safeParse(rawOutput);
      if (!parsed.success) {
        validationIssues = parsed.error.issues.map((issue) => formatValidationIssue(issue));
        if (attempt < maxStructuredOutputAttempts) continue;
        await this.recordFailure({ workspaceId: input.workspaceId, provider, model, inputHash, startedAt, validationIssues });
        throw new Error("EDITORIAL_STRATEGY_OUTPUT_INVALID");
      }

      const aiRun = await this.aiRunRecorder?.record({
        workspaceId: input.workspaceId,
        purpose: "content_strategy",
        provider,
        model,
        promptVersion,
        shadow: false,
        inputHash,
        output: parsed.data,
        status: "completed",
        cost: null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      return {
        snapshot: parsed.data,
        metadata: {
          provider: this.#configuration.provider,
          model,
          promptVersion,
          aiRunId: aiRun?.id ?? null,
        },
      };
    }

    throw new Error("EDITORIAL_STRATEGY_OUTPUT_INVALID");
  }

  private fallbackRoutes(): readonly ModelRoute[] {
    return this.#configuration.researchModels.map((model) => ({
      provider: this.#configuration.provider === "openai" ? "openai-api" as const : "kimi-code" as const,
      model,
      reasoningEffort: "max" as const,
    }));
  }

  private async recordFailure(input: {
    readonly workspaceId: string;
    readonly provider: string;
    readonly model: string;
    readonly inputHash: string;
    readonly startedAt: number;
    readonly validationIssues: readonly string[];
  }) {
    await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "content_strategy",
      provider: input.provider,
      model: input.model,
      promptVersion,
      shadow: false,
      inputHash: input.inputHash,
      output: { errorCode: "EDITORIAL_STRATEGY_OUTPUT_INVALID", validationIssues: input.validationIssues },
      status: "failed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - input.startedAt)),
    });
  }
}

async function invokeStrategyModel(input: Parameters<StrategyModelInvoker>[0]) {
  const submit = tool(async (value) => value, {
    name: "submit_editorial_strategy",
    description: "Submit the complete grounded LinkedIn editorial strategy.",
    schema: editorialStrategySnapshotSchema,
  });
  const spec = strategyModelSpec(input.grounding, input.attempt, input.validationIssues);
  // Kimi K3 rejects a named tool choice while thinking is enabled. `auto` keeps
  // max reasoning available; completeness is enforced by the bounded parse/retry
  // loop in the generator instead of by a provider-specific request option.
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    {
      role: "system",
      content: spec.system,
    },
    {
      role: "user",
      content: JSON.stringify(spec.payload),
    },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === "submit_editorial_strategy");
  if (!call) throw new Error("EDITORIAL_STRATEGY_TOOL_CALL_MISSING");
  return call.args;
}

function strategyModelSpec(
  grounding: EditorialStrategyGrounding,
  attempt: number,
  validationIssues: readonly string[],
) {
  const authorizedClaims = grounding.offer.claims.filter((claim) =>
    claim.validationStatus === "sourced" || claim.validationStatus === "validated"
  );
  const retryInstruction = validationIssues.length > 0
    ? `Your previous structured output was rejected (${validationIssues.join(", ")}). Return a complete corrected object and do not omit required fields.`
    : null;
  return {
    system: [
      "You are Noosphere's principal LinkedIn editorial strategist.",
      "Derive a specific strategy only from the supplied published offer and ICP snapshots.",
      "Do not invent customer proof, market facts, performance numbers, intent or product capabilities.",
      "Only IDs listed in authorizedClaims may appear in allowedClaimIds. Hypothesis and invalidated claims are forbidden.",
      "Pillars must map a real ICP problem to the offer and name the proof type required before a factual post can be written.",
      "Voice traits must be operational. Avoid generic B2B language, empty thought leadership, manufactured urgency and interchangeable hooks.",
      "Keep each voice.traits item to 120 characters maximum and each voice.avoid item to 240 characters maximum. Use short imperatives, never paragraph-length style guides.",
      "Return 3 to 6 pillars, 2 to 8 voice traits, 1 to 12 avoid rules, and only UUIDs supplied in authorizedClaims for allowedClaimIds.",
      "Enable linkedin_text, linkedin_image and linkedin_document. The brand kit controls which formats are actually used.",
      "Cadence must be sustainable: default to three posts per week in Europe/Paris unless the inputs justify less.",
      "Return the complete structured editorial strategy.",
      retryInstruction,
      `Structured output attempt ${attempt} of ${maxStructuredOutputAttempts}.`,
    ].filter(Boolean).join("\n"),
    payload: { ...grounding, authorizedClaims },
  };
}

function isRecoverableStructuredOutputError(error: unknown): boolean {
  return (error instanceof Error && error.message === "EDITORIAL_STRATEGY_TOOL_CALL_MISSING")
    || (error instanceof ModelGatewayError && error.code === "AI_PROVIDER_OUTPUT_INVALID");
}

function formatValidationIssue(issue: { readonly path: readonly PropertyKey[]; readonly code: string; readonly message: string }): string {
  const path = issue.path.map(String).join(".") || "root";
  const message = issue.message.replace(/\s+/g, " ").slice(0, 240);
  return `${path}:${issue.code}:${message}`;
}

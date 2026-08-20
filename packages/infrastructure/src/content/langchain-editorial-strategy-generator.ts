import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type {
  EditorialStrategyGenerator,
  EditorialStrategyGrounding,
} from "@outbound/application/content/editorial-strategy";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import {
  buildChatModelFields,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

type StrategyModelInvoker = (input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly grounding: EditorialStrategyGrounding;
}) => Promise<unknown>;

export class LangChainEditorialStrategyGenerator implements EditorialStrategyGenerator {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;

  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: StrategyModelInvoker = invokeStrategyModel,
  ) {
    this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment);
  }

  async generate(input: Parameters<EditorialStrategyGenerator["generate"]>[0]) {
    const startedAt = performance.now();
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const model = workspacePolicy?.researchModels[0] ?? this.#configuration.researchModels[0]!;
    const snapshot = editorialStrategySnapshotSchema.parse(await this.invokeModel({
      fields: buildChatModelFields(this.#configuration, model, "max"),
      grounding: input.grounding,
    }));
    const promptVersion = "noosphere-editorial-strategy-v1";
    const aiRun = await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "content_strategy",
      provider: this.#configuration.provider,
      model,
      promptVersion,
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(input.grounding)).digest("hex"),
      output: snapshot,
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return {
      snapshot,
      metadata: {
        provider: this.#configuration.provider,
        model,
        promptVersion,
        aiRunId: aiRun?.id ?? null,
      },
    };
  }
}

async function invokeStrategyModel(input: Parameters<StrategyModelInvoker>[0]) {
  const submit = tool(async (value) => value, {
    name: "submit_editorial_strategy",
    description: "Submit the complete grounded LinkedIn editorial strategy.",
    schema: editorialStrategySnapshotSchema,
  });
  const authorizedClaims = input.grounding.offer.claims.filter((claim) =>
    claim.validationStatus === "sourced" || claim.validationStatus === "validated"
  );
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    {
      role: "system",
      content: [
        "You are Noosphere's principal LinkedIn editorial strategist.",
        "Derive a specific strategy only from the supplied published offer and ICP snapshots.",
        "Do not invent customer proof, market facts, performance numbers, intent or product capabilities.",
        "Only IDs listed in authorizedClaims may appear in allowedClaimIds. Hypothesis and invalidated claims are forbidden.",
        "Pillars must map a real ICP problem to the offer and name the proof type required before a factual post can be written.",
        "Voice traits must be operational. Avoid generic B2B language, empty thought leadership, manufactured urgency and interchangeable hooks.",
        "Use linkedin_text as the only format unless the supplied constraints explicitly prove another format is available.",
        "Cadence must be sustainable: default to three posts per week in Europe/Paris unless the inputs justify less.",
        "Call submit_editorial_strategy exactly once.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({ ...input.grounding, authorizedClaims }),
    },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === "submit_editorial_strategy");
  if (!call) throw new Error("EDITORIAL_STRATEGY_TOOL_CALL_MISSING");
  return call.args;
}

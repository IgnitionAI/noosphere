import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { ContentIdeaCandidateGenerator } from "@outbound/application/content/content-ideas";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { ModelRoute } from "@outbound/application/ai/model-gateway";
import { contentIdeaBatchSchema } from "@outbound/contracts/content";
import { buildChatModelFields, resolveResearchModelConfigurationFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import type { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

type IdeasModelInvoker = (input: {
  readonly fields: ConstructorParameters<typeof ChatOpenAI>[0];
  readonly strategy: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]["strategy"];
  readonly query: string;
  readonly evidence: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]["evidence"];
}) => Promise<unknown>;

export class LangChainContentIdeaGenerator implements ContentIdeaCandidateGenerator {
  readonly #configuration: ReturnType<typeof resolveResearchModelConfigurationFromEnvironment>;
  constructor(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly modelPolicyReader?: WorkspaceAiModelPolicyReader,
    private readonly aiRunRecorder?: AiRunRecorder,
    private readonly invokeModel: IdeasModelInvoker = invokeIdeasModel,
    private readonly routedModel?: WorkspaceStructuredModel,
  ) { this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment); }

  async generate(input: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]) {
    if (input.evidence.length === 0) return [];
    const startedAt = performance.now();
    const spec = ideaModelSpec(input.strategy, input.query, input.evidence);
    let parsed: ReturnType<typeof contentIdeaBatchSchema.parse>;
    let provider: string;
    let model: string;
    if (this.routedModel) {
      const result = await this.routedModel.invoke({
        workspaceId: input.workspaceId,
        capability: "content_idea",
        requestKey: `content-idea:${new Bun.CryptoHasher("sha256").update(JSON.stringify({ query: input.query, evidence: input.evidence.map((item) => item.contentHash) })).digest("hex")}`,
        fallbackRoutes: this.fallbackRoutes(),
        systemPrompt: spec.system,
        payload: spec.payload,
        outputName: "submit_content_ideas",
        outputDescription: "Submit grounded and deduplicable LinkedIn content ideas.",
        schema: contentIdeaBatchSchema,
      });
      parsed = result.output;
      provider = result.metadata.provider;
      model = result.metadata.model;
    } else {
      const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
      model = workspacePolicy?.synthesisModels[0] ?? this.#configuration.synthesisModels[0]!;
      provider = this.#configuration.provider;
      parsed = contentIdeaBatchSchema.parse(await this.invokeModel({
        fields: buildChatModelFields(this.#configuration, model, "low"),
        strategy: input.strategy,
        query: input.query,
        evidence: input.evidence,
      }));
    }
    await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "content_idea_discovery",
      provider,
      model,
      promptVersion: "noosphere-content-ideas-v1",
      shadow: false,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify({ query: input.query, evidence: input.evidence.map((item) => item.contentHash) })).digest("hex"),
      output: parsed,
      status: "completed",
      cost: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return parsed.ideas;
  }

  private fallbackRoutes(): readonly ModelRoute[] {
    return this.#configuration.synthesisModels.map((model) => ({
      provider: this.#configuration.provider === "openai" ? "openai-api" as const : "kimi-code" as const,
      model,
      reasoningEffort: "low" as const,
    }));
  }
}

async function invokeIdeasModel(input: Parameters<IdeasModelInvoker>[0]) {
  const submit = tool(async (value) => value, {
    name: "submit_content_ideas",
    description: "Submit grounded and deduplicable LinkedIn content ideas.",
    schema: contentIdeaBatchSchema,
  });
  const spec = ideaModelSpec(input.strategy, input.query, input.evidence);
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    { role: "system", content: spec.system },
    { role: "user", content: JSON.stringify(spec.payload) },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === "submit_content_ideas");
  if (!call) throw new Error("CONTENT_IDEA_TOOL_CALL_MISSING");
  return call.args;
}

function ideaModelSpec(
  strategy: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]["strategy"],
  query: string,
  evidence: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]["evidence"],
) {
  return {
    system: [
      "You are Noosphere's bounded LinkedIn idea researcher, not a post writer or publisher.",
      "Return at most three precise ideas for this research query.",
      "Every idea must cite one or more exact evidence keys supplied in evidence. Never invent or transform a fact beyond its excerpt.",
      "Questions and objections from real conversations are valid sources for an angle, but do not identify the person.",
      "Use the strategy audience, pillar, voice and allowed claims. Reject generic advice that could fit any company.",
      "conceptKey is a stable factual concept, not a hook, date or stylistic variation; it is used for deduplication.",
      "freshnessDays reflects how quickly the underlying source becomes stale. priority is 0 to 100.",
      "Do not create a draft, CTA, publication time or provider action.",
      "Return the complete structured content idea batch.",
    ].join("\n"),
    payload: { strategy, query, evidence },
  };
}

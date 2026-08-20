import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { ContentIdeaCandidateGenerator } from "@outbound/application/content/content-ideas";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { contentIdeaBatchSchema } from "@outbound/contracts/content";
import { buildChatModelFields, resolveResearchModelConfigurationFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";

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
  ) { this.#configuration = resolveResearchModelConfigurationFromEnvironment(environment); }

  async generate(input: Parameters<ContentIdeaCandidateGenerator["generate"]>[0]) {
    if (input.evidence.length === 0) return [];
    const startedAt = performance.now();
    const workspacePolicy = await this.modelPolicyReader?.find(input.workspaceId);
    const model = workspacePolicy?.synthesisModels[0] ?? this.#configuration.synthesisModels[0]!;
    const parsed = contentIdeaBatchSchema.parse(await this.invokeModel({
      fields: buildChatModelFields(this.#configuration, model, "low"),
      strategy: input.strategy,
      query: input.query,
      evidence: input.evidence,
    }));
    await this.aiRunRecorder?.record({
      workspaceId: input.workspaceId,
      purpose: "content_idea_discovery",
      provider: this.#configuration.provider,
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
}

async function invokeIdeasModel(input: Parameters<IdeasModelInvoker>[0]) {
  const submit = tool(async (value) => value, {
    name: "submit_content_ideas",
    description: "Submit grounded and deduplicable LinkedIn content ideas.",
    schema: contentIdeaBatchSchema,
  });
  const response = await new ChatOpenAI(input.fields).bindTools([submit], { tool_choice: "auto" }).invoke([
    {
      role: "system",
      content: [
        "You are Noosphere's bounded LinkedIn idea researcher, not a post writer or publisher.",
        "Return at most three precise ideas for this research query.",
        "Every idea must cite one or more exact evidence keys supplied in evidence. Never invent or transform a fact beyond its excerpt.",
        "Questions and objections from real conversations are valid sources for an angle, but do not identify the person.",
        "Use the strategy audience, pillar, voice and allowed claims. Reject generic advice that could fit any company.",
        "conceptKey is a stable factual concept, not a hook, date or stylistic variation; it is used for deduplication.",
        "freshnessDays reflects how quickly the underlying source becomes stale. priority is 0 to 100.",
        "Do not create a draft, CTA, publication time or provider action.",
        "Call submit_content_ideas exactly once.",
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify({ strategy: input.strategy, query: input.query, evidence: input.evidence }) },
  ]);
  const call = response.tool_calls?.find((candidate) => candidate.name === "submit_content_ideas");
  if (!call) throw new Error("CONTENT_IDEA_TOOL_CALL_MISSING");
  return call.args;
}

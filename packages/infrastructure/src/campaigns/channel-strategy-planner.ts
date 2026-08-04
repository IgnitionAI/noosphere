import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type {
  ChannelStrategy,
  ChannelStrategyPlanner,
} from "@outbound/application/campaigns/channel-assessment";
import {
  buildChatModelFields,
  readJsonFromFinalMessage,
  resolveResearchModelConfigurationFromEnvironment,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

const strategySchema = z.object({
  query: z.string().trim().min(3).max(500),
  sourceKinds: z
    .array(
      z.enum([
        "linkedin",
        "web",
        "maps",
        "official_registry",
        "professional_directory",
        "jobs",
        "news",
      ]),
    )
    .min(1)
    .max(4),
  rationale: z.string().trim().min(3).max(1_000),
  sampleSize: z.number().int().min(5).max(20),
});

const allowedSourceKinds = new Set([
  "linkedin",
  "web",
  "maps",
  "official_registry",
  "professional_directory",
  "jobs",
  "news",
]);

export class LangChainChannelStrategyPlanner implements ChannelStrategyPlanner {
  readonly #model: ChatOpenAI;
  readonly #provider: "kimi-code" | "openai";

  constructor(environment: Readonly<Record<string, string | undefined>> = process.env) {
    const configuration = resolveResearchModelConfigurationFromEnvironment(environment);
    const modelName = configuration.synthesisModels[0]!;
    this.#provider = configuration.provider;
    this.#model = new ChatOpenAI(buildChatModelFields(configuration, modelName, "low"));
  }

  async plan(input: Parameters<ChannelStrategyPlanner["plan"]>[0]): Promise<ChannelStrategy> {
    const channelRule = input.channel === "linkedin"
      ? "Search people only on LinkedIn. Do not require email or phone. sourceKinds must be [linkedin]."
      : input.channel === "email"
        ? "Discover companies first using web, official registries, professional directories or maps. Then test official professional emails. Never use LinkedIn as a source."
        : "Discover companies first using web, professional directories or maps. Test only public professional phone numbers and WhatsApp Business availability. Never use LinkedIn as a source.";
    const messages = [
      {
        role: "system" as const,
        content: [
          "You plan a bounded, read-only channel feasibility sample.",
          "Return a search strategy, not market facts. Never contact anyone and never invent observed data.",
          ...(this.#provider === "kimi-code"
            ? [
                "Your final answer must be exactly one JSON object with no markdown or commentary.",
                `JSON Schema: ${JSON.stringify(z.toJSONSchema(strategySchema))}`,
              ]
            : []),
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify({ ...input, channelRule }),
      },
    ];

    // Kimi K3 rejects a forced tool_choice while thinking is enabled. Keep its
    // low-reasoning mode and validate prompt-JSON locally; OpenAI can use the
    // native function-calling structured-output path.
    if (this.#provider === "kimi-code") {
      const result = await this.#model.invoke(messages);
      return strategySchema.parse(
        normalizeStrategyPayload(readJsonFromFinalMessage({ messages: [result] })),
      );
    }
    return this.#model
      .withStructuredOutput(strategySchema, { method: "functionCalling" })
      .invoke(messages);
  }
}

export function normalizeStrategyPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  const sourceKinds = Array.isArray(payload.sourceKinds)
    ? [...new Set(payload.sourceKinds)]
        .filter(
          (source): source is string =>
            typeof source === "string" && allowedSourceKinds.has(source),
        )
        .slice(0, 4)
    : payload.sourceKinds;
  const rawSampleSize = Number(payload.sampleSize);
  return {
    ...payload,
    query:
      typeof payload.query === "string"
        ? payload.query.trim().slice(0, 500)
        : payload.query,
    rationale:
      typeof payload.rationale === "string"
        ? payload.rationale.trim().slice(0, 1_000)
        : payload.rationale,
    sourceKinds,
    sampleSize: Number.isFinite(rawSampleSize)
      ? Math.min(20, Math.max(5, Math.round(rawSampleSize)))
      : payload.sampleSize,
  };
}

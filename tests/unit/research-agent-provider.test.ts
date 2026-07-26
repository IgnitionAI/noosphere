import { describe, expect, test } from "bun:test";
import {
  buildChatModelFields,
  findUnresolvedEvidenceReferences,
  isModelUnavailableError,
  readJsonFromFinalMessage,
  resolveResearchModelConfigurationFromEnvironment,
  selectModelCandidates,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";

describe("findUnresolvedEvidenceReferences", () => {
  test("accepts references declared in the output evidence array", () => {
    const output = {
      evidence: [{ evidenceId: "S01", url: "https://example.com" }],
      findings: [{ evidenceIds: ["S01"] }],
    };
    expect(findUnresolvedEvidenceReferences(output, {})).toEqual([]);
  });

  test("accepts references declared by previous stages", () => {
    const output = { findings: [{ evidenceIds: ["S01"] }] };
    const previousOutputs = {
      competitor_discovery: { evidence: [{ evidenceId: "S01" }] },
    };
    expect(findUnresolvedEvidenceReferences(output, previousOutputs)).toEqual([]);
  });

  test("reports references nobody declared", () => {
    const output = {
      evidence: [{ evidenceId: "S01" }],
      findings: [{ evidenceIds: ["S01", "S99"] }],
    };
    expect(findUnresolvedEvidenceReferences(output, {})).toEqual(["S99"]);
  });
});

describe("readJsonFromFinalMessage", () => {
  test("parses a plain JSON final message", () => {
    const result = readJsonFromFinalMessage({
      messages: [
        { role: "user", content: "task" },
        { role: "assistant", content: '{"summary":"ok","score":2}' },
      ],
    });
    expect(result).toEqual({ summary: "ok", score: 2 });
  });

  test("parses JSON wrapped in markdown fences and content blocks", () => {
    const result = readJsonFromFinalMessage({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Voici le résultat :\n```json\n{\"a\":1}\n```" },
          ],
        },
      ],
    });
    expect(result).toEqual({ a: 1 });
  });

  test("extracts the first JSON object from surrounding prose", () => {
    const result = readJsonFromFinalMessage({
      messages: [
        { role: "assistant", content: 'Analyse terminée. {"b":{"c":[1,2]}} Merci.' },
      ],
    });
    expect(result).toEqual({ b: { c: [1, 2] } });
  });

  test("rejects when no JSON object is present", () => {
    expect(() =>
      readJsonFromFinalMessage({ messages: [{ role: "assistant", content: "rien" }] }),
    ).toThrow("JSON");
  });
});

describe("research agent model provider", () => {
  test("defaults to Kimi Code with its OpenAI-compatible endpoint and models", () => {
    const configuration = resolveResearchModelConfigurationFromEnvironment({
      KIMI_CODE_API_KEY: "test-kimi-key",
    });

    expect(configuration).toEqual({
      provider: "kimi-code",
      apiKey: "test-kimi-key",
      baseUrl: "https://api.kimi.com/coding/v1",
      researchModels: ["kimi-for-coding"],
      synthesisModels: ["kimi-for-coding"],
    });
  });

  test("accepts ordered, deduplicated Kimi model fallback lists", () => {
    const configuration = resolveResearchModelConfigurationFromEnvironment({
      KIMI_CODE_API_KEY: "test-kimi-key",
      KIMI_RESEARCH_MODELS:
        "k3, kimi-for-coding, k3, kimi-for-coding-highspeed",
      KIMI_SYNTHESIS_MODELS: "kimi-for-coding-highspeed,kimi-for-coding",
    });

    expect(configuration.researchModels).toEqual([
      "k3",
      "kimi-for-coding",
      "kimi-for-coding-highspeed",
    ]);
    expect(configuration.synthesisModels).toEqual([
      "kimi-for-coding-highspeed",
      "kimi-for-coding",
    ]);
  });

  test("builds Kimi without temperature and forces the Chat Completions API", () => {
    const fields = buildChatModelFields(
      {
        provider: "kimi-code",
        apiKey: "test-kimi-key",
        baseUrl: "https://kimi.internal/v1",
      },
      "kimi-for-coding",
    );

    expect(fields).toEqual({
      apiKey: "test-kimi-key",
      model: "kimi-for-coding",
      maxRetries: 1,
      streamUsage: true,
      useResponsesApi: false,
      configuration: { baseURL: "https://kimi.internal/v1" },
    });
    expect("temperature" in fields).toBe(false);
  });

  test("retains the explicit OpenAI fallback configuration", () => {
    const configuration = resolveResearchModelConfigurationFromEnvironment({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_RESEARCH_MODEL: "gpt-research",
      OPENAI_SYNTHESIS_MODEL: "gpt-synthesis",
    });
    const fields = buildChatModelFields(configuration, configuration.researchModels[0]!);

    expect(configuration.provider).toBe("openai");
    expect(fields.temperature).toBe(0);
    expect(fields.useResponsesApi).toBe(false);
    expect(fields.configuration).toBeUndefined();
  });

  test("rejects unknown providers before the worker starts", () => {
    expect(() =>
      resolveResearchModelConfigurationFromEnvironment({
        AI_PROVIDER: "moonshot-platform",
      }),
    ).toThrow("AI_PROVIDER must be one of: kimi-code, openai");
  });

  test("falls back only for errors that identify an unavailable model", () => {
    expect(
      isModelUnavailableError(
        Object.assign(new Error("Model k3 is not available for this account"), {
          status: 403,
        }),
      ),
    ).toBe(true);
    expect(
      isModelUnavailableError(
        Object.assign(new Error("Invalid structured output"), { status: 400 }),
      ),
    ).toBe(false);
    expect(
      isModelUnavailableError(
        Object.assign(new Error("Model kimi-for-coding is temporarily unavailable"), {
          status: 503,
        }),
      ),
    ).toBe(true);
    expect(
      isModelUnavailableError(
        Object.assign(new Error("Rate limit exceeded"), { status: 429 }),
      ),
    ).toBe(false);
  });

  test("uses the workspace policy for deep and synthesis stages", () => {
    const defaults = {
      researchModels: ["default-research"],
      synthesisModels: ["default-synthesis"],
    };
    const workspace = {
      researchModels: ["k3", "kimi-for-coding"],
      synthesisModels: ["kimi-for-coding-highspeed"],
    };

    expect(selectModelCandidates("competitor_analysis", defaults, workspace)).toEqual([
      "k3",
      "kimi-for-coding",
    ]);
    expect(selectModelCandidates("icp_synthesis", defaults, workspace)).toEqual([
      "kimi-for-coding-highspeed",
    ]);
    expect(selectModelCandidates("product_analysis", defaults, null)).toEqual([
      "default-research",
    ]);
  });
});

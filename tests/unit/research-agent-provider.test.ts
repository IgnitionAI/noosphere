import { describe, expect, test } from "bun:test";
import {
  buildChatModelFields,
  downgradeUnsupportedObservedClaims,
  dropUnevidencedCompetitorAnalyses,
  findUnresolvedEvidenceReferences,
  isModelUnavailableError,
  isProviderQuotaError,
  mandatoryBuyerExploration,
  mergeProductTruthOutputs,
  modelTierForStage,
  prioritizeCompetitorCandidates,
  readJsonFromFinalMessage,
  resolveResearchModelConfigurationFromEnvironment,
  reasoningEffortForStage,
  serializeRecoveryContext,
  structuredOutputGraceMs,
  v3StageDurationMs,
  v3StageToolLimits,
  selectModelCandidates,
  selectToolsForStage,
} from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

describe("competitor discovery hand-off", () => {
  test("caps expensive analysis while preserving relation diversity", () => {
    const candidates = (["direct", "adjacent", "alternative"] as const).flatMap(
      (relation) =>
        Array.from({ length: 8 }, (_, index) => ({
          name: `${relation}-${index}`,
          url: `https://example.com/${relation}/${index}`,
          relation,
          rationale: "Relevant competitor",
          confidence: 1 - index / 10,
          evidenceIds: ["S01"],
        })),
    );

    const result = prioritizeCompetitorCandidates({
      candidates,
      evidence: [],
    });

    expect(result.candidates).toHaveLength(12);
    expect(result.candidates.filter((candidate) => candidate.relation === "direct")).toHaveLength(6);
    expect(result.candidates.filter((candidate) => candidate.relation === "adjacent")).toHaveLength(4);
    expect(result.candidates.filter((candidate) => candidate.relation === "alternative")).toHaveLength(2);
  });
});

describe("buyer exploration checklist", () => {
  test("is sector-neutral even when the product description names an industry", () => {
    const legalChecklist = mandatoryBuyerExploration({
      stage: "buyer_landscape_discovery",
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      researchStageRunId: crypto.randomUUID(),
      correlationId: "test",
      deadlineAt: null,
      workItemKey: "main",
      externalDlpTerms: [],
      brief: {
        productUrl: "https://example.com",
        productName: "Document AI",
        description: "Assistant for legal and compliance documents",
        geography: "France",
        languages: ["fr"],
        salesMotion: "hybrid",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "quick",
        audienceGoal: "end_customers",
        buyerConstraints: "",
        researchVersion: 2,
      },
      previousOutputs: { product_analysis: { targetHints: ["Legal teams"] } },
    });

    const industrialChecklist = mandatoryBuyerExploration({
      stage: "buyer_landscape_discovery",
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      researchStageRunId: crypto.randomUUID(),
      correlationId: "test",
      deadlineAt: null,
      workItemKey: "main",
      externalDlpTerms: [],
      brief: {
        productUrl: "https://example.com",
        productName: "Operations AI",
        description: "Assistant for industrial maintenance records",
        geography: "France",
        languages: ["fr"],
        salesMotion: "hybrid",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "quick",
        audienceGoal: "end_customers",
        buyerConstraints: "",
        researchVersion: 2,
      },
      previousOutputs: { product_analysis: { targetHints: ["Factories"] } },
    });

    expect(legalChecklist).toEqual(industrialChecklist);
    expect(legalChecklist.join(" ").toLowerCase()).not.toMatch(
      /law firm|notarial|legal publisher|compliance team/,
    );
  });
});

describe("V3 tool isolation", () => {
  const tools = [
    "searchWeb",
    "readWebPage",
    "discoverWebsite",
    "readWebsitePages",
    "searchInternalDocuments",
    "readInternalDocument",
  ].map((name) => ({ name })) as never;

  test("an external stage cannot see internal document tools", () => {
    expect(
      selectToolsForStage("market_investigation", 3, true, tools).map((tool) => tool.name),
    ).toEqual(["searchWeb", "readWebPage", "discoverWebsite", "readWebsitePages"]);
  });

  test("a synthesis stage receives no retrieval tool", () => {
    expect(selectToolsForStage("objective_ranking", 3, true, tools)).toEqual([]);
  });

  test("product truth uses one retrieval surface, never both", () => {
    expect(selectToolsForStage("product_truth", 3, true, tools).map((tool) => tool.name)).toEqual([
      "searchInternalDocuments",
      "readInternalDocument",
    ]);
    expect(selectToolsForStage("product_truth", 3, false, tools).map((tool) => tool.name)).toEqual([
      "searchWeb",
      "readWebPage",
      "readWebsitePages",
    ]);
  });
});

test("product truth merges public and internal retrieval without evidence-key collisions", () => {
  const publicOutput = structuredClone(validOutputFor("product_truth")) as Record<string, any>;
  const internalOutput = structuredClone(validOutputFor("product_truth")) as Record<string, any>;
  internalOutput.evidence[0].sourceType = "internal_document";
  internalOutput.evidence[0].sourceRelation = "internal";
  const merged = mergeProductTruthOutputs(internalOutput as never, publicOutput as never);

  expect(merged.facts.map((fact) => fact.factId)).toEqual([
    "public:PF01",
    "internal:PF01",
  ]);
  expect(merged.evidence.map((source) => source.evidenceId)).toEqual([
    "public:V3E01",
    "internal:V3E01",
  ]);
  expect(new Set(merged.facts.flatMap((fact) => fact.evidenceIds)).size).toBe(2);
});

test("V3 assigns bounded wall-clock budgets per role", () => {
  expect(v3StageDurationMs("product_truth")).toBe(150_000);
  expect(v3StageDurationMs("problem_mapping")).toBe(300_000);
  expect(v3StageDurationMs("organization_discovery")).toBe(480_000);
  expect(v3StageDurationMs("market_investigation")).toBe(480_000);
  expect(v3StageDurationMs("buying_context")).toBe(300_000);
  expect(v3StageDurationMs("icp_composition")).toBe(300_000);
  expect(v3StageDurationMs("adversarial_review")).toBe(360_000);
  expect(v3StageDurationMs("objective_ranking")).toBe(90_000);
});

test("V3 caps product-reading retrieval independently of the selected depth", () => {
  expect(v3StageToolLimits("product_truth", {
    searches: 100,
    pages: 300,
    tokens: 2_000_000,
    durationMs: 75 * 60_000,
  })).toMatchObject({ searches: 2, pages: 6, tokens: 180_000 });
});

test("V3 downgrades weakly cited observations without inventing evidence", () => {
  const raw = {
    investigations: [{
      claims: [{
        dimension: "urgency",
        status: "observed",
        confidence: 0.92,
        evidence: [{ relation: "supports", directness: 2, specificity: 4, evidenceId: "E01" }],
      }],
    }],
    candidate: {
      state: "priority_for_test",
      sourcingStatus: "provider_limited",
    },
    unknownClaim: {
      status: "unknown",
      confidence: 0.8,
      evidence: [],
    },
    buyingContext: {
      claims: [{ dimension: "budget", status: "inferred" }],
      budget: { status: "observed", value: "Unknown price" },
      salesCycle: { status: "unknown", value: "Unknown" },
    },
  };

  const sanitized = downgradeUnsupportedObservedClaims(raw) as Record<string, any>;
  expect(sanitized.investigations[0].claims[0]).toMatchObject({
    status: "inferred",
    confidence: 0.65,
    evidence: [{ evidenceId: "E01" }],
  });
  expect(sanitized.buyingContext.budget.status).toBe("inferred");
  expect(sanitized.unknownClaim.confidence).toBe(0.25);
  expect(sanitized.candidate.state).toBe("adjacent_experiment");
  expect(raw.investigations[0]!.claims[0]!.status).toBe("observed");
});

describe("competitor analysis evidence boundary", () => {
  test("drops unsupported records instead of fabricating evidence or failing the whole stage", () => {
    const result = dropUnevidencedCompetitorAnalyses({
      competitors: [
        { name: "Supported", evidenceIds: ["S01"] },
        { name: "Unsupported", evidenceIds: [] },
        { name: "Malformed" },
      ],
      evidence: [{ evidenceId: "S01" }],
    }) as { competitors: Array<{ name: string }> };

    expect(result.competitors.map((candidate) => candidate.name)).toEqual(["Supported"]);
  });
});

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

  test("checks market and product-fit evidence references", () => {
    const output = {
      buyerSegments: [
        {
          marketEvidenceIds: ["M01", "M99"],
          productFitEvidenceIds: ["P01"],
        },
      ],
    };
    const previousOutputs = {
      product_analysis: { evidence: [{ evidenceId: "P01" }] },
      buyer_landscape_discovery: { evidence: [{ evidenceId: "M01" }] },
    };
    expect(findUnresolvedEvidenceReferences(output, previousOutputs)).toEqual(["M99"]);
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

describe("structured-output recovery context", () => {
  test("keeps both ends of a long transcript within a hard context bound", () => {
    const serialized = serializeRecoveryContext(
      { first: "FIRST", middle: "x".repeat(10_000), last: "LAST" },
      1_000,
    );

    expect(serialized.length).toBeLessThanOrEqual(1_000);
    expect(serialized).toContain("FIRST");
    expect(serialized).toContain("LAST");
    expect(serialized).toContain("transcript middle truncated");
  });

  test("reserves bounded Kimi synthesis time without extending OpenAI runs", () => {
    expect(structuredOutputGraceMs("kimi-code", 10 * 60_000)).toBe(150_000);
    expect(structuredOutputGraceMs("kimi-code", 75 * 60_000)).toBe(300_000);
    expect(structuredOutputGraceMs("openai", 10 * 60_000)).toBe(0);
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
      researchModels: ["k3", "k3-256k"],
      synthesisModels: ["k3-256k", "k3"],
    });
  });

  test("accepts ordered, deduplicated Kimi model fallback lists", () => {
    const configuration = resolveResearchModelConfigurationFromEnvironment({
      KIMI_CODE_API_KEY: "test-kimi-key",
      KIMI_RESEARCH_MODELS:
        "k3, k3-256k, k3",
      KIMI_SYNTHESIS_MODELS: "k3-256k,k3,k3-256k",
    });

    expect(configuration.researchModels).toEqual([
      "k3",
      "k3-256k",
    ]);
    expect(configuration.synthesisModels).toEqual([
      "k3-256k",
      "k3",
    ]);
  });

  test("builds Kimi without temperature and forces the Chat Completions API", () => {
    const fields = buildChatModelFields(
      {
        provider: "kimi-code",
        apiKey: "test-kimi-key",
        baseUrl: "https://kimi.internal/v1",
      },
      "k3",
      "max",
    );

    expect(fields).toEqual({
      apiKey: "test-kimi-key",
      model: "k3",
      maxRetries: 1,
      streamUsage: true,
      useResponsesApi: false,
      reasoning: { effort: "max" },
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
        Object.assign(new Error("Model k3-256k is temporarily unavailable"), {
          status: 503,
        }),
      ),
    ).toBe(true);
    expect(
      isModelUnavailableError(
        Object.assign(new Error("Rate limit exceeded"), { status: 429 }),
      ),
    ).toBe(false);
    const quota = Object.assign(
      new Error("You've reached your usage limit for this billing cycle"),
      { status: 403 },
    );
    expect(isProviderQuotaError(quota)).toBe(true);
    expect(isModelUnavailableError(quota)).toBe(true);
    expect(
      isProviderQuotaError(
        new Error("403 You've reached your usage limit for this billing cycle"),
      ),
    ).toBe(true);
  });

  test("uses K3 max for principal stages and K3 256k low for executors", () => {
    const defaults = {
      researchModels: ["default-research"],
      synthesisModels: ["default-synthesis"],
    };
    const workspace = {
      researchModels: ["k3", "k3-256k"],
      synthesisModels: ["k3-256k", "k3"],
    };

    expect(selectModelCandidates("organization_discovery", defaults, workspace, 3)).toEqual([
      "k3",
      "k3-256k",
    ]);
    expect(selectModelCandidates("adversarial_review", defaults, workspace, 3)).toEqual([
      "k3",
      "k3-256k",
    ]);
    expect(selectModelCandidates("market_investigation", defaults, workspace, 3)).toEqual([
      "k3-256k",
      "k3",
    ]);
    expect(selectModelCandidates("icp_composition", defaults, workspace, 3)).toEqual([
      "k3",
      "k3-256k",
    ]);
    expect(selectModelCandidates("competitor_analysis", defaults, workspace, 2)).toEqual([
      "k3",
      "k3-256k",
    ]);
    expect(selectModelCandidates("icp_synthesis", defaults, null, 2)).toEqual([
      "default-synthesis",
    ]);
    expect(selectModelCandidates("product_truth", defaults, null, 3)).toEqual([
      "default-synthesis",
    ]);
    expect(modelTierForStage("organization_discovery", 3)).toBe("principal");
    expect(modelTierForStage("problem_mapping", 3)).toBe("principal");
    expect(modelTierForStage("buying_context", 3)).toBe("principal");
    expect(modelTierForStage("icp_composition", 3)).toBe("principal");
    expect(modelTierForStage("market_investigation", 3)).toBe("executor");
    expect(reasoningEffortForStage("adversarial_review", 3)).toBe("max");
    expect(reasoningEffortForStage("market_investigation", 3)).toBe("low");
  });

  test("sends low reasoning effort to a K3 executor", () => {
    const fields = buildChatModelFields(
      {
        provider: "kimi-code",
        apiKey: "test-kimi-key",
        baseUrl: "https://api.kimi.com/coding/v1",
      },
      "k3-256k",
      "low",
    );
    expect(fields).toMatchObject({
      model: "k3-256k",
      reasoning: { effort: "low" },
      useResponsesApi: false,
    });
  });
});

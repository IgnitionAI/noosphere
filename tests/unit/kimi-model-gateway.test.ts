import { describe, expect, test } from "bun:test";
import { KimiChatModelGateway, KimiModelCatalog } from "@outbound/infrastructure/ai/kimi-model-gateway";

const now = new Date("2026-08-22T12:00:00.000Z");
const request = {
  workspaceId: "workspace-1",
  capability: "content_writer" as const,
  requestKey: "writer:1",
  model: "k3",
  reasoningEffort: "max" as const,
  systemPrompt: "Return one post.",
  input: { idea: "provider-neutral agents" },
  outputName: "submit_post",
  outputDescription: "Submit one post.",
  outputSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
  parse: (value: unknown) => {
    if (!value || typeof value !== "object" || typeof (value as { body?: unknown }).body !== "string") {
      throw new Error("INVALID_POST");
    }
    return value as { body: string };
  },
  deadlineAt: new Date(now.getTime() + 60_000),
};

describe("KimiChatModelGateway", () => {
  test("requires the single output function without naming it and returns normalized provenance", async () => {
    let sent: Record<string, unknown> | null = null;
    const gateway = new KimiChatModelGateway({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({
          choices: [{ message: { tool_calls: [{ function: { name: "submit_post", arguments: JSON.stringify({ body: "Bonjour" }) } }] } }],
          usage: { prompt_tokens: 21, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 8 } },
        });
      },
    });

    const result = await gateway.invokeStructured(request);

    expect(result.output).toEqual({ body: "Bonjour" });
    expect(result.metadata).toMatchObject({
      provider: "kimi-code",
      transport: "chat-completions",
      model: "k3",
      reasoningEffort: "max",
      usage: { inputTokens: 21, cachedInputTokens: 8, outputTokens: 5, source: "reported" },
    });
    const requestBody = sent as Record<string, unknown> | null;
    expect(requestBody?.model).toBe("k3");
    expect(requestBody?.tool_choice).toBe("required");
  });

  test("classifies a quota response as fallbackable and never retryable on Kimi", async () => {
    const gateway = new KimiChatModelGateway({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async () => Response.json({ error: { message: "usage limit reached" } }, { status: 403 }),
    });

    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_QUOTA_EXHAUSTED",
      fallbackAllowed: true,
      retryableOnProvider: false,
    });
  });

  test("disables thinking to require structured output from Kimi-for-coding models", async () => {
    let sent: Record<string, unknown> | null = null;
    const gateway = new KimiChatModelGateway({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({
          choices: [{ message: { tool_calls: [{ function: { name: "submit_post", arguments: JSON.stringify({ body: "Bonjour" }) } }] } }],
        });
      },
    });

    await gateway.invokeStructured({ ...request, model: "kimi-for-coding-highspeed", reasoningEffort: "low" });

    const requestBody = sent as Record<string, unknown> | null;
    expect(requestBody?.tool_choice).toBe("required");
    expect(requestBody?.thinking).toEqual({ type: "disabled" });
    expect(requestBody?.reasoning).toBeUndefined();
  });

  test("rejects an invalid structured response without falling back", async () => {
    const gateway = new KimiChatModelGateway({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async () => Response.json({ choices: [{ message: { content: "free text" } }] }),
    });

    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_OUTPUT_INVALID",
      fallbackAllowed: false,
    });
  });
});

describe("KimiModelCatalog", () => {
  test("discovers every accessible model dynamically", async () => {
    const catalog = new KimiModelCatalog({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async () => Response.json({ data: [
        { id: "k3" },
        { id: "k3-256k" },
        { id: "kimi-for-coding" },
        { id: "future-kimi-model" },
      ] }),
    });

    const snapshot = await catalog.list();

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.models.map((model) => model.id)).toEqual([
      "k3",
      "k3-256k",
      "kimi-for-coding",
      "future-kimi-model",
    ]);
  });

  test("keeps a useful fallback catalog when discovery is unavailable", async () => {
    const catalog = new KimiModelCatalog({
      apiKey: "secret",
      baseUrl: "https://kimi.example/v1",
      now: () => now,
      fetcher: async () => { throw new Error("network unavailable"); },
    });

    const snapshot = await catalog.list();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.errorCode).toBe("AI_PROVIDER_CATALOG_UNAVAILABLE");
    expect(snapshot.models.map((model) => model.id)).toContain("kimi-for-coding-highspeed");
  });
});

import { expect, test } from "bun:test";
import { ApiKeyModelGateway } from "@outbound/infrastructure/ai/api-key-model-gateway";
import type { StructuredModelRequest } from "@outbound/application/ai/model-gateway";
const request: StructuredModelRequest<{ ok: boolean }> = {
  workspaceId: "instance", capability: "icp_research", requestKey: "connection-test", model: "gpt-test", reasoningEffort: "low", systemPrompt: "Call the output function with ok true", input: {}, outputName: "connection_probe", outputDescription: "Connection probe", outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  parse(value) { if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) throw new Error("INVALID_PROBE"); return { ok: true }; },
  deadlineAt: new Date(Date.now() + 60_000),
};

for (const provider of ["anthropic", "openrouter", "openai-compatible"] as const) {
  test(`${provider} executes and validates its structured-output protocol`, async () => {
    const gateway = new ApiKeyModelGateway({ provider, apiKey: "only-this-key", baseUrl: provider === "openai-compatible" ? "https://llm.example.com/v1" : undefined, fetcher: async (url, options) => {
      const body = JSON.parse(String(options?.body));
      const headers = new Headers(options?.headers);
      expect(options?.redirect).toBe("error");
      expect(body.model).toBe("gpt-test");
      if (provider === "anthropic") {
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect(headers.get("x-api-key")).toBe("only-this-key");
        expect(headers.get("authorization")).toBeNull();
        expect(body).toMatchObject({ output_config: { effort: "low" }, tools: [{ name: "connection_probe", input_schema: request.outputSchema }] });
        return Response.json({ content: [{ type: "tool_use", name: "connection_probe", input: { ok: true } }], usage: { input_tokens: 11, output_tokens: 4 } });
      }
      expect(url).toBe(provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://llm.example.com/v1/chat/completions");
      expect(headers.get("authorization")).toBe("Bearer only-this-key");
      expect(body).toMatchObject({ max_completion_tokens: 16_384, tool_choice: { type: "function", function: { name: "connection_probe" } }, tools: [{ type: "function", function: { name: "connection_probe", parameters: request.outputSchema } }] });
      return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "connection_probe", arguments: '{"ok":true}' } }] } }], usage: { prompt_tokens: 11, completion_tokens: 4 } });
    } });
    const result = await gateway.invokeStructured(request);
    expect(result.output).toEqual({ ok: true });
    expect(result.metadata).toMatchObject({ provider, model: "gpt-test", usage: { inputTokens: 11, outputTokens: 4 } });
  });
  test(`${provider} rejects invalid output and sanitizes authentication failures`, async () => {
    for (const status of [200, 401]) {
      const gateway = new ApiKeyModelGateway({ provider, apiKey: "secret", baseUrl: "https://llm.example.com/v1", fetcher: async () => Response.json({ message: "secret" }, { status }) });
      await expect(gateway.invokeStructured(request)).rejects.toMatchObject({ code: status === 200 ? "AI_PROVIDER_OUTPUT_INVALID" : "AI_PROVIDER_AUTHENTICATION_FAILED" });
    }
  });
}

test("a private compatible destination fails with an actionable code before opening a connection", async () => {
  const gateway = new ApiKeyModelGateway({ provider: "openai-compatible", apiKey: "must-not-leave", baseUrl: "https://127.0.0.1/v1" });
  await expect(gateway.invokeStructured(request)).rejects.toMatchObject({ code: "AI_PROVIDER_DESTINATION_FORBIDDEN" });
});

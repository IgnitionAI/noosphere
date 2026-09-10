import { expect, test } from "bun:test";
import { OpenAiResponsesModelGateway } from "@outbound/infrastructure/ai/openai-model-gateway";
import type { StructuredModelRequest } from "@outbound/application/ai/model-gateway";

const request: StructuredModelRequest<{ ok: boolean }> = {
  workspaceId: "instance", capability: "icp_research", requestKey: "connection-test", model: "gpt-test", reasoningEffort: "low", systemPrompt: "Call the output function with ok true", input: {}, outputName: "connection_probe", outputDescription: "Connection probe", outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  parse(value) { if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) throw new Error("INVALID_PROBE"); return { ok: true }; },
  deadlineAt: new Date(Date.now() + 60_000),
};

test("OpenAI invokes the selected model with a bounded function contract and parses its real response shape", async () => {
  let sent: Record<string, unknown> | undefined;
  const gateway = new OpenAiResponsesModelGateway({ apiKey: "test-secret", maxOutputTokens: 256, fetcher: async (url, options) => {
    expect(url).toBe("https://api.openai.com/v1/responses");
    sent = JSON.parse(String(options?.body));
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer test-secret");
    return Response.json({ output: [{ type: "function_call", name: "connection_probe", arguments: '{"ok":true}' }], usage: { input_tokens: 12, output_tokens: 5 } });
  } });
  const result = await gateway.invokeStructured(request);
  expect(sent).toMatchObject({ model: "gpt-test", max_output_tokens: 256, reasoning: { effort: "low" }, tool_choice: { type: "function", name: "connection_probe" } });
  expect(result.output).toEqual({ ok: true });
  expect(result.metadata.usage.inputTokens).toBe(12);
});

for (const [status, code] of [[401, "AI_PROVIDER_AUTHENTICATION_FAILED"], [429, "AI_PROVIDER_QUOTA_EXHAUSTED"], [404, "AI_PROVIDER_MODEL_UNAVAILABLE"], [503, "AI_PROVIDER_UNAVAILABLE"]] as const) {
  test(`OpenAI maps HTTP ${status} without including provider secrets in the error`, async () => {
    const gateway = new OpenAiResponsesModelGateway({ apiKey: "test-secret", fetcher: async () => Response.json({ error: { message: "test-secret echoed by provider" } }, { status }) });
    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({ code });
    try { await gateway.invokeStructured(request); } catch (error) { expect(String(error)).not.toContain("test-secret"); }
  });
}

test("a successful HTTP response without the requested function result is not validation", async () => {
  const gateway = new OpenAiResponsesModelGateway({ apiKey: "test-secret", fetcher: async () => Response.json({ choices: [{ message: { content: "Everything is fine" } }] }) });
  await expect(gateway.invokeStructured(request)).rejects.toMatchObject({ code: "AI_PROVIDER_OUTPUT_INVALID" });
});

import { describe, expect, test } from "bun:test";
import {
  ModelGatewayError,
  unknownModelUsage,
  type ModelGateway,
  type StructuredModelRequest,
} from "@outbound/application/ai/model-gateway";
import { ModelRouter } from "@outbound/application/ai/model-router";

const baseRequest = {
  workspaceId: "workspace-1",
  capability: "content_writer" as const,
  requestKey: "content-writer:run-1",
  systemPrompt: "Write one grounded post.",
  input: { idea: "provider-neutral inference" },
  outputName: "submit_post",
  outputDescription: "Submit the post.",
  outputSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
  parse: (value: unknown) => value as { body: string },
  deadlineAt: new Date(Date.now() + 60_000),
};

describe("ModelRouter", () => {
  test("routes one structured request without leaking a provider SDK", async () => {
    const gateway = fakeGateway("kimi-code", async (request) => ({ body: `${request.model}:ok` }));
    const result = await new ModelRouter([gateway]).invokeStructured({
      ...baseRequest,
      routes: [{ provider: "kimi-code", model: "k3", reasoningEffort: "max" }],
    });

    expect(result.output).toEqual({ body: "k3:ok" });
    expect(result.metadata.provider).toBe("kimi-code");
    expect(result.providerAttempt).toBe(1);
    expect(result.fallbackReason).toBeNull();
  });

  test("falls back once when quota is exhausted and never retries the same provider", async () => {
    let kimiCalls = 0;
    const kimi = fakeGateway("kimi-code", async () => {
      kimiCalls += 1;
      throw new ModelGatewayError(
        "AI_PROVIDER_QUOTA_EXHAUSTED",
        "kimi-code",
        "quota exhausted",
        true,
        false,
      );
    });
    const codex = fakeGateway("codex-cli", async () => ({ body: "codex:ok" }));

    const result = await new ModelRouter([kimi, codex]).invokeStructured({
      ...baseRequest,
      routes: [
        { provider: "kimi-code", model: "k3", reasoningEffort: "max" },
        { provider: "codex-cli", model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
      ],
    });

    expect(kimiCalls).toBe(1);
    expect(result.output).toEqual({ body: "codex:ok" });
    expect(result.providerAttempt).toBe(2);
    expect(result.fallbackReason).toBe("AI_PROVIDER_QUOTA_EXHAUSTED");
  });

  test("does not fall back after an application-level non-fallback error", async () => {
    let codexCalls = 0;
    const kimi = fakeGateway("kimi-code", async () => {
      throw new ModelGatewayError(
        "AI_PROVIDER_OUTPUT_INVALID",
        "kimi-code",
        "invalid output",
        false,
        false,
      );
    });
    const codex = fakeGateway("codex-cli", async () => {
      codexCalls += 1;
      return { body: "must not run" };
    });

    await expect(new ModelRouter([kimi, codex]).invokeStructured({
      ...baseRequest,
      routes: [
        { provider: "kimi-code", model: "k3", reasoningEffort: "max" },
        { provider: "codex-cli", model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
      ],
    })).rejects.toMatchObject({ code: "AI_PROVIDER_OUTPUT_INVALID" });
    expect(codexCalls).toBe(0);
  });
});

function fakeGateway(
  provider: ModelGateway["provider"],
  invoke: (request: StructuredModelRequest<unknown>) => Promise<unknown>,
): ModelGateway {
  return {
    provider,
    transport: provider === "kimi-code" ? "chat-completions" : "codex-process",
    async invokeStructured<T>(request: StructuredModelRequest<T>) {
      const output = request.parse(await invoke(request));
      return {
        output,
        metadata: {
          provider,
          transport: this.transport,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          usage: unknownModelUsage(),
          latencyMs: 1,
        },
      };
    },
  };
}

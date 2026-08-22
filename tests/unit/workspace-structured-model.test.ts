import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ModelGateway } from "@outbound/application/ai/model-gateway";
import { ModelRouter } from "@outbound/application/ai/model-router";
import { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

describe("WorkspaceStructuredModel", () => {
  test("uses a per-use-case Codex route instead of the global Kimi route", async () => {
    const seen: string[] = [];
    const gateway = (provider: ModelGateway["provider"]): ModelGateway => ({
      provider,
      transport: provider === "codex-cli" ? "codex-process" : "chat-completions",
      invokeStructured: async (request) => {
        seen.push(`${provider}:${request.capability}:${request.model}:${request.reasoningEffort}`);
        return {
          output: request.parse({ body: "specific" }),
          metadata: {
            provider,
            transport: provider === "codex-cli" ? "codex-process" : "chat-completions",
            model: request.model,
            reasoningEffort: request.reasoningEffort,
            usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, source: "reported" },
            latencyMs: 1,
          },
        };
      },
    });
    const runtime = new WorkspaceStructuredModel(
      new ModelRouter([gateway("kimi-code"), gateway("codex-cli")]),
      {
        find: async () => ({
          researchModels: ["k3"],
          synthesisModels: ["k3-256k"],
          defaultRoutes: [{ provider: "kimi-code", model: "k3", reasoningEffort: "max" }],
          capabilityRoutes: {
            content_writer: [{ provider: "codex-cli", model: "gpt-5.6-luna", reasoningEffort: "xhigh" }],
          },
        }),
      },
      () => new Date("2026-08-22T12:00:00.000Z"),
    );

    const result = await runtime.invoke({
      workspaceId: "workspace-1",
      capability: "content_writer",
      requestKey: "writer:1",
      fallbackRoutes: [{ provider: "kimi-code", model: "k3", reasoningEffort: "max" }],
      systemPrompt: "Write",
      payload: { idea: "one" },
      outputName: "submit",
      outputDescription: "Submit",
      schema: z.object({ body: z.string() }),
    });

    expect(result.output).toEqual({ body: "specific" });
    expect(seen).toEqual(["codex-cli:content_writer:gpt-5.6-luna:xhigh"]);
  });
});

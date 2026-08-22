import { describe, expect, test } from "bun:test";
import { CodexCliModelGateway, CodexModelCatalog } from "@outbound/infrastructure/ai/codex-cli-model-gateway";
import {
  CodexProcessTimedOutError,
  type CodexProcessRequest,
  type CodexProcessRunner,
} from "@outbound/infrastructure/ai/codex-process-runner";

const now = new Date("2026-08-22T12:00:00.000Z");
const request = {
  workspaceId: "workspace-1",
  capability: "content_writer" as const,
  requestKey: "writer:1",
  model: "gpt-5.6-luna",
  reasoningEffort: "xhigh" as const,
  systemPrompt: "Write one useful LinkedIn post.",
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

class RecordingRunner implements CodexProcessRunner {
  seen: CodexProcessRequest | null = null;

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string } | Error) {}

  async run(input: CodexProcessRequest) {
    this.seen = input;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("CodexCliModelGateway", () => {
  test("runs Codex ephemerally in an empty read-only directory with a JSON schema", async () => {
    const runner = new RecordingRunner({ exitCode: 0, stdout: JSON.stringify({ body: "Bonjour" }), stderr: "" });
    const gateway = new CodexCliModelGateway({
      codexHome: "/srv/noosphere/codex",
      binaryPath: "/usr/local/bin/codex",
      runner,
      now: () => now,
    });

    const result = await gateway.invokeStructured(request);

    expect(result.output).toEqual({ body: "Bonjour" });
    expect(result.metadata).toMatchObject({
      provider: "codex-cli",
      transport: "codex-process",
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
    const processRequest = runner.seen;
    expect(processRequest).not.toBeNull();
    expect(processRequest?.command).toContain("--ephemeral");
    expect(processRequest?.command).toContain("--ignore-user-config");
    expect(processRequest?.command).toContain("--ignore-rules");
    expect(processRequest?.command).toContain("read-only");
    expect(processRequest?.command).toContain("--output-schema");
    expect(processRequest?.command).toContain("model_reasoning_effort=\"xhigh\"");
    expect(processRequest?.cwd).toContain("noosphere-codex-");
    expect(processRequest?.env.CODEX_HOME).toBe("/srv/noosphere/codex");
    expect(processRequest?.env.KIMI_CODE_API_KEY).toBeUndefined();
    expect(processRequest?.stdin).toContain("Do not inspect the filesystem");
  });

  test("classifies a Codex usage limit as fallbackable without retrying Codex", async () => {
    const gateway = new CodexCliModelGateway({
      codexHome: "/srv/noosphere/codex",
      runner: new RecordingRunner({ exitCode: 1, stdout: "", stderr: "You have reached your usage limit" }),
      now: () => now,
    });

    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_QUOTA_EXHAUSTED",
      fallbackAllowed: true,
      retryableOnProvider: false,
    });
  });

  test("rejects invalid structured output without fallback", async () => {
    const gateway = new CodexCliModelGateway({
      codexHome: "/srv/noosphere/codex",
      runner: new RecordingRunner({ exitCode: 0, stdout: JSON.stringify({ title: "missing body" }), stderr: "" }),
      now: () => now,
    });

    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_OUTPUT_INVALID",
      fallbackAllowed: false,
    });
  });

  test("normalizes a process deadline", async () => {
    const gateway = new CodexCliModelGateway({
      codexHome: "/srv/noosphere/codex",
      runner: new RecordingRunner(new CodexProcessTimedOutError("timeout")),
      now: () => now,
    });

    await expect(gateway.invokeStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
      fallbackAllowed: true,
    });
  });
});

describe("CodexModelCatalog", () => {
  test("exposes every visible model and its actual reasoning efforts dynamically", async () => {
    const catalog = new CodexModelCatalog({
      codexHome: "/srv/noosphere/codex",
      now: () => now,
      discovery: {
        list: async () => [
          { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", hidden: false, supportedReasoningEfforts: ["low", "xhigh", "max"] },
          { id: "future-codex", displayName: "Future Codex", hidden: false, supportedReasoningEfforts: ["medium", "ultra"] },
          { id: "internal-review", displayName: "Internal", hidden: true, supportedReasoningEfforts: ["high"] },
        ],
      },
    });

    const snapshot = await catalog.list();

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.models.map((model) => model.id)).toEqual(["gpt-5.6-luna", "future-codex"]);
    expect(snapshot.models[1]?.reasoningEfforts).toEqual(["medium", "ultra"]);
  });

  test("falls back to Luna when app-server discovery is unavailable", async () => {
    const catalog = new CodexModelCatalog({
      codexHome: "/srv/noosphere/codex",
      now: () => now,
      discovery: { list: async () => { throw new Error("app-server unavailable"); } },
    });

    const snapshot = await catalog.list();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.models.map((model) => model.id)).toEqual(["gpt-5.6-luna"]);
  });
});

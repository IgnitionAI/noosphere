import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelGatewayError,
  aiReasoningEfforts,
  type AiReasoningEffort,
  type ModelCatalog,
  type ModelCatalogSnapshot,
  type ModelDescriptor,
  type ModelGateway,
  type StructuredModelRequest,
  type StructuredModelResult,
} from "@outbound/application/ai/model-gateway";
import {
  BunCodexProcessRunner,
  CodexProcessAbortedError,
  CodexProcessOutputLimitError,
  CodexProcessTimedOutError,
  isolatedCodexEnvironment,
  type CodexProcessRunner,
} from "@outbound/infrastructure/ai/codex-process-runner";

const DEFAULT_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const fallbackModels: readonly ModelDescriptor[] = [{
  id: "gpt-5.6-luna",
  displayName: "GPT-5.6 Luna",
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  structuredOutput: "supported",
}];

export interface CodexCliModelGatewayOptions {
  readonly codexHome: string;
  readonly binaryPath?: string;
  readonly runner?: CodexProcessRunner;
  readonly maxOutputBytes?: number;
  readonly now?: () => Date;
}

export class CodexCliModelGateway implements ModelGateway {
  readonly provider = "codex-cli" as const;
  readonly transport = "codex-process" as const;
  readonly #codexHome: string;
  readonly #binaryPath: string;
  readonly #runner: CodexProcessRunner;
  readonly #maxOutputBytes: number;
  readonly #now: () => Date;

  constructor(options: CodexCliModelGatewayOptions) {
    this.#codexHome = requiredAbsolutePath(options.codexHome, "CODEX_SERVICE_HOME");
    this.#binaryPath = required(options.binaryPath ?? "codex", "CODEX_BINARY_PATH");
    this.#runner = options.runner ?? new BunCodexProcessRunner();
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const startedAt = performance.now();
    const directory = await mkdtemp(join(tmpdir(), "noosphere-codex-"));
    const schemaPath = join(directory, "output-schema.json");
    const outputPath = join(directory, "last-message.json");
    try {
      await writeFile(schemaPath, JSON.stringify(request.outputSchema), { encoding: "utf8", mode: 0o600 });
      const result = await this.#runner.run({
        command: buildCodexCommand({
          binaryPath: this.#binaryPath,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          schemaPath,
          outputPath,
        }),
        cwd: directory,
        env: isolatedCodexEnvironment(this.#codexHome),
        stdin: buildCodexPrompt(request),
        deadlineAt: request.deadlineAt,
        ...(request.signal ? { signal: request.signal } : {}),
        maxOutputBytes: this.#maxOutputBytes,
      });
      if (result.exitCode !== 0) throw classifyCodexFailure(result.stderr, result.stdout);
      const rawText = await readCodexOutput(outputPath, result.stdout);
      let rawOutput: unknown;
      try {
        rawOutput = JSON.parse(rawText);
      } catch (error) {
        throw invalidCodexOutput("Codex did not return valid JSON", error);
      }
      let output: T;
      try {
        output = request.parse(rawOutput);
      } catch (error) {
        throw invalidCodexOutput("Codex output does not satisfy the requested contract", error);
      }
      return {
        output,
        metadata: {
          provider: this.provider,
          transport: this.transport,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: "unknown" },
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        },
      };
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (error instanceof CodexProcessTimedOutError) {
        throw new ModelGatewayError("AI_PROVIDER_TIMEOUT", this.provider, "Codex exceeded the invocation deadline", true, true, { cause: error });
      }
      if (error instanceof CodexProcessAbortedError || request.signal?.aborted) {
        throw new ModelGatewayError("AI_PROVIDER_ABORTED", this.provider, "Codex invocation was aborted", false, false, { cause: error });
      }
      if (error instanceof CodexProcessOutputLimitError) {
        throw new ModelGatewayError("AI_PROVIDER_OUTPUT_INVALID", this.provider, "Codex exceeded the bounded process output", false, false, { cause: error });
      }
      throw new ModelGatewayError("AI_PROVIDER_INVOCATION_FAILED", this.provider, "Codex process failed before producing a response", true, true, { cause: error });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export interface CodexCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly hidden: boolean;
  readonly supportedReasoningEfforts: readonly string[];
}

export interface CodexModelDiscovery {
  list(input: {
    readonly binaryPath: string;
    readonly codexHome: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly CodexCatalogModel[]>;
}

export interface CodexModelCatalogOptions {
  readonly codexHome: string;
  readonly binaryPath?: string;
  readonly discovery?: CodexModelDiscovery;
  readonly now?: () => Date;
}

export class CodexModelCatalog implements ModelCatalog {
  readonly provider = "codex-cli" as const;
  readonly #codexHome: string;
  readonly #binaryPath: string;
  readonly #discovery: CodexModelDiscovery;
  readonly #now: () => Date;

  constructor(options: CodexModelCatalogOptions) {
    this.#codexHome = requiredAbsolutePath(options.codexHome, "CODEX_SERVICE_HOME");
    this.#binaryPath = required(options.binaryPath ?? "codex", "CODEX_BINARY_PATH");
    this.#discovery = options.discovery ?? new CodexAppServerModelDiscovery();
    this.#now = options.now ?? (() => new Date());
  }

  async list(signal?: AbortSignal): Promise<ModelCatalogSnapshot> {
    const observedAt = this.#now();
    try {
      const discovered = await this.#discovery.list({
        binaryPath: this.#binaryPath,
        codexHome: this.#codexHome,
        ...(signal ? { signal } : {}),
      });
      const models = discovered
        .filter((model) => !model.hidden)
        .map(toModelDescriptor)
        .filter((model) => model.reasoningEfforts.length > 0);
      if (models.length === 0) throw new Error("CODEX_MODEL_CATALOG_EMPTY");
      return { provider: this.provider, status: "healthy", models, observedAt, errorCode: null };
    } catch (error) {
      const status = classifyCatalogStatus(error);
      return {
        provider: this.provider,
        status,
        models: fallbackModels,
        observedAt,
        errorCode: status === "authentication_required"
          ? "AI_PROVIDER_AUTHENTICATION_FAILED"
          : "AI_PROVIDER_CATALOG_UNAVAILABLE",
      };
    }
  }
}

export class CodexAppServerModelDiscovery implements CodexModelDiscovery {
  async list(input: {
    readonly binaryPath: string;
    readonly codexHome: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly CodexCatalogModel[]> {
    if (input.signal?.aborted) throw new CodexProcessAbortedError("CODEX_PROCESS_ABORTED");
    const process = Bun.spawn([input.binaryPath, "app-server", "--stdio"], {
      cwd: tmpdir(),
      env: { ...isolatedCodexEnvironment(input.codexHome) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const onAbort = () => process.kill();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      writeJsonLine(process.stdin, {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "noosphere-model-catalog", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        },
      });
      await readResponse(process.stdout, 1, input.signal);
      writeJsonLine(process.stdin, { method: "initialized" });
      writeJsonLine(process.stdin, {
        id: 2,
        method: "model/list",
        params: { includeHidden: false, limit: 100 },
      });
      const response = await readResponse(process.stdout, 2, input.signal);
      const models = parseCatalogResponse(response);
      process.kill();
      await process.exited;
      return models;
    } finally {
      process.kill();
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function buildCodexCommand(input: {
  readonly binaryPath: string;
  readonly model: string;
  readonly reasoningEffort: AiReasoningEffort;
  readonly schemaPath: string;
  readonly outputPath: string;
}): readonly string[] {
  return [
    input.binaryPath,
    "-a", "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--model", input.model,
    "--config", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`,
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--output-schema", input.schemaPath,
    "--output-last-message", input.outputPath,
    "--color", "never",
    "-",
  ];
}

function buildCodexPrompt<T>(request: StructuredModelRequest<T>): string {
  return [
    "You are a bounded JSON transformation worker inside Noosphere.",
    "Do not inspect the filesystem, run commands, browse, or call tools.",
    "Return only the final JSON object required by the output schema.",
    "",
    "Task instructions:",
    request.systemPrompt,
    "",
    "Input JSON:",
    JSON.stringify(request.input),
  ].join("\n");
}

async function readCodexOutput(outputPath: string, stdout: string): Promise<string> {
  try {
    return (await readFile(outputPath, "utf8")).trim();
  } catch {
    return stdout.trim();
  }
}

function classifyCodexFailure(stderr: string, stdout: string): ModelGatewayError {
  const detail = `${stderr}\n${stdout}`.toLowerCase();
  if (
    /(?:you(?:'ve| have) reached your usage limit|usage limit (?:is )?(?:exhausted|reached)|rate_limit_exceeded|quota (?:is )?(?:exhausted|exceeded)|too many requests|insufficient_quota)/.test(detail)
  ) {
    return new ModelGatewayError("AI_PROVIDER_QUOTA_EXHAUSTED", "codex-cli", "Codex usage limit is exhausted", true, false);
  }
  if (/not logged in|authentication|unauthorized|login required|missing auth/.test(detail)) {
    return new ModelGatewayError("AI_PROVIDER_AUTHENTICATION_FAILED", "codex-cli", "Codex service authentication is unavailable", true, false);
  }
  if (/model.+(not found|unavailable|unsupported)|unknown model/.test(detail)) {
    return new ModelGatewayError("AI_PROVIDER_MODEL_UNAVAILABLE", "codex-cli", "The selected Codex model is unavailable", true, false);
  }
  if (/unknownissuer|invalid peer certificate|certificate verify|failed to connect|connection refused|dns error|network is unreachable/.test(detail)) {
    return new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", "codex-cli", "Codex cannot reach OpenAI from the service", true, true);
  }
  return new ModelGatewayError("AI_PROVIDER_INVOCATION_FAILED", "codex-cli", "Codex CLI exited without a valid response", true, true);
}

function invalidCodexOutput(message: string, cause?: unknown): ModelGatewayError {
  return new ModelGatewayError("AI_PROVIDER_OUTPUT_INVALID", "codex-cli", message, false, false, { cause });
}

function toModelDescriptor(model: CodexCatalogModel): ModelDescriptor {
  const supported = new Set(aiReasoningEfforts);
  return {
    id: model.id,
    displayName: model.displayName,
    reasoningEfforts: model.supportedReasoningEfforts.filter((effort): effort is AiReasoningEffort => supported.has(effort as AiReasoningEffort)),
    structuredOutput: "supported",
  };
}

function parseCatalogResponse(value: unknown): readonly CodexCatalogModel[] {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.result.data)) {
    throw new Error("CODEX_MODEL_CATALOG_INVALID");
  }
  return value.result.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.displayName !== "string") return [];
    const supportedReasoningEfforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts.flatMap((option) => {
        if (!isRecord(option) || typeof option.reasoningEffort !== "string") return [];
        return [option.reasoningEffort];
      })
      : [];
    return [{
      id: item.id,
      displayName: item.displayName,
      hidden: item.hidden === true,
      supportedReasoningEfforts,
    }];
  });
}

function writeJsonLine(stdin: Bun.FileSink, value: unknown): void {
  stdin.write(`${JSON.stringify(value)}\n`);
  stdin.flush();
}

async function readResponse(
  stdout: ReadableStream<Uint8Array>,
  id: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      if (signal?.aborted) throw new CodexProcessAbortedError("CODEX_PROCESS_ABORTED");
      const item = await reader.read();
      if (item.done) throw new Error("CODEX_APP_SERVER_CLOSED");
      pending += decoder.decode(item.value, { stream: true });
      while (pending.includes("\n")) {
        const newline = pending.indexOf("\n");
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line) continue;
        const parsed = JSON.parse(line) as unknown;
        if (isRecord(parsed) && parsed.id === id) {
          if (isRecord(parsed.error)) throw new Error(`CODEX_APP_SERVER_ERROR: ${String(parsed.error.message ?? "unknown")}`);
          return parsed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function classifyCatalogStatus(error: unknown): ModelCatalogSnapshot["status"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/auth|login|unauthorized/.test(message)) return "authentication_required";
  return "degraded";
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}_REQUIRED`);
  return normalized;
}

function requiredAbsolutePath(value: string, name: string): string {
  const normalized = required(value, name);
  if (!normalized.startsWith("/")) throw new Error(`${name}_MUST_BE_ABSOLUTE`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

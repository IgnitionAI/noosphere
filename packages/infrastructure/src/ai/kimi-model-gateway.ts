import {
  ModelGatewayError,
  type AiReasoningEffort,
  type ModelCatalog,
  type ModelCatalogSnapshot,
  type ModelDescriptor,
  type ModelGateway,
  type ModelUsage,
  type StructuredModelRequest,
  type StructuredModelResult,
} from "@outbound/application/ai/model-gateway";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface KimiModelGatewayOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetcher?: Fetcher;
  readonly now?: () => Date;
}

const fallbackModelIds = [
  "kimi-for-coding",
  "kimi-for-coding-highspeed",
  "k3",
  "k3-256k",
] as const;

export class KimiChatModelGateway implements ModelGateway {
  readonly provider = "kimi-code" as const;
  readonly transport = "chat-completions" as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetcher: Fetcher;
  readonly #now: () => Date;

  constructor(options: KimiModelGatewayOptions) {
    this.#apiKey = required(options.apiKey, "KIMI_CODE_API_KEY");
    this.#baseUrl = normalizedBaseUrl(options.baseUrl ?? "https://api.kimi.com/coding/v1");
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const startedAt = performance.now();
    const abort = createDeadlineAbort(request.deadlineAt, request.signal, this.#now);
    try {
      const response = await this.#fetcher(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: request.outputName,
                description: request.outputDescription,
                parameters: request.outputSchema,
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: request.outputName },
          },
          reasoning: { effort: kimiReasoningEffort(request.reasoningEffort) },
          stream: false,
        }),
        signal: abort.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw classifyKimiHttpError(response.status, payload);
      }
      const rawOutput = readToolArguments(payload, request.outputName);
      let output: T;
      try {
        output = request.parse(rawOutput);
      } catch (error) {
        throw new ModelGatewayError(
          "AI_PROVIDER_OUTPUT_INVALID",
          this.provider,
          "Kimi returned an output that does not satisfy the requested contract",
          false,
          false,
          { cause: error },
        );
      }
      return {
        output,
        metadata: {
          provider: this.provider,
          transport: this.transport,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          usage: readUsage(payload),
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        },
      };
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (abort.timedOut()) {
        throw new ModelGatewayError(
          "AI_PROVIDER_TIMEOUT",
          this.provider,
          "Kimi did not complete before the invocation deadline",
          true,
          true,
          { cause: error },
        );
      }
      if (request.signal?.aborted) {
        throw new ModelGatewayError(
          "AI_PROVIDER_ABORTED",
          this.provider,
          "Kimi invocation was aborted",
          false,
          false,
          { cause: error },
        );
      }
      throw new ModelGatewayError(
        "AI_PROVIDER_INVOCATION_FAILED",
        this.provider,
        "Kimi invocation failed before producing a response",
        true,
        true,
        { cause: error },
      );
    } finally {
      abort.dispose();
    }
  }
}

export class KimiModelCatalog implements ModelCatalog {
  readonly provider = "kimi-code" as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetcher: Fetcher;
  readonly #now: () => Date;

  constructor(options: KimiModelGatewayOptions) {
    this.#apiKey = required(options.apiKey, "KIMI_CODE_API_KEY");
    this.#baseUrl = normalizedBaseUrl(options.baseUrl ?? "https://api.kimi.com/coding/v1");
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async list(signal?: AbortSignal): Promise<ModelCatalogSnapshot> {
    const observedAt = this.#now();
    try {
      const init: RequestInit = {
        headers: { authorization: `Bearer ${this.#apiKey}` },
      };
      if (signal) init.signal = signal;
      const response = await this.#fetcher(`${this.#baseUrl}/models`, init);
      const payload = await readJson(response);
      if (!response.ok) throw classifyKimiHttpError(response.status, payload);
      const models = readModelIds(payload).map(kimiModelDescriptor);
      if (models.length === 0) throw new Error("KIMI_MODEL_CATALOG_EMPTY");
      return {
        provider: this.provider,
        status: "healthy",
        models,
        observedAt,
        errorCode: null,
      };
    } catch (error) {
      const gatewayError = error instanceof ModelGatewayError ? error : null;
      return {
        provider: this.provider,
        status: gatewayError?.code === "AI_PROVIDER_AUTHENTICATION_FAILED"
          ? "authentication_required"
          : gatewayError?.code === "AI_PROVIDER_QUOTA_EXHAUSTED"
            ? "quota_exhausted"
            : "degraded",
        models: fallbackModelIds.map(kimiModelDescriptor),
        observedAt,
        errorCode: gatewayError?.code ?? "AI_PROVIDER_CATALOG_UNAVAILABLE",
      };
    }
  }
}

function kimiModelDescriptor(id: string): ModelDescriptor {
  return {
    id,
    displayName: id,
    reasoningEfforts: ["low", "max"],
    structuredOutput: "supported",
  };
}

function kimiReasoningEffort(effort: AiReasoningEffort): "low" | "max" {
  return effort === "low" || effort === "medium" ? "low" : "max";
}

function readModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return [...new Set(payload.data.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== "string" || model.id.trim().length === 0) return [];
    return [model.id.trim()];
  }))];
}

function readToolArguments(payload: unknown, outputName: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw invalidOutput("Kimi response does not contain choices");
  }
  for (const choice of payload.choices) {
    if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.tool_calls)) continue;
    for (const call of choice.message.tool_calls) {
      if (!isRecord(call) || !isRecord(call.function) || call.function.name !== outputName) continue;
      if (typeof call.function.arguments !== "string") {
        throw invalidOutput("Kimi tool call arguments are missing");
      }
      try {
        return JSON.parse(call.function.arguments);
      } catch (error) {
        throw new ModelGatewayError(
          "AI_PROVIDER_OUTPUT_INVALID",
          "kimi-code",
          "Kimi tool call arguments are not valid JSON",
          false,
          false,
          { cause: error },
        );
      }
    }
  }
  throw invalidOutput(`Kimi did not call ${outputName}`);
}

function readUsage(payload: unknown): ModelUsage {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    return { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: "unknown" };
  }
  const details = isRecord(payload.usage.prompt_tokens_details)
    ? payload.usage.prompt_tokens_details
    : null;
  return {
    inputTokens: nonNegativeInteger(payload.usage.prompt_tokens),
    cachedInputTokens: nonNegativeInteger(details?.cached_tokens),
    outputTokens: nonNegativeInteger(payload.usage.completion_tokens),
    source: "reported",
  };
}

function classifyKimiHttpError(status: number, payload: unknown): ModelGatewayError {
  const message = providerMessage(payload).toLowerCase();
  if (status === 401) {
    return new ModelGatewayError(
      "AI_PROVIDER_AUTHENTICATION_FAILED",
      "kimi-code",
      "Kimi authentication failed",
      true,
      false,
    );
  }
  if ([402, 403, 429].includes(status) && ["quota", "usage", "limit", "billing", "credit"].some((term) => message.includes(term))) {
    return new ModelGatewayError(
      "AI_PROVIDER_QUOTA_EXHAUSTED",
      "kimi-code",
      "Kimi quota is exhausted",
      true,
      false,
    );
  }
  if (status === 404 || ([400, 403, 422].includes(status) && message.includes("model"))) {
    return new ModelGatewayError(
      "AI_PROVIDER_MODEL_UNAVAILABLE",
      "kimi-code",
      "The selected Kimi model is unavailable",
      true,
      false,
    );
  }
  return new ModelGatewayError(
    "AI_PROVIDER_INVOCATION_FAILED",
    "kimi-code",
    `Kimi request failed with HTTP ${status}`,
    status >= 500,
    status >= 500,
  );
}

function createDeadlineAbort(deadlineAt: Date, signal: AbortSignal | undefined, now: () => Date) {
  const controller = new AbortController();
  let timeoutReached = false;
  const remainingMs = Math.max(0, deadlineAt.getTime() - now().getTime());
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new Error("MODEL_INVOCATION_DEADLINE_EXCEEDED"));
  }, remainingMs);
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromParent, { once: true });
  if (signal?.aborted) abortFromParent();
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 1_000) } };
  }
}

function providerMessage(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return "";
}

function invalidOutput(message: string): ModelGatewayError {
  return new ModelGatewayError(
    "AI_PROVIDER_OUTPUT_INVALID",
    "kimi-code",
    message,
    false,
    false,
  );
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}_REQUIRED`);
  return normalized;
}

function normalizedBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("KIMI_CODE_BASE_URL_MUST_USE_HTTPS");
  }
  return normalized;
}

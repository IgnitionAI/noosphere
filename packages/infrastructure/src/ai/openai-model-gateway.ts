import { ModelGatewayError, type ModelGateway, type ModelGatewayErrorCode, type StructuredModelRequest, type StructuredModelResult } from "@outbound/application/ai/model-gateway";

type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;
export interface OpenAiModelGatewayOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly maxOutputTokens?: number;
  readonly fetcher?: Fetcher;
}

/** Function-output contract shared by connection probes and production research. */
export class OpenAiResponsesModelGateway implements ModelGateway {
  readonly provider = "openai-api" as const;
  readonly transport = "responses-api" as const;
  constructor(private readonly options: OpenAiModelGatewayOptions) {}

  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const started = performance.now();
    const reasoningEffort = request.reasoningEffort === "max" || request.reasoningEffort === "ultra" ? "xhigh" : request.reasoningEffort;
    const remaining = request.deadlineAt.getTime() - Date.now();
    if (request.signal?.aborted) throw failure("AI_PROVIDER_ABORTED");
    if (remaining <= 0) throw failure("AI_PROVIDER_TIMEOUT");
    const timeout = AbortSignal.timeout(Math.min(remaining, 2_147_483_647));
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
    try {
      const response = await (this.options.fetcher ?? fetch)(`${(this.options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/responses`, {
        method: "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          reasoning: { effort: reasoningEffort },
          input: [{ role: "system", content: request.systemPrompt }, { role: "user", content: JSON.stringify(request.input) }],
          tools: [{ type: "function", name: request.outputName, description: request.outputDescription, parameters: request.outputSchema, strict: false }],
          tool_choice: { type: "function", name: request.outputName },
          parallel_tool_calls: false,
          max_output_tokens: this.options.maxOutputTokens ?? 16_384,
          stream: false,
          store: false,
        }),
      });
      if (!response.ok) {
        const code: ModelGatewayErrorCode = response.status === 401 || response.status === 403 ? "AI_PROVIDER_AUTHENTICATION_FAILED"
          : response.status === 402 || response.status === 429 ? "AI_PROVIDER_QUOTA_EXHAUSTED"
          : response.status === 404 ? "AI_PROVIDER_MODEL_UNAVAILABLE"
          : response.status === 400 || response.status === 422 ? "AI_PROVIDER_OUTPUT_INVALID" : "AI_PROVIDER_UNAVAILABLE";
        // Provider text may echo keys, prompts or URLs; never propagate it.
        await response.body?.cancel();
        throw failure(code);
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw failure("AI_PROVIDER_OUTPUT_INVALID"); }
      const calls = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
      const call = calls.find((value) => isRecord(value) && value.type === "function_call" && value.name === request.outputName);
      if (!isRecord(call) || typeof call.arguments !== "string") throw failure("AI_PROVIDER_OUTPUT_INVALID");
      let output: T;
      try { output = request.parse(JSON.parse(call.arguments)); }
      catch { throw failure("AI_PROVIDER_OUTPUT_INVALID"); }
      const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
      const details = usage && isRecord(usage.input_tokens_details) ? usage.input_tokens_details : null;
      return { output, metadata: {
        provider: this.provider, transport: this.transport, model: request.model, reasoningEffort,
        usage: { inputTokens: tokenCount(usage?.input_tokens), outputTokens: tokenCount(usage?.output_tokens), cachedInputTokens: tokenCount(details?.cached_tokens), source: usage ? "reported" : "unknown" },
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      } };
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (request.signal?.aborted) throw failure("AI_PROVIDER_ABORTED");
      if (timeout.aborted) throw failure("AI_PROVIDER_TIMEOUT");
      throw failure("AI_PROVIDER_UNAVAILABLE");
    }
  }
}
function failure(code: ModelGatewayErrorCode) { return new ModelGatewayError(code, "openai-api", code, false, code === "AI_PROVIDER_UNAVAILABLE" || code === "AI_PROVIDER_TIMEOUT"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function tokenCount(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null; }

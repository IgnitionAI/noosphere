import { ModelGatewayError, type ModelGateway, type ModelGatewayErrorCode, type StructuredModelRequest, type StructuredModelResult } from "@outbound/application/ai/model-gateway";
import { fetchPublicProvider, ProviderDestinationForbiddenError } from "@outbound/infrastructure/ai/provider-destination";

type Provider = "anthropic" | "openrouter" | "openai-compatible";
interface Options {
  readonly provider: Provider;
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  readonly maxOutputTokens?: number;
  readonly fetcher?: (url: string, options?: RequestInit) => Promise<Response>;
}
export class ApiKeyModelGateway implements ModelGateway {
  readonly provider: Provider;
  readonly transport: "anthropic-messages" | "chat-completions";
  constructor(private readonly options: Options) {
    this.provider = options.provider;
    this.transport = this.provider === "anthropic" ? "anthropic-messages" : "chat-completions";
  }
  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const fail = (code: ModelGatewayErrorCode) => new ModelGatewayError(code, this.provider, code, false, code === "AI_PROVIDER_UNAVAILABLE" || code === "AI_PROVIDER_TIMEOUT");
    const started = performance.now();
    const remaining = request.deadlineAt.getTime() - Date.now();
    if (request.signal?.aborted) throw fail("AI_PROVIDER_ABORTED");
    if (remaining <= 0) throw fail("AI_PROVIDER_TIMEOUT");
    const timeout = AbortSignal.timeout(Math.min(remaining, 2_147_483_647));
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
    const anthropic = this.provider === "anthropic";
    const reasoningEffort = request.reasoningEffort === "ultra" ? (anthropic ? "max" : "xhigh")
      : !anthropic && request.reasoningEffort === "max" ? "xhigh" : request.reasoningEffort;
    const base = this.options.baseUrl ?? (anthropic ? "https://api.anthropic.com/v1" : "https://openrouter.ai/api/v1");
    const body = anthropic ? {
      model: request.model, max_tokens: this.options.maxOutputTokens ?? 16_384,
      system: request.systemPrompt, messages: [{ role: "user", content: JSON.stringify(request.input) }],
      output_config: { effort: reasoningEffort },
      tools: [{ name: request.outputName, description: request.outputDescription, input_schema: request.outputSchema }],
      // Auto also works with models that prohibit forced tool choice. A missing tool result fails validation.
      tool_choice: { type: "auto", disable_parallel_tool_use: true }, stream: false,
    } : {
      model: request.model, max_completion_tokens: this.options.maxOutputTokens ?? 16_384,
      messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: JSON.stringify(request.input) }],
      ...(this.provider === "openrouter" ? { reasoning: { effort: reasoningEffort } } : { reasoning_effort: reasoningEffort }),
      tools: [{ type: "function", function: { name: request.outputName, description: request.outputDescription, parameters: request.outputSchema } }],
      tool_choice: { type: "function", function: { name: request.outputName } }, parallel_tool_calls: false, stream: false,
      ...(this.provider === "openrouter" ? { provider: { require_parameters: true, allow_fallbacks: false } } : {}),
    };
    try {
      const fetcher = this.options.fetcher ?? (this.provider === "openai-compatible" ? fetchPublicProvider : fetch);
      const response = await fetcher(`${base.replace(/\/+$/, "")}/${anthropic ? "messages" : "chat/completions"}`, {
        method: "POST", redirect: "error", signal,
        headers: anthropic ? { "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }
          : { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw fail(response.status === 401 || response.status === 403 ? "AI_PROVIDER_AUTHENTICATION_FAILED"
          : response.status === 402 || response.status === 429 ? "AI_PROVIDER_QUOTA_EXHAUSTED"
          : response.status === 404 ? "AI_PROVIDER_MODEL_UNAVAILABLE"
          : response.status === 400 || response.status === 422 ? "AI_PROVIDER_OUTPUT_INVALID" : "AI_PROVIDER_UNAVAILABLE");
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw fail("AI_PROVIDER_OUTPUT_INVALID"); }
      let output: T;
      try {
        if (!record(payload)) throw new Error("invalid");
        if (anthropic) {
          const call = Array.isArray(payload.content) ? payload.content.find((item) => record(item) && item.type === "tool_use" && item.name === request.outputName) : null;
          if (!record(call)) throw new Error("missing tool");
          output = request.parse(call.input);
        } else {
          const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
          const message = record(choice) && record(choice.message) ? choice.message : null;
          const call = message && Array.isArray(message.tool_calls) ? message.tool_calls.find((item) => record(item) && record(item.function) && item.function.name === request.outputName) : null;
          if (!record(call) || !record(call.function) || typeof call.function.arguments !== "string") throw new Error("missing tool");
          output = request.parse(JSON.parse(call.function.arguments));
        }
      } catch { throw fail("AI_PROVIDER_OUTPUT_INVALID"); }
      const usage = record(payload) && record(payload.usage) ? payload.usage : null;
      const details = usage && record(usage.prompt_tokens_details) ? usage.prompt_tokens_details : null;
      return { output, metadata: { provider: this.provider, transport: this.transport, model: request.model, reasoningEffort,
        usage: { inputTokens: tokens(anthropic ? usage?.input_tokens : usage?.prompt_tokens), outputTokens: tokens(anthropic ? usage?.output_tokens : usage?.completion_tokens), cachedInputTokens: tokens(anthropic ? usage?.cache_read_input_tokens : details?.cached_tokens), source: usage ? "reported" : "unknown" },
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      } };
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (error instanceof ProviderDestinationForbiddenError) throw fail("AI_PROVIDER_DESTINATION_FORBIDDEN");
      throw fail(request.signal?.aborted ? "AI_PROVIDER_ABORTED" : timeout.aborted ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_UNAVAILABLE");
    }
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function tokens(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null; }

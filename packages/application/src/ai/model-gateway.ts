export const aiProviderIds = ["kimi-code", "codex-cli", "openai-api"] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

export const aiTransports = ["chat-completions", "codex-process", "responses-api"] as const;
export type AiTransport = (typeof aiTransports)[number];

export const aiReasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AiReasoningEffort = (typeof aiReasoningEfforts)[number];

export const aiCapabilities = [
  "icp_research",
  "content_strategy",
  "content_idea",
  "content_brief",
  "content_writer",
  "content_audit",
  "content_critic",
  "brand_direction",
  "channel_strategy",
  "prospect_decision",
  "message_generation",
  "setter",
  "evaluation",
] as const;
export type AiCapability = (typeof aiCapabilities)[number];

export interface ModelRoute {
  readonly provider: AiProviderId;
  readonly model: string;
  readonly reasoningEffort: AiReasoningEffort;
}

export interface ModelUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly source: "reported" | "estimated" | "unknown";
}

export interface ModelInvocationMetadata extends ModelRoute {
  readonly transport: AiTransport;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
}

export interface StructuredModelRequest<T> {
  readonly workspaceId: string;
  readonly capability: AiCapability;
  readonly requestKey: string;
  readonly model: string;
  readonly reasoningEffort: AiReasoningEffort;
  readonly systemPrompt: string;
  readonly input: unknown;
  readonly outputName: string;
  readonly outputDescription: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly parse: (value: unknown) => T;
  readonly deadlineAt: Date;
  readonly signal?: AbortSignal;
}

export interface StructuredModelResult<T> {
  readonly output: T;
  readonly metadata: ModelInvocationMetadata;
}

export interface ModelGateway {
  readonly provider: AiProviderId;
  readonly transport: AiTransport;
  invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>>;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly reasoningEfforts: readonly AiReasoningEffort[];
  readonly structuredOutput: "supported" | "unsupported" | "unknown";
}

export interface ModelCatalogSnapshot {
  readonly provider: AiProviderId;
  readonly status: "healthy" | "degraded" | "quota_exhausted" | "authentication_required" | "unavailable";
  readonly models: readonly ModelDescriptor[];
  readonly observedAt: Date;
  readonly errorCode: ModelGatewayErrorCode | null;
}

export interface ModelCatalog {
  readonly provider: AiProviderId;
  list(signal?: AbortSignal): Promise<ModelCatalogSnapshot>;
}

export type ModelGatewayErrorCode =
  | "AI_PROVIDER_ABORTED"
  | "AI_PROVIDER_AUTHENTICATION_FAILED"
  | "AI_PROVIDER_CATALOG_UNAVAILABLE"
  | "AI_PROVIDER_INVOCATION_FAILED"
  | "AI_PROVIDER_MODEL_UNAVAILABLE"
  | "AI_PROVIDER_OUTPUT_INVALID"
  | "AI_PROVIDER_QUOTA_EXHAUSTED"
  | "AI_PROVIDER_TIMEOUT";

export class ModelGatewayError extends Error {
  readonly name = "ModelGatewayError";

  constructor(
    readonly code: ModelGatewayErrorCode,
    readonly provider: AiProviderId,
    message: string,
    readonly fallbackAllowed: boolean,
    readonly retryableOnProvider: boolean,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
  }
}

export function unknownModelUsage(): ModelUsage {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    source: "unknown",
  };
}

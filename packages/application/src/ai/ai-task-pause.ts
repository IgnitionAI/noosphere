import { ModelGatewayError, type AiCapability, type ModelRoute } from "@outbound/application/ai/model-gateway";

/** A provider failure after all explicitly selected routes requires an operator action. */
export class AiTaskPauseError extends ModelGatewayError {
  readonly name = "AiTaskPauseError";
  private persistedJobId: string | undefined;
  markPersisted(jobId: string): void { this.persistedJobId = jobId; }
  isPersistedFor(jobId: string): boolean { return this.persistedJobId === jobId; }
  constructor(error: ModelGatewayError, readonly capability: AiCapability, readonly requestKey: string, readonly routes: readonly ModelRoute[]) {
    super(error.code, error.provider, error.code, false, false, { cause: error });
  }
}

export function requiresManualAiResume(error: unknown): error is ModelGatewayError {
  return error instanceof ModelGatewayError && [
    "AI_PROVIDER_AUTHENTICATION_FAILED", "AI_PROVIDER_CATALOG_UNAVAILABLE", "AI_PROVIDER_INVOCATION_FAILED",
    "AI_PROVIDER_MODEL_UNAVAILABLE", "AI_PROVIDER_QUOTA_EXHAUSTED", "AI_PROVIDER_TIMEOUT", "AI_PROVIDER_UNAVAILABLE",
    "AI_PROVIDER_DESTINATION_FORBIDDEN",
  ].includes(error.code);
}

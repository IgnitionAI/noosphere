import { z, type ZodType } from "zod";
import type {
  AiCapability,
  AiProviderId,
  ModelRoute,
  StructuredModelResult,
} from "@outbound/application/ai/model-gateway";
import { ModelRouter } from "@outbound/application/ai/model-router";
import {
  routesForCapability,
  type WorkspaceAiModelPolicyReader,
} from "@outbound/application/workspaces/workspace-ai-settings";

export class WorkspaceStructuredModel {
  constructor(
    private readonly router: ModelRouter,
    private readonly policies: WorkspaceAiModelPolicyReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async invoke<T>(input: {
    readonly workspaceId: string;
    readonly capability: AiCapability;
    readonly requestKey: string;
    readonly fallbackRoutes: readonly ModelRoute[];
    readonly explicitRoutes?: readonly ModelRoute[];
    /**
     * Processing-policy boundary. The routes are filtered before any payload is
     * handed to a provider, so personal data cannot accidentally fall through
     * to a workspace fallback that has not been approved for the capability.
     */
    readonly allowedProviders?: readonly AiProviderId[];
    readonly systemPrompt: string;
    readonly payload: unknown;
    readonly outputName: string;
    readonly outputDescription: string;
    readonly schema: ZodType<T>;
    readonly parse?: (value: unknown) => T;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<StructuredModelResult<T> & { readonly providerAttempt: number; readonly fallbackReason: string | null }> {
    const policy = input.explicitRoutes?.length ? null : await this.policies.find(input.workspaceId);
    const configuredRoutes = input.explicitRoutes?.length
      ? input.explicitRoutes
      : routesForCapability(policy, input.capability, input.fallbackRoutes);
    const allowedProviders = input.allowedProviders ? new Set(input.allowedProviders) : null;
    const routes = allowedProviders
      ? configuredRoutes.filter((route) => allowedProviders.has(route.provider))
      : configuredRoutes;
    if (routes.length === 0) throw new Error("AI_PROCESSING_ROUTE_NOT_ALLOWED");
    return this.router.invokeStructured({
      workspaceId: input.workspaceId,
      capability: input.capability,
      requestKey: input.requestKey,
      routes,
      systemPrompt: input.systemPrompt,
      input: input.payload,
      outputName: input.outputName,
      outputDescription: input.outputDescription,
      outputSchema: z.toJSONSchema(input.schema) as Readonly<Record<string, unknown>>,
      parse: input.parse ?? ((value) => input.schema.parse(value)),
      deadlineAt: new Date(this.now().getTime() + (input.timeoutMs ?? 5 * 60_000)),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }
}

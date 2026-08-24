import {
  ModelGatewayError,
  type ModelGateway,
  type ModelRoute,
  type StructuredModelRequest,
  type StructuredModelResult,
} from "./model-gateway";

export interface RoutedModelRequest<T>
  extends Omit<StructuredModelRequest<T>, "model" | "reasoningEffort"> {
  readonly routes: readonly ModelRoute[];
}

export interface RoutedModelResult<T> extends StructuredModelResult<T> {
  readonly providerAttempt: number;
  readonly fallbackReason: string | null;
}

export class ModelRouter {
  readonly #gateways: ReadonlyMap<ModelRoute["provider"], ModelGateway>;

  constructor(
    gateways: readonly ModelGateway[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#gateways = new Map(gateways.map((gateway) => [gateway.provider, gateway]));
  }

  async invokeStructured<T>(request: RoutedModelRequest<T>): Promise<RoutedModelResult<T>> {
    if (request.routes.length === 0) {
      throw new Error("MODEL_ROUTE_REQUIRED");
    }

    let fallbackReason: string | null = null;
    let lastFallbackError: ModelGatewayError | null = null;
    for (const [index, route] of request.routes.entries()) {
      const gateway = this.#gateways.get(route.provider);
      if (!gateway) {
        fallbackReason = "AI_PROVIDER_UNCONFIGURED";
        continue;
      }

      try {
        const current = this.now();
        const remainingMs = Math.max(0, request.deadlineAt.getTime() - current.getTime());
        const remainingRoutes = request.routes.length - index;
        const attemptDeadline = remainingRoutes > 1
          ? new Date(current.getTime() + Math.floor(remainingMs / remainingRoutes))
          : request.deadlineAt;
        const result = await gateway.invokeStructured({
          ...request,
          deadlineAt: attemptDeadline,
          model: route.model,
          reasoningEffort: route.reasoningEffort,
        });
        return {
          ...result,
          providerAttempt: index + 1,
          fallbackReason,
        };
      } catch (error) {
        if (!(error instanceof ModelGatewayError) || !error.fallbackAllowed) {
          throw error;
        }
        lastFallbackError = error;
        fallbackReason = error.code;
      }
    }

    if (lastFallbackError) throw lastFallbackError;

    throw new ModelGatewayError(
      "AI_PROVIDER_INVOCATION_FAILED",
      request.routes.at(-1)?.provider ?? "kimi-code",
      "No configured model route completed the invocation",
      false,
      false,
    );
  }
}

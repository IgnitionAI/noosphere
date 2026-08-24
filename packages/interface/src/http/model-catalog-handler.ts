import type { ModelCatalogApplication } from "@outbound/application/ai/model-catalog-application";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const route = "/api/v1/ai/models";

export function createModelCatalogHttpHandler(input: {
  readonly application: ModelCatalogApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname !== route) return problem(404, "ROUTE_NOT_FOUND", "Route not found");
      if (request.method !== "GET") {
        const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        response.headers.set("allow", "GET");
        return response;
      }
      await input.contextResolver.resolve(request);
      const providers = await input.application.list(request.signal);
      return Response.json({
        providers: providers.map((provider) => ({
          provider: provider.provider,
          status: provider.status,
          models: provider.models,
          observedAt: provider.observedAt.toISOString(),
          errorCode: provider.errorCode,
        })),
      });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function problem(status: number, code: string, detail: string): Response {
  return Response.json(
    {
      type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
      title: code,
      status,
      detail,
      code,
    },
    { status, headers: { "content-type": "application/problem+json; charset=utf-8" } },
  );
}

import type { ContentPerformanceApplication } from "@outbound/application/content/content-performance";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

export function createContentPerformanceHttpHandler(input: { readonly application: ContentPerformanceApplication; readonly contextResolver: RequestContextResolver }) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      if (request.method !== "GET") return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
      if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(context.role)) throw new PermissionError();
      return Response.json(JSON.parse(JSON.stringify(await input.application.get(context.workspaceId))));
    } catch (error) {
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", "Workspace access is required");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class PermissionError extends Error {}
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

import type { EditorialLearningApplication } from "@outbound/application/content/editorial-learning";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

export function isEditorialLearningRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/learning";
}

export function createEditorialLearningHttpHandler(input: {
  readonly application: EditorialLearningApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      if (request.method !== "GET") return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
      if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(context.role)) throw new WorkspaceAccessDeniedError("Workspace access is required");
      const learning = await input.application.latest(context.workspaceId);
      return learning ? Response.json(normalize(learning)) : problem(404, "EDITORIAL_LEARNING_NOT_FOUND", "No editorial learning is available yet");
    } catch (error) {
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

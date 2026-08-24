import { ZodError, z } from "zod";
import type { SocialContentSyncApplication } from "@outbound/application/content/social-content-sync";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

export function isSocialContentRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/social-posts"
    || pathname === "/api/v1/content/social-posts/status";
}

export function createSocialContentHttpHandler(input: {
  readonly application: SocialContentSyncApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      requireViewer(context.role);
      if (request.method !== "GET") return problem(405, "METHOD_NOT_ALLOWED", "Only GET is supported");
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/content/social-posts/status") {
        return Response.json(normalize(await input.application.status({ workspaceId: context.workspaceId })));
      }
      if (url.pathname === "/api/v1/content/social-posts") {
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const limit = z.coerce.number().int().min(1).max(100).default(30).parse(url.searchParams.get("limit") ?? undefined);
        return Response.json(normalize(await input.application.list({
          workspaceId: context.workspaceId,
          ...(cursor ? { cursor } : {}),
          limit,
        })));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.message === "SOCIAL_CONTENT_CURSOR_INVALID") return problem(422, "SOCIAL_CONTENT_CURSOR_INVALID", "The social content cursor is invalid");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
class PermissionError extends Error {}
function requireViewer(role: string) { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new PermissionError("Workspace access is required"); }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

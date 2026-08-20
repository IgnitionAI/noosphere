import { ZodError, z } from "zod";
import type { ContentIdeaApplication } from "@outbound/application/content/content-ideas";
import { contentIdeaStatuses } from "@outbound/domain/content/content-idea";
import { contentIdeaDiscoveryRequestSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

const listQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(contentIdeaStatuses).optional(),
}).strict();

export function isContentIdeaRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/ideas"
    || pathname === "/api/v1/content/ideas/discover"
    || /^\/api\/v1\/content\/idea-discovery-runs\/[^/]+$/.test(pathname);
}

export function createContentIdeaHttpHandler(input: { application: ContentIdeaApplication; contextResolver: RequestContextResolver }) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/content/ideas" && request.method === "GET") {
        requireViewer(context.role);
        const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));
        return json(normalize(await input.application.list({
          workspaceId: context.workspaceId,
          limit: query.limit,
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.status ? { status: query.status } : {}),
        })));
      }
      if (url.pathname === "/api/v1/content/ideas/discover" && request.method === "POST") {
        requireOperator(context.role);
        const body = contentIdeaDiscoveryRequestSchema.parse(await request.json());
        return json(normalize(await input.application.discover({ workspaceId: context.workspaceId, userId: context.userId, requestKey: body.requestKey })), 202);
      }
      const run = url.pathname.match(/^\/api\/v1\/content\/idea-discovery-runs\/([^/]+)$/);
      if (run && request.method === "GET") {
        requireViewer(context.role);
        const result = await input.application.findRun({ workspaceId: context.workspaceId, runId: z.string().uuid().parse(run[1]) });
        return result ? json(normalize(result)) : problem(404, "CONTENT_IDEA_RUN_NOT_FOUND", "The discovery run does not exist in this workspace");
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const code = error instanceof Error ? error.message : "";
      if (code === "CONTENT_IDEA_ACTIVE_STRATEGY_REQUIRED") return problem(409, code, "Publish the editorial strategy before researching ideas");
      if (code === "CONTENT_IDEA_RUN_NOT_FOUND") return problem(404, code, "The discovery run does not exist in this workspace");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
class PermissionError extends Error {}
function requireViewer(role: string) { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new PermissionError("Workspace access is required"); }
function requireOperator(role: string) { if (!["operator", "admin", "owner"].includes(role)) throw new PermissionError("Operator access is required"); }
function json(body: unknown, status = 200) { return Response.json(body, { status }); }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

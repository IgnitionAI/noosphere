import { ZodError, z } from "zod";
import type { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const requestSchema = z.object({ requestKey: z.string().trim().min(8).max(300) }).strict();
const updateSchema = requestSchema.extend({ snapshot: editorialStrategySnapshotSchema }).strict();

export function isContentStrategyRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/strategy"
    || pathname === "/api/v1/content/strategy/derive"
    || pathname === "/api/v1/content/strategy/publish";
}

export function createContentStrategyHttpHandler(input: {
  readonly application: EditorialStrategyApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/v1/content/strategy" && request.method === "GET") {
        requireViewer(context.role);
        const strategy = await input.application.find(context.workspaceId);
        return strategy ? json(normalize(strategy)) : problem(404, "EDITORIAL_STRATEGY_NOT_FOUND", "No editorial strategy exists for this workspace");
      }
      if (pathname === "/api/v1/content/strategy/derive" && request.method === "POST") {
        requireOperator(context.role);
        const body = requestSchema.parse(await request.json());
        return json(normalize(await input.application.derive({ workspaceId: context.workspaceId, userId: context.userId, requestKey: body.requestKey })), 201);
      }
      if (pathname === "/api/v1/content/strategy" && request.method === "PUT") {
        requireOperator(context.role);
        const body = updateSchema.parse(await request.json());
        return json(normalize(await input.application.updateDraft({ workspaceId: context.workspaceId, userId: context.userId, requestKey: body.requestKey, snapshot: body.snapshot })));
      }
      if (pathname === "/api/v1/content/strategy/publish" && request.method === "POST") {
        requireOperator(context.role);
        const body = requestSchema.parse(await request.json());
        return json(normalize(await input.application.publish({ workspaceId: context.workspaceId, userId: context.userId, requestKey: body.requestKey })), 201);
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const code = error instanceof Error ? error.message : "";
      if (code === "EDITORIAL_STRATEGY_OFFER_REQUIRED") return problem(409, code, "Publish an offer before deriving the strategy");
      if (code === "EDITORIAL_STRATEGY_ICP_REQUIRED") return problem(409, code, "Publish an ICP before deriving the strategy");
      if (code === "EDITORIAL_STRATEGY_NOT_FOUND") return problem(404, code, "No editorial strategy exists for this workspace");
      if (code === "EDITORIAL_STRATEGY_UNAUTHORIZED_CLAIM") return problem(422, code, "The strategy references an unauthorized offer claim");
      if (code === "EDITORIAL_STRATEGY_OUTPUT_INVALID") return problem(502, code, "The AI returned an invalid editorial strategy after a bounded retry. Retry without changing your product brief");
      console.error(JSON.stringify({
        event: "content_strategy_http_error",
        path: new URL(request.url).pathname,
        method: request.method,
        error: code || "UNKNOWN_ERROR",
      }));
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class PermissionError extends Error {}
function requireViewer(role: string) {
  if (!['viewer', 'operator', 'reviewer', 'admin', 'owner'].includes(role)) throw new PermissionError("Workspace access is required");
}
function requireOperator(role: string) {
  if (!['operator', 'admin', 'owner'].includes(role)) throw new PermissionError("Operator access is required");
}
function json(body: unknown, status = 200) { return Response.json(body, { status }); }
function problem(status: number, code: string, detail: string) {
  return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

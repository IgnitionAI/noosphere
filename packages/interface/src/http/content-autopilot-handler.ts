import { ZodError } from "zod";
import type { ContentAutopilotApplication } from "@outbound/application/content/content-autopilot";
import { contentAutopilotConfigureRequestSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

export function isContentAutopilotRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/autopilot";
}

export function createContentAutopilotHttpHandler(input: {
  readonly application: ContentAutopilotApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      if (request.method === "GET") {
        requireViewer(context.role);
        return json(normalize(await input.application.get(context.workspaceId)));
      }
      if (request.method === "PUT") {
        requireOperator(context.role);
        const body = contentAutopilotConfigureRequestSchema.parse(await request.json());
        return json(normalize(await input.application.configure({
          workspaceId: context.workspaceId,
          userId: context.userId,
          requestKey: body.requestKey,
          enabled: body.enabled,
          localTime: body.localTime,
          timezone: body.timezone,
        })));
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const code = error instanceof Error ? error.message : "";
      if (code === "CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED") return problem(409, code, "Publish an editorial strategy before enabling the autopilot");
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

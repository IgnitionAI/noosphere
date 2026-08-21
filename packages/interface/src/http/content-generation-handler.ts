import { ZodError, z } from "zod";
import type { ContentGenerationApplication } from "@outbound/application/content/content-generation";
import { contentGenerationRequestSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();

export function isContentGenerationRoute(pathname: string): boolean {
  if (pathname === "/api/v1/content/ideas/discover") return false;
  return /^\/api\/v1\/content\/ideas\/[^/]+(?:\/brief)?$/.test(pathname)
    || /^\/api\/v1\/content\/assets\/[^/]+\/improve$/.test(pathname)
    || /^\/api\/v1\/content\/generation-runs\/[^/]+$/.test(pathname);
}

export function createContentGenerationHttpHandler(input: { application: ContentGenerationApplication; contextResolver: RequestContextResolver }) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      const pathname = new URL(request.url).pathname;
      const ideaBrief = pathname.match(/^\/api\/v1\/content\/ideas\/([^/]+)\/brief$/);
      if (ideaBrief && request.method === "POST") {
        requireOperator(context.role);
        const body = contentGenerationRequestSchema.parse(await request.json());
        return json(normalize(await input.application.generate({ workspaceId: context.workspaceId, userId: context.userId, ideaId: uuid.parse(ideaBrief[1]), requestKey: body.requestKey, ...(body.instruction ? { instruction: body.instruction } : {}) })), 202);
      }
      const idea = pathname.match(/^\/api\/v1\/content\/ideas\/([^/]+)$/);
      if (idea && request.method === "GET") {
        requireViewer(context.role);
        const ideaId = uuid.parse(idea[1]);
        const found = await input.application.findIdea({ workspaceId: context.workspaceId, ideaId });
        if (!found) return problem(404, "CONTENT_IDEA_NOT_FOUND", "The idea does not exist in this workspace");
        return json(normalize({ idea: found, asset: await input.application.findAssetByIdea({ workspaceId: context.workspaceId, ideaId }) }));
      }
      const improve = pathname.match(/^\/api\/v1\/content\/assets\/([^/]+)\/improve$/);
      if (improve && request.method === "POST") {
        requireOperator(context.role);
        const body = contentGenerationRequestSchema.parse(await request.json());
        return json(normalize(await input.application.improve({ workspaceId: context.workspaceId, userId: context.userId, assetId: uuid.parse(improve[1]), requestKey: body.requestKey, ...(body.instruction ? { instruction: body.instruction } : {}) })), 202);
      }
      const run = pathname.match(/^\/api\/v1\/content\/generation-runs\/([^/]+)$/);
      if (run && request.method === "GET") {
        requireViewer(context.role);
        const found = await input.application.findRun({ workspaceId: context.workspaceId, runId: uuid.parse(run[1]) });
        return found ? json(normalize(found)) : problem(404, "CONTENT_GENERATION_RUN_NOT_FOUND", "The generation run does not exist in this workspace");
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const code = error instanceof Error ? error.message : "";
      if (code === "CONTENT_IDEA_NOT_FOUND" || code === "CONTENT_ASSET_NOT_FOUND" || code === "CONTENT_GENERATION_RUN_NOT_FOUND") return problem(404, code, "The content resource does not exist in this workspace");
      if (code === "CONTENT_IDEA_NOT_GENERATABLE" || code === "CONTENT_IDEA_EVIDENCE_REQUIRED") return problem(409, code, "The idea needs fresh resolvable evidence before content can be generated");
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

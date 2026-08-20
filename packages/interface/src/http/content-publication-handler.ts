import { ZodError, z } from "zod";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";
import { SocialProviderError } from "@outbound/application/content/social-ports";
import { contentPublicationMutationRequestSchema, contentPublicationScheduleRequestSchema } from "@outbound/contracts/content";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();

export function isContentPublicationRoute(pathname: string): boolean {
  return pathname === "/api/v1/content/publications"
    || /^\/api\/v1\/content\/publications\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/content\/publications\/[^/]+\/(?:reschedule|cancel)$/.test(pathname)
    || /^\/api\/v1\/content\/assets\/[^/]+\/schedule$/.test(pathname);
}

export function createContentPublicationHttpHandler(input: {
  readonly application: ContentPublicationApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/content/publications" && request.method === "GET") {
        requireViewer(context.role);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const limit = z.coerce.number().int().min(1).max(100).default(30).parse(url.searchParams.get("limit") ?? undefined);
        return json(normalize(await input.application.list({ workspaceId: context.workspaceId, ...(cursor ? { cursor } : {}), limit })));
      }
      const schedule = url.pathname.match(/^\/api\/v1\/content\/assets\/([^/]+)\/schedule$/);
      if (schedule && request.method === "POST") {
        requireOperator(context.role);
        const body = contentPublicationScheduleRequestSchema.parse(await request.json());
        return json(normalize(await input.application.schedule({ workspaceId: context.workspaceId, userId: context.userId, assetId: uuid.parse(schedule[1]), requestKey: body.requestKey, scheduledFor: body.scheduledFor })), 202);
      }
      const reschedule = url.pathname.match(/^\/api\/v1\/content\/publications\/([^/]+)\/reschedule$/);
      if (reschedule && request.method === "POST") {
        requireOperator(context.role);
        const body = contentPublicationScheduleRequestSchema.parse(await request.json());
        return json(normalize(await input.application.reschedule({ workspaceId: context.workspaceId, userId: context.userId, publicationId: uuid.parse(reschedule[1]), requestKey: body.requestKey, scheduledFor: body.scheduledFor })));
      }
      const cancel = url.pathname.match(/^\/api\/v1\/content\/publications\/([^/]+)\/cancel$/);
      if (cancel && request.method === "POST") {
        requireOperator(context.role);
        const body = contentPublicationMutationRequestSchema.parse(await request.json());
        return json(normalize(await input.application.cancel({ workspaceId: context.workspaceId, userId: context.userId, publicationId: uuid.parse(cancel[1]), requestKey: body.requestKey })));
      }
      const detail = url.pathname.match(/^\/api\/v1\/content\/publications\/([^/]+)$/);
      if (detail && request.method === "GET") {
        requireViewer(context.role);
        const publication = await input.application.find({ workspaceId: context.workspaceId, publicationId: uuid.parse(detail[1]) });
        return publication ? json(normalize(publication)) : problem(404, "CONTENT_PUBLICATION_NOT_FOUND", "The publication does not exist in this workspace");
      }
      return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof SocialProviderError) {
        const status = error.code === "SOCIAL_RATE_LIMITED" || error.code === "SOCIAL_PROVIDER_UNAVAILABLE" ? 503 : 409;
        return problem(status, error.code, error.message);
      }
      const code = error instanceof Error ? error.message : "";
      if (code === "CONTENT_ASSET_NOT_FOUND" || code === "CONTENT_PUBLICATION_NOT_FOUND") return problem(404, code, "The content resource does not exist in this workspace");
      if (["CONTENT_ASSET_NOT_READY", "CONTENT_PUBLICATION_STRATEGY_INACTIVE", "CONTENT_PUBLICATION_ACCOUNT_UNAVAILABLE", "CONTENT_PUBLICATION_NOT_RESCHEDULABLE", "CONTENT_PUBLICATION_NOT_CANCELLABLE"].includes(code)) return problem(409, code, "The publication prerequisites are no longer valid");
      if (code === "CONTENT_PUBLICATION_SCHEDULE_IN_PAST") return problem(422, code, "The publication date must be in the future");
      if (code === "CONTENT_PUBLICATION_CURSOR_INVALID") return problem(422, code, "The publication cursor is invalid");
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

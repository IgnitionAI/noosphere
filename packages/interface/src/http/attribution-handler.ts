import { ZodError, z } from "zod";
import type { AttributionApplication } from "@outbound/application/attribution/attribution";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  interactionId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
});

export function isAttributionRoute(pathname: string): boolean {
  return pathname === "/api/v1/attribution/journeys";
}

export function createAttributionHttpHandler(input: {
  readonly application: AttributionApplication;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await input.contextResolver.resolve(request);
      if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(context.role)) throw new PermissionError("Workspace access is required");
      if (request.method !== "GET") return problem(405, "METHOD_NOT_ALLOWED", "Only GET is supported");
      const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return Response.json(normalize(await input.application.listJourneys({
        workspaceId: context.workspaceId,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit,
        ...(query.interactionId ? { interactionId: query.interactionId } : {}),
        ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      })));
    } catch (error) {
      if (error instanceof ZodError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.message === "ATTRIBUTION_CURSOR_INVALID") return problem(422, "ATTRIBUTION_CURSOR_INVALID", "The attribution cursor is invalid");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
class PermissionError extends Error {}
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

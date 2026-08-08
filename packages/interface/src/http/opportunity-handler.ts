import { ZodError, z } from "zod";
import { OPPORTUNITY_STAGES } from "@outbound/domain/pipeline/opportunity";
import {
  OpportunityPipelineError,
  type PostgresOpportunityRepository,
} from "@outbound/infrastructure/pipeline/postgres-opportunity-repository";
import { postgresUuidSchema } from "@outbound/interface/http/http-schemas";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const collectionPath = "/api/v1/opportunities";
const changeStagePath = /^\/api\/v1\/opportunities\/([^/]+)\/actions\/change-stage$/;
const changeStageSchema = z.object({
  stage: z.enum(OPPORTUNITY_STAGES),
  reason: z.string().trim().min(2).max(1_000).nullable().optional(),
}).strict();

export function createOpportunityHttpHandler(input: {
  repository: Pick<PostgresOpportunityRepository, "list" | "changeStage">;
  contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (url.pathname === collectionPath && request.method === "GET") {
        requireViewer(context.role);
        return Response.json(await input.repository.list(context.workspaceId));
      }
      const stageMatch = changeStagePath.exec(url.pathname);
      if (stageMatch && request.method === "POST") {
        requireOperator(context.role);
        const body = changeStageSchema.parse(await request.json());
        return Response.json(await input.repository.changeStage({
          workspaceId: context.workspaceId,
          opportunityId: postgresUuidSchema.parse(stageMatch[1]),
          stage: body.stage,
          reason: body.reason ?? null,
          now: new Date(),
        }));
      }
      if (url.pathname === collectionPath || stageMatch) {
        const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        response.headers.set("allow", url.pathname === collectionPath ? "GET" : "POST");
        return response;
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The opportunity request is invalid");
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspacePermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof OpportunityPipelineError) {
        return problem(error.status, error.code, error.message);
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Workspace access is required");
  }
}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Operator access is required");
  }
}

function problem(status: number, code: string, detail: string): Response {
  return Response.json({
    type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
    title: code,
    status,
    detail,
    code,
  }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

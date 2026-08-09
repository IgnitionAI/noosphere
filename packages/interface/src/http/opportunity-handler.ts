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
const opportunityPath = /^\/api\/v1\/opportunities\/([^/]+)$/;
const closePath = /^\/api\/v1\/opportunities\/([^/]+)\/actions\/close$/;
const reopenPath = /^\/api\/v1\/opportunities\/([^/]+)\/actions\/reopen$/;
const forecastPath = "/api/v1/pipeline/forecast";
const lostReasonsPath = /^\/api\/v1\/workspaces\/([^/]+)\/lost-reasons$/;
const changeStageSchema = z.object({
  stage: z.enum(OPPORTUNITY_STAGES),
  reason: z.string().trim().min(2).max(1_000).nullable().optional(),
}).strict();
const updateSchema = z.object({
  amount: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  ownerUserId: postgresUuidSchema.nullable().optional(),
  nextAction: z.string().trim().max(2_000).nullable().optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
}).strict();
const closeSchema = z.object({
  stage: z.enum(["won", "lost"]),
  amount: z.number().finite().positive().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  offerVersionId: postgresUuidSchema.nullable().optional(),
  lostReason: z.string().trim().min(1).max(120).nullable().optional(),
  lostComment: z.string().trim().max(2_000).nullable().optional(),
}).strict();
const lostReasonSchema = z.object({ key: z.string().trim().regex(/^[a-z0-9_]+$/).max(120), label: z.string().trim().min(1).max(300) }).strict();

export function createOpportunityHttpHandler(input: {
  repository: Pick<PostgresOpportunityRepository, "list" | "changeStage"> & Partial<Pick<PostgresOpportunityRepository, "update" | "close" | "reopen" | "forecast" | "listLostReasons" | "upsertLostReason">>;
  contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (url.pathname === collectionPath && request.method === "GET") {
        requireViewer(context.role);
        const result = await input.repository.list(context.workspaceId);
        return Response.json(context.role === "viewer" ? redactPipeline(result) : result);
      }
      if (url.pathname === forecastPath && request.method === "GET") {
        requireViewer(context.role);
        const from = parseDate(url.searchParams.get("from"));
        const to = parseDate(url.searchParams.get("to"));
        if (!input.repository.forecast) throw new Error("OPPORTUNITY_FORECAST_UNAVAILABLE");
        const result = await input.repository.forecast({ workspaceId: context.workspaceId, from, to });
        return Response.json(context.role === "viewer" ? redactForecast(result) : result);
      }
      const opportunityMatch = opportunityPath.exec(url.pathname);
      if (opportunityMatch && request.method === "PATCH") {
        requireOperator(context.role);
        const body = updateSchema.parse(await request.json());
        if (!input.repository.update) throw new Error("OPPORTUNITY_UPDATE_UNAVAILABLE");
        const updated = await input.repository.update({ workspaceId: context.workspaceId, opportunityId: postgresUuidSchema.parse(opportunityMatch[1]), actorUserId: context.userId, actorRole: context.role, ...body, now: new Date() });
        return Response.json(context.role === "viewer" ? redactOpportunity(updated) : updated);
      }
      const stageMatch = changeStagePath.exec(url.pathname);
      if (stageMatch && request.method === "POST") {
        requireOperator(context.role);
        const body = changeStageSchema.parse(await request.json());
        if (body.stage === "won" || body.stage === "lost") return problem(409, "OPPORTUNITY_CLOSE_REQUIRED", "Use the dedicated close action for won or lost opportunities");
        return Response.json(await input.repository.changeStage({
          workspaceId: context.workspaceId,
          opportunityId: postgresUuidSchema.parse(stageMatch[1]),
          stage: body.stage,
          reason: body.reason ?? null,
          actorUserId: context.userId,
          actorRole: context.role,
          now: new Date(),
        }));
      }
      const closeMatch = closePath.exec(url.pathname);
      if (closeMatch && request.method === "POST") {
        requireOperator(context.role);
        const body = closeSchema.parse(await request.json());
        if (!input.repository.close) throw new Error("OPPORTUNITY_CLOSE_UNAVAILABLE");
        return Response.json(await input.repository.close({ workspaceId: context.workspaceId, opportunityId: postgresUuidSchema.parse(closeMatch[1]), actorUserId: context.userId, actorRole: context.role, ...body, now: new Date() }));
      }
      const reopenMatch = reopenPath.exec(url.pathname);
      if (reopenMatch && request.method === "POST") {
        requireAdmin(context.role);
        if (!input.repository.reopen) throw new Error("OPPORTUNITY_REOPEN_UNAVAILABLE");
        return Response.json(await input.repository.reopen({ workspaceId: context.workspaceId, opportunityId: postgresUuidSchema.parse(reopenMatch[1]), actorUserId: context.userId, now: new Date() }));
      }
      const reasonsMatch = lostReasonsPath.exec(url.pathname);
      if (reasonsMatch && request.method === "GET") {
        requireViewer(context.role);
        assertWorkspacePath(context.workspaceId, reasonsMatch[1] ?? "");
        if (!input.repository.listLostReasons) throw new Error("LOST_REASONS_UNAVAILABLE");
        return Response.json({ data: await input.repository.listLostReasons(context.workspaceId) });
      }
      if (reasonsMatch && request.method === "PUT") {
        requireAdmin(context.role);
        assertWorkspacePath(context.workspaceId, reasonsMatch[1] ?? "");
        const body = lostReasonSchema.parse(await request.json());
        if (!input.repository.upsertLostReason) throw new Error("LOST_REASONS_UNAVAILABLE");
        return Response.json(await input.repository.upsertLostReason({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 200 });
      }
      if (url.pathname === collectionPath || stageMatch || opportunityMatch || closeMatch || reopenMatch || url.pathname === forecastPath || reasonsMatch) {
        const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        response.headers.set("allow", url.pathname === collectionPath ? "GET" : reasonsMatch ? "GET, PUT" : opportunityMatch ? "PATCH" : forecastPath === url.pathname ? "GET" : "POST");
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
        return problem(error.status, error.code, error.message, error.details);
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

function requireAdmin(role: string): void {
  if (![
    "admin",
    "owner",
  ].includes(role)) throw new WorkspacePermissionError("Administrator access is required");
}

function assertWorkspacePath(contextWorkspaceId: string, pathWorkspaceId: string): void {
  if (contextWorkspaceId !== pathWorkspaceId) throw new WorkspacePermissionError("Workspace access is required");
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new OpportunityPipelineError("INVALID_PERIOD", 422, { field: "date" });
  return date;
}

function redactOpportunity<T extends Record<string, unknown>>(opportunity: T): Omit<T, "amount" | "currency"> {
  const { amount: _amount, currency: _currency, ...safe } = opportunity;
  return safe as Omit<T, "amount" | "currency">;
}

function redactPipeline<T extends { data: readonly Record<string, unknown>[]; metrics: unknown }>(pipeline: T) {
  return { ...pipeline, data: pipeline.data.map(redactOpportunity) };
}

function redactForecast<T extends { data: readonly Record<string, unknown>[] }>(forecast: T) {
  return { ...forecast, data: forecast.data.map(({ amount: _amount, weightedRevenue: _weightedRevenue, ...safe }) => safe) };
}

function problem(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}): Response {
  return Response.json({
    type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
    title: code,
    status,
    detail,
    code,
    ...extensions,
  }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

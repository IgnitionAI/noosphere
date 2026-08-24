import { z } from "zod";
import type { ConsoleJobStatus, PostgresOperatorConsole } from "@outbound/infrastructure/operations/postgres-operator-console";
import { OperatorConsoleError } from "@outbound/infrastructure/operations/postgres-operator-console";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const correlationPath = /^\/api\/v1\/console\/correlations\/([^/]+)$/;
const requeuePath = /^\/api\/v1\/console\/jobs\/([^/]+)\/actions\/requeue$/;
const allowedStatuses = new Set<ConsoleJobStatus>(["pending", "running", "retry", "completed", "dead_lettered"]);

export function isOperatorConsoleRoute(pathname: string): boolean {
  return pathname.startsWith("/api/v1/console/");
}

type OperatorConsoleService = Pick<PostgresOperatorConsole, "listJobs" | "listDeadLetters" | "listRejectedWebhooks" | "traceCorrelation" | "requeue">;

export function createOperatorConsoleHttpHandler(input: { contextResolver: RequestContextResolver; service: OperatorConsoleService }) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const context = await input.contextResolver.resolve(request);
      requireReader(context.role);
      if (url.pathname === "/api/v1/console/jobs") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json({ data: await input.service.listJobs({
          workspaceId: context.workspaceId,
          statuses: statuses(url.searchParams.getAll("status")),
          ...(boundedText(url.searchParams.get("type"), 160) ? { type: boundedText(url.searchParams.get("type"), 160)! } : {}),
          ...dateRange(url),
          limit: limit(url),
        }) });
      }
      if (url.pathname === "/api/v1/console/dead-letters") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json({ data: await input.service.listDeadLetters({ workspaceId: context.workspaceId, ...(boundedText(url.searchParams.get("type"), 160) ? { type: boundedText(url.searchParams.get("type"), 160)! } : {}), ...dateRange(url), limit: limit(url) }) });
      }
      if (url.pathname === "/api/v1/console/webhooks/rejected") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json({ data: await input.service.listRejectedWebhooks({ workspaceId: context.workspaceId, ...dateRange(url), limit: limit(url) }) });
      }
      const correlation = correlationPath.exec(url.pathname);
      if (correlation) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const correlationId = boundedText(decodeURIComponent(correlation[1]!), 200);
        if (!correlationId) throw new OperatorConsoleError("INVALID_CORRELATION_ID", 422);
        return Response.json(await input.service.traceCorrelation({ workspaceId: context.workspaceId, correlationId }));
      }
      const requeue = requeuePath.exec(url.pathname);
      if (requeue) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        return Response.json(await input.service.requeue({ workspaceId: context.workspaceId, actorUserId: context.userId, jobId: uuid(requeue[1]!) }), { status: 202 });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof OperatorConsoleError) return problem(error.status, error.code, error.message);
      if (error instanceof z.ZodError || error instanceof URIError) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

function requireReader(role: WorkspaceRole) {
  if (!(["owner", "admin", "operator"] as WorkspaceRole[]).includes(role)) throw new OperatorConsoleError("OPERATOR_CONSOLE_FORBIDDEN", 403);
}
function requireAdmin(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin") throw new OperatorConsoleError("OPERATOR_CONSOLE_MUTATION_FORBIDDEN", 403);
}
function statuses(values: readonly string[]): readonly ConsoleJobStatus[] {
  const normalized = values.flatMap((value) => value.split(",")).filter(Boolean);
  if (!normalized.length) return ["retry", "dead_lettered"];
  if (normalized.includes("failed")) normalized.splice(normalized.indexOf("failed"), 1, "retry", "dead_lettered");
  if (normalized.some((value) => !allowedStatuses.has(value as ConsoleJobStatus))) throw new OperatorConsoleError("INVALID_JOB_STATUS", 422);
  return [...new Set(normalized)] as ConsoleJobStatus[];
}
function dateRange(url: URL): { from?: Date; to?: Date } {
  const from = date(url.searchParams.get("from"), false);
  const to = date(url.searchParams.get("to"), true);
  if (from && to && from > to) throw new OperatorConsoleError("INVALID_DATE_RANGE", 422);
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
function date(value: string | null, endOfDay: boolean): Date | null {
  if (!value) return null;
  const parsed = endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new OperatorConsoleError("INVALID_DATE", 422);
  return parsed;
}
function limit(url: URL): number {
  const value = url.searchParams.get("limit");
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new OperatorConsoleError("INVALID_LIMIT", 422);
  return parsed;
}
function boundedText(value: string | null, maximum: number): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new OperatorConsoleError("INVALID_FILTER", 422);
  return normalized;
}
function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new OperatorConsoleError("INVALID_ID", 422);
  return value;
}
function methodNotAllowed(allow: string) { const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed"); response.headers.set("allow", allow); return response; }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

import { ZodError, z } from "zod";
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension, type AnalyticsFilters } from "@outbound/application/analytics/workspace-analytics";
import { PostgresWorkspaceAnalytics } from "@outbound/infrastructure/analytics/postgres-workspace-analytics";
import type { Database } from "@outbound/infrastructure/database/client";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError, type RequestContextResolver } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();
const contextSchema = z.object({ userId: uuid, workspaceId: uuid, role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]) });
const dateValue = z.string().datetime({ offset: true });

export function createAnalyticsHttpHandler(input: { database: Database; contextResolver: RequestContextResolver }) {
  const repository = new PostgresWorkspaceAnalytics(input.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = contextSchema.parse(await input.contextResolver.resolve(request));
      const url = new URL(request.url);
      const filters = parseFilters(url, context.workspaceId);
      if (url.pathname === "/api/v1/analytics/funnel" && request.method === "GET") {
        requireViewer(context.role);
        const result = await repository.funnel(filters);
        return json(context.role === "owner" || context.role === "admin" ? result : redactFinancials(result));
      }
      if (url.pathname === "/api/v1/analytics/breakdown" && request.method === "GET") {
        requireViewer(context.role);
        const dimension = z.enum(ANALYTICS_DIMENSIONS).parse(url.searchParams.get("dimension"));
        return json({ period: { from: filters.from.toISOString(), to: filters.to.toISOString() }, dimension, data: await repository.breakdown({ ...filters, dimension }) });
      }
      if (url.pathname === "/api/v1/analytics/costs" && request.method === "GET") {
        requireOwnerAdmin(context.role);
        return json({ period: { from: filters.from.toISOString(), to: filters.to.toISOString() }, ...(await repository.costs(filters)) });
      }
      if (url.pathname === "/api/v1/analytics/export" && request.method === "GET") {
        requireOwnerAdmin(context.role);
        const dimensionValue = url.searchParams.get("dimension");
        const dimension = dimensionValue ? z.enum(ANALYTICS_DIMENSIONS).parse(dimensionValue) : undefined;
        const csv = await repository.exportCsv({ ...filters, actorUserId: context.userId, ...(dimension ? { dimension } : {}) });
        return new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=analytics.csv" } });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The analytics request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "ANALYTICS_PERIOD_INVALID") return problem(400, message, "The period start must precede its end");
      if (message === "ANALYTICS_FORBIDDEN") return problem(403, message, "This analytics view requires owner or admin access");
      return problem(500, "INTERNAL_ERROR", "An unexpected analytics error occurred");
    }
  };
}

function parseFilters(url: URL, workspaceId: string): AnalyticsFilters {
  const now = new Date();
  const from = parseDate(url.searchParams.get("from"), new Date(now.getTime() - 30 * 86_400_000));
  const to = parseDate(url.searchParams.get("to"), now);
  if (from >= to) throw new Error("ANALYTICS_PERIOD_INVALID");
  const campaignId = optionalUuid(url.searchParams.get("campaignId"));
  const icpVersionId = optionalUuid(url.searchParams.get("icpVersionId"));
  return { workspaceId, from, to, ...(campaignId ? { campaignId } : {}), ...(icpVersionId ? { icpVersionId } : {}), ...(url.searchParams.get("channel") ? { channel: url.searchParams.get("channel")! } : {}), ...(url.searchParams.get("signalType") ? { signalType: url.searchParams.get("signalType")! } : {}), ...(url.searchParams.get("role") ? { role: url.searchParams.get("role")! } : {}) };
}

function parseDate(value: string | null, fallback: Date): Date { return value ? new Date(dateValue.parse(value)) : fallback; }
function optionalUuid(value: string | null): string | undefined { return value ? uuid.parse(value) : undefined; }
function requireViewer(role: string): void { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new Error("WORKSPACE_FORBIDDEN"); }
function requireOwnerAdmin(role: string): void { if (!["owner", "admin"].includes(role)) throw new Error("ANALYTICS_FORBIDDEN"); }
function redactFinancials<T extends { metrics: { revenue: number } }>(value: T): T { return { ...value, metrics: { ...value.metrics, revenue: 0 } }; }
function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "content-type": "application/json" } }); }
function problem(status: number, code: string, detail: string): Response { return json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, status); }

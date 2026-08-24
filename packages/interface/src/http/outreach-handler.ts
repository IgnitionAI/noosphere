import { z, ZodError } from "zod";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError } from "@outbound/interface/http/request-context";
import type { Database } from "@outbound/infrastructure/database/client";
import { OutreachSchedulerError, PostgresOutreachScheduler } from "@outbound/infrastructure/scheduler/postgres-outreach-scheduler";

const uuid = z.string().uuid();
const contextSchema = z.object({ userId: uuid, workspaceId: uuid, role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]) });
const actionPath = /^\/api\/v1\/actions\/([^/]+)$/;
const actionMutationPath = /^\/api\/v1\/actions\/([^/]+)\/actions\/(cancel|retry)$/;
const campaignActionsPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions$/;

export interface OutreachHttpDependencies { readonly database: Database; readonly contextResolver: RequestContextResolver; }

export function createOutreachHttpHandler(dependencies: OutreachHttpDependencies) {
  const scheduler = new PostgresOutreachScheduler(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = contextSchema.parse(await dependencies.contextResolver.resolve(request));
      const url = new URL(request.url);
      const campaign = campaignActionsPath.exec(url.pathname);
      if (campaign && request.method === "GET") {
        requireReader(context.role);
        const status = url.searchParams.get("status") ?? undefined;
        return json({ data: await scheduler.list({ workspaceId: context.workspaceId, campaignId: uuid.parse(campaign[1]), ...(status ? { status } : {}) }) });
      }
      const action = actionPath.exec(url.pathname);
      if (action && request.method === "GET") {
        requireReader(context.role);
        const result = await scheduler.get({ workspaceId: context.workspaceId, actionId: uuid.parse(action[1]) });
        return result ? json(result) : problem(404, "OUTREACH_ACTION_NOT_FOUND", "Outreach action not found");
      }
      const mutation = actionMutationPath.exec(url.pathname);
      if (mutation && request.method === "POST") {
        requireOperator(context.role);
        const actionId = uuid.parse(mutation[1]);
        const result = mutation[2] === "cancel"
          ? await scheduler.cancel({ workspaceId: context.workspaceId, actionId, userId: context.userId })
          : await scheduler.retry({ workspaceId: context.workspaceId, actionId, userId: context.userId });
        return json(result);
      }
      const allowed = allowedMethods(url.pathname);
      if (allowed) return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed", { allowed });
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof OutreachSchedulerError) {
        const status = ["OUTREACH_ACTION_NOT_FOUND", "ENROLLMENT_NOT_FOUND", "CONTACT_NOT_FOUND", "SEQUENCE_VERSION_NOT_FOUND"].includes(error.code) ? 404 : 409;
        return problem(status, error.code, "Outreach action is not allowed", error.details);
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}
function requireReader(role: string): void { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required"); }
function requireOperator(role: string): void { if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required"); }
function allowedMethods(pathname: string): string | null { if (campaignActionsPath.test(pathname)) return "GET"; if (actionPath.test(pathname)) return "GET"; if (actionMutationPath.test(pathname)) return "POST"; return null; }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function problem(status: number, code: string, detail: string, extras: Record<string, unknown> = {}): Response { return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extras }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

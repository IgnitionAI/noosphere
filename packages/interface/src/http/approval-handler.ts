import { z, ZodError } from "zod";
import { PostgresApprovalRepository, ApprovalRepositoryError } from "@outbound/infrastructure/approvals/postgres-approval-repository";
import type { Database } from "@outbound/infrastructure/database/client";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError, type RequestContextResolver } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();
const contextSchema = z.object({ userId: uuid, workspaceId: uuid, role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]) });
const statusSchema = z.enum(["pending", "approved", "rejected", "invalidated"]);
const editSchema = z.object({ contentEdited: z.unknown() }).strict();
const rejectSchema = z.object({ justification: z.string().trim().min(1).max(2_000) }).strict();
const bulkSchema = z.union([
  z.object({ decisions: z.array(z.object({ itemId: uuid, decision: z.enum(["approve", "reject"]), justification: z.string().trim().min(1).max(2_000).optional() }).strict()).min(1).max(500) }).strict(),
  z.object({ itemIds: z.array(uuid).min(1).max(500), decision: z.enum(["approve", "reject"]), justification: z.string().trim().min(1).max(2_000).optional() }).strict(),
]);
const itemPath = /^\/api\/v1\/approval-items\/([^/]+)$/;
const approvePath = /^\/api\/v1\/approval-items\/([^/]+)\/actions\/approve$/;
const rejectPath = /^\/api\/v1\/approval-items\/([^/]+)\/actions\/reject$/;

export interface ApprovalHttpDependencies { readonly database: Database; readonly contextResolver: RequestContextResolver; }

export function createApprovalHttpHandler(dependencies: ApprovalHttpDependencies) {
  const repository = new PostgresApprovalRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    try {
      const context = await resolveContext(dependencies.contextResolver, request);
      const url = requestUrl;
      if (url.pathname === "/api/v1/approval-items" && request.method === "GET") {
        requireReader(context.role);
        const status = url.searchParams.get("status");
        const campaignId = url.searchParams.get("campaignId") ?? undefined;
        const parsedStatus = status ? statusSchema.parse(status) : undefined;
        const data = await repository.list({ workspaceId: context.workspaceId, ...(campaignId ? { campaignId: uuid.parse(campaignId) } : {}), ...(parsedStatus ? { status: parsedStatus } : {}), limit: Math.min(Number(url.searchParams.get("limit") ?? 100), 100) });
        return json({ data });
      }
      if (url.pathname === "/api/v1/approval-items/actions/bulk-decide" && request.method === "POST") {
        requireApprover(context.role);
        const body = bulkSchema.parse(await request.json());
        const decisions = "decisions" in body
          ? body.decisions.map((decision) => decision.justification === undefined
            ? { itemId: decision.itemId, decision: decision.decision }
            : { itemId: decision.itemId, decision: decision.decision, justification: decision.justification })
          : body.itemIds.map((itemId) => body.justification === undefined
            ? { itemId, decision: body.decision }
            : { itemId, decision: body.decision, justification: body.justification });
        return json(await repository.bulkDecide({ workspaceId: context.workspaceId, decisions, userId: context.userId }));
      }
      const item = itemPath.exec(url.pathname);
      if (item && request.method === "GET") {
        requireReader(context.role);
        const data = await repository.get({ workspaceId: context.workspaceId, itemId: uuid.parse(item[1]) });
        if (!data) return problem(404, "APPROVAL_ITEM_NOT_FOUND", "Approval item not found");
        return json(data);
      }
      if (item && request.method === "PATCH") {
        requireApprover(context.role);
        const body = editSchema.parse(await request.json());
        return json(await repository.update({ workspaceId: context.workspaceId, itemId: uuid.parse(item[1]), contentEdited: body.contentEdited }));
      }
      const approve = approvePath.exec(url.pathname);
      if (approve && request.method === "POST") {
        requireApprover(context.role);
        return json(await repository.decide({ workspaceId: context.workspaceId, itemId: uuid.parse(approve[1]), decision: "approve", userId: context.userId }));
      }
      const reject = rejectPath.exec(url.pathname);
      if (reject && request.method === "POST") {
        requireApprover(context.role);
        const body = rejectSchema.parse(await request.json());
        return json(await repository.decide({ workspaceId: context.workspaceId, itemId: uuid.parse(reject[1]), decision: "reject", userId: context.userId, justification: body.justification }));
      }
      const allowed = allowedMethods(url.pathname);
      if (allowed) return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed", { allowed });
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        if (rejectPath.test(requestUrl.pathname)) return problem(422, "REJECTION_JUSTIFICATION_REQUIRED", "A rejection justification is required");
        return problem(400, "INVALID_REQUEST", "The request is invalid");
      }
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof ApprovalRepositoryError) {
        const status = ["APPROVAL_ITEM_NOT_FOUND"].includes(error.code) ? 404 : ["REJECTION_JUSTIFICATION_REQUIRED", "EDITED_CONTENT_REQUIRED"].includes(error.code) ? 422 : 409;
        return problem(status, error.code, "Approval item action is not allowed", error.details);
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}
function requireReader(role: string): void { if (!["operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Approval content is not available to viewers"); }
function requireApprover(role: string): void { if (!["reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Reviewer approval is required"); }
async function resolveContext(resolver: RequestContextResolver, request: Request) { try { return contextSchema.parse(await resolver.resolve(request)); } catch (error) { if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error; throw new RequestAuthenticationError("The authenticated request context is invalid"); } }
function allowedMethods(pathname: string): string | null { if (pathname === "/api/v1/approval-items") return "GET"; if (pathname === "/api/v1/approval-items/actions/bulk-decide") return "POST"; if (itemPath.test(pathname)) return "GET, PATCH"; if (approvePath.test(pathname) || rejectPath.test(pathname)) return "POST"; return null; }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}): Response { return Response.json({ type: `https://api.ignition.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extensions }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

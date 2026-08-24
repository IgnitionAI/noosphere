import { z, ZodError } from "zod";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresMergeService } from "@outbound/infrastructure/crm/postgres-merge-service";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const uuidSchema = z.string().uuid();
const candidatePath = /^\/api\/v1\/merge-candidates\/([^/]+)$/;
const approvePath = /^\/api\/v1\/merge-candidates\/([^/]+)\/actions\/approve$/;
const rejectPath = /^\/api\/v1\/merge-candidates\/([^/]+)\/actions\/reject$/;
const undoPath = /^\/api\/v1\/contacts\/([^/]+)\/actions\/undo-merge$/;
const historyPath = /^\/api\/v1\/contacts\/([^/]+)\/merges$/;

export function createMergeHttpHandler(input: { database: Database; contextResolver: RequestContextResolver }) {
  const service = new PostgresMergeService(input.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (request.method === "GET" && url.pathname === "/api/v1/merge-candidates") {
        requireViewer(context.role);
        const candidates = await service.discover(context.workspaceId);
        return json(candidates);
      }
      const candidate = candidatePath.exec(url.pathname);
      if (request.method === "GET" && candidate) {
        requireViewer(context.role);
        const candidates = await service.listCandidates({ workspaceId: context.workspaceId });
        const found = candidates.find((row) => row.id === uuidSchema.parse(candidate[1]));
        if (!found) return problem(404, "MERGE_CANDIDATE_NOT_FOUND", "Merge candidate not found");
        return json(found);
      }
      const approve = approvePath.exec(url.pathname);
      if (request.method === "POST" && approve) {
        requireOperator(context.role);
        const result = await service.approve({ workspaceId: context.workspaceId, candidateId: uuidSchema.parse(approve[1]), decidedBy: context.userId });
        return json(result, 201);
      }
      const reject = rejectPath.exec(url.pathname);
      if (request.method === "POST" && reject) {
        requireOperator(context.role);
        const body = z.object({ reason: z.string().trim().max(2_000).nullish() }).strict().parse(await request.json().catch(() => ({})));
        const result = await service.reject({ workspaceId: context.workspaceId, candidateId: uuidSchema.parse(reject[1]), decidedBy: context.userId, reason: body.reason ?? null });
        return json(result);
      }
      const undo = undoPath.exec(url.pathname);
      if (request.method === "POST" && undo) {
        requireOperator(context.role);
        const result = await service.undo({ workspaceId: context.workspaceId, contactId: uuidSchema.parse(undo[1]), undoneBy: context.userId });
        return json(result);
      }
      const history = historyPath.exec(url.pathname);
      if (request.method === "GET" && history) {
        requireViewer(context.role);
        return json(await service.history({ workspaceId: context.workspaceId, contactId: uuidSchema.parse(history[1]) }));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
      if (["CONTACT_NOT_FOUND", "MERGE_CANDIDATE_NOT_FOUND", "MERGE_NOT_FOUND"].includes(message)) return problem(404, message, "Merge resource not found");
      if (["MERGE_CANDIDATE_REJECTED", "MERGE_IDENTITY_CONFLICT", "MERGE_ALREADY_UNDONE"].includes(message)) return problem(409, message, "The merge cannot be applied");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}
function requireViewer(role: string): void { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required"); }
function requireOperator(role: string): void { if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required"); }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string): Response { return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

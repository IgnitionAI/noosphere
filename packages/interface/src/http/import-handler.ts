import { ZodError, z } from "zod";
import { PostgresImportService } from "@outbound/infrastructure/crm/postgres-import-service";
import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const uuidSchema = z.string().uuid();
const importPath = /^\/api\/v1\/imports\/([^/]+)$/;
const previewPath = /^\/api\/v1\/imports\/([^/]+)\/preview$/;
const applyPath = /^\/api\/v1\/imports\/([^/]+)\/actions\/apply$/;
const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(10 * 1024 * 1024),
  mapping: z.record(z.string(), z.string()).optional(),
}).strict();

export function createImportHttpHandler(input: {
  database: Database;
  contextResolver: RequestContextResolver;
  queue?: JobQueue;
}) {
  const service = new PostgresImportService(input.database, input.queue);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (request.method === "POST" && url.pathname === "/api/v1/imports") {
        requireImporter(context.role);
        const body = request.headers.get("content-type")?.includes("application/json")
          ? uploadSchema.parse(await request.json())
          : { filename: request.headers.get("x-filename") ?? "import.csv", content: await request.text() };
        const batch = await service.create({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          filename: body.filename,
          content: body.content,
          ...(body.mapping ? { mapping: body.mapping } : {}),
          createdBy: context.userId,
        });
        return json(serialize(batch), 201);
      }
      const preview = previewPath.exec(url.pathname);
      if (request.method === "GET" && preview) {
        requireImportReader(context.role);
        const batch = await service.preview(context.workspaceId, uuidSchema.parse(preview[1]));
        return json(serialize(batch));
      }
      const apply = applyPath.exec(url.pathname);
      if (request.method === "POST" && apply) {
        requireImporter(context.role);
        const batch = await service.apply({
          workspaceId: context.workspaceId,
          batchId: uuidSchema.parse(apply[1]),
          correlationId: correlationId(request),
        });
        return json(serialize(batch), 202);
      }
      const detail = importPath.exec(url.pathname);
      if (request.method === "GET" && detail) {
        requireImportReader(context.role);
        const batch = await service.get(context.workspaceId, uuidSchema.parse(detail[1]));
        return json(serialize(batch));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
      if (message === "IMPORT_NOT_FOUND") return problem(404, message, "Import not found");
      if (message.startsWith("IMPORT_") || message === "INVALID_CSV") return problem(400, message, "The import is invalid");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}
function requireImporter(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required");
}
function requireImportReader(role: string): void {
  if (!["operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Import access is required");
}
function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && supplied.length <= 200 ? supplied : crypto.randomUUID();
}
function serialize(batch: Awaited<ReturnType<PostgresImportService["get"]>>) {
  return {
    id: batch.id,
    filename: batch.filename,
    status: batch.status,
    previewedAt: batch.previewedAt,
    appliedAt: batch.appliedAt,
    completedAt: batch.completedAt,
    totals: batch.totals,
    createdAt: batch.createdAt,
    rows: batch.rows.map((row) => ({
      id: row.id,
      lineNumber: row.lineNumber,
      rawData: row.rawData,
      normalizedData: row.normalizedData,
      status: row.status,
      reason: row.reason,
      companyId: row.companyId,
      contactId: row.contactId,
    })),
  };
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string): Response {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

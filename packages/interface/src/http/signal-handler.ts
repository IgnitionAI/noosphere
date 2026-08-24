import { z, ZodError } from "zod";
import type { SignalSource } from "@outbound/application/crm/signal-source";
import { SIGNAL_TYPES, type SignalType } from "@outbound/domain/crm/intent-signal";
import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresSignalRepository, SIGNAL_COLLECTION_JOB_TYPE } from "@outbound/infrastructure/crm/postgres-signal-repository";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError, type RequestContextResolver } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();
const contextSchema = z.object({ userId: uuid, workspaceId: uuid, role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]) });
const entitySignals = /^\/api\/v1\/(companies|contacts)\/([^/]+)\/signals$/;
const runPath = /^\/api\/v1\/signal-collection-runs\/([^/]+)$/;
const collectSchema = z.object({ companyId: uuid.optional(), contactId: uuid.optional(), requestKey: z.string().trim().min(1).max(500).optional(), signalTypes: z.array(z.enum(SIGNAL_TYPES)).min(1).max(SIGNAL_TYPES.length).optional() }).strict();

export interface SignalHttpDependencies {
  readonly database: Database;
  readonly contextResolver: RequestContextResolver;
  readonly signalSource: (workspaceId: string) => SignalSource | null;
  readonly jobQueue?: JobQueue;
}

export function createSignalHttpHandler(dependencies: SignalHttpDependencies) {
  const repository = new PostgresSignalRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = contextSchema.parse(await dependencies.contextResolver.resolve(request));
      const entityMatch = entitySignals.exec(url.pathname);
      if (entityMatch && request.method === "GET") {
        requireViewer(context.role);
        const entityType = entityMatch[1] === "companies" ? "company" : "contact";
        const entityId = uuid.parse(entityMatch[2]);
        const rows = await repository.listSignals({ workspaceId: context.workspaceId, entityType, entityId, includeExpired: url.searchParams.get("includeExpired") === "true" });
        return json({ data: rows.map((row) => serializeSignal(row, context.role)) });
      }
      if (url.pathname === "/api/v1/signals" && request.method === "GET") {
        requireViewer(context.role);
        const type = url.searchParams.get("signalType");
        const signalType = type ? z.enum(SIGNAL_TYPES).parse(type) : undefined;
        const entityType = url.searchParams.get("entityType");
        const parsedEntityType = entityType ? z.enum(["company", "contact"]).parse(entityType) : undefined;
        const entityId = url.searchParams.get("entityId");
        if (entityId) uuid.parse(entityId);
        const rows = await repository.listSignals({ workspaceId: context.workspaceId, ...(signalType ? { signalType } : {}), ...(parsedEntityType ? { entityType: parsedEntityType } : {}), ...(entityId ? { entityId } : {}), includeExpired: url.searchParams.get("includeExpired") === "true" });
        return json({ data: rows.map((row) => serializeSignal(row, context.role)) });
      }
      if (url.pathname === "/api/v1/signals/actions/collect" && request.method === "POST") {
        requireOwnerAdmin(context.role);
        const body = collectSchema.parse(await request.json().catch(() => ({})));
        const source = dependencies.signalSource(context.workspaceId);
        if (!source) return problem(503, "SIGNAL_SOURCE_UNAVAILABLE", "No signal source is configured");
        const configuredTypes = await repository.getConfiguredSignalTypes({ workspaceId: context.workspaceId, fallback: source.supportedTypes });
        const signalTypes = body.signalTypes ?? configuredTypes;
        const requestKey = body.requestKey ?? `signals:${body.companyId ?? body.contactId}:${crypto.randomUUID()}`;
        const result = await repository.requestCollection({ id: crypto.randomUUID(), workspaceId: context.workspaceId,
          ...(body.companyId ? { companyId: body.companyId } : {}), ...(body.contactId ? { contactId: body.contactId } : {}), requestKey, source: source.name,
          requestedBy: context.userId, correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID() });
        if (result.created && dependencies.jobQueue) await dependencies.jobQueue.enqueue({
          id: crypto.randomUUID(), workspaceId: context.workspaceId, type: SIGNAL_COLLECTION_JOB_TYPE,
          payload: { workspaceId: context.workspaceId, runId: result.run.id, signalTypes }, idempotencyKey: result.run.requestKey,
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), maxAttempts: 3, availableAt: new Date(),
        });
        else if (result.created) await repository.processRun({ workspaceId: context.workspaceId, runId: result.run.id, source, signalTypes });
        return json(serializeRun(result.run), result.created ? 202 : 200);
      }
      const runMatch = runPath.exec(url.pathname);
      if (runMatch && request.method === "GET") {
        requireViewer(context.role);
        const run = await repository.getRun({ workspaceId: context.workspaceId, runId: uuid.parse(runMatch[1]) });
        return run ? json(serializeRun(run)) : problem(404, "SIGNAL_RUN_NOT_FOUND", "Signal collection run not found");
      }
      if (url.pathname === "/api/v1/settings/signals" && request.method === "PUT") {
        requireOwnerAdmin(context.role);
        const body = z.object({ signalTypes: z.array(z.enum(SIGNAL_TYPES)).min(1).max(SIGNAL_TYPES.length) }).strict().parse(await request.json());
        const settings = await repository.setConfiguredSignalTypes({ workspaceId: context.workspaceId, signalTypes: body.signalTypes, updatedBy: context.userId });
        return json({ signalTypes: settings?.signalTypes ?? body.signalTypes });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "SIGNAL_FORBIDDEN") return problem(403, message, "Owner or admin access is required");
      if (message.endsWith("_NOT_FOUND")) return problem(404, message, "The requested resource was not found");
      if (message === "SIGNAL_TARGET_REQUIRED") return problem(400, message, "Exactly one companyId or contactId is required");
      if (message.startsWith("SIGNAL_")) return problem(422, message, "Signal collection cannot be completed");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function requireViewer(role: string): void { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new Error("WORKSPACE_FORBIDDEN"); }
function requireOwnerAdmin(role: string): void { if (!["admin", "owner"].includes(role)) throw new Error("SIGNAL_FORBIDDEN"); }

function serializeRun(run: { id: string; workspaceId: string; companyId: string | null; contactId: string | null; requestKey: string; status: string; source: string; errorCode: string | null; errorMessage: string | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  return { id: run.id, workspaceId: run.workspaceId, companyId: run.companyId, contactId: run.contactId, requestKey: run.requestKey, status: run.status, source: run.source, errorCode: run.errorCode, errorMessage: run.errorMessage, startedAt: run.startedAt?.toISOString() ?? null, completedAt: run.completedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString() };
}

function serializeSignal(row: { id: string; signalType: string; entityType: string; entityId: string; companyId: string | null; contactId: string | null; source: string; sources: unknown; providerEventId: string | null; evidenceUrl: string; evidenceSnippet: string | null; observedAt: Date; expiresAt: Date; confidence: string; legalBasis: string; sourceAuthorized: boolean }, role: string) {
  const restricted = role === "viewer";
  return { id: row.id, signalType: row.signalType, entityType: row.entityType, entityId: row.entityId, companyId: row.companyId, contactId: row.contactId, source: row.source, sources: row.sources, providerEventId: row.providerEventId, evidenceUrl: restricted ? null : row.evidenceUrl, evidenceSnippet: restricted ? null : row.evidenceSnippet, observedAt: row.observedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), confidence: row.confidence, legalBasis: row.legalBasis, sourceAuthorized: row.sourceAuthorized };
}

function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json" } }); }
function problem(status: number, code: string, detail: string): Response { return json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, status); }

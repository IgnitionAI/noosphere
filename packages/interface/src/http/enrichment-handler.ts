import { z, ZodError } from "zod";
import type { ProspectEnricher } from "@outbound/application/crm/prospect-enrichment-ports";
import type { EmailVerifier } from "@outbound/application/crm/email-verification-ports";
import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database } from "@outbound/infrastructure/database/client";
import { ENRICHMENT_JOB_TYPE, PostgresEnrichmentRepository } from "@outbound/infrastructure/crm/postgres-enrichment-repository";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const uuidSchema = z.string().uuid();
const requestContextSchema = z.object({
  userId: uuidSchema,
  workspaceId: uuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});
const enrichPath = /^\/api\/v1\/contacts\/([^/]+)\/actions\/enrich$/;
const jobPath = /^\/api\/v1\/enrichment-jobs\/([^/]+)$/;
const retryJobPath = /^\/api\/v1\/enrichment-jobs\/([^/]+)\/actions\/retry$/;
const contactEnrichmentPath = /^\/api\/v1\/contacts\/([^/]+)\/enrichment$/;
const requestSchema = z.object({
  requestKey: z.string().trim().min(1).max(500).optional(),
}).strict();

export interface EnrichmentHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
  readonly prospectEnricher?: () => ProspectEnricher | null;
  readonly emailVerifier?: EmailVerifier;
  readonly jobQueue?: JobQueue;
}

export function createEnrichmentHttpHandler(dependencies: EnrichmentHttpDependencies) {
  const repository = new PostgresEnrichmentRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = requestContextSchema.parse(await dependencies.contextResolver.resolve(request));
      if (url.pathname === "/api/v1/enrichment-coverage" && request.method === "GET") {
        requireViewer(context.role);
        return json({ data: await repository.coverage({ workspaceId: context.workspaceId }) });
      }
      const enrichMatch = enrichPath.exec(url.pathname);
      if (enrichMatch && request.method === "POST") {
        requireOperator(context.role);
        const contactId = uuidSchema.parse(enrichMatch[1]);
        const body = request.method === "POST"
          ? requestSchema.parse(await request.json().catch(() => ({})))
          : {};
        const requestKey = body.requestKey ?? `enrichment:${contactId}:${crypto.randomUUID()}`;
        const result = await repository.request({
          id: crypto.randomUUID(), workspaceId: context.workspaceId, contactId, requestKey,
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestedBy: context.userId,
        });
        if (result.created && dependencies.jobQueue) {
          await dependencies.jobQueue.enqueue({
            id: crypto.randomUUID(), workspaceId: context.workspaceId, type: ENRICHMENT_JOB_TYPE,
            payload: { workspaceId: context.workspaceId, jobId: result.job.id, contactId },
            idempotencyKey: result.job.requestKey, correlationId: result.job.correlationId,
            maxAttempts: result.job.maxAttempts, availableAt: new Date(),
          });
        } else if (result.created) {
          const enricher = dependencies.prospectEnricher?.() ?? null;
          if (enricher) {
            await repository.processJob({
              job: { id: result.job.id, workspaceId: context.workspaceId, jobId: result.job.id, contactId },
              enricher,
              ...(dependencies.emailVerifier ? { verifier: dependencies.emailVerifier } : {}),
            });
          }
        }
        return json(serializeJob(result.job), result.created ? 202 : 200);
      }

      const jobMatch = jobPath.exec(url.pathname);
      if (jobMatch && request.method === "GET") {
        requireViewer(context.role);
        const job = await repository.getJob({ workspaceId: context.workspaceId, jobId: uuidSchema.parse(jobMatch[1]) });
        if (!job) return problem(404, "ENRICHMENT_JOB_NOT_FOUND", "Enrichment job not found");
        const observations = await repository.listObservations({ workspaceId: context.workspaceId, contactId: job.entityId });
        return json({ ...serializeJob(job), observations: observations.map((observation) => serializeObservation(observation, context.role)) });
      }

      const retryMatch = retryJobPath.exec(url.pathname);
      if (retryMatch && request.method === "POST") {
        requireOperator(context.role);
        const job = await repository.retryJob({ workspaceId: context.workspaceId, jobId: uuidSchema.parse(retryMatch[1]) });
        if (!job) return problem(404, "ENRICHMENT_JOB_NOT_FOUND", "Enrichment job not found");
        if (job.status === "queued" && dependencies.jobQueue) {
          await dependencies.jobQueue.enqueue({
            id: crypto.randomUUID(), workspaceId: context.workspaceId, type: ENRICHMENT_JOB_TYPE,
            payload: { workspaceId: context.workspaceId, jobId: job.id, contactId: job.entityId },
            idempotencyKey: `${job.requestKey}:retry:${job.attempts + 1}`, correlationId: job.correlationId,
            maxAttempts: job.maxAttempts, availableAt: new Date(),
          });
        }
        return json(serializeJob(job), 202);
      }

      const contactMatch = contactEnrichmentPath.exec(url.pathname);
      if (contactMatch && request.method === "GET") {
        requireViewer(context.role);
        const contactId = uuidSchema.parse(contactMatch[1]);
        const observations = await repository.listObservations({ workspaceId: context.workspaceId, contactId });
        return json({ data: observations.map((observation) => serializeObservation(observation, context.role)) });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "ENRICHMENT_FORBIDDEN") return problem(403, message, "Operator access is required");
      if (message === "CONTACT_NOT_FOUND") return problem(404, message, "Contact not found");
      if (message === "ENRICHMENT_IDENTITY_REQUIRED") return problem(422, message, "A contact with a current company is required");
      if (message.startsWith("ENRICHMENT_")) return problem(409, message, "The enrichment request cannot be completed");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new Error("WORKSPACE_FORBIDDEN");
}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) throw new Error("ENRICHMENT_FORBIDDEN");
}

function serializeJob(job: {
  id: string; entityType: string; entityId: string; requestKey: string; status: string; provider: string;
  attempts: number; maxAttempts: number; errorCode: string | null; errorMessage: string | null;
  correlationId: string; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: job.id, entityType: job.entityType, entityId: job.entityId, requestKey: job.requestKey,
    status: job.status, provider: job.provider, attempts: job.attempts, maxAttempts: job.maxAttempts,
    errorCode: job.errorCode, errorMessage: job.errorMessage, correlationId: job.correlationId,
    startedAt: job.startedAt?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  };
}

function serializeObservation(observation: {
  id: string; field: string; value: string; normalizedValue: string; status: string; confidence: string;
  source: string; provider: string | null; evidenceUrl: string | null; evidenceSnippet: string | null;
  phoneKind: string | null; observedAt: Date; expiresAt: Date | null;
}, role: string) {
  const restricted = role === "viewer";
  return {
    id: observation.id, field: observation.field, value: observation.value, normalizedValue: observation.normalizedValue,
    status: observation.status, confidence: observation.confidence, source: observation.source,
    provider: observation.provider, evidenceUrl: restricted ? null : observation.evidenceUrl,
    evidenceSnippet: restricted ? null : observation.evidenceSnippet, phoneKind: observation.phoneKind,
    observedAt: observation.observedAt.toISOString(), expiresAt: observation.expiresAt?.toISOString() ?? null,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, detail: string): Response {
  return json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, status);
}

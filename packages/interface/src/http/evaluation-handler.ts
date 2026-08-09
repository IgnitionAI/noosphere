import { z } from "zod";
import { EvaluationServiceError } from "@outbound/infrastructure/ai/postgres-evaluation-service";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const capability = z.enum(["icp_research", "message_generation", "setter"]);
const datasetSchema = z.object({
  capability,
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5_000).nullable().optional(),
  rubricVersion: z.string().trim().min(1).max(120),
  cases: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    input: z.unknown(),
    expected: z.record(z.string(), z.unknown()),
    criteria: z.record(z.string(), z.unknown()).optional(),
    authorizedKnowledgeClaimIds: z.array(z.string().uuid()).max(50).optional(),
  }).strict()).min(1).max(500),
}).strict();
const promptSchema = z.object({ capability, content: z.string().trim().min(1).max(100_000) }).strict();
const configurationSchema = z.object({ capability, provider: z.literal("kimi-code"), model: z.string().trim().min(1).max(200), promptVersionId: z.string().uuid(), status: z.enum(["candidate", "shadow"]).optional() }).strict();
const runSchema = z.object({ datasetId: z.string().uuid(), configurationId: z.string().uuid(), requestKey: z.string().trim().min(1).max(300) }).strict();
const retrySchema = z.object({ requestKey: z.string().trim().min(1).max(300) }).strict();
const feedbackSchema = z.object({ rating: z.union([z.literal(-1), z.literal(1)]), reason: z.string().trim().max(1_000).nullable().optional() }).strict();
const runPath = /^\/api\/v1\/evaluation-runs\/([^/]+)$/;
const retryPath = /^\/api\/v1\/evaluation-runs\/([^/]+)\/actions\/retry$/;
const promotePath = /^\/api\/v1\/ai-configurations\/([^/]+)\/actions\/promote$/;
const feedbackPath = /^\/api\/v1\/ai-runs\/([^/]+)\/feedback$/;

export interface EvaluationHttpService {
  createDataset(input: z.infer<typeof datasetSchema> & { workspaceId: string; actorUserId: string }): Promise<unknown>;
  listDatasets(input: { workspaceId: string }): Promise<unknown[]>;
  createPromptVersion(input: z.infer<typeof promptSchema> & { workspaceId: string; actorUserId: string }): Promise<unknown>;
  createConfiguration(input: z.infer<typeof configurationSchema> & { workspaceId: string; actorUserId: string }): Promise<unknown>;
  listConfigurations(input: { workspaceId: string }): Promise<unknown[]>;
  requestRun(input: z.infer<typeof runSchema> & { workspaceId: string; actorUserId: string }): Promise<unknown>;
  retryFailedRun(input: { workspaceId: string; actorUserId: string; runId: string; requestKey: string }): Promise<unknown>;
  listRuns(input: { workspaceId: string }): Promise<unknown[]>;
  getRun(input: { workspaceId: string; runId: string }): Promise<unknown>;
  compareRuns(input: { workspaceId: string; leftRunId: string; rightRunId: string }): Promise<unknown>;
  promoteConfiguration(input: { workspaceId: string; actorUserId: string; configurationId: string }): Promise<unknown>;
  recordFeedback(input: { workspaceId: string; actorUserId: string; aiRunId: string; rating: -1 | 1; reason?: string | null | undefined }): Promise<unknown>;
}

export function createEvaluationHttpHandler(dependencies: { contextResolver: RequestContextResolver; service: EvaluationHttpService }) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const context = await dependencies.contextResolver.resolve(request);
      requireStudioAccess(context.role);
      if (url.pathname === "/api/v1/evaluation-datasets") {
        if (request.method === "GET") return Response.json({ data: await dependencies.service.listDatasets({ workspaceId: context.workspaceId }) });
        if (request.method !== "POST") return methodNotAllowed("GET, POST");
        requireAdmin(context.role);
        const body = datasetSchema.parse(await request.json());
        return Response.json(await dependencies.service.createDataset({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 201 });
      }
      if (url.pathname === "/api/v1/ai-prompt-versions") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        const body = promptSchema.parse(await request.json());
        return Response.json(await dependencies.service.createPromptVersion({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 201 });
      }
      if (url.pathname === "/api/v1/ai-configurations") {
        if (request.method === "GET") return Response.json({ data: await dependencies.service.listConfigurations({ workspaceId: context.workspaceId }) });
        if (request.method !== "POST") return methodNotAllowed("GET, POST");
        requireAdmin(context.role);
        const body = configurationSchema.parse(await request.json());
        return Response.json(await dependencies.service.createConfiguration({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 201 });
      }
      if (url.pathname === "/api/v1/evaluation-runs/compare") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json(await dependencies.service.compareRuns({ workspaceId: context.workspaceId, leftRunId: uuid(url.searchParams.get("left")), rightRunId: uuid(url.searchParams.get("right")) }));
      }
      if (url.pathname === "/api/v1/evaluation-runs") {
        if (request.method === "GET") return Response.json({ data: await dependencies.service.listRuns({ workspaceId: context.workspaceId }) });
        if (request.method !== "POST") return methodNotAllowed("GET, POST");
        requireAdmin(context.role);
        const body = runSchema.parse(await request.json());
        return Response.json(await dependencies.service.requestRun({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 202 });
      }
      const retry = retryPath.exec(url.pathname);
      if (retry) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        const body = retrySchema.parse(await request.json());
        return Response.json(await dependencies.service.retryFailedRun({ workspaceId: context.workspaceId, actorUserId: context.userId, runId: uuid(retry[1]), requestKey: body.requestKey }), { status: 202 });
      }
      const run = runPath.exec(url.pathname);
      if (run) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json(await dependencies.service.getRun({ workspaceId: context.workspaceId, runId: uuid(run[1]) }));
      }
      const promote = promotePath.exec(url.pathname);
      if (promote) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        return Response.json(await dependencies.service.promoteConfiguration({ workspaceId: context.workspaceId, actorUserId: context.userId, configurationId: uuid(promote[1]) }));
      }
      const feedback = feedbackPath.exec(url.pathname);
      if (feedback) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const body = feedbackSchema.parse(await request.json());
        return Response.json(await dependencies.service.recordFeedback({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId, aiRunId: uuid(feedback[1]) }), { status: 201 });
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof EvaluationServiceError) return problem(error.status, error.code, error.message);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", error instanceof Error ? error.message : "Invalid request");
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

export function isEvaluationRoute(pathname: string): boolean {
  return pathname === "/api/v1/evaluation-datasets"
    || pathname === "/api/v1/ai-prompt-versions"
    || pathname === "/api/v1/ai-configurations"
    || pathname === "/api/v1/evaluation-runs"
    || pathname === "/api/v1/evaluation-runs/compare"
    || runPath.test(pathname)
    || retryPath.test(pathname)
    || promotePath.test(pathname)
    || feedbackPath.test(pathname);
}

function requireStudioAccess(role: WorkspaceRole) {
  if (role === "viewer" || role === "reviewer") throw new EvaluationServiceError("AI_STUDIO_FORBIDDEN", 403);
}

function requireAdmin(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin") throw new EvaluationServiceError("AI_EVALUATION_MUTATION_FORBIDDEN", 403);
}

function uuid(value: string | null | undefined): string {
  return z.string().uuid().parse(value);
}

function methodNotAllowed(allow: string) {
  const response = problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route");
  response.headers.set("allow", allow);
  return response;
}

function problem(status: number, code: string, detail: string) {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

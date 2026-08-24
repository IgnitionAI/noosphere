import { z } from "zod";
import { KnowledgeServiceError } from "@outbound/infrastructure/knowledge/postgres-knowledge-service";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const sourcePath = /^\/api\/v1\/knowledge-sources\/([^/]+)\/actions\/(validate|withdraw)$/;
const claimPath = /^\/api\/v1\/knowledge-claims\/([^/]+)\/actions\/validate$/;
const sourceType = z.enum(["product_document", "proof", "customer_case", "objection_response"]);
const sourceStatus = z.enum(["draft", "validated", "expired", "withdrawn"]);
const sourceSchema = z.object({
  type: sourceType,
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(200_000).nullable(),
  researchDocumentId: z.string().uuid().nullable(),
  authorName: z.string().trim().min(1).max(300),
  publishedAt: z.string().datetime({ offset: true }),
  freshnessUntil: z.string().datetime({ offset: true }).nullable(),
}).strict();
const claimSchema = z.object({
  claim: z.string().trim().min(1).max(5_000),
  offerClaimId: z.string().uuid().nullable().default(null),
  sourceIds: z.array(z.string().uuid()).max(50).default([]),
}).strict();
const withdrawalSchema = z.object({ reason: z.string().trim().min(3).max(1_000) }).strict();

export interface KnowledgeHttpService {
  listSources(input: { workspaceId: string; type?: z.infer<typeof sourceType>; status?: z.infer<typeof sourceStatus>; fresh?: boolean }): Promise<unknown[]>;
  createSource(input: { workspaceId: string; actorUserId: string; type: z.infer<typeof sourceType>; title: string; content: string | null; researchDocumentId: string | null; authorName: string; publishedAt: Date; freshnessUntil: Date | null }): Promise<unknown>;
  validateSource(input: { workspaceId: string; actorUserId: string; sourceId: string }): Promise<unknown>;
  withdrawSource(input: { workspaceId: string; actorUserId: string; sourceId: string; reason: string }): Promise<unknown>;
  listClaims(input: { workspaceId: string }): Promise<unknown[]>;
  createClaim(input: { workspaceId: string; actorUserId: string; claim: string; offerClaimId: string | null; sourceIds: readonly string[] }): Promise<unknown>;
  validateClaim(input: { workspaceId: string; actorUserId: string; claimId: string }): Promise<unknown>;
}

export function createKnowledgeHttpHandler(dependencies: { contextResolver: RequestContextResolver; service: KnowledgeHttpService }) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const context = await dependencies.contextResolver.resolve(request);
      if (url.pathname === "/api/v1/knowledge-sources") {
        if (request.method === "GET") {
          const viewer = context.role === "viewer";
          const type = optionalEnum(url.searchParams.get("type"), sourceType);
          const status = viewer ? undefined : optionalEnum(url.searchParams.get("status"), sourceStatus);
          const fresh = viewer ? true : optionalBoolean(url.searchParams.get("fresh"));
          const data = await dependencies.service.listSources({
            workspaceId: context.workspaceId,
            ...(type ? { type } : {}),
            ...(status ? { status } : {}),
            ...(fresh !== undefined ? { fresh } : {}),
          });
          return Response.json({ data: viewer ? data.filter(isViewerSource) : data });
        }
        if (request.method !== "POST") return methodNotAllowed("GET, POST");
        requireContributor(context.role);
        const body = sourceSchema.parse(await request.json());
        const created = await dependencies.service.createSource({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId, publishedAt: new Date(body.publishedAt), freshnessUntil: body.freshnessUntil ? new Date(body.freshnessUntil) : null });
        return Response.json(created, { status: 201 });
      }
      const sourceAction = sourcePath.exec(url.pathname);
      if (sourceAction) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        const sourceId = uuid(sourceAction[1]);
        if (sourceAction[2] === "validate") return Response.json(await dependencies.service.validateSource({ workspaceId: context.workspaceId, actorUserId: context.userId, sourceId }));
        const body = withdrawalSchema.parse(await request.json());
        return Response.json(await dependencies.service.withdrawSource({ workspaceId: context.workspaceId, actorUserId: context.userId, sourceId, reason: body.reason }));
      }
      if (url.pathname === "/api/v1/knowledge-claims") {
        if (request.method === "GET") {
          const data = await dependencies.service.listClaims({ workspaceId: context.workspaceId });
          return Response.json({ data: context.role === "viewer" ? data.filter(isViewerClaim) : data });
        }
        if (request.method !== "POST") return methodNotAllowed("GET, POST");
        requireContributor(context.role);
        const body = claimSchema.parse(await request.json());
        return Response.json(await dependencies.service.createClaim({ ...body, workspaceId: context.workspaceId, actorUserId: context.userId }), { status: 201 });
      }
      const claimAction = claimPath.exec(url.pathname);
      if (claimAction) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireAdmin(context.role);
        return Response.json(await dependencies.service.validateClaim({ workspaceId: context.workspaceId, actorUserId: context.userId, claimId: uuid(claimAction[1]) }));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof KnowledgeServiceError) return problem(error.status, error.code, error.message);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED", error instanceof Error ? error.message : "Invalid request");
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

export function isKnowledgeRoute(pathname: string): boolean {
  return pathname === "/api/v1/knowledge-sources" || pathname === "/api/v1/knowledge-claims" || sourcePath.test(pathname) || claimPath.test(pathname);
}

function requireContributor(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin" && role !== "operator") throw new KnowledgeServiceError("KNOWLEDGE_MUTATION_FORBIDDEN", 403);
}

function requireAdmin(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin") throw new KnowledgeServiceError("KNOWLEDGE_APPROVAL_FORBIDDEN", 403);
}

function isViewerSource(value: unknown): boolean {
  return isObject(value) && value.effectiveStatus === "validated";
}

function isViewerClaim(value: unknown): boolean {
  return isObject(value) && value.effectiveStatus === "validated";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalEnum<T extends z.ZodEnum>(value: string | null, schema: T): z.infer<T> | undefined {
  return value ? schema.parse(value) : undefined;
}

function optionalBoolean(value: string | null): boolean | undefined {
  if (value === null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new KnowledgeServiceError("INVALID_FILTER", 422);
}

function uuid(value: string | null | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new KnowledgeServiceError("INVALID_ID", 422);
  return value;
}

function methodNotAllowed(allow: string) {
  const response = problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route");
  response.headers.set("allow", allow);
  return response;
}

function problem(status: number, code: string, detail: string) {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

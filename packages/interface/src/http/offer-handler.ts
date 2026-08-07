import { z, ZodError } from "zod";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresOfferRepository } from "@outbound/infrastructure/offers/postgres-offer-repository";
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
const claimSchema = z.object({
  claim: z.string().trim().min(1).max(5_000),
  validationStatus: z.enum(["hypothesis", "sourced", "validated", "invalidated"]),
  evidenceUri: z.string().trim().max(2_000).nullish(),
}).strict();
const categorySchema = z.enum(["service", "saas", "licence", "autre"]);
const createSchema = z.object({
  name: z.string().trim().min(1).max(500),
  category: categorySchema.default("autre"),
  targetAudience: z.string().max(5_000).default(""),
}).strict();
const patchSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  category: categorySchema.optional(),
  valueProposition: z.string().max(10_000).optional(),
  targetAudience: z.string().max(5_000).optional(),
  pricing: z.unknown().optional(),
  commercialRules: z.unknown().optional(),
  constraints: z.unknown().optional(),
  claims: z.array(claimSchema).max(100).optional(),
  objections: z.unknown().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), {
  message: "At least one field must be provided",
});
const offerPath = /^\/api\/v1\/offers\/([^/]+)$/;
const publishPath = /^\/api\/v1\/offers\/([^/]+)\/actions\/publish$/;
const versionsPath = /^\/api\/v1\/offers\/([^/]+)\/versions$/;

export interface OfferHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
}

export function createOfferHttpHandler(dependencies: OfferHttpDependencies) {
  const repository = new PostgresOfferRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await resolveContext(dependencies.contextResolver, request);
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/offers") {
        if (request.method === "GET") {
          requireViewer(context.role);
          return json({ data: (await repository.listOffers(context.workspaceId)).map(normalizeOffer) });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = createSchema.parse(await request.json());
          const offer = await repository.createOffer({ id: crypto.randomUUID(), workspaceId: context.workspaceId, createdBy: context.userId, ...body });
          return json(normalizeOffer(offer), 201);
        }
      }
      const match = offerPath.exec(url.pathname);
      if (match && request.method === "GET") {
        requireViewer(context.role);
        const offer = await repository.getOffer({ workspaceId: context.workspaceId, offerId: uuidSchema.parse(match[1]) });
        if (!offer) return problem(404, "OFFER_NOT_FOUND", "Offer not found");
        return json(normalizeOffer(offer));
      }
      if (match && request.method === "PATCH") {
        requireOperator(context.role);
        const body = patchSchema.parse(await request.json());
        const fields = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as never;
        const offer = await repository.updateOffer({ workspaceId: context.workspaceId, offerId: uuidSchema.parse(match[1]), fields });
        return json(normalizeOffer(offer));
      }
      const publish = publishPath.exec(url.pathname);
      if (publish && request.method === "POST") {
        requireAdmin(context.role);
        const version = await repository.publishOffer({ id: crypto.randomUUID(), workspaceId: context.workspaceId, offerId: uuidSchema.parse(publish[1]), userId: context.userId, publishedAt: new Date() });
        return json(normalizeVersion(version), 201);
      }
      const versions = versionsPath.exec(url.pathname);
      if (versions && request.method === "GET") {
        requireViewer(context.role);
        const data = await repository.listVersions({ workspaceId: context.workspaceId, offerId: uuidSchema.parse(versions[1]) });
        return json({ data: data.map(normalizeVersion) });
      }
      const allowed = allowedMethods(url.pathname);
      if (allowed) return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed", { allowed });
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid");
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const message = error instanceof Error ? error.message : "";
      if (message === "OFFER_NOT_FOUND") return problem(404, message, "Offer not found");
      if (message === "OFFER_DELETED") return problem(409, message, "Deleted offer cannot be published");
      if (message.startsWith("OFFER_INVALID:")) return problem(422, "OFFER_INVALID", "Offer is not publishable", { missing: message.slice("OFFER_INVALID:".length).split(",") });
      if (message.includes("offer_versions_offer_version_uq")) return problem(409, "OFFER_VERSION_ALLOCATION_CONFLICT", "Offer version allocation conflicted; retry");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalizeOffer(value: any) {
  return {
    ...value,
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : value.createdAt,
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : value.updatedAt,
    deletedAt: value.deletedAt instanceof Date ? value.deletedAt.toISOString() : value.deletedAt,
    versions: value.versions?.map(normalizeVersion),
  };
}
function normalizeVersion(value: any) {
  return {
    ...value,
    publishedAt: value.publishedAt instanceof Date ? value.publishedAt.toISOString() : value.publishedAt,
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : value.createdAt,
  };
}
class WorkspacePermissionError extends Error {}
function requireViewer(role: string) { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required"); }
function requireOperator(role: string) { if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required"); }
function requireAdmin(role: string) { if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Administrator access is required"); }
function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/offers") return "GET, POST";
  if (offerPath.test(pathname)) return "GET, PATCH";
  if (publishPath.test(pathname)) return "POST";
  if (versionsPath.test(pathname)) return "GET";
  return null;
}
async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try { return requestContextSchema.parse(await resolver.resolve(request)); }
  catch (error) { if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error; throw new RequestAuthenticationError("The authenticated request context is invalid"); }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}) { return Response.json({ type: `https://api.ignition.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extensions }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

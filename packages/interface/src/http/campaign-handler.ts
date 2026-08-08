import { z, ZodError } from "zod";
import { PostgresCampaignRepository, CampaignPreflightError } from "@outbound/infrastructure/campaigns/postgres-campaign-repository";
import { CampaignPopulationError, PostgresCampaignPopulationRepository } from "@outbound/infrastructure/campaigns/postgres-campaign-population-repository";
import type { Database } from "@outbound/infrastructure/database/client";
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
const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  objective: z.string().max(10_000).default(""),
  offerVersionId: uuidSchema,
  icpVersionId: uuidSchema,
  messagingStrategyVersionId: uuidSchema,
  aiPolicyVersionId: uuidSchema,
  sequenceVersionId: uuidSchema,
}).strict();
const campaignPatchSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  objective: z.string().max(10_000).optional(),
  offerVersionId: uuidSchema.optional(),
  icpVersionId: uuidSchema.optional(),
  messagingStrategyVersionId: uuidSchema.optional(),
  aiPolicyVersionId: uuidSchema.optional(),
  sequenceVersionId: uuidSchema.optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), {
  message: "At least one field must be provided",
});

const campaignPath = /^\/api\/v1\/campaigns\/([^/]+)$/;
const preflightPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/preflight$/;
const transitionPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/(activate|pause|resume|archive)$/;
const prospectsPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects$/;
const selectProspectsPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/select$/;
const prospectActionPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/([^/]+)\/actions\/(enroll|exclude)$/;
const explanationPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/([^/]+)\/explanation$/;
const selectSchema = z.object({ contactIds: z.array(uuidSchema).min(1).max(500) }).strict();
const excludeSchema = z.object({ reason: z.string().trim().min(1).max(1_000) }).strict();

export interface CampaignHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
}

export function createCampaignHttpHandler(dependencies: CampaignHttpDependencies) {
  const repository = new PostgresCampaignRepository(dependencies.database);
  const population = new PostgresCampaignPopulationRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await resolveContext(dependencies.contextResolver, request);

      if (url.pathname === "/api/v1/campaigns") {
        if (request.method === "GET") {
          requireViewer(context.role);
          return json({ data: await repository.listCampaigns(context.workspaceId) });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = campaignCreateSchema.parse(await request.json());
          const campaign = await repository.createCampaign({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            createdBy: context.userId,
            ...body,
          });
          return json(campaign, 201);
        }
      }

      const campaignMatch = campaignPath.exec(url.pathname);
      if (campaignMatch && request.method === "GET") {
        requireViewer(context.role);
        const campaign = await repository.getCampaign({ workspaceId: context.workspaceId, campaignId: uuidSchema.parse(campaignMatch[1]) });
        if (!campaign) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(campaign);
      }
      if (campaignMatch && request.method === "PATCH") {
        requireOperator(context.role);
        const body = campaignPatchSchema.parse(await request.json());
        const campaign = await repository.updateCampaign({
          workspaceId: context.workspaceId,
          campaignId: uuidSchema.parse(campaignMatch[1]),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.objective !== undefined ? { objective: body.objective } : {}),
          ...(body.offerVersionId !== undefined ? { offerVersionId: body.offerVersionId } : {}),
          ...(body.icpVersionId !== undefined ? { icpVersionId: body.icpVersionId } : {}),
          ...(body.messagingStrategyVersionId !== undefined ? { messagingStrategyVersionId: body.messagingStrategyVersionId } : {}),
          ...(body.aiPolicyVersionId !== undefined ? { aiPolicyVersionId: body.aiPolicyVersionId } : {}),
          ...(body.sequenceVersionId !== undefined ? { sequenceVersionId: body.sequenceVersionId } : {}),
        });
        return json(campaign);
      }

      const preflightMatch = preflightPath.exec(url.pathname);
      if (preflightMatch && request.method === "POST") {
        requireViewer(context.role);
        const result = await repository.preflight({ workspaceId: context.workspaceId, campaignId: uuidSchema.parse(preflightMatch[1]) });
        return json(result);
      }

      const transitionMatch = transitionPath.exec(url.pathname);
      if (transitionMatch && request.method === "POST") {
        requireAdmin(context.role);
        const campaign = await repository.transition({
          workspaceId: context.workspaceId,
          campaignId: uuidSchema.parse(transitionMatch[1]),
          transition: transitionMatch[2] as "activate" | "pause" | "resume" | "archive",
          userId: context.userId,
          at: new Date(),
        });
        return json(campaign);
      }

      const prospectsMatch = prospectsPath.exec(url.pathname);
      if (prospectsMatch && request.method === "GET") {
        requireViewer(context.role);
        const data = await population.listPopulation({ workspaceId: context.workspaceId, campaignId: uuidSchema.parse(prospectsMatch[1]) });
        return json({ data });
      }
      const selectMatch = selectProspectsPath.exec(url.pathname);
      if (selectMatch && request.method === "POST") {
        requireOperator(context.role);
        const body = selectSchema.parse(await request.json());
        const data = await population.select({ workspaceId: context.workspaceId, campaignId: uuidSchema.parse(selectMatch[1]), contactIds: body.contactIds, userId: context.userId });
        return json({ data });
      }
      const explanationMatch = explanationPath.exec(url.pathname);
      if (explanationMatch && request.method === "GET") {
        requireViewer(context.role);
        const data = await population.getExplanation({ workspaceId: context.workspaceId, campaignId: uuidSchema.parse(explanationMatch[1]), contactId: uuidSchema.parse(explanationMatch[2]) });
        return json(data);
      }
      const prospectActionMatch = prospectActionPath.exec(url.pathname);
      if (prospectActionMatch && request.method === "POST") {
        requireOperator(context.role);
        const campaignId = uuidSchema.parse(prospectActionMatch[1]);
        const contactId = uuidSchema.parse(prospectActionMatch[2]);
        if (prospectActionMatch[3] === "enroll") {
          return json(await population.enroll({ workspaceId: context.workspaceId, campaignId, contactId, userId: context.userId }), 201);
        }
        const body = excludeSchema.parse(await request.json());
        return json(await population.exclude({ workspaceId: context.workspaceId, campaignId, contactId, userId: context.userId, reason: body.reason }));
      }

      const allowed = allowedMethods(url.pathname);
      if (allowed) return methodNotAllowed(allowed);
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The request is invalid", { errors: error instanceof ZodError ? error.issues : undefined });
      }
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof CampaignPreflightError) return problem(422, "CAMPAIGN_PREFLIGHT_FAILED", "Campaign preflight failed", { ...error.result });
      if (error instanceof CampaignPopulationError) {
        const status = ["CAMPAIGN_NOT_FOUND", "CONTACT_NOT_FOUND", "PROSPECT_NOT_FOUND"].includes(error.code) ? 404
          : ["SELECTION_EMPTY", "EXCLUSION_REASON_REQUIRED"].includes(error.code) ? 422
            : ["CAMPAIGN_NOT_ACTIVE", "PROSPECT_NOT_SELECTED", "PROSPECT_EXCLUDED", "PROSPECT_ALREADY_ENROLLED", "ENROLLMENT_SUPPRESSED", "NO_VALID_CHANNEL", "ACTIVE_SEQUENCE_CONFLICT", "SEQUENCE_VERSION_NOT_FOUND"].includes(error.code) ? 409 : 400;
        return problem(status, error.code, "Campaign prospect action is not allowed", error.details);
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "CAMPAIGN_NOT_FOUND") return problem(404, message, "Campaign not found");
      if (message === "CAMPAIGN_SNAPSHOT_IMMUTABLE" || message.endsWith("_CONFLICT")) return problem(409, message, "Campaign transition is not allowed");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required");
}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required");
}

function requireAdmin(role: string): void {
  if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Admin access is required for campaign transitions");
}

async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try {
    return requestContextSchema.parse(await resolver.resolve(request));
  } catch (error) {
    if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error;
    throw new RequestAuthenticationError("The authenticated request context is invalid");
  }
}

function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/campaigns") return "GET, POST";
  if (campaignPath.test(pathname)) return "GET, PATCH";
  if (preflightPath.test(pathname)) return "POST";
  if (transitionPath.test(pathname)) return "POST";
  if (prospectsPath.test(pathname)) return "GET";
  if (selectProspectsPath.test(pathname)) return "POST";
  if (prospectActionPath.test(pathname)) return "POST";
  if (explanationPath.test(pathname)) return "GET";
  return null;
}

function methodNotAllowed(allowed: string): Response {
  return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route", { allowed });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function problem(status: number, code: string, detail: string, extras: Record<string, unknown> = {}): Response {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extras }, {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

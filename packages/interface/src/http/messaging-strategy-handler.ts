import { z, ZodError } from "zod";
import type { AIPolicyRules, MessagingStrategyRules } from "@outbound/domain/gtm/messaging-strategy";
import { MessagingStrategyApplication } from "@outbound/application/gtm/messaging-strategy-application";
import { CryptoIdGenerator } from "@outbound/application/shared/ports";
import { PostgresMessagingStrategyRepository } from "@outbound/infrastructure/gtm/postgres-messaging-strategy-repository";
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
const templateSchema = z.object({
  channel: z.enum(["linkedin", "email", "whatsapp"]),
  body: z.string().max(20_000),
  subject: z.string().max(500).optional(),
  maxLength: z.number().int().positive().max(100_000).optional(),
  cta: z.string().max(2_000).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
}).strict();
const strategyRulesSchema = z.object({
  tone: z.string().max(1_000).default(""),
  angle: z.string().max(2_000).default(""),
  templates: z.array(templateSchema).max(100).default([]),
  allowedClaimIds: z.array(uuidSchema).max(100).default([]),
  offerVersionId: uuidSchema.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
}).strict().default({ tone: "", angle: "", templates: [], allowedClaimIds: [] });
const policyRulesSchema = z.object({
  firstContactRequiresHumanApproval: z.boolean().optional(),
  responsesRequireHumanApproval: z.boolean().optional(),
  followUpsMayBeAutomated: z.boolean().default(false),
  escalationRules: z.record(z.string(), z.unknown()).optional(),
}).strict();
const strategyCreateSchema = z.object({ name: z.string().trim().min(1).max(500), rules: strategyRulesSchema }).strict();
const strategyPatchSchema = z.object({ name: z.string().trim().min(1).max(500).optional(), rules: strategyRulesSchema.optional() }).strict().refine((value) => Object.values(value).some((field) => field !== undefined), { message: "At least one field must be provided" });
const policyCreateSchema = z.object({ name: z.string().trim().min(1).max(500), rules: policyRulesSchema.default({ followUpsMayBeAutomated: false }) }).strict();
const policyPatchSchema = z.object({ name: z.string().trim().min(1).max(500).optional(), rules: policyRulesSchema.optional() }).strict().refine((value) => Object.values(value).some((field) => field !== undefined), { message: "At least one field must be provided" });
const strategyPath = /^\/api\/v1\/messaging-strategies\/([^/]+)$/;
const strategyPublishPath = /^\/api\/v1\/messaging-strategies\/([^/]+)\/actions\/publish$/;
const policyPath = /^\/api\/v1\/ai-policies\/([^/]+)$/;
const policyPublishPath = /^\/api\/v1\/ai-policies\/([^/]+)\/actions\/publish$/;

export interface MessagingStrategyHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
}

export function createMessagingStrategyHttpHandler(dependencies: MessagingStrategyHttpDependencies) {
  const application = new MessagingStrategyApplication(new PostgresMessagingStrategyRepository(dependencies.database), new CryptoIdGenerator());
  return async function handle(request: Request): Promise<Response> {
    try {
      const context = await resolveContext(dependencies.contextResolver, request);
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/messaging-strategies") {
        if (request.method === "GET") { requireViewer(context.role); return json({ data: (await application.listStrategies(context.workspaceId)).map(normalizeStrategy) }); }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = strategyCreateSchema.parse(await request.json());
          return json(normalizeStrategy(await application.createStrategy({ workspaceId: context.workspaceId, userId: context.userId, ...body, draftRules: body.rules })), 201);
        }
      }
      const strategy = strategyPath.exec(url.pathname);
      if (strategy && request.method === "GET") {
        requireViewer(context.role);
        const value = await application.getStrategy({ workspaceId: context.workspaceId, strategyId: uuidSchema.parse(strategy[1]) });
        if (!value) return problem(404, "MESSAGING_STRATEGY_NOT_FOUND", "Messaging strategy not found");
        return json(normalizeStrategy(value));
      }
      if (strategy && request.method === "PATCH") {
        requireOperator(context.role);
        const body = strategyPatchSchema.parse(await request.json());
        const value = await application.updateStrategy({ workspaceId: context.workspaceId, strategyId: uuidSchema.parse(strategy[1]), ...(body.name !== undefined ? { name: body.name } : {}), ...(body.rules !== undefined ? { draftRules: body.rules } : {}) });
        return json(normalizeStrategy(value));
      }
      const publishStrategy = strategyPublishPath.exec(url.pathname);
      if (publishStrategy && request.method === "POST") {
        requireAdmin(context.role);
        const value = await application.publishStrategy({ workspaceId: context.workspaceId, strategyId: uuidSchema.parse(publishStrategy[1]), userId: context.userId, publishedAt: new Date() });
        return json(normalizeStrategyVersion(value), 201);
      }

      if (url.pathname === "/api/v1/ai-policies") {
        if (request.method === "GET") { requireViewer(context.role); return json({ data: (await application.listPolicies(context.workspaceId)).map(normalizePolicy) }); }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = policyCreateSchema.parse(await request.json());
          return json(normalizePolicy(await application.createPolicy({ workspaceId: context.workspaceId, userId: context.userId, ...body, draftRules: body.rules })), 201);
        }
      }
      const policy = policyPath.exec(url.pathname);
      if (policy && request.method === "GET") {
        requireViewer(context.role);
        const value = await application.getPolicy({ workspaceId: context.workspaceId, policyId: uuidSchema.parse(policy[1]) });
        if (!value) return problem(404, "AI_POLICY_NOT_FOUND", "AI policy not found");
        return json(normalizePolicy(value));
      }
      if (policy && request.method === "PATCH") {
        requireOperator(context.role);
        const body = policyPatchSchema.parse(await request.json());
        const value = await application.updatePolicy({ workspaceId: context.workspaceId, policyId: uuidSchema.parse(policy[1]), ...(body.name !== undefined ? { name: body.name } : {}), ...(body.rules !== undefined ? { draftRules: body.rules } : {}) });
        return json(normalizePolicy(value));
      }
      const publishPolicy = policyPublishPath.exec(url.pathname);
      if (publishPolicy && request.method === "POST") {
        requireAdmin(context.role);
        const value = await application.publishPolicy({ workspaceId: context.workspaceId, policyId: uuidSchema.parse(publishPolicy[1]), userId: context.userId, publishedAt: new Date() });
        return json(normalizePolicyVersion(value), 201);
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
      if (message === "MESSAGING_STRATEGY_NOT_FOUND") return problem(404, message, "Messaging strategy not found");
      if (message === "AI_POLICY_NOT_FOUND") return problem(404, message, "AI policy not found");
      if (message.endsWith("_DELETED")) return problem(409, message, "Deleted container cannot be published");
      if (message.includes("NAME_CONFLICT")) return problem(409, message, "A container with this name already exists");
      if (message.startsWith("MESSAGING_STRATEGY_INVALID:")) return problem(422, "MESSAGING_STRATEGY_INVALID", "Messaging strategy is not publishable", { errors: JSON.parse(message.slice("MESSAGING_STRATEGY_INVALID:".length)) });
      if (message.startsWith("MESSAGING_CLAIMS_INVALID:")) return problem(422, "MESSAGING_CLAIMS_INVALID", "Referenced offer claims are not validated", { blockedClaimIds: message.slice("MESSAGING_CLAIMS_INVALID:".length).split(",") });
      if (message.includes("VERSION_ALLOCATION_CONFLICT")) return problem(409, message, "Publication conflicted; retry");
      if (message.includes("First contact always requires human approval") || message.includes("Responses always require human approval")) return problem(422, "AI_POLICY_INVALID", message);
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function normalizeStrategy(value: any) { return { ...value, createdAt: asIso(value.createdAt), updatedAt: asIso(value.updatedAt), deletedAt: asIso(value.deletedAt), versions: value.versions?.map(normalizeStrategyVersion) }; }
function normalizeStrategyVersion(value: any) { return { ...value, publishedAt: asIso(value.publishedAt), createdAt: asIso(value.createdAt) }; }
function normalizePolicy(value: any) { return { ...value, createdAt: asIso(value.createdAt), updatedAt: asIso(value.updatedAt), deletedAt: asIso(value.deletedAt), versions: value.versions?.map(normalizePolicyVersion) }; }
function normalizePolicyVersion(value: any) { return { ...value, publishedAt: asIso(value.publishedAt), createdAt: asIso(value.createdAt) }; }
function asIso(value: unknown) { return value instanceof Date ? value.toISOString() : value; }
class WorkspacePermissionError extends Error {}
function requireViewer(role: string) { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required"); }
function requireOperator(role: string) { if (!["operator", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Operator access is required"); }
function requireAdmin(role: string) { if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Administrator access is required"); }
function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/messaging-strategies" || pathname === "/api/v1/ai-policies") return "GET, POST";
  if (strategyPath.test(pathname) || policyPath.test(pathname)) return "GET, PATCH";
  if (strategyPublishPath.test(pathname) || policyPublishPath.test(pathname)) return "POST";
  return null;
}
async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try { return requestContextSchema.parse(await resolver.resolve(request)); }
  catch (error) { if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error; throw new RequestAuthenticationError("The authenticated request context is invalid"); }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}) { return Response.json({ type: `https://api.ignition.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extensions }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

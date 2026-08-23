import { z, ZodError } from "zod";
import {
  ProspectMemoryOperationsError,
  type ProspectMemoryOperationsApplication,
} from "@outbound/application/prospect-memory/prospect-memory-operations";
import type { ProspectMemoryPrincipalRole } from "@outbound/application/prospect-memory/prospect-memory";
import { prospectMemoryCapabilities } from "@outbound/domain/prospect-memory/prospect-memory";
import { aiProviderIds } from "@outbound/application/ai/model-gateway";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
  type WorkspaceRole,
} from "@outbound/interface/http/request-context";

const memoryPath = /^\/api\/v1\/prospects\/([^/]+)\/(memory-status|memory-view)$/;
const refreshPath = /^\/api\/v1\/prospects\/([^/]+)\/memory\/actions\/refresh$/;
const settingsPath = "/api/v1/workspace/prospect-memory-settings";
const uuid = z.string().uuid();
const refreshSchema = z.object({ requestKey: uuid }).strict();
const settingsSchema = z.object({
  captureEnabled: z.boolean(),
  shadowEnabled: z.boolean(),
  setterEnabled: z.boolean(),
  enabledCapabilities: z.array(z.enum(prospectMemoryCapabilities)).max(prospectMemoryCapabilities.length),
  processingProfiles: z.array(z.object({
    provider: z.enum(aiProviderIds),
    encryptedInTransit: z.literal(true),
    trainingUse: z.literal("none"),
    providerRetentionDays: z.number().int().min(0).max(365),
    regionOrJurisdiction: z.string().trim().min(1).max(200),
    operatorAccessPolicy: z.string().trim().min(1).max(500),
    subprocessorsReviewed: z.literal(true),
    deletionProcedure: z.string().trim().min(1).max(500),
    personalDataAllowed: z.boolean(),
    allowedCapabilities: z.array(z.enum(prospectMemoryCapabilities)).max(prospectMemoryCapabilities.length),
  }).strict()).max(aiProviderIds.length),
  maxDailySemanticRefreshes: z.number().int().min(0).max(1_000_000),
  maxDailyCostUsd: z.number().min(0).max(1_000_000),
}).strict();

export function isProspectMemoryRoute(pathname: string): boolean {
  return pathname === settingsPath || memoryPath.test(pathname) || refreshPath.test(pathname);
}

export function createProspectMemoryHttpHandler(input: {
  readonly contextResolver: RequestContextResolver;
  readonly application: Pick<ProspectMemoryOperationsApplication, "status" | "view" | "refresh" | "settings" | "updateSettings">;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      if (url.pathname === settingsPath) {
        requireAdmin(context.role);
        if (request.method === "GET") {
          return json(await input.application.settings(context.workspaceId));
        }
        if (request.method === "PUT") {
          return json(await input.application.updateSettings({
            workspaceId: context.workspaceId,
            updatedBy: context.userId,
            update: settingsSchema.parse(await request.json()),
          }));
        }
        return methodNotAllowed("GET, PUT");
      }
      const memoryMatch = memoryPath.exec(url.pathname);
      if (memoryMatch) {
        requireViewer(context.role);
        if (request.method !== "GET") return methodNotAllowed("GET");
        const contactId = uuid.parse(memoryMatch[1]);
        if (memoryMatch[2] === "memory-status") {
          return json(await input.application.status(context.workspaceId, contactId));
        }
        const capability = z.enum(prospectMemoryCapabilities).parse(
          url.searchParams.get("capability") ?? "call_preparation",
        );
        return json(await input.application.view({
          workspaceId: context.workspaceId,
          contactId,
          capability,
          principalRole: memoryRole(context.role),
          requestKey: crypto.randomUUID(),
        }));
      }
      const refreshMatch = refreshPath.exec(url.pathname);
      if (refreshMatch) {
        requireAdmin(context.role);
        if (request.method !== "POST") return methodNotAllowed("POST");
        const body = refreshSchema.parse(await request.json());
        const result = await input.application.refresh({
          workspaceId: context.workspaceId,
          contactId: uuid.parse(refreshMatch[1]),
          requestKey: body.requestKey,
          correlationId: `prospect-memory:${context.workspaceId}:${body.requestKey}`,
        });
        return json(result, 202);
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(422, "VALIDATION_FAILED", "The request is invalid");
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError || error instanceof PermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof ProspectMemoryOperationsError) {
        return problem(error.status, error.code, humanDetail(error.code));
      }
      if (error instanceof Error) {
        if (error.message === "PROSPECT_MEMORY_CAPABILITY_FORBIDDEN") {
          return problem(403, error.message, "This memory view is not available for the current role");
        }
        if (error.message === "PROSPECT_MEMORY_CAPABILITY_DISABLED") {
          return problem(409, error.message, "This memory capability is not enabled for the workspace");
        }
        if (error.message === "PROSPECT_MEMORY_CONTACT_UNAVAILABLE") {
          return problem(404, error.message, "The prospect is unavailable");
        }
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function memoryRole(role: WorkspaceRole): ProspectMemoryPrincipalRole {
  if (role === "owner" || role === "admin") return "admin";
  if (role === "operator") return "operator";
  return "viewer";
}

function requireViewer(role: WorkspaceRole): void {
  if (!["viewer", "reviewer", "operator", "admin", "owner"].includes(role)) {
    throw new PermissionError("Workspace access is required");
  }
}

function requireAdmin(role: WorkspaceRole): void {
  if (role !== "admin" && role !== "owner") {
    throw new PermissionError("Admin access is required");
  }
}

function humanDetail(code: string): string {
  switch (code) {
    case "PROSPECT_MEMORY_CONTACT_NOT_FOUND": return "The prospect does not exist in this workspace";
    case "PROSPECT_MEMORY_CONTACT_ANONYMIZED": return "An anonymized prospect memory cannot be refreshed";
    case "PROSPECT_MEMORY_DISABLED": return "Prospect memory capture is disabled for this workspace";
    case "PROSPECT_MEMORY_NO_EVENTS": return "No durable prospect event is available to rebuild";
    case "PROSPECT_MEMORY_SETTINGS_INCONSISTENT": return "Capture must be enabled before shadow or active capabilities";
    case "PROSPECT_MEMORY_SHADOW_CANNOT_SEND": return "Shadow mode cannot enable the Setter";
    case "PROSPECT_MEMORY_SETTER_FLAG_MISMATCH": return "Setter activation and the Setter capability must match";
    case "PROSPECT_MEMORY_BUDGET_INVALID": return "Memory budgets must be finite positive values";
    case "PROSPECT_MEMORY_PROCESSING_PROFILE_DUPLICATE": return "Only one processing profile is allowed per provider";
    case "PROSPECT_MEMORY_PROCESSING_PROFILE_REQUIRED": return "An approved processing profile must cover every enabled capability";
    default: return "The prospect memory operation could not be completed";
  }
}

class PermissionError extends Error {}
function json(body: unknown, status = 200) { return Response.json(body, { status }); }
function methodNotAllowed(allow: string) { const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed"); response.headers.set("allow", allow); return response; }
function problem(status: number, code: string, detail: string) { return Response.json({ type: `https://api.noosphere.local/problems/${code.toLowerCase()}`, title: code, status, detail, code }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

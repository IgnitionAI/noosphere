import { z, ZodError } from "zod";
import { PostgresApprovalRepository, ApprovalRepositoryError, type ApprovalItemView } from "@outbound/infrastructure/approvals/postgres-approval-repository";
import type { Database } from "@outbound/infrastructure/database/client";
import type { McpExecutionContext, McpGovernedEffectCapabilities } from "@outbound/application/mcp/mcp-governed-effects";
import { RequestAuthenticationError, WorkspaceAccessDeniedError, WorkspaceContextRequiredError, type RequestContextResolver } from "@outbound/interface/http/request-context";

const uuid = z.string().uuid();
const bulkUuid = uuid.transform((value) => value.toLowerCase());
const contextSchema = z.object({ userId: uuid, workspaceId: uuid, role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]) });
const statusSchema = z.enum(["pending", "approved", "rejected", "invalidated"]);
const editSchema = z.object({ contentEdited: z.unknown() }).strict();
const rejectSchema = z.object({ justification: z.string().trim().min(1).max(2_000) }).strict();
const bulkDecisionSchema = z.object({ decisions: z.array(z.object({ itemId: bulkUuid, decision: z.enum(["approve", "reject"]), justification: z.string().trim().min(1).max(2_000).optional() }).strict()).min(1).max(500) }).strict();
const bulkItemIdsSchema = z.object({ itemIds: z.array(bulkUuid).min(1).max(500), decision: z.enum(["approve", "reject"]), justification: z.string().trim().min(1).max(2_000).optional() }).strict();
const bulkSchema = z.union([
  bulkDecisionSchema,
  bulkItemIdsSchema,
]).superRefine((value, refinementContext) => {
  const itemIds = "decisions" in value ? value.decisions.map((decision) => decision.itemId) : value.itemIds;
  if (new Set(itemIds).size !== itemIds.length) {
    refinementContext.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate approval item ids are not allowed" });
  }
});
const itemPath = /^\/api\/v1\/approval-items\/([^/]+)$/;
const approvePath = /^\/api\/v1\/approval-items\/([^/]+)\/actions\/approve$/;
const rejectPath = /^\/api\/v1\/approval-items\/([^/]+)\/actions\/reject$/;

export interface ApprovalRepositoryPort {
  list(input: { readonly workspaceId: string; readonly campaignId?: string; readonly status?: "pending" | "approved" | "rejected" | "invalidated"; readonly limit: number }): Promise<readonly ApprovalItemView[]>;
  get(input: { readonly workspaceId: string; readonly itemId: string }): Promise<ApprovalItemView | null>;
  update(input: { readonly workspaceId: string; readonly itemId: string; readonly contentEdited: unknown }): Promise<ApprovalItemView>;
  decide(input: { readonly workspaceId: string; readonly itemId: string; readonly decision: "approve" | "reject"; readonly userId: string; readonly justification?: string }): Promise<ApprovalItemView>;
  bulkDecide(input: { readonly workspaceId: string; readonly decisions: readonly { readonly itemId: string; readonly decision: "approve" | "reject"; readonly justification?: string }[]; readonly userId: string }): Promise<ApprovalBulkDecisionResult>;
}

interface ApprovalBulkDecisionResult {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
  readonly invalidated: readonly string[];
  readonly conflicts: readonly { readonly itemId: string; readonly code: string }[];
}

export interface ApprovalHttpDependencies {
  readonly database?: Database;
  readonly repository?: ApprovalRepositoryPort;
  readonly governedEffects?: McpGovernedEffectCapabilities;
  readonly contextResolver: RequestContextResolver;
}

export function createApprovalHttpHandler(dependencies: ApprovalHttpDependencies) {
  const repository = dependencies.repository ?? (dependencies.database ? new PostgresApprovalRepository(dependencies.database) : null);
  if (!repository) throw new Error("Approval HTTP repository is required");
  return async function handle(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    try {
      const context = await resolveContext(dependencies.contextResolver, request);
      const url = requestUrl;
      if (url.pathname === "/api/v1/approval-items" && request.method === "GET") {
        requireReader(context.role);
        const status = url.searchParams.get("status");
        const campaignId = url.searchParams.get("campaignId") ?? undefined;
        const parsedStatus = status ? statusSchema.parse(status) : undefined;
        const data = await repository.list({ workspaceId: context.workspaceId, ...(campaignId ? { campaignId: uuid.parse(campaignId) } : {}), ...(parsedStatus ? { status: parsedStatus } : {}), limit: Math.min(Number(url.searchParams.get("limit") ?? 100), 100) });
        return json({ data });
      }
      if (url.pathname === "/api/v1/approval-items/actions/bulk-decide" && request.method === "POST") {
        requireApprover(context.role);
        const body = bulkSchema.parse(await request.json());
        const decisions = "decisions" in body
          ? body.decisions.map((decision) => decision.justification === undefined
            ? { itemId: decision.itemId, decision: decision.decision }
            : { itemId: decision.itemId, decision: decision.decision, justification: decision.justification })
          : body.itemIds.map((itemId) => body.justification === undefined
            ? { itemId, decision: body.decision }
            : { itemId, decision: body.decision, justification: body.justification });
        return json(await bulkDecide({ request, context, repository, ...(dependencies.governedEffects ? { governedEffects: dependencies.governedEffects } : {}), decisions }));
      }
      const item = itemPath.exec(url.pathname);
      if (item && request.method === "GET") {
        requireReader(context.role);
        const data = await repository.get({ workspaceId: context.workspaceId, itemId: uuid.parse(item[1]) });
        if (!data) return problem(404, "APPROVAL_ITEM_NOT_FOUND", "Approval item not found");
        return json(data);
      }
      if (item && request.method === "PATCH") {
        requireApprover(context.role);
        const body = editSchema.parse(await request.json());
        return json(await repository.update({ workspaceId: context.workspaceId, itemId: uuid.parse(item[1]), contentEdited: body.contentEdited }));
      }
      const approve = approvePath.exec(url.pathname);
      if (approve && request.method === "POST") {
        requireApprover(context.role);
        const itemId = uuid.parse(approve[1]);
        const item = await repository.get({ workspaceId: context.workspaceId, itemId });
        if (!item) throw new ApprovalRepositoryError("APPROVAL_ITEM_NOT_FOUND");
        if (item.proposalId) {
          if (!dependencies.governedEffects) throw new ApprovalRepositoryError("MCP_EFFECT_APPROVAL_REQUIRED");
          return json(await dependencies.governedEffects.decide(toGovernedContext(request, context), {
            approvalItemId: item.id,
            decision: "approve",
            expectedVersion: expectedVersion(item),
          }));
        }
        return json(await repository.decide({ workspaceId: context.workspaceId, itemId, decision: "approve", userId: context.userId }));
      }
      const reject = rejectPath.exec(url.pathname);
      if (reject && request.method === "POST") {
        requireApprover(context.role);
        const body = rejectSchema.parse(await request.json());
        const itemId = uuid.parse(reject[1]);
        const item = await repository.get({ workspaceId: context.workspaceId, itemId });
        if (!item) throw new ApprovalRepositoryError("APPROVAL_ITEM_NOT_FOUND");
        if (item.proposalId) {
          if (!dependencies.governedEffects) throw new ApprovalRepositoryError("MCP_EFFECT_APPROVAL_REQUIRED");
          return json(await dependencies.governedEffects.decide(toGovernedContext(request, context), {
            approvalItemId: item.id,
            decision: "reject",
            justification: body.justification,
            expectedVersion: expectedVersion(item),
          }));
        }
        return json(await repository.decide({ workspaceId: context.workspaceId, itemId, decision: "reject", userId: context.userId, justification: body.justification }));
      }
      const allowed = allowedMethods(url.pathname);
      if (allowed) return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed", { allowed });
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        if (rejectPath.test(requestUrl.pathname)) return problem(422, "REJECTION_JUSTIFICATION_REQUIRED", "A rejection justification is required");
        return problem(400, "INVALID_REQUEST", "The request is invalid");
      }
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      const governedError = governedHttpError(error);
      if (governedError) return problem(governedError.status, governedError.code, governedError.detail);
      if (error instanceof ApprovalRepositoryError) {
        const status = ["APPROVAL_ITEM_NOT_FOUND"].includes(error.code) ? 404 : ["REJECTION_JUSTIFICATION_REQUIRED", "EDITED_CONTENT_REQUIRED"].includes(error.code) ? 422 : 409;
        return problem(status, error.code, "Approval item action is not allowed", error.details);
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

async function bulkDecide(input: {
  readonly request: Request;
  readonly context: { readonly userId: string; readonly workspaceId: string; readonly role: string };
  readonly repository: ApprovalRepositoryPort;
  readonly governedEffects?: McpGovernedEffectCapabilities;
  readonly decisions: readonly { readonly itemId: string; readonly decision: "approve" | "reject"; readonly justification?: string }[];
}): Promise<ApprovalBulkDecisionResult & { readonly results?: readonly BulkDecisionResult[] }> {
  const loaded = await Promise.all(input.decisions.map(async (decision) => ({
    decision,
    item: await input.repository.get({ workspaceId: input.context.workspaceId, itemId: decision.itemId }),
  })));
  const governed = loaded.filter((entry) => entry.item?.proposalId);
  if (governed.length === 0) {
    return input.repository.bulkDecide({
      workspaceId: input.context.workspaceId,
      decisions: input.decisions,
      userId: input.context.userId,
    });
  }

  const legacy = loaded.filter((entry) => !entry.item?.proposalId);
  const legacyResult = legacy.length > 0
    ? await input.repository.bulkDecide({
      workspaceId: input.context.workspaceId,
      decisions: legacy.map((entry) => entry.decision),
      userId: input.context.userId,
    })
    : { approved: [], rejected: [], invalidated: [], conflicts: [] };
  const legacyById = new Map<string, BulkDecisionResult>();
  for (const entry of legacy) {
    const itemId = entry.decision.itemId;
    if (legacyResult.approved.includes(itemId)) legacyById.set(itemId, { itemId, status: "approved" });
    else if (legacyResult.rejected.includes(itemId)) legacyById.set(itemId, { itemId, status: "rejected" });
    else if (legacyResult.invalidated.includes(itemId)) legacyById.set(itemId, { itemId, status: "invalidated" });
    else legacyById.set(itemId, { itemId, code: legacyResult.conflicts.find((conflict) => conflict.itemId === itemId)?.code ?? "APPROVAL_ITEM_NOT_FOUND" });
  }

  const governedById = new Map<string, BulkDecisionResult>();
  for (const entry of governed) {
    const itemId = entry.decision.itemId;
    if (!input.governedEffects) {
      governedById.set(itemId, { itemId, code: "MCP_EFFECT_APPROVAL_REQUIRED" });
      continue;
    }
    try {
      const result = await input.governedEffects.decide(toGovernedContext(input.request, input.context), {
        approvalItemId: itemId,
        decision: entry.decision.decision,
        ...(entry.decision.justification === undefined ? {} : { justification: entry.decision.justification }),
        expectedVersion: expectedVersion(entry.item!),
      });
      governedById.set(itemId, { itemId, status: result.status });
    } catch (error) {
      governedById.set(itemId, { itemId, code: governedHttpError(error)?.code ?? "MCP_EFFECT_DECISION_CONFLICT" });
    }
  }

  const results = input.decisions.map((decision) => legacyById.get(decision.itemId) ?? governedById.get(decision.itemId) ?? {
    itemId: decision.itemId,
    code: "APPROVAL_ITEM_NOT_FOUND",
  });
  return {
    approved: results.filter((result) => result.status === "approved" || result.status === "queued" || result.status === "accepted").map((result) => result.itemId),
    rejected: results.filter((result) => result.status === "rejected").map((result) => result.itemId),
    invalidated: results.filter((result) => result.status === "invalidated" || result.status === "policy_denied").map((result) => result.itemId),
    conflicts: results.filter((result): result is BulkDecisionConflict => result.code !== undefined).map(({ itemId, code }) => ({ itemId, code })),
    results,
  };
}

interface BulkDecisionResult {
  readonly itemId: string;
  readonly status?: string;
  readonly code?: string;
}

interface BulkDecisionConflict extends BulkDecisionResult {
  readonly code: string;
}

function toGovernedContext(
  request: Request,
  context: { readonly userId: string; readonly workspaceId: string; readonly role: string },
): McpExecutionContext {
  return {
    userId: context.userId,
    workspaceId: context.workspaceId,
    clientId: "http-approval",
    role: context.role as McpExecutionContext["role"],
    scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    audience: new URL(request.url).origin,
  };
}

function expectedVersion(item: ApprovalItemView): number {
  const proposalVersion = item.proposalVersion;
  if (typeof proposalVersion !== "number" || !Number.isSafeInteger(proposalVersion) || proposalVersion < 1) {
    throw new ApprovalRepositoryError("MCP_EFFECT_VERSION_UNAVAILABLE");
  }
  return proposalVersion;
}

function governedHttpError(error: unknown): { readonly status: number; readonly code: string; readonly detail: string } | null {
  const value = error as { readonly code?: unknown; readonly message?: unknown };
  const rawCode = typeof value.code === "string" ? value.code : typeof value.message === "string" ? value.message : null;
  const code = rawCode?.match(/^(?:MCP_EFFECT|MCP_GOVERNED_EFFECT)_[A-Z0-9_]+/)?.[0] ?? null;
  if (!code) return null;
  if (["MCP_EFFECT_DECISION_FORBIDDEN", "MCP_EFFECT_FORBIDDEN", "MCP_GOVERNED_EFFECT_FORBIDDEN"].includes(code)) {
    return { status: 403, code: "MCP_EFFECT_FORBIDDEN", detail: "The approval decision is not permitted" };
  }
  if (["MCP_EFFECT_APPROVAL_NOT_FOUND", "MCP_EFFECT_PROPOSAL_NOT_FOUND", "MCP_EFFECT_NOT_FOUND"].includes(code)) {
    return { status: 404, code: "MCP_EFFECT_NOT_FOUND", detail: "The approval item was not found" };
  }
  if (code === "MCP_EFFECT_APPROVAL_REQUIRED") {
    return { status: 409, code, detail: "Governed approval capability is required" };
  }
  if (["MCP_EFFECT_VERSION_UNAVAILABLE", "MCP_EFFECT_VERSION_CONFLICT", "MCP_EFFECT_POLICY_VERSION_CONFLICT", "MCP_EFFECT_STALE_CONFLICT", "MCP_EFFECT_SOURCE_STALE"].includes(code)) {
    return { status: 409, code: "MCP_EFFECT_STALE_CONFLICT", detail: "The approval decision is stale" };
  }
  if (["MCP_EFFECT_DECISION_CONFLICT", "MCP_EFFECT_APPROVAL_CONFLICT"].includes(code)) {
    return { status: 409, code: "MCP_EFFECT_DECISION_CONFLICT", detail: "The approval decision conflicts with the current state" };
  }
  if (code.startsWith("MCP_EFFECT_")) {
    return { status: 409, code: "MCP_EFFECT_DECISION_CONFLICT", detail: "The approval decision is unavailable" };
  }
  return null;
}

class WorkspacePermissionError extends Error {}
function requireReader(role: string): void { if (!["operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Approval content is not available to viewers"); }
function requireApprover(role: string): void { if (!["reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Reviewer approval is required"); }
async function resolveContext(resolver: RequestContextResolver, request: Request) { try { return contextSchema.parse(await resolver.resolve(request)); } catch (error) { if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error; throw new RequestAuthenticationError("The authenticated request context is invalid"); } }
function allowedMethods(pathname: string): string | null { if (pathname === "/api/v1/approval-items") return "GET"; if (pathname === "/api/v1/approval-items/actions/bulk-decide") return "POST"; if (itemPath.test(pathname)) return "GET, PATCH"; if (approvePath.test(pathname) || rejectPath.test(pathname)) return "POST"; return null; }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}): Response { return Response.json({ type: `https://api.ignition.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extensions }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }); }

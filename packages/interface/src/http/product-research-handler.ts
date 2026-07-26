import { ZodError, z } from "zod";
import {
  productResearchBriefSchema,
  researchStageSchema,
} from "@outbound/contracts/product-research";
import type { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { ProductResearchNotFoundError } from "@outbound/application/gtm/product-research-application";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";
import {
  ProductResearchInvariantError,
  researchStages,
} from "@outbound/domain/gtm/product-research";

const runPath = /^\/api\/v1\/product-research-runs\/([^/]+)$/;
const actionPath = /^\/api\/v1\/product-research-runs\/([^/]+)\/actions\/([^/]+)$/;
const evidencePath = /^\/api\/v1\/product-research-runs\/([^/]+)\/evidence$/;
const reportPath = /^\/api\/v1\/product-research-runs\/([^/]+)\/report$/;
const uuidSchema = z.string().uuid();
const requestContextSchema = z.object({
  userId: uuidSchema,
  workspaceId: uuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});
const researchMoreSchema = z
  .object({
    fromStage: researchStageSchema,
    reason: z.string().trim().min(10).max(1_000),
  })
  .strict();
const proposalReviewSchema = z
  .object({
    proposalId: z.string().uuid(),
    reason: z.string().trim().min(3).max(2_000).nullable().default(null),
  })
  .strict();

export interface ProductResearchHttpDependencies {
  readonly application: ProductResearchApplication;
  readonly contextResolver: RequestContextResolver;
}

export function createProductResearchHttpHandler(dependencies: ProductResearchHttpDependencies) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/v1/product-research-runs") {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireOperator(context.role);
        const brief = productResearchBriefSchema.parse(await request.json());
        const run = await dependencies.application.create({
          workspaceId: context.workspaceId,
          brief,
        });
        return json(
          {
            id: run.id,
            status: run.status,
            createdAt: run.createdAt.toISOString(),
            links: {
              self: `/api/v1/product-research-runs/${run.id}`,
              start: `/api/v1/product-research-runs/${run.id}/actions/start`,
            },
          },
          201,
        );
      }
      const actionMatch = actionPath.exec(url.pathname);
      if (
        request.method === "POST" &&
        actionMatch &&
        ["start", "pause", "resume"].includes(actionMatch[2] ?? "")
      ) {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireOperator(context.role);
        const runId = uuidSchema.parse(actionMatch[1]);
        const action = actionMatch[2];
        const run =
          action === "start"
            ? await dependencies.application.start({
                workspaceId: context.workspaceId,
                runId,
                correlationId: correlationId(request),
              })
            : action === "pause"
              ? await dependencies.application.pause({
                  workspaceId: context.workspaceId,
                  runId,
                })
              : await dependencies.application.resume({
                  workspaceId: context.workspaceId,
                  runId,
                  correlationId: correlationId(request),
                });
        return json(
          {
            id: run.id,
            status: run.status,
            links: { self: `/api/v1/product-research-runs/${run.id}` },
          },
          202,
        );
      }
      if (request.method === "POST" && actionMatch?.[2] === "research-more") {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireOperator(context.role);
        const runId = uuidSchema.parse(actionMatch[1]);
        const body = researchMoreSchema.parse(await request.json());
        const run = await dependencies.application.researchMore({
          workspaceId: context.workspaceId,
          runId,
          fromStage: body.fromStage,
          reason: body.reason,
          correlationId: correlationId(request),
        });
        return json(
          {
            id: run.id,
            status: run.status,
            completedStages: run.completedStages,
            links: { self: `/api/v1/product-research-runs/${run.id}` },
          },
          202,
        );
      }
      if (
        request.method === "POST" &&
        actionMatch &&
        ["approve-icp", "reject-icp"].includes(actionMatch[2] ?? "")
      ) {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireReviewer(context.role);
        const runId = uuidSchema.parse(actionMatch[1]);
        const body = proposalReviewSchema.parse(await request.json());
        await dependencies.application.reviewIcpProposal({
          workspaceId: context.workspaceId,
          runId,
          proposalId: body.proposalId,
          userId: context.userId,
          decision: actionMatch[2] === "approve-icp" ? "approved" : "rejected",
          reason: body.reason,
        });
        return new Response(null, { status: 204 });
      }
      const runMatch = runPath.exec(url.pathname);
      if (request.method === "GET" && runMatch) {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireViewer(context.role);
        const runId = uuidSchema.parse(runMatch[1]);
        const progress = await dependencies.application.getProgress({
          workspaceId: context.workspaceId,
          runId,
        });
        const run = progress.run;
        const nextStage = researchStages.find((stage) => !run.completedStages.includes(stage)) ?? null;
        return json({
          id: run.id,
          status: run.status,
          activeStage: run.activeStage,
          brief: run.brief,
          completedStages: run.completedStages,
          createdAt: run.createdAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          stages: researchStages.map((stage) => {
            const attempts = progress.stageRuns.filter((stageRun) => stageRun.stage === stage);
            const latest = attempts.at(-1);
            return {
              stage,
              status: run.completedStages.includes(stage)
                ? "completed"
                : run.activeStage === stage
                  ? run.status === "paused"
                    ? "paused"
                    : "running"
                  : stage === nextStage
                    ? "queued"
                    : "pending",
              attempts: attempts.length,
              lastErrorCode: latest?.errorCode ?? null,
              startedAt: latest?.startedAt.toISOString() ?? null,
              completedAt: latest?.completedAt?.toISOString() ?? null,
            };
          }),
          links: {
            evidence: `/api/v1/product-research-runs/${run.id}/evidence`,
          },
        });
      }
      const evidenceMatch = evidencePath.exec(url.pathname);
      if (request.method === "GET" && evidenceMatch) {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireViewer(context.role);
        const runId = uuidSchema.parse(evidenceMatch[1]);
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .parse(url.searchParams.get("limit") ?? undefined);
        const after = decodeEvidenceCursor(url.searchParams.get("cursor"));
        const evidence = await dependencies.application.listEvidence({
          workspaceId: context.workspaceId,
          runId,
          after,
          limit: limit + 1,
        });
        const hasMore = evidence.length > limit;
        const data = evidence.slice(0, limit);
        const last = data.at(-1);
        return json({
          data: data.map((item) => ({
            id: item.id,
            sourceType: item.sourceType,
            url: item.url,
            title: item.title,
            excerpt: item.excerpt,
            contentHash: item.contentHash,
            observedAt: item.observedAt.toISOString(),
          })),
          nextCursor: hasMore && last ? encodeEvidenceCursor(last.createdAt, last.id) : null,
        });
      }
      const reportMatch = reportPath.exec(url.pathname);
      if (request.method === "GET" && reportMatch) {
        const context = await resolveContext(dependencies.contextResolver, request);
        requireViewer(context.role);
        const runId = uuidSchema.parse(reportMatch[1]);
        const report = await dependencies.application.getReport({
          workspaceId: context.workspaceId,
          runId,
        });
        return json({
          run: {
            id: report.run.id,
            status: report.run.status,
            brief: report.run.brief,
            completedStages: report.run.completedStages,
          },
          stageOutputs: report.stageOutputs,
          evidence: report.evidence.map((item) => ({
            ...item,
            observedAt: item.observedAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
          competitors: report.competitors,
          findings: report.findings,
          proposals: report.proposals,
          links: {
            approve: `/api/v1/product-research-runs/${runId}/actions/approve-icp`,
            reject: `/api/v1/product-research-runs/${runId}/actions/reject-icp`,
          },
        });
      }
      const allowed = allowedMethods(url.pathname);
      if (allowed) return methodNotAllowed(allowed);
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The request is invalid", {
          errors: error instanceof ZodError ? error.issues : undefined,
        });
      }
      if (error instanceof WorkspacePermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof ProductResearchNotFoundError) {
        return problem(404, "PRODUCT_RESEARCH_RUN_NOT_FOUND", error.message);
      }
      if (error instanceof ProductResearchInvariantError) {
        return problem(409, "PRODUCT_RESEARCH_INVALID_STATE", error.message);
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "PRODUCT_RESEARCH_NOT_READY_FOR_REVIEW") {
        return problem(409, message, "The evidence audit must complete before human review");
      }
      if (message === "ICP_PROPOSAL_NOT_FOUND") {
        return problem(404, message, "ICP proposal not found in this workspace run");
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Operator access is required");
  }
}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Workspace access is required");
  }
}

function requireReviewer(role: string): void {
  if (!["reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Reviewer access is required");
  }
}

function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && supplied.length <= 200 ? supplied : crypto.randomUUID();
}

async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try {
    return requestContextSchema.parse(await resolver.resolve(request));
  } catch (error) {
    if (
      error instanceof RequestAuthenticationError ||
      error instanceof WorkspaceContextRequiredError ||
      error instanceof WorkspaceAccessDeniedError
    ) {
      throw error;
    }
    throw new RequestAuthenticationError("The authenticated request context is invalid");
  }
}

function encodeEvidenceCursor(createdAt: Date, id: string): string {
  return btoa(`${createdAt.toISOString()}|${id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeEvidenceCursor(cursor: string | null): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const [timestamp, id] = atob(padded).split("|");
    const createdAt = new Date(timestamp ?? "");
    return {
      createdAt: z.date().parse(createdAt),
      id: uuidSchema.parse(id),
    };
  } catch {
    throw new ZodError([
      {
        code: "custom",
        path: ["cursor"],
        message: "Invalid evidence cursor",
      },
    ]);
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function problem(
  status: number,
  code: string,
  detail: string,
  extensions: Readonly<Record<string, unknown>> = {},
): Response {
  return Response.json(
    {
      type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
      title: code,
      status,
      detail,
      code,
      ...extensions,
    },
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}

function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/product-research-runs") return "POST";
  if (runPath.test(pathname) || evidencePath.test(pathname) || reportPath.test(pathname)) return "GET";
  if (actionPath.test(pathname)) return "POST";
  return null;
}

function methodNotAllowed(allowed: string): Response {
  const response = problem(
    405,
    "METHOD_NOT_ALLOWED",
    "The HTTP method is not allowed for this route",
  );
  response.headers.set("allow", allowed);
  return response;
}

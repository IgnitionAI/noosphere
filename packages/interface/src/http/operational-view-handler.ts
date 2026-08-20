import { ZodError, z } from "zod";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";
import type {
  ActivityWorkspacePage,
  CampaignWorkspaceView,
  ConversationWorkspacePage,
  ConversationWorkspaceDetail,
  SetupReadinessView,
  WorkspaceOperationalSummary,
} from "@outbound/application/workspaces/operational-views";
import { noosphereLenses, type NoosphereLens } from "@outbound/application/workspaces/operational-views";

const campaignViewPath = /^\/api\/v1\/campaigns\/([^/]+)\/workspace-view$/;
const conversationViewPath = /^\/api\/v1\/conversations\/([^/]+)$/;

export type OperationalViewsPort = {
  getSummary(workspaceId: string, input?: { attentionOffset?: number; attentionLimit?: number }): Promise<WorkspaceOperationalSummary>;
  getActivity(input: { workspaceId: string; lens: NoosphereLens; offset?: number; limit?: number }): Promise<ActivityWorkspacePage>;
  getSetupReadiness(workspaceId: string): Promise<SetupReadinessView>;
  getCampaignView(workspaceId: string, campaignId: string): Promise<CampaignWorkspaceView | null>;
  listConversations(input: { workspaceId: string; channel?: string; scope?: string; search?: string; period?: string; read?: string; campaignId?: string; page: number; pageSize: number }): Promise<ConversationWorkspacePage>;
  getConversation(workspaceId: string, conversationId: string): Promise<ConversationWorkspaceDetail | null>;
  getPipeline(workspaceId: string, role?: string): Promise<unknown>;
};

export function createOperationalViewHttpHandler(input: {
  readonly database: ConstructorParameters<typeof PostgresOperationalViews>[0];
  readonly contextResolver: RequestContextResolver;
  readonly views?: OperationalViewsPort;
}) {
  const views: OperationalViewsPort = input.views ?? new PostgresOperationalViews(input.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await input.contextResolver.resolve(request);
      requireViewer(context.role);
      if (request.method !== "GET") return problem(405, "METHOD_NOT_ALLOWED", "Only GET is supported");
      if (url.pathname === "/api/v1/workspace/operational-summary") {
        const attentionOffset = parseCursor(url.searchParams.get("attentionCursor"));
        const attentionLimit = parsePositiveInt(url.searchParams.get("attentionLimit"), 20, 100);
        return Response.json(await views.getSummary(context.workspaceId, { attentionOffset, attentionLimit }));
      }
      if (url.pathname === "/api/v1/activity") {
        const lens = z.enum(noosphereLenses).default("symbiosis").parse(url.searchParams.get("lens") || undefined);
        const offset = parseCursor(url.searchParams.get("cursor"));
        const limit = parsePositiveInt(url.searchParams.get("limit"), 25, 100);
        return Response.json(await views.getActivity({ workspaceId: context.workspaceId, lens, offset, limit }));
      }
      if (url.pathname === "/api/v1/workspace/setup-readiness") {
        return Response.json(await views.getSetupReadiness(context.workspaceId));
      }
      const campaignMatch = campaignViewPath.exec(url.pathname);
      if (campaignMatch) {
        const campaignId = z.string().uuid().parse(campaignMatch[1]);
        const view = await views.getCampaignView(context.workspaceId, campaignId);
        return view ? Response.json(view) : problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
      }
      if (url.pathname === "/api/v1/conversations") {
        const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
        const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 25, 100);
        const channel = z.enum(["linkedin", "email", "whatsapp"]).optional().parse(url.searchParams.get("channel") || undefined);
        const scope = z.enum(["campaign", "outside_campaign"]).optional().parse(url.searchParams.get("scope") || undefined);
        const period = z.enum(["today", "7d", "30d", "90d"]).optional().parse(url.searchParams.get("period") || undefined);
        const read = z.literal("unread").optional().parse(url.searchParams.get("read") || undefined);
        const campaignId = z.string().uuid().optional().parse(url.searchParams.get("campaignId") || undefined);
        return Response.json(await views.listConversations({
          workspaceId: context.workspaceId,
          page,
          pageSize,
          ...(channel ? { channel } : {}),
          ...(scope ? { scope } : {}),
          ...(period ? { period } : {}),
          ...(read ? { read } : {}),
          ...(campaignId ? { campaignId } : {}),
          ...(url.searchParams.get("search") ? { search: url.searchParams.get("search")! } : {}),
        }));
      }
      const conversationMatch = conversationViewPath.exec(url.pathname);
      if (conversationMatch) {
        const conversationId = z.string().uuid().parse(conversationMatch[1]);
        const conversation = await views.getConversation(context.workspaceId, conversationId);
        return conversation ? Response.json(conversation) : problem(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
      }
      if (url.pathname === "/api/v1/pipeline/view") {
        return Response.json(await views.getPipeline(context.workspaceId, context.role));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || (error instanceof Error && error.message === "INVALID_PAGINATION")) return problem(422, "VALIDATION_FAILED", "The request is invalid");
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError || (error instanceof Error && error.message === "WORKSPACE_FORBIDDEN")) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error("INVALID_PAGINATION");
  return parsed;
}

function parseCursor(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) throw new Error("INVALID_PAGINATION");
  return parsed;
}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspaceAccessDeniedError();
}

function problem(status: number, code: string, detail: string): Response {
  return Response.json({
    type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
    title: code,
    status,
    detail,
    code,
  }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

import { z, ZodError } from "zod";
import {
  ConversationDraftNotFoundError,
  type ConversationDraftImprover,
} from "@outbound/application/campaigns/conversation-draft-improver";
import type { JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  CampaignAutopilotPolicyLockedError,
  CampaignPreflightError,
  PostgresCampaignRepository,
} from "@outbound/infrastructure/campaigns/postgres-campaign-repository";
import {
  CampaignPopulationError,
  PostgresCampaignPopulationRepository,
} from "@outbound/infrastructure/campaigns/postgres-campaign-population-repository";
import { PostgresCampaignConversationRepository } from "@outbound/infrastructure/campaigns/postgres-campaign-conversation-repository";
import { PostgresCampaignAutopilotDashboard } from "@outbound/infrastructure/campaigns/postgres-campaign-autopilot-dashboard";
import { PostgresProspectingPlanRepository } from "@outbound/infrastructure/campaigns/postgres-prospecting-plan-repository";
import { PostgresDiscoveryRepository } from "@outbound/infrastructure/crm/postgres-discovery-repository";
import { PROSPECT_DISCOVERY_JOB_TYPE } from "@outbound/infrastructure/crm/prospect-discovery-runner";
import { PostgresConversationCommandRepository } from "@outbound/infrastructure/campaigns/postgres-conversation-command-repository";
import { postgresUuidSchema } from "@outbound/interface/http/http-schemas";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const identityUuidSchema = z.string().uuid();
const requestContextSchema = z.object({
  userId: identityUuidSchema,
  workspaceId: identityUuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});
const campaignPath = /^\/api\/v1\/campaigns\/([^/]+)$/;
const campaignPreflightPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/preflight$/;
const campaignTransitionPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/(activate|pause|resume|archive)$/;
const campaignProspectsPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects$/;
const campaignSelectProspectsPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/select$/;
const campaignProspectActionPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/([^/]+)\/actions\/(enroll|exclude)$/;
const campaignProspectExplanationPath = /^\/api\/v1\/campaigns\/([^/]+)\/prospects\/([^/]+)\/explanation$/;
const campaignConversationsPath = /^\/api\/v1\/campaigns\/([^/]+)\/conversations$/;
const campaignConversationPath = /^\/api\/v1\/campaigns\/([^/]+)\/conversations\/([^/]+)$/;
const campaignAutopilotDashboardPath = /^\/api\/v1\/campaigns\/([^/]+)\/autopilot-dashboard$/;
const campaignAutopilotPolicyPath = /^\/api\/v1\/campaigns\/([^/]+)\/autopilot-policy$/;
const campaignDiscoveryPath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/discover$/;
const campaignArchivePath = /^\/api\/v1\/campaigns\/([^/]+)\/actions\/archive$/;
const conversationMessagesPath = /^\/api\/v1\/conversations\/([^/]+)\/messages$/;
const conversationDraftImprovementsPath = /^\/api\/v1\/conversations\/([^/]+)\/draft-improvements$/;
const planPath = /^\/api\/v1\/prospecting-plans\/([^/]+)$/;
const planEnableChannelPath =
  /^\/api\/v1\/prospecting-plans\/([^/]+)\/channels\/(linkedin|email|whatsapp)\/actions\/enable$/;
const assessmentRetryPath =
  /^\/api\/v1\/channel-assessments\/([^/]+)\/actions\/retry$/;
const campaignAutopilotPolicyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  executionMode: z.enum(["dry_run", "live"]).optional(),
  schedule: z.object({
    activeDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    windowStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    windowEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    timezoneMode: z.enum(["recipient", "workspace"]).optional(),
    fallbackTimezone: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
  email: z.object({
    language: z.enum(["auto", "fr", "en"]).optional(),
    firstMessageInstructions: z.string().trim().max(3_000).nullable().optional(),
    followUpInstructions: z.string().trim().max(3_000).nullable().optional(),
    followUpDelaysBusinessDays: z.array(z.number().int().min(1).max(90)).max(3).optional(),
    autoReplyEnabled: z.boolean().optional(),
    replyDelayMinutes: z.number().int().min(0).max(1_440).optional(),
    replyInstructions: z.string().trim().max(3_000).nullable().optional(),
    bookingUrl: z.string().url().max(2_000).nullable().optional(),
    stopOnHumanActivity: z.literal(true).optional(),
  }).strict().optional(),
}).strict();
const conversationCommandSchema = z.object({
  mode: z.enum(["manual", "setter"]),
  body: z.string().trim().min(1).max(5_000).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "manual" && !value.body) {
    context.addIssue({ code: "custom", path: ["body"], message: "A manual message body is required" });
  }
});
const conversationDraftImprovementSchema = z.object({
  draft: z.string().trim().min(1).max(5_000),
}).strict();
const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  objective: z.string().max(10_000).default(""),
  offerVersionId: identityUuidSchema,
  icpVersionId: identityUuidSchema,
  messagingStrategyVersionId: identityUuidSchema,
  aiPolicyVersionId: identityUuidSchema,
  sequenceVersionId: identityUuidSchema,
}).strict();
const campaignPatchSchema = campaignCreateSchema.partial().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "At least one field must be provided",
);
const selectProspectsSchema = z.object({ contactIds: z.array(identityUuidSchema).min(1).max(500) }).strict();
const excludeProspectSchema = z.object({ reason: z.string().trim().min(1).max(1_000) }).strict();

export function createCampaignHttpHandler(dependencies: {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
  readonly jobQueue?: JobQueue;
  readonly draftImprover?: ConversationDraftImprover;
}) {
  const campaigns = new PostgresCampaignRepository(dependencies.database);
  const population = new PostgresCampaignPopulationRepository(dependencies.database);
  const campaignConversations = new PostgresCampaignConversationRepository(dependencies.database);
  const campaignDashboard = new PostgresCampaignAutopilotDashboard(dependencies.database);
  const plans = new PostgresProspectingPlanRepository(dependencies.database);
  const discovery = new PostgresDiscoveryRepository(dependencies.database);
  const conversationCommands = new PostgresConversationCommandRepository(dependencies.database);

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = requestContextSchema.parse(await dependencies.contextResolver.resolve(request));

      const conversationDraftImprovementMatch = conversationDraftImprovementsPath.exec(url.pathname);
      if (conversationDraftImprovementMatch && request.method === "POST") {
        requireOperator(context.role);
        if (!dependencies.draftImprover) return problem(503, "DRAFT_IMPROVER_UNAVAILABLE", "Draft improvement is unavailable");
        const conversationId = postgresUuidSchema.parse(conversationDraftImprovementMatch[1]);
        const body = conversationDraftImprovementSchema.parse(await request.json());
        return json(await dependencies.draftImprover.improve({
          workspaceId: context.workspaceId,
          conversationId,
          draft: body.draft,
        }));
      }

      const conversationMessagesMatch = conversationMessagesPath.exec(url.pathname);
      if (conversationMessagesMatch && request.method === "POST") {
        requireOperator(context.role);
        const conversationId = postgresUuidSchema.parse(conversationMessagesMatch[1]);
        const body = conversationCommandSchema.parse(await request.json());
        const command = await conversationCommands.create({
          workspaceId: context.workspaceId,
          conversationId,
          requestedBy: context.userId,
          mode: body.mode,
          body: body.mode === "manual" ? body.body! : null,
          ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
          now: new Date(),
        });
        return json(command, 202);
      }

      if (url.pathname === "/api/v1/campaigns") {
        if (request.method === "GET") {
          requireViewer(context.role);
          return json({ data: await campaigns.listCampaigns(context.workspaceId) });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = campaignCreateSchema.parse(await request.json());
          return json(await campaigns.createCampaign({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            createdBy: context.userId,
            ...body,
          }), 201);
        }
      }

      if (url.pathname === "/api/v1/prospecting-plans" && request.method === "GET") {
        requireViewer(context.role);
        return json({ data: await plans.listPlans(context.workspaceId) });
      }

      const planMatch = planPath.exec(url.pathname);
      if (planMatch && request.method === "GET") {
        requireViewer(context.role);
        const plan = await plans.getPlan({
          workspaceId: context.workspaceId,
          planId: postgresUuidSchema.parse(planMatch[1]),
        });
        if (!plan) return problem(404, "PROSPECTING_PLAN_NOT_FOUND", "Prospecting plan not found");
        return json(plan);
      }

      const enableMatch = planEnableChannelPath.exec(url.pathname);
      if (enableMatch && request.method === "POST") {
        requireOperator(context.role);
        const result = await plans.enableChannel({
          workspaceId: context.workspaceId,
          planId: postgresUuidSchema.parse(enableMatch[1]),
          channel: z.enum(["linkedin", "email", "whatsapp"]).parse(enableMatch[2]),
          now: new Date(),
        });
        return json(result, 201);
      }

      const retryAssessmentMatch = assessmentRetryPath.exec(url.pathname);
      if (retryAssessmentMatch && request.method === "POST") {
        requireOperator(context.role);
        if (!dependencies.jobQueue) return problem(503, "JOB_QUEUE_UNAVAILABLE", "Background jobs are unavailable");
        const assessment = await plans.restartAssessment({
          workspaceId: context.workspaceId,
          assessmentId: postgresUuidSchema.parse(retryAssessmentMatch[1]),
          now: new Date(),
        });
        await dependencies.jobQueue.enqueue({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          type: "prospecting.channel.assess",
          payload: { workspaceId: context.workspaceId, assessmentId: assessment.id },
          idempotencyKey: `${assessment.id}:retry:${Date.now()}`,
          correlationId: `prospecting-plan:${assessment.planId}`,
          maxAttempts: 3,
          availableAt: new Date(),
        });
        return json(assessment, 202);
      }

      const conversationDetailMatch = campaignConversationPath.exec(url.pathname);
      if (conversationDetailMatch && request.method === "GET") {
        requireViewer(context.role);
        const detail = await campaignConversations.getConversation({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(conversationDetailMatch[1]),
          conversationId: postgresUuidSchema.parse(conversationDetailMatch[2]),
        });
        if (!detail) {
          return problem(404, "CAMPAIGN_CONVERSATION_NOT_FOUND", "Campaign conversation not found");
        }
        return json(detail);
      }

      const conversationsMatch = campaignConversationsPath.exec(url.pathname);
      if (conversationsMatch && request.method === "GET") {
        requireViewer(context.role);
        const overview = await campaignConversations.getOverview({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(conversationsMatch[1]),
        });
        if (!overview) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(overview);
      }

      const dashboardMatch = campaignAutopilotDashboardPath.exec(url.pathname);
      if (dashboardMatch && request.method === "GET") {
        requireViewer(context.role);
        const dashboard = await campaignDashboard.get({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(dashboardMatch[1]),
        });
        if (!dashboard) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(dashboard);
      }

      const autopilotPolicyMatch = campaignAutopilotPolicyPath.exec(url.pathname);
      if (autopilotPolicyMatch && request.method === "GET") {
        requireViewer(context.role);
        const result = await campaigns.getAutopilotPolicy({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(autopilotPolicyMatch[1]),
        });
        if (!result) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(result);
      }
      if (autopilotPolicyMatch && request.method === "PATCH") {
        requireOperator(context.role);
        const patch = campaignAutopilotPolicyPatchSchema.parse(await request.json());
        const result = await campaigns.updateAutopilotPolicy({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(autopilotPolicyMatch[1]),
          patch,
          now: new Date(),
        });
        if (!result) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(result);
      }

      const detailMatch = campaignPath.exec(url.pathname);
      if (detailMatch && request.method === "GET") {
        requireViewer(context.role);
        const detail = await campaigns.getCampaign({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(detailMatch[1]),
        });
        if (!detail) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return json(detail);
      }
      if (detailMatch && request.method === "PATCH") {
        requireOperator(context.role);
        const body = campaignPatchSchema.parse(await request.json());
        return json(await campaigns.updateCampaign({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(detailMatch[1]),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.objective !== undefined ? { objective: body.objective } : {}),
          ...(body.offerVersionId !== undefined ? { offerVersionId: body.offerVersionId } : {}),
          ...(body.icpVersionId !== undefined ? { icpVersionId: body.icpVersionId } : {}),
          ...(body.messagingStrategyVersionId !== undefined ? { messagingStrategyVersionId: body.messagingStrategyVersionId } : {}),
          ...(body.aiPolicyVersionId !== undefined ? { aiPolicyVersionId: body.aiPolicyVersionId } : {}),
          ...(body.sequenceVersionId !== undefined ? { sequenceVersionId: body.sequenceVersionId } : {}),
        }));
      }

      const preflightMatch = campaignPreflightPath.exec(url.pathname);
      if (preflightMatch && request.method === "POST") {
        requireViewer(context.role);
        return json(await campaigns.preflight({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(preflightMatch[1]),
        }));
      }

      const transitionMatch = campaignTransitionPath.exec(url.pathname);
      if (transitionMatch && request.method === "POST") {
        requireAdmin(context.role);
        return json(await campaigns.transition({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(transitionMatch[1]),
          transition: transitionMatch[2] as "activate" | "pause" | "resume" | "archive",
          userId: context.userId,
          at: new Date(),
        }));
      }

      const populationMatch = campaignProspectsPath.exec(url.pathname);
      if (populationMatch && request.method === "GET") {
        requireViewer(context.role);
        return json({ data: await population.listPopulation({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(populationMatch[1]),
        }) });
      }

      const selectMatch = campaignSelectProspectsPath.exec(url.pathname);
      if (selectMatch && request.method === "POST") {
        requireOperator(context.role);
        const body = selectProspectsSchema.parse(await request.json());
        return json({ data: await population.select({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(selectMatch[1]),
          contactIds: body.contactIds,
          userId: context.userId,
        }) });
      }

      const explanationMatch = campaignProspectExplanationPath.exec(url.pathname);
      if (explanationMatch && request.method === "GET") {
        requireViewer(context.role);
        return json(await population.getExplanation({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(explanationMatch[1]),
          contactId: postgresUuidSchema.parse(explanationMatch[2]),
        }));
      }

      const prospectActionMatch = campaignProspectActionPath.exec(url.pathname);
      if (prospectActionMatch && request.method === "POST") {
        requireOperator(context.role);
        const campaignId = postgresUuidSchema.parse(prospectActionMatch[1]);
        const contactId = postgresUuidSchema.parse(prospectActionMatch[2]);
        if (prospectActionMatch[3] === "enroll") {
          return json(await population.enroll({ workspaceId: context.workspaceId, campaignId, contactId, userId: context.userId }), 201);
        }
        const body = excludeProspectSchema.parse(await request.json());
        return json(await population.exclude({ workspaceId: context.workspaceId, campaignId, contactId, userId: context.userId, reason: body.reason }));
      }

      const discoveryMatch = campaignDiscoveryPath.exec(url.pathname);
      if (discoveryMatch && request.method === "POST") {
        requireOperator(context.role);
        if (!dependencies.jobQueue) return problem(503, "JOB_QUEUE_UNAVAILABLE", "Background jobs are unavailable");
        const campaign = await campaigns.getCampaign({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(discoveryMatch[1]),
        });
        if (!campaign) return problem(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        if (!campaign.discoveryRunId) {
          return problem(
            409,
            "CHANNEL_CAMPAIGN_SOURCING_NOT_AVAILABLE",
            "This mono-channel campaign has no legacy LinkedIn discovery run",
          );
        }
        if (campaign.discoveryStatus === "running") {
          return problem(409, "DISCOVERY_ALREADY_RUNNING", "Discovery is already running");
        }
        const restarted = await discovery.restartRun({
          workspaceId: context.workspaceId,
          runId: campaign.discoveryRunId,
        });
        await dependencies.jobQueue.enqueue({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          type: PROSPECT_DISCOVERY_JOB_TYPE,
          payload: { workspaceId: context.workspaceId, runId: campaign.discoveryRunId },
          idempotencyKey: `${campaign.id}:retry:${Date.now()}`,
          correlationId: `campaign:${campaign.id}`,
          maxAttempts: 3,
          availableAt: new Date(),
        });
        return json(restarted, 202);
      }

      const archiveMatch = campaignArchivePath.exec(url.pathname);
      if (archiveMatch && request.method === "POST") {
        requireOperator(context.role);
        const archived = await plans.archiveCampaign({
          workspaceId: context.workspaceId,
          campaignId: postgresUuidSchema.parse(archiveMatch[1]),
          now: new Date(),
        });
        return json(archived);
      }

      const allowed = allowedMethods(url.pathname);
      if (allowed) return methodNotAllowed(allowed);
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The request is invalid");
      }
      if (error instanceof RequestAuthenticationError) {
        return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceContextRequiredError) {
        return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      }
      if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspacePermissionError) {
        return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      }
      if (error instanceof CampaignAutopilotPolicyLockedError) {
        return problem(409, error.message, "The campaign policy is immutable after scheduling starts");
      }
      if (error instanceof CampaignPreflightError) {
        return problem(422, "CAMPAIGN_PREFLIGHT_FAILED", "Campaign preflight failed", { ...error.result });
      }
      if (error instanceof CampaignPopulationError) {
        const status = ["CAMPAIGN_NOT_FOUND", "CONTACT_NOT_FOUND", "PROSPECT_NOT_FOUND"].includes(error.code) ? 404
          : ["SELECTION_EMPTY", "EXCLUSION_REASON_REQUIRED"].includes(error.code) ? 422
            : ["CAMPAIGN_NOT_ACTIVE", "PROSPECT_NOT_SELECTED", "PROSPECT_EXCLUDED", "PROSPECT_ALREADY_ENROLLED", "ENROLLMENT_SUPPRESSED", "NO_VALID_CHANNEL", "ACTIVE_SEQUENCE_CONFLICT", "SEQUENCE_VERSION_NOT_FOUND"].includes(error.code) ? 409 : 400;
        return problem(status, error.code, "Campaign prospect action is not allowed", error.details);
      }
      if (error instanceof ConversationDraftNotFoundError) {
        return problem(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
      }
      const message = error instanceof Error ? error.message : "";
      if ([
        "CHANNEL_ASSESSMENT_NOT_COMPLETED",
        "DRAFT_CAMPAIGN_NOT_FOUND",
        "FAILED_CHANNEL_ASSESSMENT_NOT_FOUND",
      ].includes(message)) {
        return problem(409, message, "The requested prospecting-plan transition is not allowed");
      }
      if (message === "CONVERSATION_NOT_FOUND") {
        return problem(404, message, "Conversation not found");
      }
      if (message === "CONVERSATION_COMMAND_ALREADY_PENDING") {
        return problem(409, message, "A message is already being prepared or sent for this conversation");
      }
      if (message === "CAMPAIGN_NOT_FOUND") return problem(404, message, "Campaign not found");
      if (message === "CAMPAIGN_SNAPSHOT_IMMUTABLE" || message.endsWith("_CONFLICT")) {
        return problem(409, message, "Campaign transition is not allowed");
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireViewer(role: string): void {
  if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Workspace access is required");
  }
}

function requireOperator(role: string): void {
  if (!["operator", "admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Operator access is required");
  }
}

function requireAdmin(role: string): void {
  if (!["admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Administrator access is required");
  }
}

function allowedMethods(pathname: string): string | null {
  if (campaignAutopilotPolicyPath.test(pathname)) return "GET, PATCH";
  if (conversationMessagesPath.test(pathname)) return "POST";
  if (conversationDraftImprovementsPath.test(pathname)) return "POST";
  if (pathname === "/api/v1/campaigns") return "GET, POST";
  if (campaignPath.test(pathname)) return "GET, PATCH";
  if (campaignPreflightPath.test(pathname) || campaignTransitionPath.test(pathname)) return "POST";
  if (campaignProspectsPath.test(pathname)) return "GET";
  if (campaignSelectProspectsPath.test(pathname) || campaignProspectActionPath.test(pathname)) return "POST";
  if (campaignProspectExplanationPath.test(pathname)) return "GET";
  if (
    campaignConversationsPath.test(pathname)
    || campaignConversationsPath.test(pathname)
    || campaignConversationPath.test(pathname)
    || campaignAutopilotDashboardPath.test(pathname)
  ) return "GET";
  if (pathname === "/api/v1/prospecting-plans" || planPath.test(pathname)) return "GET";
  if (
    campaignDiscoveryPath.test(pathname) ||
    campaignArchivePath.test(pathname) ||
    planEnableChannelPath.test(pathname) ||
    assessmentRetryPath.test(pathname)
  ) return "POST";
  return null;
}

function methodNotAllowed(allowed: string): Response {
  return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route", {
    allowed,
  });
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
    { status, headers: { "content-type": "application/problem+json; charset=utf-8" } },
  );
}

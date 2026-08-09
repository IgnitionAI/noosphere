import "server-only";
import { cookies } from "next/headers";

export interface Session {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly image?: string | null;
  };
  readonly session: {
    readonly id: string;
    readonly expiresAt: string;
  };
}

export interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: "viewer" | "operator" | "reviewer" | "admin" | "owner";
  readonly lastSelectedAt: string | null;
}

export type WorkspaceOnboardingStep = "workspace" | "product" | "icp" | "sending_account" | "calendar" | "prerequisites" | "autopilot";
export interface WorkspaceOnboardingProgress {
  readonly workspaceId: string;
  readonly currentStep: WorkspaceOnboardingStep | null;
  readonly completed: boolean;
  readonly completedCount: number;
  readonly steps: readonly {
    readonly key: WorkspaceOnboardingStep;
    readonly position: number;
    readonly title: string;
    readonly description: string;
    readonly optional: boolean;
    readonly status: "pending" | "completed" | "skipped";
    readonly canMutate: boolean;
    readonly requiredRole: "member" | "owner_or_admin";
    readonly prerequisite: { readonly satisfied: boolean; readonly code: string; readonly message: string; readonly href: string };
    readonly actorUserId: string | null;
    readonly completedAt: string | null;
  }[];
  readonly nextAction: { readonly label: string; readonly href: string };
}

export type WorkspaceRole = Workspace["role"];
export type WorkspaceMemberStatus = "active" | "disabled";

export interface WorkspaceMember {
  readonly workspaceId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly status: WorkspaceMemberStatus;
  readonly joinedAt: string;
  readonly lastSelectedAt: string | null;
}

export interface WorkspaceInvitation {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly proposedRole: WorkspaceRole;
  readonly status: "pending" | "accepted" | "revoked" | "expired";
  readonly expiresAt: string;
  readonly invitedBy: string | null;
  readonly acceptedBy: string | null;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly emailDelivery?: "sent" | "failed" | "not_configured";
}

export interface WorkspaceDataPolicy {
  readonly sending: { readonly timezone: string; readonly activeDays: readonly number[]; readonly windowStart: string; readonly windowEnd: string };
  readonly channelLimits: { readonly linkedin: number; readonly email: number; readonly whatsapp: number };
  readonly retention: { readonly invitationsDays: number; readonly jobsDays: number; readonly auditDays: number };
}

export interface WorkspaceDataExport {
  readonly id: string;
  readonly workspaceId: string;
  readonly requestKey: string;
  readonly status: "pending" | "processing" | "completed" | "failed";
  readonly sizeBytes: number | null;
  readonly checksumSha256: string | null;
  readonly requestedBy: string | null;
  readonly expiresAt: string | null;
  readonly completedAt: string | null;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly downloadUrl?: string | null;
}

export interface WorkspaceAuditLog {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorName: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly changes: unknown;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export type ConsoleJobStatus = "pending" | "running" | "retry" | "completed" | "dead_lettered";
export interface ConsoleJob {
  readonly id: string;
  readonly type: string;
  readonly status: ConsoleJobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly payloadPreview: unknown;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface RejectedWebhook {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly payloadPreview: unknown;
  readonly receivedAt: string;
}
export interface CorrelationTrace {
  readonly correlationId: string;
  readonly jobs: readonly ConsoleJob[];
  readonly events: readonly { readonly id: string; readonly aggregateType: string; readonly aggregateId: string; readonly eventType: string; readonly payloadPreview: unknown; readonly attempts: number; readonly publishedAt: string | null; readonly createdAt: string }[];
  readonly audit: readonly { readonly id: string; readonly actorUserId: string | null; readonly action: string; readonly subjectType: string; readonly subjectId: string; readonly changes: unknown; readonly createdAt: string }[];
}

export type KnowledgeSourceType = "product_document" | "proof" | "customer_case" | "objection_response";
export type KnowledgeSourceStatus = "draft" | "validated" | "expired" | "withdrawn";
export interface KnowledgeSource {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: KnowledgeSourceType;
  readonly title: string;
  readonly content: string | null;
  readonly researchDocumentId: string | null;
  readonly authorName: string;
  readonly publishedAt: string;
  readonly freshnessUntil: string | null;
  readonly status: KnowledgeSourceStatus;
  readonly effectiveStatus: KnowledgeSourceStatus;
  readonly withdrawalReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeClaim {
  readonly id: string;
  readonly workspaceId: string;
  readonly claim: string;
  readonly status: "draft" | "validated";
  readonly effectiveStatus: "draft" | "validated" | "needs_resourcing";
  readonly offerClaimId: string | null;
  readonly sources: readonly KnowledgeSource[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AiCapability = "icp_research" | "message_generation" | "setter";
export interface EvaluationDataset {
  readonly id: string;
  readonly capability: AiCapability;
  readonly name: string;
  readonly description: string | null;
  readonly rubricVersion: string;
  readonly version: number;
  readonly caseCount: number;
  readonly createdAt: string;
}
export interface AiPromptVersion {
  readonly id: string;
  readonly capability: AiCapability;
  readonly version: number;
  readonly content: string;
  readonly previousVersionId: string | null;
  readonly createdAt: string;
}
export interface AiConfiguration {
  readonly configuration: {
    readonly id: string;
    readonly capability: AiCapability;
    readonly provider: "kimi-code";
    readonly model: string;
    readonly promptVersionId: string;
    readonly status: "candidate" | "shadow" | "active" | "retired";
    readonly promotedAt: string | null;
    readonly createdAt: string;
  };
  readonly prompt: AiPromptVersion;
}
export interface EvaluationRun {
  readonly id: string;
  readonly datasetId: string;
  readonly configurationId: string;
  readonly requestKey: string;
  readonly status: "queued" | "running" | "completed" | "partial" | "failed";
  readonly totalCases: number;
  readonly completedCases: number;
  readonly failedCases: number;
  readonly aggregateScores: Readonly<Record<string, number>>;
  readonly totalCost: string | null;
  readonly totalLatencyMs: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}
export interface EvaluationRunDetail extends EvaluationRun {
  readonly results: readonly {
    readonly id: string;
    readonly evaluationCaseId: string;
    readonly aiRunId: string | null;
    readonly status: "pending" | "completed" | "failed";
    readonly output: unknown;
    readonly scores: Readonly<Record<string, number>>;
    readonly errorCode: string | null;
  }[];
}

export interface WorkspaceAiSettings {
  readonly researchModels: readonly string[];
  readonly synthesisModels: readonly string[];
  readonly source: "workspace" | "environment";
  readonly updatedAt: string | null;
}

export interface ProductResearchBrief {
  readonly productUrl: string;
  readonly productName: string;
  readonly description: string;
  readonly geography: string;
  readonly languages: readonly string[];
  readonly salesMotion: "service" | "saas" | "license" | "hybrid";
  readonly knownCompetitors: readonly string[];
  readonly internalDocumentIds: readonly string[];
  readonly depth: "quick" | "standard" | "deep";
  readonly audienceGoal: "end_customers" | "channel_partners" | "both";
  readonly buyerConstraints: string;
  readonly researchObjective?:
    | "qualified_conversations"
    | "fast_revenue"
    | "strategic_market"
    | undefined;
  readonly researchVersion: 1 | 2 | 3;
}

export interface ResearchRun {
  readonly id: string;
  readonly status:
    | "draft"
    | "queued"
    | "running"
    | "paused"
    | "ready_for_review"
    | "completed"
    | "partial"
    | "interrupted"
    | "failed";
  readonly activeStage: string | null;
  readonly brief: ProductResearchBrief;
  readonly completedStages: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stages: readonly {
    readonly stage: string;
    readonly status:
      | "pending"
      | "queued"
      | "running"
      | "paused"
      | "completed"
      | "failed"
      | "invalidated";
    readonly attempts: number;
    readonly lastErrorCode: string | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  }[];
}

export interface ResearchRunSummary {
  readonly id: string;
  readonly status: ResearchRun["status"];
  readonly activeStage: string | null;
  readonly brief: ProductResearchBrief;
  readonly completedStages: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearchDocument {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearchReport {
  readonly run: {
    readonly id: string;
    readonly status: ResearchRun["status"];
    readonly brief: ProductResearchBrief;
    readonly completedStages: readonly string[];
  };
  readonly stageOutputs: Readonly<Record<string, unknown>>;
  readonly evidence: readonly {
    readonly id: string;
    readonly sourceType: string;
    readonly url: string | null;
    readonly title: string;
    readonly excerpt: string;
  }[];
  readonly competitors: readonly Record<string, unknown>[];
  readonly findings: readonly Record<string, unknown>[];
  readonly proposals: readonly Record<string, unknown>[];
  readonly versions: readonly Record<string, unknown>[];
}

export interface IcpVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly icpId: string;
  readonly runId: string | null;
  readonly proposalId: string | null;
  readonly version: number;
  readonly name: string;
  readonly confidence: number;
  readonly criteria: unknown;
  readonly buyingCommittee: unknown;
  readonly problems: unknown;
  readonly signals: unknown;
  readonly exclusions: unknown;
  readonly unknowns: unknown;
  readonly unresolvedContradictions: unknown;
  readonly blockedFindings: unknown;
  readonly publishedBy: string | null;
  readonly publishedAt: string;
  readonly createdAt: string;
}

/** Compatibility name retained for report publication responses. */
export type IcpVersionView = IcpVersion;

export interface Icp {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IcpDetail extends Icp {
  readonly versions: readonly IcpVersion[];
}

export class OutboundApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "OutboundApiError";
  }
}

export async function getSession(): Promise<Session | null> {
  const response = await apiFetch("/api/auth/get-session");
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return (await response.json()) as Session | null;
}

export async function listWorkspaces(): Promise<readonly Workspace[]> {
  const response = await apiFetch("/api/v1/workspaces");
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: Workspace[] }).data;
}

export async function createWorkspace(input: { name: string; slug?: string }): Promise<Workspace> {
  return crmFetch("", "/api/v1/workspaces", { method: "POST", body: input });
}

export async function getWorkspaceOnboarding(workspaceSlug: string, workspaceId: string): Promise<WorkspaceOnboardingProgress> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/onboarding`);
}

export async function completeWorkspaceOnboardingStep(workspaceSlug: string, workspaceId: string, step: WorkspaceOnboardingStep): Promise<WorkspaceOnboardingProgress> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/onboarding/steps/${step}/actions/complete`, { method: "POST", body: {} });
}

export async function skipWorkspaceOnboardingStep(workspaceSlug: string, workspaceId: string, step: WorkspaceOnboardingStep): Promise<WorkspaceOnboardingProgress> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/onboarding/steps/${step}/actions/skip`, { method: "POST", body: {} });
}

export async function listWorkspaceMembers(
  workspaceSlug: string,
  workspaceId: string,
): Promise<readonly WorkspaceMember[]> {
  const response = await crmFetch<{ data: WorkspaceMember[] }>(workspaceSlug, `/api/v1/workspaces/${workspaceId}/members`);
  return response.data;
}

export async function listWorkspaceInvitations(
  workspaceSlug: string,
  workspaceId: string,
): Promise<readonly WorkspaceInvitation[]> {
  const response = await crmFetch<{ data: WorkspaceInvitation[] }>(workspaceSlug, `/api/v1/workspaces/${workspaceId}/invitations`);
  return response.data;
}

export async function inviteWorkspaceMember(
  workspaceSlug: string,
  workspaceId: string,
  input: { email: string; role: WorkspaceRole },
): Promise<WorkspaceInvitation> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/invitations`, { method: "POST", body: input });
}

export async function acceptWorkspaceInvitation(invitationId: string): Promise<{
  invitation: WorkspaceInvitation;
  member: WorkspaceMember;
}> {
  return crmFetch("", `/api/v1/invitations/${invitationId}/actions/accept`, { method: "POST", body: {} });
}

export async function revokeWorkspaceInvitation(
  workspaceSlug: string,
  invitationId: string,
): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/invitations/${invitationId}/actions/revoke`, { method: "POST", body: {} });
}

export async function changeWorkspaceMemberRole(
  workspaceSlug: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/members/${userId}/actions/change-role`, { method: "POST", body: { role } });
}

export async function setWorkspaceMemberStatus(
  workspaceSlug: string,
  workspaceId: string,
  userId: string,
  status: WorkspaceMemberStatus,
): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/members/${userId}/actions/set-status`, { method: "POST", body: { status } });
}

export async function updateWorkspaceProfile(workspaceSlug: string, workspaceId: string, name: string): Promise<Workspace> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}`, { method: "PATCH", body: { name } });
}

export async function getWorkspaceDataPolicy(workspaceSlug: string, workspaceId: string, includeRetention: boolean): Promise<WorkspaceDataPolicy> {
  const [sending, limits, retention] = await Promise.all([
    crmFetch<{ sending: WorkspaceDataPolicy["sending"] }>(workspaceSlug, `/api/v1/workspaces/${workspaceId}/sending-preferences`),
    crmFetch<{ channelLimits: WorkspaceDataPolicy["channelLimits"] }>(workspaceSlug, `/api/v1/workspaces/${workspaceId}/channel-limits`),
    includeRetention
      ? crmFetch<{ retention: WorkspaceDataPolicy["retention"] }>(workspaceSlug, `/api/v1/workspaces/${workspaceId}/retention-policy`)
      : Promise.resolve({ retention: { invitationsDays: 90, jobsDays: 90, auditDays: 365 } }),
  ]);
  return { sending: sending.sending, channelLimits: limits.channelLimits, retention: retention.retention };
}

export async function updateWorkspaceSendingPreferences(workspaceSlug: string, workspaceId: string, sending: WorkspaceDataPolicy["sending"]): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/sending-preferences`, { method: "PUT", body: { sending } });
}

export async function updateWorkspaceChannelLimits(workspaceSlug: string, workspaceId: string, channelLimits: WorkspaceDataPolicy["channelLimits"]): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/channel-limits`, { method: "PUT", body: { channelLimits } });
}

export async function updateWorkspaceRetentionPolicy(workspaceSlug: string, workspaceId: string, retention: WorkspaceDataPolicy["retention"], confirmation: string): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/retention-policy`, { method: "PUT", body: { retention, confirmation } });
}

export async function requestWorkspaceDataExport(workspaceSlug: string, workspaceId: string, requestKey: string): Promise<WorkspaceDataExport> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/actions/export`, { method: "POST", body: { requestKey } });
}

export async function getWorkspaceDataExport(workspaceSlug: string, exportId: string): Promise<WorkspaceDataExport> {
  return crmFetch(workspaceSlug, `/api/v1/exports/${exportId}`);
}

export async function anonymizeWorkspaceContact(workspaceSlug: string, contactId: string, confirmation: string): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/actions/anonymize`, { method: "POST", body: { confirmation } });
}

export async function listWorkspaceAuditLogs(workspaceSlug: string, filters: { action?: string; actorUserId?: string; from?: string; to?: string; limit?: number } = {}): Promise<readonly WorkspaceAuditLog[]> {
  const query = new URLSearchParams();
  if (filters.action) query.set("action", filters.action);
  if (filters.actorUserId) query.set("actorUserId", filters.actorUserId);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  query.set("limit", String(filters.limit ?? 50));
  const response = await crmFetch<{ data: WorkspaceAuditLog[] }>(workspaceSlug, `/api/v1/audit-logs?${query.toString()}`);
  return response.data;
}

export async function listConsoleJobs(workspaceSlug: string, filters: { statuses?: readonly string[]; type?: string; from?: string; to?: string; limit?: number } = {}): Promise<readonly ConsoleJob[]> {
  const query = consoleQuery(filters);
  for (const status of filters.statuses ?? []) query.append("status", status);
  return (await crmFetch<{ data: ConsoleJob[] }>(workspaceSlug, `/api/v1/console/jobs?${query}`)).data;
}
export async function listConsoleDeadLetters(workspaceSlug: string, filters: { type?: string; from?: string; to?: string; limit?: number } = {}): Promise<readonly ConsoleJob[]> {
  return (await crmFetch<{ data: ConsoleJob[] }>(workspaceSlug, `/api/v1/console/dead-letters?${consoleQuery(filters)}`)).data;
}
export async function listConsoleRejectedWebhooks(workspaceSlug: string, filters: { from?: string; to?: string; limit?: number } = {}): Promise<readonly RejectedWebhook[]> {
  return (await crmFetch<{ data: RejectedWebhook[] }>(workspaceSlug, `/api/v1/console/webhooks/rejected?${consoleQuery(filters)}`)).data;
}
export async function traceConsoleCorrelation(workspaceSlug: string, correlationId: string): Promise<CorrelationTrace> {
  return crmFetch(workspaceSlug, `/api/v1/console/correlations/${encodeURIComponent(correlationId)}`);
}
export async function requeueConsoleJob(workspaceSlug: string, jobId: string): Promise<ConsoleJob & { requeued: true }> {
  return crmFetch(workspaceSlug, `/api/v1/console/jobs/${jobId}/actions/requeue`, { method: "POST", body: {} });
}

function consoleQuery(filters: { type?: string; from?: string; to?: string; limit?: number }): URLSearchParams {
  const query = new URLSearchParams({ limit: String(filters.limit ?? 50) });
  if (filters.type) query.set("type", filters.type);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  return query;
}

export async function listKnowledgeSources(workspaceSlug: string, filters: { type?: KnowledgeSourceType; status?: KnowledgeSourceStatus; fresh?: boolean } = {}): Promise<readonly KnowledgeSource[]> {
  const query = new URLSearchParams();
  if (filters.type) query.set("type", filters.type);
  if (filters.status) query.set("status", filters.status);
  if (filters.fresh !== undefined) query.set("fresh", String(filters.fresh));
  const response = await crmFetch<{ data: KnowledgeSource[] }>(workspaceSlug, `/api/v1/knowledge-sources${query.size ? `?${query}` : ""}`);
  return response.data;
}

export async function createKnowledgeSource(workspaceSlug: string, input: { type: KnowledgeSourceType; title: string; content: string | null; researchDocumentId: string | null; authorName: string; publishedAt: string; freshnessUntil: string | null }): Promise<KnowledgeSource> {
  return crmFetch(workspaceSlug, "/api/v1/knowledge-sources", { method: "POST", body: input });
}

export async function validateKnowledgeSource(workspaceSlug: string, sourceId: string): Promise<KnowledgeSource> {
  return crmFetch(workspaceSlug, `/api/v1/knowledge-sources/${sourceId}/actions/validate`, { method: "POST", body: {} });
}

export async function withdrawKnowledgeSource(workspaceSlug: string, sourceId: string, reason: string): Promise<KnowledgeSource> {
  return crmFetch(workspaceSlug, `/api/v1/knowledge-sources/${sourceId}/actions/withdraw`, { method: "POST", body: { reason } });
}

export async function listKnowledgeClaims(workspaceSlug: string): Promise<readonly KnowledgeClaim[]> {
  const response = await crmFetch<{ data: KnowledgeClaim[] }>(workspaceSlug, "/api/v1/knowledge-claims");
  return response.data;
}

export async function createKnowledgeClaim(workspaceSlug: string, input: { claim: string; offerClaimId: string | null; sourceIds: readonly string[] }): Promise<KnowledgeClaim> {
  return crmFetch(workspaceSlug, "/api/v1/knowledge-claims", { method: "POST", body: input });
}

export async function validateKnowledgeClaim(workspaceSlug: string, claimId: string): Promise<KnowledgeClaim> {
  return crmFetch(workspaceSlug, `/api/v1/knowledge-claims/${claimId}/actions/validate`, { method: "POST", body: {} });
}

export async function listEvaluationDatasets(workspaceSlug: string): Promise<readonly EvaluationDataset[]> {
  return (await crmFetch<{ data: EvaluationDataset[] }>(workspaceSlug, "/api/v1/evaluation-datasets")).data;
}

export async function createEvaluationDataset(workspaceSlug: string, input: { capability: AiCapability; name: string; description?: string | null; rubricVersion: string; cases: readonly { name: string; input: unknown; expected: Record<string, unknown>; criteria?: Record<string, unknown>; authorizedKnowledgeClaimIds?: readonly string[] }[] }): Promise<EvaluationDataset> {
  return crmFetch(workspaceSlug, "/api/v1/evaluation-datasets", { method: "POST", body: input });
}

export async function createAiPromptVersion(workspaceSlug: string, input: { capability: AiCapability; content: string }): Promise<AiPromptVersion> {
  return crmFetch(workspaceSlug, "/api/v1/ai-prompt-versions", { method: "POST", body: input });
}

export async function listAiConfigurations(workspaceSlug: string): Promise<readonly AiConfiguration[]> {
  return (await crmFetch<{ data: AiConfiguration[] }>(workspaceSlug, "/api/v1/ai-configurations")).data;
}

export async function createAiConfiguration(workspaceSlug: string, input: { capability: AiCapability; provider: "kimi-code"; model: string; promptVersionId: string; status?: "candidate" | "shadow" }): Promise<AiConfiguration["configuration"]> {
  return crmFetch(workspaceSlug, "/api/v1/ai-configurations", { method: "POST", body: input });
}

export async function listEvaluationRuns(workspaceSlug: string): Promise<readonly EvaluationRun[]> {
  return (await crmFetch<{ data: EvaluationRun[] }>(workspaceSlug, "/api/v1/evaluation-runs")).data;
}

export async function getEvaluationRun(workspaceSlug: string, runId: string): Promise<EvaluationRunDetail> {
  return crmFetch(workspaceSlug, `/api/v1/evaluation-runs/${runId}`);
}

export async function requestEvaluationRun(workspaceSlug: string, input: { datasetId: string; configurationId: string; requestKey: string }): Promise<EvaluationRun> {
  return crmFetch(workspaceSlug, "/api/v1/evaluation-runs", { method: "POST", body: input });
}

export async function compareEvaluationRuns(workspaceSlug: string, leftRunId: string, rightRunId: string): Promise<{ left: EvaluationRun; right: EvaluationRun; recommendation: { decision: "consider_candidate" | "keep_baseline"; requiresHumanApproval: true; autoApplied: false; explanation: string } }> {
  const query = new URLSearchParams({ left: leftRunId, right: rightRunId });
  return crmFetch(workspaceSlug, `/api/v1/evaluation-runs/compare?${query}`);
}

export async function promoteAiConfiguration(workspaceSlug: string, configurationId: string): Promise<AiConfiguration["configuration"]> {
  return crmFetch(workspaceSlug, `/api/v1/ai-configurations/${configurationId}/actions/promote`, { method: "POST", body: {} });
}

export async function recordAiFeedback(workspaceSlug: string, aiRunId: string, input: { rating: -1 | 1; reason: string | null }): Promise<unknown> {
  return crmFetch(workspaceSlug, `/api/v1/ai-runs/${aiRunId}/feedback`, { method: "POST", body: input });
}

export async function getWorkspaceAiSettings(
  workspaceSlug: string,
): Promise<WorkspaceAiSettings> {
  const response = await apiFetch("/api/v1/workspace-ai-settings", { workspaceSlug });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as WorkspaceAiSettings;
}

export async function updateWorkspaceAiSettings(
  workspaceSlug: string,
  settings: Pick<WorkspaceAiSettings, "researchModels" | "synthesisModels">,
): Promise<WorkspaceAiSettings> {
  const response = await apiFetch("/api/v1/workspace-ai-settings", {
    method: "PUT",
    workspaceSlug,
    body: JSON.stringify(settings),
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as WorkspaceAiSettings;
}

export type CalendarConnection =
  | { readonly connected: false }
  | {
      readonly connected: true;
      readonly id: string;
      readonly provider: "calcom";
      readonly bookingUrl: string;
      readonly apiConfigured: boolean;
      readonly automationReady: boolean;
      readonly eventType: { readonly id: number; readonly slug: string; readonly title: string } | null;
      readonly username: string | null;
      readonly timeZone: string | null;
      readonly webhookRegistered: boolean;
      readonly lastVerifiedAt: string | null;
      readonly lastErrorCode: string | null;
      readonly status: "active" | "disabled";
      readonly webhookUrl: string;
      readonly updatedAt: string;
    };

export interface CalendarMeetingType {
  readonly id: string;
  readonly providerEventTypeId: number;
  readonly slug: string;
  readonly title: string;
  readonly lengthMinutes: number;
  readonly bookingUrl: string;
  readonly timeZone: string;
  readonly isDefault: boolean;
  readonly active: boolean;
}
export interface CalendarBooking {
  readonly id: string;
  readonly contactId: string | null;
  readonly campaignId: string | null;
  readonly opportunityId: string | null;
  readonly status: string;
  readonly attendeeName: string | null;
  readonly attendeeEmail: string | null;
  readonly attendeePhone: string | null;
  readonly attendeeTimeZone: string;
  readonly organizerTimeZone: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly meetingUrl: string | null;
  readonly cancellationReason: string | null;
  readonly noShowAt: string | null;
  readonly rescheduleCount: number;
  readonly meetingType: CalendarMeetingType | null;
  readonly history: readonly { readonly id: string; readonly action: string; readonly fromStatus: string | null; readonly toStatus: string; readonly previousStartAt: string | null; readonly newStartAt: string | null; readonly reason: string | null; readonly source: string; readonly createdAt: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function getCalendarConnection(
  workspaceSlug: string,
): Promise<CalendarConnection> {
  return crmFetch(workspaceSlug, "/api/v1/calendar-connection");
}

export async function updateCalendarConnection(
  workspaceSlug: string,
  input: { provider: "calcom"; bookingUrl: string; apiKey?: string },
): Promise<CalendarConnection> {
  return crmFetch(workspaceSlug, "/api/v1/calendar-connection", {
    method: "PUT",
    body: input,
  });
}

export async function disconnectCalendar(
  workspaceSlug: string,
): Promise<void> {
  return crmFetch(workspaceSlug, "/api/v1/calendar-connection", { method: "DELETE" });
}

export async function listCalendarMeetingTypes(workspaceSlug: string): Promise<readonly CalendarMeetingType[]> {
  return (await crmFetch<{ data: CalendarMeetingType[] }>(workspaceSlug, "/api/v1/calendar-connection/meeting-types")).data;
}
export async function updateCalendarMeetingTypes(workspaceSlug: string, input: { providerEventTypeIds: readonly number[]; defaultProviderEventTypeId: number }): Promise<readonly CalendarMeetingType[]> {
  return (await crmFetch<{ data: CalendarMeetingType[] }>(workspaceSlug, "/api/v1/calendar-connection/meeting-types", { method: "PUT", body: input })).data;
}
export async function listCalendarBookings(workspaceSlug: string, filters: { contactId?: string; opportunityId?: string; limit?: number } = {}): Promise<readonly CalendarBooking[]> {
  const query = new URLSearchParams({ limit: String(filters.limit ?? 100) });
  if (filters.contactId) query.set("contactId", filters.contactId);
  if (filters.opportunityId) query.set("opportunityId", filters.opportunityId);
  return (await crmFetch<{ data: CalendarBooking[] }>(workspaceSlug, `/api/v1/calendar-bookings?${query}`)).data;
}
export async function rescheduleCalendarBooking(workspaceSlug: string, bookingId: string, input: { start: string; reason: string; requestKey: string }): Promise<unknown> {
  return crmFetch(workspaceSlug, `/api/v1/calendar-bookings/${bookingId}/actions/reschedule`, { method: "POST", body: input });
}
export async function cancelCalendarBooking(workspaceSlug: string, bookingId: string, input: { reason: string; requestKey: string }): Promise<unknown> {
  return crmFetch(workspaceSlug, `/api/v1/calendar-bookings/${bookingId}/actions/cancel`, { method: "POST", body: input });
}
export async function markCalendarBookingNoShow(workspaceSlug: string, bookingId: string, input: { reason: string; requestKey: string }): Promise<unknown> {
  return crmFetch(workspaceSlug, `/api/v1/calendar-bookings/${bookingId}/actions/no-show`, { method: "POST", body: input });
}

export interface WhatsAppChannelConnection {
  readonly channel: "whatsapp";
  readonly connected: boolean;
  readonly selectedAccountId: string | null;
  readonly selectedDisplayName: string | null;
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly channel: "whatsapp";
    readonly healthy: boolean;
    readonly selected: boolean;
  }[];
}

export async function getWhatsAppChannelConnection(
  workspaceSlug: string,
): Promise<WhatsAppChannelConnection> {
  return crmFetch(workspaceSlug, "/api/v1/channel-connections/whatsapp");
}

export async function selectWhatsAppChannelAccount(
  workspaceSlug: string,
  providerAccountId: string,
): Promise<void> {
  await crmFetch(workspaceSlug, "/api/v1/channel-connections/whatsapp", {
    method: "PUT",
    body: { providerAccountId },
  });
}

export interface PipelineOpportunity {
  readonly id: string;
  readonly contactId: string;
  readonly campaignId: string | null;
  readonly stage: "qualified" | "meeting_requested" | "meeting_booked" | "meeting_no_show" | "meeting_completed" | "won" | "lost";
  readonly column: "qualified" | "meeting" | "follow_up" | "closed";
  readonly amount?: number | null;
  readonly currency?: string | null;
  readonly probability: number;
  readonly ownerUserId?: string | null;
  readonly nextAction: string | null;
  readonly expectedCloseDate?: string | null;
  readonly closedAt?: string | null;
  readonly lostReason?: string | null;
  readonly lostComment?: string | null;
  readonly offerVersionId?: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly companyName: string | null;
  readonly jobTitle: string | null;
  readonly campaignName: string | null;
  readonly icpName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly meeting: {
    readonly status: string;
    readonly startAt: string;
    readonly endAt: string | null;
    readonly meetingUrl: string | null;
  } | null;
  readonly history: readonly {
    readonly id: string;
    readonly fromStage: string | null;
    readonly toStage: string;
    readonly source: string;
    readonly reason: string | null;
    readonly createdAt: string;
  }[];
}

export interface PipelineView {
  readonly data: readonly PipelineOpportunity[];
  readonly metrics: {
    readonly total: number;
    readonly qualified: number;
    readonly meetings: number;
    readonly followUp: number;
    readonly won: number;
  };
}

export async function getPipeline(workspaceSlug: string): Promise<PipelineView> {
  return crmFetch(workspaceSlug, "/api/v1/opportunities");
}

export async function changeOpportunityStage(
  workspaceSlug: string,
  opportunityId: string,
  input: { stage: PipelineOpportunity["stage"]; reason?: string },
): Promise<void> {
  await crmFetch(workspaceSlug, `/api/v1/opportunities/${opportunityId}/actions/change-stage`, {
    method: "POST",
    body: input,
  });
}

export interface PipelineForecastRow {
  readonly period: string;
  readonly stage: string;
  readonly ownerUserId: string | null;
  readonly amount?: number;
  readonly weightedRevenue?: number;
  readonly count: number;
}
export async function updateOpportunity(workspaceSlug: string, opportunityId: string, input: {
  amount?: number | null;
  currency?: string | null;
  probability?: number;
  ownerUserId?: string | null;
  nextAction?: string | null;
  expectedCloseDate?: string | null;
}): Promise<PipelineOpportunity> {
  return crmFetch(workspaceSlug, `/api/v1/opportunities/${opportunityId}`, { method: "PATCH", body: input });
}
export async function closeOpportunity(workspaceSlug: string, opportunityId: string, input: {
  stage: "won" | "lost";
  amount?: number | null;
  currency?: string | null;
  offerVersionId?: string | null;
  lostReason?: string | null;
  lostComment?: string | null;
}): Promise<PipelineOpportunity> {
  return crmFetch(workspaceSlug, `/api/v1/opportunities/${opportunityId}/actions/close`, { method: "POST", body: input });
}
export async function reopenOpportunity(workspaceSlug: string, opportunityId: string): Promise<PipelineOpportunity> {
  return crmFetch(workspaceSlug, `/api/v1/opportunities/${opportunityId}/actions/reopen`, { method: "POST", body: {} });
}
export async function getPipelineForecast(workspaceSlug: string, options: { from?: string; to?: string } = {}): Promise<{ data: PipelineForecastRow[] }> {
  const query = new URLSearchParams();
  if (options.from) query.set("from", new Date(options.from).toISOString());
  if (options.to) query.set("to", new Date(options.to).toISOString());
  const suffix = query.toString();
  return crmFetch(workspaceSlug, `/api/v1/pipeline/forecast${suffix ? `?${suffix}` : ""}`);
}
export async function listLostReasons(workspaceSlug: string, workspaceId: string): Promise<{ data: { key: string; label: string }[] }> {
  return crmFetch(workspaceSlug, `/api/v1/workspaces/${workspaceId}/lost-reasons`);
}

export async function createResearchRun(
  workspaceSlug: string,
  brief: ProductResearchBrief,
): Promise<{ id: string; status: string }> {
  const response = await apiFetch("/api/v1/product-research-runs", {
    method: "POST",
    workspaceSlug,
    body: JSON.stringify(brief),
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as { id: string; status: string };
}

export async function getResearchRun(
  workspaceSlug: string,
  runId: string,
): Promise<ResearchRun> {
  const response = await apiFetch(`/api/v1/product-research-runs/${runId}`, {
    workspaceSlug,
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as ResearchRun;
}

export async function listResearchRuns(
  workspaceSlug: string,
  limit = 10,
): Promise<readonly ResearchRunSummary[]> {
  const response = await apiFetch(`/api/v1/product-research-runs?limit=${limit}`, {
    workspaceSlug,
  });
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: ResearchRunSummary[] }).data;
}

export async function researchAction(
  workspaceSlug: string,
  runId: string,
  action: "start" | "pause" | "resume",
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/actions/${action}`,
    { method: "POST", workspaceSlug },
  );
  if (!response.ok) await throwApiError(response);
}

export async function createDocumentUploadIntent(
  workspaceSlug: string,
  input: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  },
): Promise<{ document: ResearchDocument; uploadUrl: string; expiresInSeconds: number }> {
  const response = await apiFetch("/api/v1/research-documents/upload-intents", {
    method: "POST",
    workspaceSlug,
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as {
    document: ResearchDocument;
    uploadUrl: string;
    expiresInSeconds: number;
  };
}

export async function completeDocumentUpload(
  workspaceSlug: string,
  documentId: string,
): Promise<ResearchDocument> {
  const response = await apiFetch(`/api/v1/research-documents/${documentId}/complete`, {
    method: "POST",
    workspaceSlug,
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as ResearchDocument;
}

export async function listResearchDocuments(
  workspaceSlug: string,
): Promise<readonly ResearchDocument[]> {
  const response = await apiFetch("/api/v1/research-documents", { workspaceSlug });
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: ResearchDocument[] }).data;
}

export async function getResearchReport(
  workspaceSlug: string,
  runId: string,
): Promise<ResearchReport> {
  const response = await apiFetch(`/api/v1/product-research-runs/${runId}/report`, {
    workspaceSlug,
  });
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as ResearchReport;
}

export type SuppressionIdentityType = "email" | "linkedin" | "phone" | "whatsapp";
export type SuppressionChannel = "global" | "email" | "linkedin" | "whatsapp";

export interface Suppression {
  readonly id: string;
  readonly channel: SuppressionChannel;
  readonly identityType: SuppressionIdentityType | null;
  readonly normalizedValue: string | null;
  readonly reason: string | null;
  readonly contactId: string | null;
  readonly createdBy: string | null;
  readonly liftedAt: string | null;
  readonly liftedBy: string | null;
  readonly liftJustification: string | null;
  readonly createdAt: string;
}

export async function reviewIcpProposal(
  workspaceSlug: string,
  runId: string,
  action: "approve-icp" | "reject-icp",
  proposalId: string,
  reason: string | null,
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/actions/${action}`,
    {
      method: "POST",
      workspaceSlug,
      body: JSON.stringify({ proposalId, reason }),
    },
  );
  if (!response.ok) await throwApiError(response);
}

export async function reviewFinding(
  workspaceSlug: string,
  runId: string,
  findingId: string,
  input: {
    decision: "confirmed" | "corrected" | "rejected";
    statement?: string;
    confidence?: number;
    reason?: string | null;
  },
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/findings/${findingId}`,
    { method: "PATCH", workspaceSlug, body: JSON.stringify(input) },
  );
  if (!response.ok) await throwApiError(response);
}

export async function correctIcpProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/icp-proposals/${proposalId}`,
    { method: "PATCH", workspaceSlug, body: JSON.stringify(fields) },
  );
  if (!response.ok) await throwApiError(response);
}

export async function publishIcpVersion(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
): Promise<IcpVersionView> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/actions/publish-icp`,
    { method: "POST", workspaceSlug, body: JSON.stringify({ proposalId }) },
  );
  if (!response.ok) await throwApiError(response);
  return (await response.json()) as IcpVersionView;
}

export async function researchMore(
  workspaceSlug: string,
  runId: string,
  fromStage: string,
  reason: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/product-research-runs/${runId}/actions/research-more`,
    { method: "POST", workspaceSlug, body: JSON.stringify({ fromStage, reason }) },
  );
  if (!response.ok) await throwApiError(response);
}

export interface Company {
  readonly id: string;
  readonly name: string;
  readonly normalizedDomain: string | null;
  readonly sector: string | null;
  readonly employeeCountMin: number | null;
  readonly employeeCountMax: number | null;
  readonly location: string | null;
  readonly linkedinUrl: string | null;
  readonly source: string;
  readonly createdAt: string;
}

export interface ContactSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: "active" | "suppressed";
  readonly createdAt: string;
  readonly currentEmployment: {
    readonly companyId: string;
    readonly companyName: string;
    readonly title: string;
  } | null;
}

export interface ContactDetail {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly source?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly photoUrl?: string | null;
  readonly preferredChannel?: string | null;
  readonly status: "active" | "suppressed";
  readonly identities: readonly {
    readonly id: string;
    readonly type: string;
    readonly value: string;
    readonly verificationStatus: "unknown" | "verified" | "invalid";
    readonly source: string;
  }[];
  readonly employments: readonly {
    readonly id: string;
    readonly companyId: string;
    readonly companyName: string;
    readonly title: string;
    readonly startedOn: string | null;
    readonly endedOn: string | null;
    readonly isCurrent: boolean;
  }[];
}

export type SignalType = "hiring" | "funding" | "job_change" | "leadership_change" | "geographic_expansion" | "public_activity" | "technology" | "competitor";
export type SignalEntityType = "company" | "contact";
export type SignalConfidence = "high" | "medium" | "low";
export interface IntentSignal {
  readonly id: string;
  readonly signalType: SignalType;
  readonly entityType: SignalEntityType;
  readonly entityId: string;
  readonly companyId: string | null;
  readonly contactId: string | null;
  readonly source: string;
  readonly sources: readonly string[];
  readonly providerEventId: string | null;
  readonly evidenceUrl: string | null;
  readonly evidenceSnippet: string | null;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly confidence: SignalConfidence;
  readonly legalBasis: string;
  readonly sourceAuthorized: boolean;
}
export type SignalCollectionRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed";
export interface SignalCollectionRun {
  readonly id: string;
  readonly workspaceId?: string;
  readonly companyId: string | null;
  readonly contactId: string | null;
  readonly requestKey: string;
  readonly status: SignalCollectionRunStatus;
  readonly source: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type EnrichmentObservationStatus = "found" | "probable" | "verified" | "invalid";
export type EnrichmentConfidence = "high" | "medium" | "low" | "none";
export type EnrichmentPhoneKind = "public_company" | "personal";
export interface EnrichmentObservation {
  readonly id: string;
  readonly field: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly status: EnrichmentObservationStatus;
  readonly confidence: EnrichmentConfidence;
  readonly source: string;
  readonly provider: string | null;
  readonly evidenceUrl: string | null;
  readonly evidenceSnippet: string | null;
  readonly phoneKind: EnrichmentPhoneKind | null;
  readonly observedAt: string;
  readonly expiresAt: string | null;
}
export type EnrichmentJobStatus = "queued" | "running" | "succeeded" | "failed";
export interface EnrichmentJob {
  readonly id: string;
  readonly entityType: "contact" | "company";
  readonly entityId: string;
  readonly requestKey: string;
  readonly status: EnrichmentJobStatus;
  readonly provider: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly correlationId: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface EnrichmentJobDetail extends EnrichmentJob {
  readonly observations: readonly EnrichmentObservation[];
}

export interface ProspectActivity {
  readonly id: string;
  readonly campaignId: string | null;
  readonly channel: "linkedin" | "email" | "whatsapp";
  readonly source: "outreach_action" | "conversation";
  readonly direction: "inbound" | "outbound";
  readonly senderType: string;
  readonly status: string;
  readonly stepKind: string | null;
  readonly subject: string | null;
  readonly body: string | null;
  readonly occurredAt: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface ProspectViewSummary extends ContactSummary {
  readonly channels: { readonly linkedin: boolean; readonly email: boolean; readonly whatsapp: boolean };
  readonly icpMatches: readonly {
    readonly campaignId: string;
    readonly campaignName: string;
    readonly channel: "linkedin" | "email" | "whatsapp" | null;
    readonly icpVersionId: string;
    readonly icpName: string;
    readonly score: number | null;
    readonly eligible: boolean;
    readonly candidateId: string;
    readonly headline: string | null;
    readonly companyName: string | null;
    readonly scoreExplanation?: unknown;
  }[];
  readonly aiOpinion: {
    readonly score: number | null;
    readonly summary: string;
    readonly strengths: readonly string[];
    readonly risks: readonly string[];
    readonly recommendedAngle: string | null;
  } | null;
  readonly meeting: {
    readonly status: "requested" | "booked" | "cancelled" | "no_show" | "completed";
    readonly startAt: string;
    readonly endAt: string | null;
    readonly meetingUrl: string | null;
    readonly updatedAt: string;
  } | null;
  readonly opportunity: {
    readonly stage: string;
    readonly nextAction: string | null;
    readonly updatedAt: string;
  } | null;
  readonly latestActivity: ProspectActivity | null;
  readonly conversation: {
    readonly id: string;
    readonly campaignId: string | null;
    readonly channel: "linkedin" | "email" | "whatsapp";
    readonly status: string;
    readonly unreadCount: number;
    readonly lastMessageAt: string;
    readonly lastMessage: {
      readonly direction: string;
      readonly senderType: string;
      readonly body: string;
      readonly occurredAt: string;
    } | null;
    readonly decision: {
      readonly intent: string;
      readonly confidence: number;
      readonly action: string;
      readonly rationale: string;
      readonly provider: string | null;
      readonly model: string | null;
      readonly createdAt: string;
    } | null;
    readonly latestCommand: {
      readonly mode: string;
      readonly status: string;
      readonly errorCode: string | null;
      readonly createdAt: string;
    } | null;
  } | null;
}

export interface ProspectViewDetail extends ProspectViewSummary {
  readonly identities: ContactDetail["identities"];
  readonly employments: ContactDetail["employments"];
  readonly activity: readonly ProspectActivity[];
  readonly conversation: (NonNullable<ProspectViewSummary["conversation"]> & {
    readonly messages: readonly {
      readonly id?: string;
      readonly direction: string;
      readonly senderType: string;
      readonly body: string;
      readonly occurredAt: string;
      readonly decision: ProspectViewSummary["conversation"] extends infer _T ? unknown : never;
    }[];
    readonly commands: readonly {
      readonly id: string;
      readonly mode: string;
      readonly status: string;
      readonly requestedBody: string | null;
      readonly generatedBody: string | null;
      readonly errorCode: string | null;
      readonly errorMessage: string | null;
      readonly createdAt: string;
    }[];
  }) | null;
}

export async function listProspectViews(
  workspaceSlug: string,
  filters: { search?: string; icpVersionId?: string; channel?: string } = {},
): Promise<{ data: ProspectViewSummary[]; filters: { icps: { id: string; name: string }[] } }> {
  const query = new URLSearchParams({ limit: "100" });
  if (filters.search) query.set("search", filters.search);
  if (filters.icpVersionId) query.set("icpVersionId", filters.icpVersionId);
  if (filters.channel) query.set("channel", filters.channel);
  return crmFetch(workspaceSlug, `/api/v1/prospects?${query.toString()}`);
}

export async function getProspectView(
  workspaceSlug: string,
  contactId: string,
): Promise<ProspectViewDetail> {
  return crmFetch(workspaceSlug, `/api/v1/prospects/${contactId}`);
}

export async function sendConversationCommand(
  workspaceSlug: string,
  conversationId: string,
  input: { mode: "manual" | "setter"; body?: string },
): Promise<{ id: string; status: string }> {
  return crmFetch(workspaceSlug, `/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { ...input, idempotencyKey: crypto.randomUUID() },
  });
}

export async function improveConversationDraft(
  workspaceSlug: string,
  conversationId: string,
  draft: string,
): Promise<{ body: string; metadata: { provider: string; model: string; promptVersion: string } }> {
  return crmFetch(workspaceSlug, `/api/v1/conversations/${conversationId}/draft-improvements`, {
    method: "POST",
    body: { draft },
  });
}

async function crmFetch<T>(
  workspaceSlug: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await apiFetch(pathname, {
    method: options.method ?? "GET",
    workspaceSlug,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) await throwApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function listCompanies(
  workspaceSlug: string,
  options: {
    search?: string | undefined;
    sector?: string | undefined;
    location?: string | undefined;
    employeeCountMin?: number | undefined;
    employeeCountMax?: number | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  } | string = {},
): Promise<{ data: Company[]; nextCursor: string | null }> {
  const normalized = typeof options === "string" ? { search: options } : options;
  const params = new URLSearchParams({ limit: String(normalized.limit ?? 50) });
  if (normalized.search) params.set("search", normalized.search);
  if (normalized.sector) params.set("sector", normalized.sector);
  if (normalized.location) params.set("location", normalized.location);
  if (normalized.employeeCountMin !== undefined) params.set("employeeCountMin", String(normalized.employeeCountMin));
  if (normalized.employeeCountMax !== undefined) params.set("employeeCountMax", String(normalized.employeeCountMax));
  if (normalized.cursor) params.set("cursor", normalized.cursor);
  return crmFetch(
    workspaceSlug,
    `/api/v1/companies?${params.toString()}`,
  );
}

export async function createCompany(
  workspaceSlug: string,
  input: {
    name: string;
    domain?: string;
    sector?: string;
    location?: string;
    employeeCountMin?: number;
    employeeCountMax?: number;
  },
): Promise<Company> {
  return crmFetch(workspaceSlug, "/api/v1/companies", { method: "POST", body: input });
}

export async function updateCompany(
  workspaceSlug: string,
  companyId: string,
  input: {
    name?: string;
    domain?: string | null;
    sector?: string | null;
    employeeCountMin?: number | null;
    employeeCountMax?: number | null;
    location?: string | null;
    linkedinUrl?: string | null;
  },
): Promise<Company> {
  return crmFetch(workspaceSlug, `/api/v1/companies/${companyId}`, {
    method: "PATCH",
    body: input,
  });
}

export async function getCompany(
  workspaceSlug: string,
  companyId: string,
): Promise<Company & { contacts: { id: string; firstName: string; lastName: string; title: string | null; isCurrent: boolean; status: string }[] }> {
  return crmFetch(workspaceSlug, `/api/v1/companies/${companyId}`);
}

export async function listContacts(
  workspaceSlug: string,
  options: { search?: string | undefined; companyId?: string | undefined; cursor?: string | undefined; limit?: number | undefined } | string = {},
): Promise<{ data: ContactSummary[]; nextCursor: string | null }> {
  const normalized = typeof options === "string" ? { search: options } : options;
  const params = new URLSearchParams({ limit: String(normalized.limit ?? 50) });
  if (normalized.search) params.set("search", normalized.search);
  if (normalized.companyId) params.set("companyId", normalized.companyId);
  if (normalized.cursor) params.set("cursor", normalized.cursor);
  return crmFetch(
    workspaceSlug,
    `/api/v1/contacts?${params.toString()}`,
  );
}

export async function createContact(
  workspaceSlug: string,
  input: {
    firstName: string;
    lastName: string;
    identities?: { type: string; value: string }[];
    employment?: { companyId: string; title: string };
  },
): Promise<{ id: string }> {
  return crmFetch(workspaceSlug, "/api/v1/contacts", { method: "POST", body: input });
}

export async function getContact(
  workspaceSlug: string,
  contactId: string,
): Promise<ContactDetail> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}`);
}

export async function listSignals(
  workspaceSlug: string,
  options: { signalType?: SignalType; entityType?: SignalEntityType; entityId?: string; includeExpired?: boolean } = {},
): Promise<{ data: IntentSignal[] }> {
  const params = new URLSearchParams();
  if (options.signalType) params.set("signalType", options.signalType);
  if (options.entityType) params.set("entityType", options.entityType);
  if (options.entityId) params.set("entityId", options.entityId);
  if (options.includeExpired) params.set("includeExpired", "true");
  const query = params.toString();
  return crmFetch(workspaceSlug, `/api/v1/signals${query ? `?${query}` : ""}`);
}

export async function listCompanySignals(workspaceSlug: string, companyId: string, includeExpired = true): Promise<{ data: IntentSignal[] }> {
  return crmFetch(workspaceSlug, `/api/v1/companies/${companyId}/signals${includeExpired ? "?includeExpired=true" : ""}`);
}

export async function listContactSignals(workspaceSlug: string, contactId: string, includeExpired = true): Promise<{ data: IntentSignal[] }> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/signals${includeExpired ? "?includeExpired=true" : ""}`);
}

export async function collectSignals(
  workspaceSlug: string,
  input: { companyId?: string; contactId?: string; requestKey: string; signalTypes?: readonly SignalType[] },
): Promise<SignalCollectionRun> {
  return crmFetch(workspaceSlug, "/api/v1/signals/actions/collect", { method: "POST", body: input });
}

export async function getSignalCollectionRun(workspaceSlug: string, runId: string): Promise<SignalCollectionRun> {
  return crmFetch(workspaceSlug, `/api/v1/signal-collection-runs/${runId}`);
}

export async function getContactEnrichment(workspaceSlug: string, contactId: string): Promise<{ data: EnrichmentObservation[] }> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/enrichment`);
}

export async function enrichContact(workspaceSlug: string, contactId: string, requestKey: string): Promise<EnrichmentJob> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/actions/enrich`, { method: "POST", body: { requestKey } });
}

export async function getEnrichmentJob(workspaceSlug: string, jobId: string): Promise<EnrichmentJobDetail> {
  return crmFetch(workspaceSlug, `/api/v1/enrichment-jobs/${jobId}`);
}

export async function retryEnrichmentJob(workspaceSlug: string, jobId: string): Promise<EnrichmentJob> {
  return crmFetch(workspaceSlug, `/api/v1/enrichment-jobs/${jobId}/actions/retry`, { method: "POST", body: {} });
}

export async function updateContact(
  workspaceSlug: string,
  contactId: string,
  input: {
    firstName?: string;
    lastName?: string;
    photoUrl?: string | null;
    preferredChannel?: string | null;
  },
): Promise<ContactDetail> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}`, {
    method: "PATCH",
    body: input,
  });
}

export async function addContactIdentity(
  workspaceSlug: string,
  contactId: string,
  input: { type: string; value: string },
): Promise<void> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/identities`, {
    method: "POST",
    body: input,
  });
}

export async function addContactEmployment(
  workspaceSlug: string,
  contactId: string,
  input: { companyId: string; title: string },
): Promise<void> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/employments`, {
    method: "POST",
    body: input,
  });
}

export async function suppressContact(
  workspaceSlug: string,
  contactId: string,
  reason: string,
): Promise<void> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/actions/suppress`, {
    method: "POST",
    body: { channel: "global", reason },
  });
}

export async function listSuppressions(
  workspaceSlug: string,
  options: { channel?: SuppressionChannel; cursor?: string; limit?: number } = {},
): Promise<{ data: Suppression[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.channel) params.set("channel", options.channel);
  if (options.cursor) params.set("cursor", options.cursor);
  return crmFetch(workspaceSlug, `/api/v1/suppressions?${params.toString()}`);
}

export async function createSuppression(
  workspaceSlug: string,
  input: {
    identityType: SuppressionIdentityType;
    value: string;
    channel: SuppressionChannel;
    reason?: string | null;
  },
): Promise<Suppression> {
  return crmFetch(workspaceSlug, "/api/v1/suppressions", { method: "POST", body: input });
}

export async function checkSuppression(
  workspaceSlug: string,
  input: {
    identityType: SuppressionIdentityType;
    value: string;
    channel: SuppressionChannel;
  },
): Promise<{ eligible: boolean; suppressionId: string | null; channel: string | null; reason: string | null }> {
  return crmFetch(workspaceSlug, "/api/v1/suppressions/check", { method: "POST", body: input });
}

export async function liftSuppression(
  workspaceSlug: string,
  suppressionId: string,
  justification: string,
): Promise<Suppression> {
  return crmFetch(workspaceSlug, `/api/v1/suppressions/${suppressionId}/actions/lift`, {
    method: "POST",
    body: { justification },
  });
}

export type ImportRowStatus = "valid" | "invalid" | "duplicate" | "suppressed" | "created" | "failed";

export interface ImportRow {
  readonly id: string;
  readonly lineNumber: number;
  readonly rawData: unknown;
  readonly normalizedData: unknown;
  readonly status: ImportRowStatus;
  readonly reason: string | null;
  readonly companyId: string | null;
  readonly contactId: string | null;
}

export interface ImportBatch {
  readonly id: string;
  readonly filename: string;
  readonly status: string;
  readonly previewedAt: string | null;
  readonly appliedAt: string | null;
  readonly completedAt: string | null;
  readonly totals: Readonly<Record<string, number>>;
  readonly createdAt: string;
  readonly rows: readonly ImportRow[];
}

export async function createImport(
  workspaceSlug: string,
  input: { filename: string; content: string; mapping?: Readonly<Record<string, string>> },
): Promise<ImportBatch> {
  return crmFetch(workspaceSlug, "/api/v1/imports", { method: "POST", body: input });
}

export async function getImportPreview(workspaceSlug: string, importId: string): Promise<ImportBatch> {
  return crmFetch(workspaceSlug, `/api/v1/imports/${importId}/preview`);
}

export async function getImport(workspaceSlug: string, importId: string): Promise<ImportBatch> {
  return crmFetch(workspaceSlug, `/api/v1/imports/${importId}`);
}

export async function applyImport(workspaceSlug: string, importId: string): Promise<ImportBatch> {
  return crmFetch(workspaceSlug, `/api/v1/imports/${importId}/actions/apply`, {
    method: "POST",
    body: {},
  });
}

export type MergeMatchType = "certain" | "probable";
export type MergeCandidateStatus = "pending" | "approved" | "rejected";

export interface MergeCandidate {
  readonly id: string;
  readonly workspaceId: string;
  readonly primaryContactId: string;
  readonly secondaryContactId: string;
  readonly pairKey: string;
  readonly matchType: MergeMatchType;
  readonly status: MergeCandidateStatus;
  readonly signals: Readonly<Record<string, unknown>>;
  readonly decisionReason: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
  readonly contacts: readonly ContactSummary[];
}

export interface ContactMerge {
  readonly id: string;
  readonly workspaceId: string;
  readonly survivorContactId: string;
  readonly mergedContactId: string;
  readonly candidateId: string | null;
  readonly status: "active" | "undone";
  readonly mergedAt: string;
  readonly mergedBy: string | null;
  readonly undoneAt: string | null;
  readonly undoneBy: string | null;
}

export async function listMergeCandidates(workspaceSlug: string): Promise<MergeCandidate[]> {
  return crmFetch(workspaceSlug, "/api/v1/merge-candidates");
}

export async function getMergeCandidate(workspaceSlug: string, candidateId: string): Promise<MergeCandidate> {
  return crmFetch(workspaceSlug, `/api/v1/merge-candidates/${candidateId}`);
}

export async function approveMergeCandidate(workspaceSlug: string, candidateId: string): Promise<ContactMerge> {
  return crmFetch(workspaceSlug, `/api/v1/merge-candidates/${candidateId}/actions/approve`, {
    method: "POST",
    body: {},
  });
}

export async function rejectMergeCandidate(
  workspaceSlug: string,
  candidateId: string,
  reason?: string | null,
): Promise<MergeCandidate> {
  return crmFetch(workspaceSlug, `/api/v1/merge-candidates/${candidateId}/actions/reject`, {
    method: "POST",
    body: { reason: reason || null },
  });
}

export async function listContactMerges(workspaceSlug: string, contactId: string): Promise<ContactMerge[]> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/merges`);
}

export async function undoContactMerge(workspaceSlug: string, contactId: string): Promise<ContactMerge> {
  return crmFetch(workspaceSlug, `/api/v1/contacts/${contactId}/actions/undo-merge`, {
    method: "POST",
    body: {},
  });
}

export type MessagingChannel = "linkedin" | "email" | "whatsapp";
export interface MessagingTemplate {
  readonly channel: MessagingChannel;
  readonly body: string;
  readonly subject?: string;
  readonly maxLength?: number;
  readonly cta?: string;
  readonly constraints?: Readonly<Record<string, unknown>>;
}
export interface MessagingStrategyRules {
  readonly tone: string;
  readonly angle: string;
  readonly templates: readonly MessagingTemplate[];
  readonly allowedClaimIds: readonly string[];
  readonly offerVersionId?: string;
  readonly constraints?: Readonly<Record<string, unknown>>;
}
export interface MessagingStrategyVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyId: string;
  readonly version: number;
  readonly rules: MessagingStrategyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: string;
  readonly createdAt?: string;
}
export interface MessagingStrategy {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly draftRules: MessagingStrategyRules;
  readonly deletedAt: string | null;
  readonly versions?: readonly MessagingStrategyVersion[];
}
export interface AIPolicyRules {
  readonly firstContactRequiresHumanApproval?: boolean;
  readonly responsesRequireHumanApproval?: boolean;
  readonly followUpsMayBeAutomated: boolean;
  readonly escalationRules?: Readonly<Record<string, unknown>>;
}
export interface AIPolicyVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyId: string;
  readonly version: number;
  readonly rules: AIPolicyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: string;
  readonly createdAt?: string;
}
export interface AIPolicy {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly draftRules: AIPolicyRules;
  readonly deletedAt: string | null;
  readonly versions?: readonly AIPolicyVersion[];
}

export async function listMessagingStrategies(workspaceSlug: string): Promise<{ data: MessagingStrategy[] }> {
  return crmFetch(workspaceSlug, "/api/v1/messaging-strategies");
}
export async function createMessagingStrategy(workspaceSlug: string, input: { name: string; rules: MessagingStrategyRules }): Promise<MessagingStrategy> {
  return crmFetch(workspaceSlug, "/api/v1/messaging-strategies", { method: "POST", body: input });
}
export async function getMessagingStrategy(workspaceSlug: string, strategyId: string): Promise<MessagingStrategy> {
  return crmFetch(workspaceSlug, `/api/v1/messaging-strategies/${strategyId}`);
}
export async function updateMessagingStrategy(workspaceSlug: string, strategyId: string, input: { name?: string; rules?: MessagingStrategyRules }): Promise<MessagingStrategy> {
  return crmFetch(workspaceSlug, `/api/v1/messaging-strategies/${strategyId}`, { method: "PATCH", body: input });
}
export async function publishMessagingStrategy(workspaceSlug: string, strategyId: string): Promise<MessagingStrategyVersion> {
  return crmFetch(workspaceSlug, `/api/v1/messaging-strategies/${strategyId}/actions/publish`, { method: "POST", body: {} });
}
export async function listAIPolicies(workspaceSlug: string): Promise<{ data: AIPolicy[] }> {
  return crmFetch(workspaceSlug, "/api/v1/ai-policies");
}
export async function createAIPolicy(workspaceSlug: string, input: { name: string; rules: AIPolicyRules }): Promise<AIPolicy> {
  return crmFetch(workspaceSlug, "/api/v1/ai-policies", { method: "POST", body: input });
}
export async function updateAIPolicy(workspaceSlug: string, policyId: string, input: { name?: string; rules?: AIPolicyRules }): Promise<AIPolicy> {
  return crmFetch(workspaceSlug, `/api/v1/ai-policies/${policyId}`, { method: "PATCH", body: input });
}
export async function publishAIPolicy(workspaceSlug: string, policyId: string): Promise<AIPolicyVersion> {
  return crmFetch(workspaceSlug, `/api/v1/ai-policies/${policyId}/actions/publish`, { method: "POST", body: {} });
}

export async function getAIPolicy(workspaceSlug: string, policyId: string): Promise<AIPolicy> {
  return crmFetch(workspaceSlug, `/api/v1/ai-policies/${policyId}`);
}

export type ApprovalItemStatus = "pending" | "approved" | "rejected" | "invalidated";
export type ApprovalDecision = "approve" | "reject";

export interface ApprovalItem {
  readonly id: string;
  readonly campaignId: string | null;
  readonly contactId: string | null;
  readonly enrollmentId: string | null;
  readonly itemType: string;
  readonly channel: string;
  readonly stepPosition: number | null;
  readonly contentOriginal: unknown;
  readonly contentEdited: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly sourceUpdatedAt: string | null;
  readonly status: ApprovalItemStatus;
  readonly decisionBy: string | null;
  readonly decidedAt: string | null;
  readonly rejectionJustification: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApprovalBulkDecisionResult {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
  readonly invalidated: readonly string[];
  readonly conflicts: readonly { itemId: string; code: string }[];
}

export async function listApprovalItems(
  workspaceSlug: string,
  options: { campaignId?: string; status?: ApprovalItemStatus; limit?: number } = {},
): Promise<{ data: ApprovalItem[] }> {
  const params = new URLSearchParams();
  if (options.campaignId) params.set("campaignId", options.campaignId);
  if (options.status) params.set("status", options.status);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return crmFetch(workspaceSlug, `/api/v1/approval-items${query ? `?${query}` : ""}`);
}

export async function getApprovalItem(workspaceSlug: string, itemId: string): Promise<ApprovalItem> {
  return crmFetch(workspaceSlug, `/api/v1/approval-items/${itemId}`);
}

export async function editApprovalItem(workspaceSlug: string, itemId: string, contentEdited: unknown): Promise<ApprovalItem> {
  return crmFetch(workspaceSlug, `/api/v1/approval-items/${itemId}`, {
    method: "PATCH",
    body: { contentEdited },
  });
}

export async function approveApprovalItem(workspaceSlug: string, itemId: string): Promise<ApprovalItem> {
  return crmFetch(workspaceSlug, `/api/v1/approval-items/${itemId}/actions/approve`, { method: "POST", body: {} });
}

export async function rejectApprovalItem(workspaceSlug: string, itemId: string, justification: string): Promise<ApprovalItem> {
  return crmFetch(workspaceSlug, `/api/v1/approval-items/${itemId}/actions/reject`, {
    method: "POST",
    body: { justification },
  });
}

export async function bulkDecideApprovalItems(
  workspaceSlug: string,
  input: { itemIds: readonly string[]; decision: ApprovalDecision; justification?: string },
): Promise<ApprovalBulkDecisionResult> {
  return crmFetch(workspaceSlug, "/api/v1/approval-items/actions/bulk-decide", {
    method: "POST",
    body: input,
  });
}

export type OfferClaimValidationStatus = "hypothesis" | "sourced" | "validated" | "invalidated";

export interface OfferClaim {
  readonly id?: string;
  readonly claim: string;
  readonly validationStatus: OfferClaimValidationStatus;
  readonly evidenceUri: string | null;
}

export interface Offer {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly status: "draft" | "archived";
  readonly currentVersion: number;
  readonly category: string;
  readonly valueProposition: string;
  readonly targetAudience: string;
  readonly pricing: unknown;
  readonly commercialRules: unknown;
  readonly constraints: unknown;
  readonly claims: readonly OfferClaim[];
  readonly objections: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string | null;
}

export interface OfferVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly offerId: string;
  readonly version: number;
  readonly name: string;
  readonly category: string;
  readonly valueProposition: string;
  readonly targetAudience: string;
  readonly pricing: unknown;
  readonly commercialRules: unknown;
  readonly constraints: unknown;
  readonly objections: unknown;
  readonly claims: readonly OfferClaim[];
  readonly publishedBy: string | null;
  readonly publishedAt: string;
  readonly createdAt: string;
}

export interface OfferDetail extends Offer {
  readonly versions: readonly OfferVersion[];
}

export interface Campaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly objective: string;
  readonly status: "draft" | "active" | "paused" | "archived";
  readonly offerVersionId: string;
  readonly icpVersionId: string;
  readonly messagingStrategyVersionId: string;
  readonly aiPolicyVersionId: string;
  readonly sequenceVersionId: string;
  readonly createdBy: string | null;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
  readonly pausedAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CampaignPreflight {
  readonly ok: boolean;
  readonly blockers: readonly { code: string; reference: string; versionId: string; message: string }[];
  readonly warnings: readonly { code: string; message: string }[];
}

export type OutreachActionStatus = "planned" | "awaiting_approval" | "due" | "sending" | "sent" | "failed" | "cancelled" | "suspended";
export interface OutreachAction {
  readonly id: string;
  readonly campaignId: string;
  readonly enrollmentId: string;
  readonly contactId: string;
  readonly sequenceVersionId: string;
  readonly approvalItemId: string | null;
  readonly connectedAccountId: string | null;
  readonly stepPosition: number;
  readonly channel: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly status: OutreachActionStatus;
  readonly idempotencyKey: string;
  readonly scheduledAt: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly providerMessageId: string | null;
  readonly sentAt: string | null;
  readonly responseReceivedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AnalyticsDimension = "campaign" | "icp" | "channel" | "role" | "signal";
export interface AnalyticsQuery {
  readonly from?: string;
  readonly to?: string;
  readonly campaignId?: string;
  readonly icpVersionId?: string;
  readonly channel?: string;
  readonly role?: string;
  readonly signalType?: string;
}
export interface AnalyticsFunnel {
  readonly period: { readonly from: string; readonly to: string };
  readonly metrics: {
    readonly prospectsFound: number;
    readonly profilesEnriched: number;
    readonly actionsPlanned: number;
    readonly attempts: number;
    readonly actionsSent: number;
    readonly actionsAccepted: number;
    readonly responded: number;
    readonly positiveReplies: number;
    readonly meetingsBooked: number;
    readonly opportunities: number;
    readonly revenue: number;
  };
}
export interface AnalyticsBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly prospectsFound: number | null;
  readonly profilesEnriched: number | null;
  readonly actionsPlanned: number | null;
  readonly attempts: number | null;
  readonly actionsSent: number | null;
  readonly actionsAccepted: number | null;
  readonly responded: number | null;
  readonly positiveReplies: number | null;
  readonly meetingsBooked: number | null;
  readonly opportunities: number | null;
  readonly revenue: number | null;
}
export interface AnalyticsBreakdown {
  readonly period: { readonly from: string; readonly to: string };
  readonly dimension: AnalyticsDimension;
  readonly data: readonly AnalyticsBreakdownRow[];
}
export interface AnalyticsCosts {
  readonly period?: { readonly from: string; readonly to: string };
  readonly totalAiCost: number;
  readonly costPerProspect: number;
  readonly costPerMeeting: number;
}
function analyticsParams(options: AnalyticsQuery = {}): string {
  const params = new URLSearchParams();
  if (options.from) params.set("from", normalizeAnalyticsDate(options.from, false));
  if (options.to) params.set("to", normalizeAnalyticsDate(options.to, true));
  for (const key of ["campaignId", "icpVersionId", "channel", "role", "signalType"] as const) if (options[key]) params.set(key, options[key]!);
  return params.toString();
}
function normalizeAnalyticsDate(value: string, _end: boolean): string {
  const date = value.length === 10
    // Keep the API's [from,to) semantics: a date-only `to` is midnight at
    // the start of that date, so the selected end date remains exclusive.
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
export async function getAnalyticsFunnel(workspaceSlug: string, options: AnalyticsQuery = {}): Promise<AnalyticsFunnel> {
  const query = analyticsParams(options);
  return crmFetch(workspaceSlug, `/api/v1/analytics/funnel${query ? `?${query}` : ""}`);
}
export async function getAnalyticsBreakdown(workspaceSlug: string, dimension: AnalyticsDimension, options: AnalyticsQuery = {}): Promise<AnalyticsBreakdown> {
  const query = analyticsParams({ ...options });
  return crmFetch(workspaceSlug, `/api/v1/analytics/breakdown?dimension=${dimension}${query ? `&${query}` : ""}`);
}
export async function getAnalyticsCosts(workspaceSlug: string, options: AnalyticsQuery = {}): Promise<AnalyticsCosts> {
  const query = analyticsParams(options);
  return crmFetch(workspaceSlug, `/api/v1/analytics/costs${query ? `?${query}` : ""}`);
}
export async function exportAnalyticsCsv(workspaceSlug: string, options: AnalyticsQuery = {}, dimension?: AnalyticsDimension): Promise<string> {
  const query = analyticsParams(options);
  const full = `${query}${dimension ? `${query ? "&" : ""}dimension=${dimension}` : ""}`;
  const response = await apiFetch(`/api/v1/analytics/export${full ? `?${full}` : ""}`, { workspaceSlug });
  if (!response.ok) await throwApiError(response);
  return response.text();
}

export type ConnectedAccountStatus = "pending" | "connected" | "degraded" | "disconnected" | "unknown";
export interface ConnectedAccount {
  readonly id: string;
  readonly provider: "unipile";
  readonly providerAccountId: string;
  readonly displayName: string | null;
  readonly status: ConnectedAccountStatus;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly quotas: Readonly<Record<string, unknown>>;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly lastCheckedAt: string | null;
  readonly disconnectedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export async function listConnectedAccounts(workspaceSlug: string): Promise<{ data: ConnectedAccount[] }> { return crmFetch(workspaceSlug, "/api/v1/connected-accounts"); }
export async function connectConnectedAccount(workspaceSlug: string, input: { providerAccountId: string; displayName?: string; accessToken: string }): Promise<ConnectedAccount> { return crmFetch(workspaceSlug, "/api/v1/connected-accounts", { method: "POST", body: { provider: "unipile", ...input } }); }
export async function checkConnectedAccount(workspaceSlug: string, accountId: string): Promise<ConnectedAccount> { return crmFetch(workspaceSlug, `/api/v1/connected-accounts/${accountId}/actions/check`, { method: "POST", body: {} }); }
export async function reconnectConnectedAccount(workspaceSlug: string, accountId: string): Promise<ConnectedAccount> { return crmFetch(workspaceSlug, `/api/v1/connected-accounts/${accountId}/actions/reconnect`, { method: "POST", body: {} }); }
export async function disconnectConnectedAccount(workspaceSlug: string, accountId: string): Promise<ConnectedAccount> {
  return crmFetch(workspaceSlug, `/api/v1/connected-accounts/${accountId}`, { method: "DELETE" });
}

export type OnboardingChannel = "email" | "linkedin" | "whatsapp";
export type OnboardingStep = "initiation" | "callback" | "verification";
export type OnboardingStatus = "initiated" | "awaiting_callback" | "verifying" | "completed" | "failed" | "expired";
export interface ConnectionOnboarding {
  readonly id: string;
  readonly provider?: "unipile";
  readonly channel: OnboardingChannel;
  readonly step: OnboardingStep;
  readonly status: OnboardingStatus;
  readonly hostedUrl?: string | null;
  readonly providerAccountId?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AccountQuotaChannel {
  readonly channel: OnboardingChannel;
  readonly sentToday: number;
  readonly limit: number | null;
  readonly percentage: number | null;
  readonly state: "ok" | "near_limit" | "reached" | "unlimited";
}
export interface AccountQuota {
  readonly accountId: string;
  readonly referenceDate: string;
  readonly timezone: "UTC";
  readonly channels: readonly AccountQuotaChannel[];
}
export interface AccountHealthAlert {
  readonly id: string;
  readonly connectedAccountId: string;
  readonly status: "active" | "acknowledged" | "resolved";
  readonly reasonCode?: string | null;
  readonly reasonMessage?: string | null;
  readonly acknowledgedBy?: string | null;
  readonly acknowledgedAt?: string | null;
  readonly resolvedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AccountSuspensionImpact {
  readonly accountId: string;
  readonly campaigns: readonly { readonly campaignId: string; readonly campaignName: string; readonly suspendedActions: number }[];
}
export async function startConnectedAccountOnboarding(workspaceSlug: string, channel: OnboardingChannel): Promise<ConnectionOnboarding> {
  return crmFetch(workspaceSlug, "/api/v1/connected-accounts/onboarding", { method: "POST", body: { channel } });
}
export async function getConnectedAccountOnboarding(workspaceSlug: string, onboardingId: string): Promise<ConnectionOnboarding> {
  return crmFetch(workspaceSlug, `/api/v1/connected-accounts/onboarding/${onboardingId}`);
}
export async function getConnectedAccountQuotas(workspaceSlug: string, accountId: string): Promise<AccountQuota> {
  return crmFetch(workspaceSlug, `/api/v1/connected-accounts/${accountId}/quotas`);
}
export async function getConnectedAccountImpact(workspaceSlug: string, accountId: string): Promise<AccountSuspensionImpact> {
  return crmFetch(workspaceSlug, `/api/v1/connected-accounts/${accountId}/impact`);
}
export async function listAccountHealthAlerts(workspaceSlug: string): Promise<{ data: AccountHealthAlert[] }> {
  return crmFetch(workspaceSlug, "/api/v1/account-health-alerts");
}
export async function acknowledgeAccountHealthAlert(workspaceSlug: string, alertId: string): Promise<AccountHealthAlert> {
  return crmFetch(workspaceSlug, `/api/v1/account-health-alerts/${alertId}/actions/acknowledge`, { method: "POST", body: {} });
}

export type CampaignProspectStatus = "candidate" | "selected" | "excluded" | "enrolled";
export interface CampaignProspectExplanation {
  readonly facts: readonly Record<string, unknown>[];
  readonly missing: readonly Record<string, unknown>[];
  readonly exclusions: readonly Record<string, unknown>[];
}
export interface ManagedCampaignProspect {
  readonly id: string;
  readonly campaignId: string;
  readonly contactId: string;
  readonly status: CampaignProspectStatus;
  readonly score: number;
  readonly explanation: CampaignProspectExplanation;
  readonly exclusionReason: string | null;
  readonly selectedAt: string | null;
  readonly excludedAt: string | null;
  readonly enrolledAt: string | null;
  readonly contact?: {
    readonly firstName: string;
    readonly lastName: string;
    readonly status: string;
    readonly preferredChannel: string | null;
    readonly employment: { readonly title?: string | null; readonly company?: { readonly name?: string | null } | null } | null;
    readonly company?: { readonly name?: string | null } | null;
  };
}
export interface CampaignEnrollment { readonly id: string; readonly campaignId: string; readonly contactId: string; readonly sequenceVersionId: string; readonly status: string; readonly enrolledAt: string; }
export async function listCampaignProspects(workspaceSlug: string, campaignId: string): Promise<{ data: ManagedCampaignProspect[] }> { return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/prospects`); }
export async function selectCampaignProspects(workspaceSlug: string, campaignId: string, contactIds: readonly string[]): Promise<{ data: ManagedCampaignProspect[] }> { return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/prospects/select`, { method: "POST", body: { contactIds } }); }
export async function getCampaignProspectExplanation(workspaceSlug: string, campaignId: string, contactId: string): Promise<ManagedCampaignProspect> { return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/prospects/${contactId}/explanation`); }
export async function enrollCampaignProspect(workspaceSlug: string, campaignId: string, contactId: string): Promise<CampaignEnrollment> { return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/prospects/${contactId}/actions/enroll`, { method: "POST", body: {} }); }
export async function excludeCampaignProspect(workspaceSlug: string, campaignId: string, contactId: string, reason: string): Promise<ManagedCampaignProspect> { return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/prospects/${contactId}/actions/exclude`, { method: "POST", body: { reason } }); }

export async function listManagedCampaigns(workspaceSlug: string): Promise<{ data: Campaign[] }> {
  return crmFetch(workspaceSlug, "/api/v1/campaigns");
}
export async function createCampaign(workspaceSlug: string, input: Omit<Campaign, "id" | "workspaceId" | "status" | "createdBy" | "activatedBy" | "activatedAt" | "pausedAt" | "archivedAt" | "createdAt" | "updatedAt">): Promise<Campaign> {
  return crmFetch(workspaceSlug, "/api/v1/campaigns", { method: "POST", body: input });
}
export async function getManagedCampaign(workspaceSlug: string, campaignId: string): Promise<Campaign> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}`);
}
export async function updateCampaign(workspaceSlug: string, campaignId: string, input: Partial<Pick<Campaign, "name" | "objective" | "offerVersionId" | "icpVersionId" | "messagingStrategyVersionId" | "aiPolicyVersionId" | "sequenceVersionId">>): Promise<Campaign> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}`, { method: "PATCH", body: input });
}
export async function preflightCampaign(workspaceSlug: string, campaignId: string): Promise<CampaignPreflight> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/actions/preflight`, { method: "POST", body: {} });
}
export async function campaignTransition(workspaceSlug: string, campaignId: string, transition: "activate" | "pause" | "resume" | "archive"): Promise<Campaign> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/actions/${transition}`, { method: "POST", body: {} });
}

export async function listCampaignActions(workspaceSlug: string, campaignId: string, status?: OutreachActionStatus): Promise<{ data: OutreachAction[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/actions${query}`);
}

export async function getOutreachAction(workspaceSlug: string, actionId: string): Promise<OutreachAction> {
  return crmFetch(workspaceSlug, `/api/v1/actions/${actionId}`);
}

export async function cancelOutreachAction(workspaceSlug: string, actionId: string): Promise<OutreachAction> {
  return crmFetch(workspaceSlug, `/api/v1/actions/${actionId}/actions/cancel`, { method: "POST", body: {} });
}

export async function retryOutreachAction(workspaceSlug: string, actionId: string): Promise<OutreachAction> {
  return crmFetch(workspaceSlug, `/api/v1/actions/${actionId}/actions/retry`, { method: "POST", body: {} });
}

export async function listOffers(workspaceSlug: string): Promise<{ data: Offer[] }> {
  return crmFetch(workspaceSlug, "/api/v1/offers");
}

export async function createOffer(
  workspaceSlug: string,
  input: { name: string; category?: string; targetAudience?: string },
): Promise<Offer> {
  return crmFetch(workspaceSlug, "/api/v1/offers", { method: "POST", body: input });
}

export async function getOffer(workspaceSlug: string, offerId: string): Promise<OfferDetail> {
  return crmFetch(workspaceSlug, `/api/v1/offers/${offerId}`);
}

export async function updateOfferDraft(
  workspaceSlug: string,
  offerId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<Offer> {
  return crmFetch(workspaceSlug, `/api/v1/offers/${offerId}`, { method: "PATCH", body: fields });
}

export async function publishOfferVersion(
  workspaceSlug: string,
  offerId: string,
): Promise<OfferVersion> {
  return crmFetch(workspaceSlug, `/api/v1/offers/${offerId}/actions/publish`, { method: "POST" });
}

export async function listOfferVersions(
  workspaceSlug: string,
  offerId: string,
): Promise<{ data: OfferVersion[] }> {
  return crmFetch(workspaceSlug, `/api/v1/offers/${offerId}/versions`);
}

/** Legacy list retained for discovery; canonical pages use listIcps. */
export type PublishedIcpVersion = IcpVersion;

export interface DiscoveryRun {
  readonly id: string;
  readonly workspaceId?: string;
  readonly icpVersionId: string;
  readonly provider: string;
  readonly filters: Readonly<Record<string, unknown>> & {
    readonly keywords?: string;
    readonly category?: string;
    readonly limit?: number;
  };
  readonly status: "running" | "completed" | "failed";
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly candidateCount: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface DiscoveryCandidate {
  readonly id: string;
  readonly runId: string;
  /** Provenance discriminator returned by the discovery API. */
  readonly source: "discovery";
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
  readonly location: string | null;
  readonly companyName: string | null;
  readonly companyWebsite: string | null;
  readonly companyDomain: string | null;
  readonly channels: {
    readonly linkedin: DiscoveryChannel;
    readonly email: DiscoveryChannel;
    readonly whatsapp: DiscoveryChannel;
  };
  readonly icpFit: { matches: string[]; gaps: string[] };
  readonly importedContactId: string | null;
}

export interface DiscoveryChannel {
  readonly value: string | null;
  readonly normalizedValue: string | null;
  readonly status: "verified" | "found" | "unverified" | "unavailable";
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly source: string | null;
  readonly evidenceUrl?: string | null;
  readonly evidenceSnippet?: string | null;
  readonly observedAt?: string | null;
}

export async function listIcpVersions(
  workspaceSlug: string,
): Promise<{ data: IcpVersion[] }> {
  return crmFetch(workspaceSlug, "/api/v1/icp-versions");
}

export async function getIcpVersion(workspaceSlug: string, versionId: string): Promise<IcpVersion> {
  return crmFetch(workspaceSlug, `/api/v1/icp-versions/${versionId}`);
}

export async function listIcps(workspaceSlug: string): Promise<{ data: Icp[] }> {
  return crmFetch(workspaceSlug, "/api/v1/icps");
}

export async function getIcp(workspaceSlug: string, icpId: string): Promise<IcpDetail> {
  return crmFetch(workspaceSlug, `/api/v1/icps/${icpId}`);
}

export async function publishNextIcpVersion(
  workspaceSlug: string,
  icpId: string,
): Promise<IcpVersion> {
  return crmFetch(workspaceSlug, `/api/v1/icps/${icpId}/actions/publish`, { method: "POST" });
}

export async function launchDiscoveryRun(
  workspaceSlug: string,
  versionId: string,
  limit: number,
): Promise<DiscoveryRun> {
  return crmFetch(workspaceSlug, `/api/v1/icp-versions/${versionId}/discovery-runs`, {
    method: "POST",
    body: { limit },
  });
}

export async function listDiscoveryRuns(
  workspaceSlug: string,
  icpVersionId?: string,
): Promise<{ data: DiscoveryRun[] }> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/discovery-runs${icpVersionId ? `?icpVersionId=${icpVersionId}` : ""}`,
  );
}

export async function getDiscoveryRun(
  workspaceSlug: string,
  runId: string,
): Promise<DiscoveryRun & { candidates: DiscoveryCandidate[] }> {
  return crmFetch(workspaceSlug, `/api/v1/discovery-runs/${runId}`);
}

export async function retryDiscoveryRun(
  workspaceSlug: string,
  runId: string,
): Promise<DiscoveryRun> {
  return crmFetch(workspaceSlug, `/api/v1/discovery-runs/${runId}/actions/retry`, {
    method: "POST",
    body: {},
  });
}

export async function importDiscoveryCandidate(
  workspaceSlug: string,
  runId: string,
  candidateId: string,
): Promise<{ id: string }> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/discovery-runs/${runId}/candidates/${candidateId}/actions/import`,
    { method: "POST", body: {} },
  );
}

export interface SequenceSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: "draft" | "published" | "archived";
  readonly updatedAt: string;
}

export interface SequenceStep {
  readonly position: number;
  readonly kind: "linkedin_invite" | "linkedin_message" | "email" | "whatsapp" | "manual_task";
  readonly delayDays: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly subject: string | null;
  readonly body: string;
  readonly fallbackKind: string | null;
}

export interface SequenceVersion {
  readonly id: string;
  readonly sequenceId: string;
  readonly workspaceId?: string;
  readonly version: number;
  readonly steps: readonly SequenceStep[];
  readonly publishedAt: string;
}

export async function listSequences(
  workspaceSlug: string,
): Promise<{ data: SequenceSummary[] }> {
  return crmFetch(workspaceSlug, "/api/v1/sequences");
}

export async function createSequence(
  workspaceSlug: string,
  input: { name: string; description?: string },
): Promise<SequenceSummary> {
  return crmFetch(workspaceSlug, "/api/v1/sequences", { method: "POST", body: input });
}

export async function getSequence(
  workspaceSlug: string,
  sequenceId: string,
): Promise<SequenceSummary & { steps: SequenceStep[] }> {
  return crmFetch(workspaceSlug, `/api/v1/sequences/${sequenceId}`);
}

export async function replaceSequenceSteps(
  workspaceSlug: string,
  sequenceId: string,
  steps: readonly Omit<SequenceStep, "id">[],
): Promise<void> {
  return crmFetch(workspaceSlug, `/api/v1/sequences/${sequenceId}/steps`, {
    method: "PUT",
    body: { steps },
  });
}

export async function listSequenceVersions(
  workspaceSlug: string,
  sequenceId: string,
): Promise<{ data: SequenceVersion[] }> {
  return crmFetch(workspaceSlug, `/api/v1/sequences/${sequenceId}/versions`);
}

export async function publishSequenceVersion(
  workspaceSlug: string,
  sequenceId: string,
): Promise<SequenceVersion> {
  return crmFetch(workspaceSlug, `/api/v1/sequences/${sequenceId}/actions/publish`, {
    method: "POST",
    body: {},
  });
}

export interface CampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly status: "draft" | "active" | "paused" | "completed" | "archived";
  readonly prospectCount: number;
  readonly autopilotPolicy: CampaignAutopilotPolicy;
  readonly automationStage: "sourcing" | "enriching" | "composing" | "scheduled" | "running" | "completed" | "attention";
  readonly automationErrorCode: string | null;
  readonly automationErrorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly icpVersionId: string;
  readonly icpRunId: string;
  readonly icpName: string;
  readonly icpConfidence: string;
  readonly planId: string | null;
  readonly assessmentId: string | null;
  readonly channel: "linkedin" | "email" | "whatsapp" | null;
  readonly assessmentRecommendation: "recommended" | "optional" | "unsuitable" | null;
  readonly assessmentScore: number | null;
  readonly sequenceId: string;
  readonly sequenceVersionId: string | null;
  readonly sequenceName: string;
  readonly sequenceStatus: "draft" | "published" | "archived";
  readonly discoveryRunId: string;
  readonly discoveryStatus: "running" | "completed" | "failed" | null;
  readonly discoveryErrorCode: string | null;
  readonly discoveryErrorMessage: string | null;
}

export interface CampaignAutopilotPolicy {
  readonly version: 1;
  readonly enabled: boolean;
  readonly schedule: {
    readonly activeDays: readonly number[];
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly timezoneMode: "recipient" | "workspace";
    readonly fallbackTimezone: string;
  };
  readonly email: {
    readonly language: "auto" | "fr" | "en";
    readonly firstMessageInstructions: string | null;
    readonly followUpInstructions: string | null;
    readonly followUpDelaysBusinessDays: readonly number[];
    readonly autoReplyEnabled: boolean;
    readonly replyDelayMinutes: number;
    readonly replyInstructions: string | null;
    readonly bookingUrl: string | null;
    readonly stopOnHumanActivity: boolean;
  };
}

export interface CampaignProspect {
  readonly candidateId: string;
  readonly contactId: string | null;
  readonly state: "candidate" | "imported" | "excluded";
  readonly score: number | null;
  readonly eligible: boolean;
  readonly exclusionReason: string | null;
  readonly personalizedSteps: readonly unknown[];
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
  readonly location: string | null;
  readonly companyName: string | null;
  readonly companyWebsite: string | null;
  readonly providerData: Readonly<Record<string, unknown>>;
  readonly channels: DiscoveryCandidate["channels"];
  readonly icpFit: DiscoveryCandidate["icpFit"];
}

export interface WhatsappSourcingPool {
  readonly shared: true;
  readonly status: "not_started" | "scheduled" | "running" | "completed" | "partial" | "failed" | "action_required";
  readonly localDate: string | null;
  readonly lastPassAt: string | null;
  readonly nextPassAt: string | null;
  readonly contactsAssignedToday: number;
  readonly admissibleObserved: number;
  readonly verificationPending: number;
  readonly verifiedObserved: number;
  readonly pageAttempts: number;
  readonly pageLimit: number;
  readonly verificationAttempts: number;
  readonly verificationLimit: number;
  readonly actionRequired: boolean;
  readonly errorCode: string | null;
}

export interface CampaignDetail extends CampaignSummary {
  readonly icpCriteria: unknown;
  readonly buyingCommittee: unknown;
  readonly signals: unknown;
  readonly discoveryFilters: unknown;
  readonly assessmentRationale: string | null;
  readonly assessmentMetrics: unknown;
  readonly assessmentEvidence: unknown;
  readonly steps: readonly SequenceStep[];
  readonly prospects: readonly CampaignProspect[];
  readonly sourcingPool: WhatsappSourcingPool | null;
}

export type ProspectEngagementState =
  | "not_contacted"
  | "sent"
  | "replied"
  | "qualified"
  | "refused"
  | "meeting";

export interface CampaignReplyDecision {
  readonly messageId: string;
  readonly intent: "positive" | "question" | "objection" | "not_interested" | "unsubscribe" | "meeting_request" | "other";
  readonly confidence: number;
  readonly action: "reply" | "stop" | "booking";
  readonly rationale: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly createdAt: string;
}

export interface CampaignAutomatedReply {
  readonly id: string;
  readonly inboundMessageId: string;
  readonly body: string;
  readonly status: string;
  readonly providerRequestId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export interface CampaignConversationMessage {
  readonly id: string;
  readonly providerMessageId: string | null;
  readonly direction: "inbound" | "outbound";
  readonly senderType: string;
  readonly body: string;
  readonly occurredAt: string;
  readonly source: "conversation" | "outreach_action";
  readonly decision: CampaignReplyDecision | null;
  readonly automatedReply: CampaignAutomatedReply | null;
}

export interface CampaignProspectEngagement {
  readonly campaignId: string;
  readonly candidateId: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly fullName: string;
  readonly headline: string | null;
  readonly companyName: string | null;
  readonly score: number | null;
  readonly eligible: boolean;
  readonly state: ProspectEngagementState;
  readonly lastMessage: Omit<CampaignConversationMessage, "decision" | "automatedReply"> | null;
  readonly lastActivityAt: string;
  readonly decision: CampaignReplyDecision | null;
  readonly automatedReply: CampaignAutomatedReply | null;
  readonly enrollment: {
    readonly status: string;
    readonly suspensionReason: string | null;
    readonly suspendedAt: string | null;
  } | null;
  readonly sentCount: number;
  readonly pendingFollowUps: number;
  readonly cancelledFollowUps: number;
  readonly relaunchesCancelled: boolean;
  readonly opportunity: { readonly stage: string; readonly nextAction: string | null } | null;
}

export interface CampaignEngagementOverview {
  readonly campaignId: string;
  readonly metrics: {
    readonly targeted: number;
    readonly contacted: number;
    readonly replies: number;
    readonly hot: number;
    readonly meetings: number;
  };
  readonly prospects: readonly CampaignProspectEngagement[];
}

export interface CampaignAutopilotDashboard {
  readonly campaignId: string;
  readonly health: "working" | "healthy" | "attention" | "paused" | "completed";
  readonly currentStep: "research" | "enrichment" | "composition" | "outreach" | "setter" | "meeting" | "completed" | "attention";
  readonly counts: {
    readonly discovered: number;
    readonly eligible: number;
    readonly enrolled: number;
    readonly scheduled: number;
    readonly sent: number;
    readonly replies: number;
    readonly setterReplies: number;
    readonly offeredMeetings: number;
    readonly bookedMeetings: number;
  };
  readonly exceptions: readonly {
    readonly code: string;
    readonly message: string;
    readonly count: number;
    readonly lastOccurredAt: string | null;
  }[];
  readonly updatedAt: string;
}

export interface CampaignConversationDetail {
  readonly campaignId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly candidateId: string | null;
  readonly fullName: string;
  readonly headline: string | null;
  readonly companyName: string | null;
  readonly channel: "linkedin" | "email" | "whatsapp";
  readonly status: string;
  readonly lastMessageAt: string;
  readonly messages: readonly CampaignConversationMessage[];
  readonly decision: CampaignReplyDecision | null;
  readonly automatedReply: CampaignAutomatedReply | null;
  readonly enrollment: CampaignProspectEngagement["enrollment"];
  readonly pendingFollowUps: number;
  readonly cancelledFollowUps: number;
  readonly relaunchesCancelled: boolean;
  readonly opportunity: CampaignProspectEngagement["opportunity"];
  readonly meeting: {
    readonly status: string;
    readonly timeZone: string | null;
    readonly proposedSlots: readonly {
      readonly position: number;
      readonly start: string;
      readonly label: string;
    }[];
    readonly selectedSlotStart: string | null;
    readonly bookedStartAt: string | null;
    readonly meetingUrl: string | null;
  } | null;
}

export async function listCampaigns(
  workspaceSlug: string,
): Promise<{ data: CampaignSummary[] }> {
  return crmFetch(workspaceSlug, "/api/v1/campaigns");
}

export async function getCampaign(
  workspaceSlug: string,
  campaignId: string,
): Promise<CampaignDetail> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}`);
}

export async function getCampaignAutopilotPolicy(
  workspaceSlug: string,
  campaignId: string,
): Promise<{ policy: CampaignAutopilotPolicy; editable: boolean }> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/autopilot-policy`);
}

export async function updateCampaignAutopilotPolicy(
  workspaceSlug: string,
  campaignId: string,
  patch: Partial<CampaignAutopilotPolicy>,
): Promise<{ policy: CampaignAutopilotPolicy; editable: boolean }> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/autopilot-policy`, {
    method: "PATCH",
    body: patch,
  });
}

export async function getCampaignEngagement(
  workspaceSlug: string,
  campaignId: string,
): Promise<CampaignEngagementOverview> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/conversations`);
}

export async function getCampaignAutopilotDashboard(
  workspaceSlug: string,
  campaignId: string,
): Promise<CampaignAutopilotDashboard> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/autopilot-dashboard`);
}

export async function getCampaignConversation(
  workspaceSlug: string,
  campaignId: string,
  conversationId: string,
): Promise<CampaignConversationDetail> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/campaigns/${campaignId}/conversations/${conversationId}`,
  );
}

export async function restartCampaignDiscovery(
  workspaceSlug: string,
  campaignId: string,
): Promise<DiscoveryRun> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/actions/discover`, {
    method: "POST",
    body: {},
  });
}

export interface ChannelAssessmentView {
  readonly id: string;
  readonly planId: string;
  readonly channel: "linkedin" | "email" | "whatsapp";
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly recommendation: "recommended" | "optional" | "unsuitable" | null;
  readonly score: number | null;
  readonly strategy: Record<string, unknown>;
  readonly metrics: Record<string, unknown>;
  readonly evidence: readonly {
    readonly url: string | null;
    readonly title: string;
    readonly excerpt: string;
    readonly kind: string;
  }[];
  readonly rationale: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface ProspectingPlanSummary {
  readonly id: string;
  readonly icpVersionId: string;
  readonly icpName: string;
  readonly icpRunId: string;
  readonly name: string;
  readonly status: "assessing" | "ready" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProspectingPlanDetail extends ProspectingPlanSummary {
  readonly assessments: readonly ChannelAssessmentView[];
  readonly campaigns: readonly {
    readonly id: string;
    readonly channel: "linkedin" | "email" | "whatsapp" | null;
    readonly name: string;
    readonly status: "draft" | "active" | "paused" | "completed" | "archived";
    readonly sequenceId: string;
    readonly prospectCount: number;
  }[];
}

export async function listProspectingPlans(
  workspaceSlug: string,
): Promise<{ data: ProspectingPlanSummary[] }> {
  return crmFetch(workspaceSlug, "/api/v1/prospecting-plans");
}

export async function getProspectingPlan(
  workspaceSlug: string,
  planId: string,
): Promise<ProspectingPlanDetail> {
  return crmFetch(workspaceSlug, `/api/v1/prospecting-plans/${planId}`);
}

export async function enableProspectingChannel(
  workspaceSlug: string,
  planId: string,
  channel: "linkedin" | "email" | "whatsapp",
): Promise<{ campaignId: string }> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/prospecting-plans/${planId}/channels/${channel}/actions/enable`,
    { method: "POST", body: {} },
  );
}

export async function retryChannelAssessment(
  workspaceSlug: string,
  assessmentId: string,
): Promise<ChannelAssessmentView> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/channel-assessments/${assessmentId}/actions/retry`,
    { method: "POST", body: {} },
  );
}

export async function archiveChannelCampaign(
  workspaceSlug: string,
  campaignId: string,
): Promise<void> {
  return crmFetch(workspaceSlug, `/api/v1/campaigns/${campaignId}/actions/archive`, {
    method: "POST",
    body: {},
  });
}

export function outboundApiUrl(pathname: string): URL {
  return new URL(pathname, process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001");
}

async function apiFetch(
  pathname: string,
  options: {
    readonly method?: string;
    readonly body?: string;
    readonly workspaceSlug?: string;
  } = {},
): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  const headers = new Headers({ accept: "application/json" });
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (options.workspaceSlug) headers.set("x-workspace-slug", options.workspaceSlug);
  if (options.body) headers.set("content-type", "application/json");
  return fetch(outboundApiUrl(pathname), {
    method: options.method ?? "GET",
    headers,
    ...(options.body ? { body: options.body } : {}),
    cache: "no-store",
    redirect: "manual",
  });
}

async function throwApiError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as
    | { code?: string; detail?: string; message?: string; errors?: unknown; field?: unknown; blockedClaimIds?: unknown; blockers?: unknown; warnings?: unknown; campaignId?: unknown; campaignName?: unknown; reason?: unknown; channel?: unknown; suppressionId?: unknown; contactId?: unknown }
    | null;
  throw new OutboundApiError(
    response.status,
    body?.code ?? "UPSTREAM_ERROR",
    body?.detail ?? body?.message ?? "Le serveur n’a pas pu traiter la demande.",
    body ? { errors: body.errors, field: body.field, blockedClaimIds: body.blockedClaimIds, blockers: body.blockers, warnings: body.warnings, campaignId: body.campaignId, campaignName: body.campaignName, reason: body.reason, channel: body.channel, suppressionId: body.suppressionId, contactId: body.contactId } : null,
  );
}

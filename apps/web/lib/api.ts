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
  readonly researchVersion: 1 | 2;
}

export interface ResearchRun {
  readonly id: string;
  readonly status: "draft" | "queued" | "running" | "paused" | "ready_for_review" | "failed";
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

export type SuppressionIdentityType = "email" | "linkedin" | "phone" | "whatsapp";
export type SuppressionChannel = "global" | "email" | "linkedin" | "whatsapp";

export interface Suppression {
  readonly id: string;
  readonly channel: SuppressionChannel;
  readonly identityType: SuppressionIdentityType | null;
  /** The API masks this value for non-privileged workspace roles. */
  readonly normalizedValue: string | null;
  readonly reason: string | null;
  readonly contactId: string | null;
  readonly createdBy: string | null;
  readonly liftedAt: string | null;
  readonly liftedBy: string | null;
  readonly liftJustification: string | null;
  readonly createdAt: string;
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

export async function listCampaigns(workspaceSlug: string): Promise<{ data: Campaign[] }> {
  return crmFetch(workspaceSlug, "/api/v1/campaigns");
}
export async function createCampaign(workspaceSlug: string, input: Omit<Campaign, "id" | "workspaceId" | "status" | "createdBy" | "activatedBy" | "activatedAt" | "pausedAt" | "archivedAt" | "createdAt" | "updatedAt">): Promise<Campaign> {
  return crmFetch(workspaceSlug, "/api/v1/campaigns", { method: "POST", body: input });
}
export async function getCampaign(workspaceSlug: string, campaignId: string): Promise<Campaign> {
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
  readonly providerData: Readonly<Record<string, unknown>>;
  readonly icpFit: { matches?: readonly string[]; gaps?: readonly string[] };
  readonly importedContactId: string | null;
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
    | { code?: string; detail?: string; message?: string; errors?: unknown; blockedClaimIds?: unknown; blockers?: unknown; warnings?: unknown }
    | null;
  throw new OutboundApiError(
    response.status,
    body?.code ?? "UPSTREAM_ERROR",
    body?.detail ?? body?.message ?? "Le serveur n’a pas pu traiter la demande.",
    body ? { errors: body.errors, blockedClaimIds: body.blockedClaimIds, blockers: body.blockers, warnings: body.warnings } : null,
  );
}

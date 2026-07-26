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
    readonly status: "pending" | "queued" | "running" | "paused" | "completed";
    readonly attempts: number;
    readonly lastErrorCode: string | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  }[];
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

export interface IcpVersionView {
  readonly id: string;
  readonly runId: string;
  readonly proposalId: string;
  readonly version: number;
  readonly name: string;
  readonly unknowns: readonly unknown[];
  readonly unresolvedContradictions: readonly unknown[];
  readonly blockedFindings: readonly { findingId: string; statement: string; reason: string | null }[];
  readonly publishedAt: string;
}

export class OutboundApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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
  search?: string,
): Promise<{ data: Company[]; nextCursor: string | null }> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/companies${search ? `?search=${encodeURIComponent(search)}&limit=50` : "?limit=50"}`,
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

export async function getCompany(
  workspaceSlug: string,
  companyId: string,
): Promise<Company & { contacts: { id: string; firstName: string; lastName: string; title: string | null; isCurrent: boolean; status: string }[] }> {
  return crmFetch(workspaceSlug, `/api/v1/companies/${companyId}`);
}

export async function listContacts(
  workspaceSlug: string,
  search?: string,
): Promise<{ data: ContactSummary[]; nextCursor: string | null }> {
  return crmFetch(
    workspaceSlug,
    `/api/v1/contacts${search ? `?search=${encodeURIComponent(search)}&limit=50` : "?limit=50"}`,
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
    | { code?: string; detail?: string; message?: string }
    | null;
  throw new OutboundApiError(
    response.status,
    body?.code ?? "UPSTREAM_ERROR",
    body?.detail ?? body?.message ?? "Le serveur n’a pas pu traiter la demande.",
  );
}

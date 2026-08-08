import { z, ZodError } from "zod";
import {
  ProviderUnavailableError,
  type ProspectSource,
  type ProspectSourceCandidate,
} from "@outbound/application/crm/prospect-source";
import { normalizeLinkedinUrl } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresCrmRepository } from "@outbound/infrastructure/crm/postgres-crm-repository";
import { PostgresDiscoveryRepository } from "@outbound/infrastructure/crm/postgres-discovery-repository";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
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
const launchSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

const versionDiscoveryPath = /^\/api\/v1\/icp-versions\/([^/]+)\/discovery-runs$/;
const runPath = /^\/api\/v1\/discovery-runs\/([^/]+)$/;
const runRetryPath = /^\/api\/v1\/discovery-runs\/([^/]+)\/actions\/retry$/;
const candidateImportPath =
  /^\/api\/v1\/discovery-runs\/([^/]+)\/candidates\/([^/]+)\/actions\/import$/;
const icpPath = /^\/api\/v1\/icps\/([^/]+)$/;
const icpPublishPath = /^\/api\/v1\/icps\/([^/]+)\/actions\/publish$/;

export interface DiscoveryHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
  readonly prospectSource: () => ProspectSource;
}

export function createDiscoveryHttpHandler(dependencies: DiscoveryHttpDependencies) {
  const repository = new PostgresDiscoveryRepository(dependencies.database);
  const productResearch = new PostgresProductResearchRepository(dependencies.database);
  const crm = createCrmHttpHandler({
    contextResolver: dependencies.contextResolver,
    database: dependencies.database,
  });
  const crmRepository = new PostgresCrmRepository(dependencies.database);

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        url.pathname.startsWith("/api/v1/contacts") ||
        url.pathname.startsWith("/api/v1/companies")
      ) {
        return crm(request);
      }
      const context = await resolveContext(dependencies.contextResolver, request);

      if (request.method === "GET" && url.pathname === "/api/v1/icp-versions") {
        requireViewer(context.role);
        const versions = await repository.listIcpVersions(context.workspaceId);
        return json({
          data: versions.map((version) => ({
            id: version.id,
            runId: version.runId,
            proposalId: version.proposalId,
            version: version.version,
            name: version.name,
            confidence: Number(version.confidence),
            unknowns: version.unknowns,
            publishedAt: version.publishedAt.toISOString(),
          })),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/icps") {
        requireViewer(context.role);
        return json({ data: await repository.listIcps(context.workspaceId) });
      }
      const versionPath = /^\/api\/v1\/icp-versions\/([^/]+)$/;
      const versionMatch = versionPath.exec(url.pathname);
      if (request.method === "GET" && versionMatch) {
        requireViewer(context.role);
        const version = await repository.getIcpVersion({ workspaceId: context.workspaceId, versionId: uuidSchema.parse(versionMatch[1]) });
        if (!version) return problem(404, "ICP_VERSION_NOT_FOUND", "Published ICP version not found");
        return json(normalizeVersion(version));
      }
      const icpMatch = icpPath.exec(url.pathname);
      if (request.method === "GET" && icpMatch) {
        requireViewer(context.role);
        const icp = await repository.getIcp({ workspaceId: context.workspaceId, icpId: uuidSchema.parse(icpMatch[1]) });
        if (!icp) return problem(404, "ICP_NOT_FOUND", "ICP not found");
        return json({ ...icp, versions: icp.versions.map(normalizeVersion) });
      }
      const publishIcpMatch = icpPublishPath.exec(url.pathname);
      if (request.method === "POST" && publishIcpMatch) {
        requireAdmin(context.role);
        const version = await productResearch.publishNextIcpVersion({
          id: crypto.randomUUID(), icpId: uuidSchema.parse(publishIcpMatch[1]),
          workspaceId: context.workspaceId, userId: context.userId, publishedAt: new Date(),
        });
        return json(normalizeVersion(version), 201);
      }

      const launchMatch = versionDiscoveryPath.exec(url.pathname);
      if (request.method === "POST" && launchMatch) {
        requireOperator(context.role);
        const versionId = uuidSchema.parse(launchMatch[1]);
        const body = launchSchema.parse(await request.json().catch(() => ({})));
        const version = await repository.getIcpVersion({
          workspaceId: context.workspaceId,
          versionId,
        });
        if (!version) return problem(404, "ICP_VERSION_NOT_FOUND", "Published ICP version not found");
        const filters = buildFilters(version, body.limit);
        const run = await repository.createRun({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          icpVersionId: versionId,
          filters,
          createdBy: context.userId,
        });
        const completed = await executeSearch(dependencies, repository, {
          workspaceId: context.workspaceId,
          runId: run.id,
          version,
          filters,
        });
        return json(completed, 201);
      }

      if (request.method === "GET" && url.pathname === "/api/v1/discovery-runs") {
        requireViewer(context.role);
        const runs = await repository.listRuns({
          workspaceId: context.workspaceId,
          ...(url.searchParams.get("icpVersionId")
            ? { icpVersionId: uuidSchema.parse(url.searchParams.get("icpVersionId")) }
            : {}),
        });
        return json({ data: runs });
      }

      const runMatch = runPath.exec(url.pathname);
      if (request.method === "GET" && runMatch) {
        requireViewer(context.role);
        const run = await repository.getRun({
          workspaceId: context.workspaceId,
          runId: uuidSchema.parse(runMatch[1]),
        });
        if (!run) return problem(404, "DISCOVERY_RUN_NOT_FOUND", "Discovery run not found");
        return json(normalizeDiscoveryRun(run));
      }

      const retryMatch = runRetryPath.exec(url.pathname);
      if (request.method === "POST" && retryMatch) {
        requireOperator(context.role);
        const runId = uuidSchema.parse(retryMatch[1]);
        const run = await repository.getRun({ workspaceId: context.workspaceId, runId });
        if (!run) return problem(404, "DISCOVERY_RUN_NOT_FOUND", "Discovery run not found");
        if (run.status !== "failed") {
          return problem(409, "DISCOVERY_RUN_NOT_FAILED", "Only a failed run can be retried");
        }
        const version = await repository.getIcpVersion({
          workspaceId: context.workspaceId,
          versionId: run.icpVersionId,
        });
        if (!version) return problem(404, "ICP_VERSION_NOT_FOUND", "Published ICP version not found");
        await repository.beginRetry({ workspaceId: context.workspaceId, runId, maxRetries: 3 });
        const retried = await executeSearch(dependencies, repository, {
          workspaceId: context.workspaceId,
          runId: run.id,
          version,
          filters: run.filters as ReturnType<typeof buildFilters>,
        });
        return json(retried);
      }

      const importMatch = candidateImportPath.exec(url.pathname);
      if (request.method === "POST" && importMatch) {
        requireOperator(context.role);
        const runId = uuidSchema.parse(importMatch[1]);
        const candidateId = uuidSchema.parse(importMatch[2]);
        const candidate = await repository.getCandidate({
          workspaceId: context.workspaceId,
          runId,
          candidateId,
        });
        if (!candidate) return problem(404, "DISCOVERY_CANDIDATE_NOT_FOUND", "Candidate not found");
        if (candidate.importedContactId) {
          return problem(409, "CANDIDATE_ALREADY_IMPORTED", "This candidate is already imported", {
            contactId: candidate.importedContactId,
          });
        }
        const contact = await importCandidate(crmRepository, repository, {
          workspaceId: context.workspaceId,
          candidate,
        });
        return json(contact, 201);
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
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("INVALID_")) {
        return problem(400, message, "The request contains an invalid value");
      }
      if (message.startsWith("COMPANY_DOMAIN_CONFLICT")) {
        return problem(409, "COMPANY_DOMAIN_CONFLICT", "A company already uses this domain", {
          existingCompanyId: message.split(":", 2)[1] || null,
        });
      }
      if (message === "CONTACT_IDENTITY_CONFLICT") {
        return problem(409, message, "This contact identity already exists in the workspace");
      }
      if (message === "CONTACT_SUPPRESSED") {
        return problem(409, message, "This identity was suppressed and cannot be re-imported");
      }
      if (message === "COMPANY_NOT_FOUND") {
        return problem(404, message, "Company not found");
      }
      if (message === "CONTACT_NOT_FOUND") {
        return problem(404, message, "Contact not found");
      }
      if (["ICP_NOT_FOUND", "ICP_VERSION_NOT_FOUND"].includes(message)) {
        return problem(404, message, "Published ICP version not found");
      }
      if (["ICP_DELETED", "ICP_NOT_PUBLISHABLE", "ICP_VERSION_ALLOCATION_CONFLICT"].includes(message)) {
        return problem(409, message, "The ICP cannot be published");
      }
      if (["DISCOVERY_RUN_NOT_FAILED", "DISCOVERY_RETRY_EXHAUSTED"].includes(message)) {
        return problem(409, message, message === "DISCOVERY_RETRY_EXHAUSTED" ? "The discovery retry limit has been reached" : "Only a failed run can be retried");
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

async function executeSearch(
  dependencies: DiscoveryHttpDependencies,
  repository: PostgresDiscoveryRepository,
  input: {
    workspaceId: string;
    runId: string;
    version: {
      criteria: unknown;
      buyingCommittee: unknown;
    };
    filters: ReturnType<typeof buildFilters>;
  },
) {
  try {
    const found = await dependencies.prospectSource().searchPeople(input.filters);
    const candidates = found.map((candidate) => ({
      id: crypto.randomUUID(),
      fullName: candidate.fullName,
      headline: candidate.headline,
      linkedinUrl: candidate.linkedinUrl,
      linkedinNormalized: normalizeLinkedin(candidate.linkedinUrl),
      location: candidate.location,
      companyName: candidate.companyName,
      providerData: candidate.providerData,
      icpFit: computeIcpFit(input.version, candidate),
    }));
    return await repository.completeRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      candidates,
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      return await repository.failRun({
        workspaceId: input.workspaceId,
        runId: input.runId,
        errorCode: "PROVIDER_UNAVAILABLE",
        errorMessage: error.message,
      });
    }
    throw error;
  }
}

export function buildFilters(
  version: { criteria: unknown; buyingCommittee: unknown },
  limit: number,
): {
  api: "classic";
  category: "people";
  keywords: string;
  limit: number;
} {
  const criteria = objectRecord(version.criteria);
  const industries = [...stringArray(criteria.sectors), ...stringArray(criteria.industries)];
  const committee = stringArray(version.buyingCommittee);
  // LinkedIn classic keyword search ANDs every term: long multi-word queries
  // return nothing. Keep it to the first industry + the first committee role,
  // cleaned of slashes and limited to two words each.
  const industry = (industries[0] ?? "").split("/")[0]!.trim().split(/\s+/).slice(0, 2).join(" ");
  const role = (committee[0] ?? "").split("/")[0]!.trim().split(/\s+/).slice(0, 2).join(" ");
  const keywords = [industry, role].filter(Boolean).join(" ").trim();
  return { api: "classic", category: "people", keywords, limit };
}

export function computeIcpFit(
  version: { criteria: unknown; buyingCommittee: unknown },
  candidate: ProspectSourceCandidate,
): { matches: string[]; gaps: string[] } {
  const criteria = objectRecord(version.criteria);
  const matches: string[] = [];
  const gaps: string[] = [];
  const haystack = `${candidate.headline ?? ""} ${candidate.companyName ?? ""}`.toLowerCase();
  const geography = typeof criteria.geography === "string" ? criteria.geography : null;
  if (geography) {
    const location = (candidate.location ?? "").toLowerCase();
    if (location && location.includes(geography.toLowerCase())) {
      matches.push(`Géographie : ${geography}`);
    } else {
      gaps.push(
        candidate.location
          ? `Géographie à vérifier : ${candidate.location} (critère ${geography})`
          : "Géographie inconnue",
      );
    }
  }
  const industries = [...stringArray(criteria.sectors), ...stringArray(criteria.industries)];
  const matchedSectors = industries.filter((sector) => haystack.includes(sector.toLowerCase()));
  if (matchedSectors.length) {
    matches.push(`Secteur : ${matchedSectors.join(", ")}`);
  } else if (industries.length) {
    gaps.push("Secteur non confirmé par le profil");
  }
  const committee = stringArray(version.buyingCommittee);
  const matchedRole = committee.find((role) => {
    const cleaned = role.split("/")[0]!.trim().toLowerCase();
    return cleaned.length > 0 && haystack.includes(cleaned);
  });
  if (matchedRole) {
    matches.push(`Rôle : ${matchedRole.split("/")[0]!.trim()}`);
  } else if (committee.length) {
    gaps.push("Rôle non confirmé par le profil");
  }
  return { matches, gaps };
}

async function importCandidate(
  crmRepository: PostgresCrmRepository,
  repository: PostgresDiscoveryRepository,
  input: {
    workspaceId: string;
    candidate: {
      id: string;
      fullName: string;
      headline: string | null;
      linkedinUrl: string | null;
      linkedinNormalized: string | null;
      companyName: string | null;
    };
  },
) {
  const candidate = input.candidate;
  const [firstName, ...rest] = candidate.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ") || "—";
  let companyId: string | null = null;
  if (candidate.companyName) {
    const existing = await repository.findCompanyByName({
      workspaceId: input.workspaceId,
      name: candidate.companyName,
    });
    companyId =
      existing?.id ??
      (
        await crmRepository.createCompany({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          name: candidate.companyName,
          normalizedDomain: null,
          sector: null,
          employeeCountMin: null,
          employeeCountMax: null,
          location: null,
          linkedinUrl: null,
          source: "discovery",
        })
      ).id;
  }
  const contact = await crmRepository.createContact({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    firstName: firstName ?? candidate.fullName,
    lastName,
    source: "discovery",
    identities: candidate.linkedinNormalized
      ? [
          {
            id: crypto.randomUUID(),
            type: "linkedin",
            value: candidate.linkedinUrl ?? candidate.linkedinNormalized,
            normalizedValue: candidate.linkedinNormalized,
          },
        ]
      : [],
    employment: companyId
      ? {
          id: crypto.randomUUID(),
          companyId,
          title: candidate.headline ?? "Contact LinkedIn",
          startedOn: null,
        }
      : null,
  });
  await repository.markCandidateImported({
    workspaceId: input.workspaceId,
    candidateId: candidate.id,
    contactId: contact.id,
  });
  return contact;
}

function normalizeLinkedin(url: string | null): string | null {
  if (!url) return null;
  try {
    return normalizeLinkedinUrl(url);
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
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
  if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Admin access is required to publish an ICP version");
}

function normalizeVersion(input: unknown) {
  const version = input as Record<string, unknown>;
  return {
    ...version,
    confidence: Number(version.confidence),
    publishedAt: version.publishedAt instanceof Date ? version.publishedAt.toISOString() : version.publishedAt,
    createdAt: version.createdAt instanceof Date ? version.createdAt.toISOString() : version.createdAt,
  };
}

function normalizeDiscoveryRun(input: { candidates?: readonly Record<string, unknown>[]; [key: string]: unknown }) {
  return {
    ...input,
    candidates: (input.candidates ?? []).map((candidate) => ({ ...candidate, source: "discovery" })),
  };
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

function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/icp-versions" || pathname === "/api/v1/discovery-runs") return "GET";
  if (pathname === "/api/v1/icps") return "GET";
  if (icpPath.test(pathname)) return "GET";
  if (icpPublishPath.test(pathname)) return "POST";
  if (/^\/api\/v1\/icp-versions\/[^/]+$/.test(pathname)) return "GET";
  if (versionDiscoveryPath.test(pathname)) return "POST";
  if (runPath.test(pathname)) return "GET";
  if (runRetryPath.test(pathname) || candidateImportPath.test(pathname)) return "POST";
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
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}

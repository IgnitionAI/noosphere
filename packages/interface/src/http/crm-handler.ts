import { z, ZodError } from "zod";
import {
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
} from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresCrmRepository } from "@outbound/infrastructure/crm/postgres-crm-repository";
import { PostgresProspectViewRepository } from "@outbound/infrastructure/crm/postgres-prospect-view-repository";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
  type RequestContextResolver,
} from "@outbound/interface/http/request-context";

const uuidSchema = z.string().uuid();
const postgresUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);
const requestContextSchema = z.object({
  userId: uuidSchema,
  workspaceId: uuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});

const companyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    domain: z.string().trim().max(600).nullish(),
    sector: z.string().trim().max(200).nullish(),
    employeeCountMin: z.number().int().min(0).nullish(),
    employeeCountMax: z.number().int().min(0).nullish(),
    location: z.string().trim().max(300).nullish(),
    linkedinUrl: z.string().trim().max(600).nullish(),
  })
  .strict();

const identityInputSchema = z.object({
  type: z.enum(["email", "linkedin", "phone", "whatsapp"]),
  value: z.string().trim().min(1).max(600),
});

const contactCreateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(200),
    lastName: z.string().trim().min(1).max(200),
    identities: z.array(identityInputSchema).max(10).default([]),
    employment: z
      .object({
        companyId: uuidSchema,
        title: z.string().trim().min(1).max(300),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      })
      .strict()
      .nullish(),
  })
  .strict();

const employmentCreateSchema = z
  .object({
    companyId: uuidSchema,
    title: z.string().trim().min(1).max(300),
    startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  })
  .strict();

const suppressionCreateSchema = z
  .object({
    channel: z.enum(["global", "email", "linkedin", "whatsapp"]).default("global"),
    reason: z.string().trim().max(2_000).nullish(),
  })
  .strict();

const companyPath = /^\/api\/v1\/companies\/([^/]+)$/;
const contactPath = /^\/api\/v1\/contacts\/([^/]+)$/;
const contactIdentitiesPath = /^\/api\/v1\/contacts\/([^/]+)\/identities$/;
const contactEmploymentsPath = /^\/api\/v1\/contacts\/([^/]+)\/employments$/;
const contactSuppressPath = /^\/api\/v1\/contacts\/([^/]+)\/actions\/suppress$/;
const prospectPath = /^\/api\/v1\/prospects\/([^/]+)$/;

export interface CrmHttpDependencies {
  readonly contextResolver: RequestContextResolver;
  readonly database: Database;
}

export function createCrmHttpHandler(dependencies: CrmHttpDependencies) {
  const repository = new PostgresCrmRepository(dependencies.database);
  const prospectViews = new PostgresProspectViewRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const context = await resolveContext(dependencies.contextResolver, request);

      if (url.pathname === "/api/v1/prospects" && request.method === "GET") {
        requireViewer(context.role);
        const channel = url.searchParams.get("channel");
        const result = await prospectViews.list({
          workspaceId: context.workspaceId,
          ...(url.searchParams.get("search")?.trim()
            ? { search: url.searchParams.get("search")!.trim() }
            : {}),
          ...(url.searchParams.get("icpVersionId")
            ? { icpVersionId: postgresUuidSchema.parse(url.searchParams.get("icpVersionId")) }
            : {}),
          ...(channel
            ? { channel: z.enum(["linkedin", "email", "whatsapp"]).parse(channel) }
            : {}),
          limit: parseLimit(url.searchParams.get("limit")),
        });
        return json(result);
      }

      const prospectMatch = prospectPath.exec(url.pathname);
      if (prospectMatch && request.method === "GET") {
        requireViewer(context.role);
        const prospect = await prospectViews.get({
          workspaceId: context.workspaceId,
          contactId: uuidSchema.parse(prospectMatch[1]),
        });
        if (!prospect) return problem(404, "PROSPECT_NOT_FOUND", "Prospect not found");
        return json(prospect);
      }

      if (url.pathname === "/api/v1/companies") {
        if (request.method === "GET") {
          requireViewer(context.role);
          const { data, nextCursor } = await repository.listCompanies({
            workspaceId: context.workspaceId,
            ...(url.searchParams.get("search")?.trim()
              ? { search: url.searchParams.get("search")!.trim() }
              : {}),
            ...(url.searchParams.get("cursor")
              ? { cursor: decodeCursor(url.searchParams.get("cursor"))! }
              : {}),
            limit: parseLimit(url.searchParams.get("limit")),
          });
          return json({ data, nextCursor: encodeCursor(nextCursor) });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = companyCreateSchema.parse(await request.json());
          const company = await repository.createCompany({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            name: body.name,
            normalizedDomain: normalizeDomain(body.domain),
            sector: body.sector ?? null,
            employeeCountMin: body.employeeCountMin ?? null,
            employeeCountMax: body.employeeCountMax ?? null,
            location: body.location ?? null,
            linkedinUrl: body.linkedinUrl ?? null,
            source: "manual",
          });
          return json(company, 201);
        }
      }

      const companyMatch = companyPath.exec(url.pathname);
      if (request.method === "GET" && companyMatch) {
        requireViewer(context.role);
        const company = await repository.getCompany({
          workspaceId: context.workspaceId,
          companyId: uuidSchema.parse(companyMatch[1]),
        });
        if (!company) return problem(404, "COMPANY_NOT_FOUND", "Company not found");
        return json(company);
      }

      if (url.pathname === "/api/v1/contacts") {
        if (request.method === "GET") {
          requireViewer(context.role);
          const { data, nextCursor } = await repository.listContacts({
            workspaceId: context.workspaceId,
            ...(url.searchParams.get("search")?.trim()
              ? { search: url.searchParams.get("search")!.trim() }
              : {}),
            ...(url.searchParams.get("companyId")
              ? { companyId: uuidSchema.parse(url.searchParams.get("companyId")) }
              : {}),
            ...(url.searchParams.get("cursor")
              ? { cursor: decodeCursor(url.searchParams.get("cursor"))! }
              : {}),
            limit: parseLimit(url.searchParams.get("limit")),
          });
          return json({ data, nextCursor: encodeCursor(nextCursor) });
        }
        if (request.method === "POST") {
          requireOperator(context.role);
          const body = contactCreateSchema.parse(await request.json());
          const contact = await repository.createContact({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            firstName: body.firstName,
            lastName: body.lastName,
            source: "manual",
            identities: body.identities.map((identity) => ({
              id: crypto.randomUUID(),
              type: identity.type,
              value: identity.value,
              normalizedValue: normalizeIdentity(identity.type, identity.value),
            })),
            employment: body.employment
              ? {
                  id: crypto.randomUUID(),
                  companyId: body.employment.companyId,
                  title: body.employment.title,
                  startedOn: body.employment.startedOn ?? null,
                }
              : null,
          });
          return json(contact, 201);
        }
      }

      const contactMatch = contactPath.exec(url.pathname);
      if (request.method === "GET" && contactMatch) {
        requireViewer(context.role);
        const contact = await repository.getContact({
          workspaceId: context.workspaceId,
          contactId: uuidSchema.parse(contactMatch[1]),
        });
        if (!contact) return problem(404, "CONTACT_NOT_FOUND", "Contact not found");
        return json(contact);
      }

      const identitiesMatch = contactIdentitiesPath.exec(url.pathname);
      if (request.method === "POST" && identitiesMatch) {
        requireOperator(context.role);
        const contactId = uuidSchema.parse(identitiesMatch[1]);
        const body = identityInputSchema.parse(await request.json());
        const identity = await repository.addIdentity({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          contactId,
          type: body.type,
          value: body.value,
          normalizedValue: normalizeIdentity(body.type, body.value),
        });
        return json(identity, 201);
      }

      const employmentsMatch = contactEmploymentsPath.exec(url.pathname);
      if (request.method === "POST" && employmentsMatch) {
        requireOperator(context.role);
        const contactId = uuidSchema.parse(employmentsMatch[1]);
        const body = employmentCreateSchema.parse(await request.json());
        const employment = await repository.addEmployment({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          contactId,
          companyId: body.companyId,
          title: body.title,
          startedOn: body.startedOn ?? null,
        });
        return json(employment, 201);
      }

      const suppressMatch = contactSuppressPath.exec(url.pathname);
      if (request.method === "POST" && suppressMatch) {
        requireOperator(context.role);
        const contactId = uuidSchema.parse(suppressMatch[1]);
        const body = suppressionCreateSchema.parse(await request.json().catch(() => ({})));
        await repository.suppressContact({
          workspaceId: context.workspaceId,
          contactId,
          channel: body.channel,
          reason: body.reason ?? null,
          userId: context.userId,
        });
        return new Response(null, { status: 204 });
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

function normalizeIdentity(type: "email" | "linkedin" | "phone" | "whatsapp", value: string): string {
  if (type === "email") return normalizeEmail(value);
  if (type === "linkedin") return normalizeLinkedinUrl(value);
  return normalizePhone(value);
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

function parseLimit(raw: string | null): number {
  const value = Number(raw ?? 25);
  if (!Number.isSafeInteger(value) || value <= 0) return 25;
  return Math.min(value, 100);
}

function encodeCursor(cursor: { createdAt: Date; id: string } | null): string | null {
  if (!cursor) return null;
  return btoa(`${cursor.createdAt.toISOString()}|${cursor.id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(raw: string | null): { createdAt: Date; id: string } | undefined {
  if (!raw) return undefined;
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
  const [timestamp, id] = atob(padded).split("|");
  return { createdAt: new Date(timestamp ?? ""), id: id ?? "" };
}

function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/prospects" || prospectPath.test(pathname)) return "GET";
  if (pathname === "/api/v1/companies" || pathname === "/api/v1/contacts") return "GET, POST";
  if (companyPath.test(pathname) || contactPath.test(pathname)) return "GET";
  if (
    contactIdentitiesPath.test(pathname) ||
    contactEmploymentsPath.test(pathname) ||
    contactSuppressPath.test(pathname)
  ) {
    return "POST";
  }
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

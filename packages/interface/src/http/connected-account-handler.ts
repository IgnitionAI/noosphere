import { createHmac, timingSafeEqual } from "node:crypto";
import { recordRejectedUnipileWebhook } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { z, ZodError } from "zod";
import type { RequestContextResolver } from "./request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "./request-context";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresConnectedAccountRepository } from "@outbound/infrastructure/integrations/postgres-connected-account-repository";
import {
  normalizeStatus,
  type UnipileAccountSnapshot,
  type UnipileClient,
} from "@outbound/infrastructure/integrations/unipile-client";
import { decryptSecret, encryptSecret } from "@outbound/infrastructure/security/secret-crypto";
import { ProviderUnavailableError } from "@outbound/application/crm/prospect-source";

const uuidSchema = z.string().uuid();
const contextSchema = z.object({
  userId: uuidSchema,
  workspaceId: uuidSchema,
  role: z.enum(["viewer", "operator", "reviewer", "admin", "owner"]),
});
const connectSchema = z.object({
  provider: z.literal("unipile").default("unipile"),
  providerAccountId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().max(300).nullish(),
  accessToken: z.string().min(1).max(20_000),
}).strict();
const accountPath = /^\/api\/v1\/connected-accounts\/([^/]+)$/;
const actionPath = /^\/api\/v1\/connected-accounts\/([^/]+)\/actions\/(check|reconnect)$/;
const onboardingPath = /^\/api\/v1\/connected-accounts\/onboarding\/([^/]+)$/;
const onboardingActionPath = /^\/api\/v1\/connected-accounts\/onboarding\/([^/]+)\/actions\/complete$/;
const quotasPath = /^\/api\/v1\/connected-accounts\/([^/]+)\/quotas$/;
const impactPath = /^\/api\/v1\/connected-accounts\/([^/]+)\/impact$/;
const alertPath = /^\/api\/v1\/account-health-alerts\/([^/]+)\/actions\/acknowledge$/;
const onboardingSchema = z.object({ channel: z.enum(["email", "linkedin", "whatsapp"]) }).strict();
const onboardingCompleteSchema = z.object({ providerAccountId: z.string().trim().min(1).max(300), accessToken: z.string().min(1).max(20_000), displayName: z.string().trim().max(300).nullish() }).strict();

export interface ConnectedAccountHttpDependencies {
  readonly database: Database;
  readonly contextResolver: RequestContextResolver;
  readonly client: UnipileClient;
  readonly webhookSecret: string;
}

export function createConnectedAccountHttpHandler(dependencies: ConnectedAccountHttpDependencies) {
  const repository = new PostgresConnectedAccountRepository(dependencies.database);
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/v1/webhooks/unipile") return await handleWebhook(request, dependencies, repository);
      const context = await resolveContext(dependencies.contextResolver, request);

      if (url.pathname === "/api/v1/connected-accounts/onboarding" && request.method === "POST") {
        requireAdmin(context.role);
        const body = onboardingSchema.parse(await request.json());
        const onboarding = await repository.startOnboarding({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          channel: body.channel,
          createdBy: context.userId,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        });
        return json(onboarding, 201);
      }

      const onboardingAction = onboardingActionPath.exec(url.pathname);
      if (onboardingAction && request.method === "POST") {
        requireAdmin(context.role);
        const body = onboardingCompleteSchema.parse(await request.json());
        const onboardingId = uuidSchema.parse(onboardingAction[1]);
        const onboarding = await repository.getOnboarding({ workspaceId: context.workspaceId, id: onboardingId });
        if (!onboarding) return problem(404, "CONNECTION_ONBOARDING_NOT_FOUND", "Connection onboarding not found");
        let snapshot: UnipileAccountSnapshot;
        try {
          snapshot = await dependencies.client.connect({ providerAccountId: body.providerAccountId, accessToken: body.accessToken });
        } catch (error) {
          if (error instanceof ProviderUnavailableError) {
            const failed = await repository.failOnboarding({ workspaceId: context.workspaceId, id: onboardingId, errorCode: "PROVIDER_UNAVAILABLE", errorMessage: error.message });
            return json(failed, 503);
          }
          throw error;
        }
        const completed = await repository.completeOnboarding({
          workspaceId: context.workspaceId,
          onboardingId,
          providerAccountId: body.providerAccountId,
          displayName: body.displayName ?? null,
          encryptedSecret: encryptSecret(body.accessToken),
          snapshot,
          actorUserId: context.userId,
        });
        return json({ onboarding: completed.onboarding, account: completed.account }, 201);
      }

      const onboardingMatch = onboardingPath.exec(url.pathname);
      if (onboardingMatch && request.method === "GET") {
        requireViewer(context.role);
        const onboarding = await repository.getOnboarding({ workspaceId: context.workspaceId, id: uuidSchema.parse(onboardingMatch[1]) });
        if (!onboarding) return problem(404, "CONNECTION_ONBOARDING_NOT_FOUND", "Connection onboarding not found");
        return json(onboardingViewForRole(onboarding, context.role));
      }

      if (url.pathname === "/api/v1/connected-accounts") {
        if (request.method === "GET") {
          requireViewer(context.role);
          return json({ data: (await repository.list(context.workspaceId)).map((account) => viewForRole(account, context.role)) });
        }
        if (request.method === "POST") {
          requireAdmin(context.role);
          const body = connectSchema.parse(await request.json());
          let snapshot: UnipileAccountSnapshot;
          try {
            snapshot = await dependencies.client.connect({
              providerAccountId: body.providerAccountId,
              accessToken: body.accessToken,
            });
          } catch (error) {
            if (error instanceof ProviderUnavailableError) return problem(503, "PROVIDER_UNAVAILABLE", error.message);
            throw error;
          }
          const account = await repository.create({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            provider: body.provider,
            providerAccountId: body.providerAccountId,
            displayName: body.displayName ?? null,
            encryptedSecret: encryptSecret(body.accessToken),
            createdBy: context.userId,
            snapshot,
          });
          return json(account, 201);
        }
      }

      const match = accountPath.exec(url.pathname);
      if (match && request.method === "GET") {
        requireViewer(context.role);
        const account = await repository.get({ workspaceId: context.workspaceId, id: uuidSchema.parse(match[1]) });
        if (!account) return problem(404, "CONNECTED_ACCOUNT_NOT_FOUND", "Connected account not found");
        return json(viewForRole(account, context.role));
      }
      if (match && request.method === "DELETE") {
        requireAdmin(context.role);
        const account = await repository.disconnect({ workspaceId: context.workspaceId, accountId: uuidSchema.parse(match[1]), actorUserId: context.userId });
        if (!account) return problem(404, "CONNECTED_ACCOUNT_NOT_FOUND", "Connected account not found");
        return json(account);
      }

      const quotas = quotasPath.exec(url.pathname);
      if (quotas && request.method === "GET") {
        requireQuotaReader(context.role);
        const result = await repository.quotas({ workspaceId: context.workspaceId, accountId: uuidSchema.parse(quotas[1]) });
        if (!result) return problem(404, "CONNECTED_ACCOUNT_NOT_FOUND", "Connected account not found");
        return json(result);
      }

      const impact = impactPath.exec(url.pathname);
      if (impact && request.method === "GET") {
        requireOperatorReader(context.role);
        const result = await repository.suspensionImpact({ workspaceId: context.workspaceId, accountId: uuidSchema.parse(impact[1]) });
        if (!result) return problem(404, "CONNECTED_ACCOUNT_NOT_FOUND", "Connected account not found");
        return json(result);
      }

      if (url.pathname === "/api/v1/account-health-alerts" && request.method === "GET") {
        requireOperatorReader(context.role);
        const alerts = await repository.listHealthAlerts({ workspaceId: context.workspaceId });
        return json({ data: alerts.map((alert) => alertViewForRole(alert, context.role)) });
      }
      const alert = alertPath.exec(url.pathname);
      if (alert && request.method === "POST") {
        requireAdmin(context.role);
        const result = await repository.acknowledgeHealthAlert({ workspaceId: context.workspaceId, id: uuidSchema.parse(alert[1]), actorUserId: context.userId });
        if (!result) return problem(404, "ACCOUNT_HEALTH_ALERT_NOT_FOUND", "Account health alert not found");
        return json(result);
      }

      const action = actionPath.exec(url.pathname);
      if (action && request.method === "POST") {
        requireAdmin(context.role);
        const accountId = uuidSchema.parse(action[1]);
        const account = await repository.getWithSecret({ workspaceId: context.workspaceId, id: accountId });
        if (!account) return problem(404, "CONNECTED_ACCOUNT_NOT_FOUND", "Connected account not found");
        try {
          const snapshot = await dependencies.client.check({
            providerAccountId: account.providerAccountId,
            accessToken: decryptSecret(account.encryptedSecret),
          });
          const updated = await repository.updateFromProvider({
            workspaceId: context.workspaceId,
            accountId,
            snapshot,
            actorUserId: context.userId,
          });
          return json(updated);
        } catch (error) {
          if (!(error instanceof ProviderUnavailableError)) throw error;
          const unknown: UnipileAccountSnapshot = {
            providerAccountId: account.providerAccountId,
            displayName: account.displayName,
            status: "unknown",
            capabilities: asRecord(account.capabilities),
            quotas: asRecord(account.quotas),
          };
          const updated = await repository.updateFromProvider({
            workspaceId: context.workspaceId,
            accountId,
            snapshot: unknown,
            errorCode: "PROVIDER_UNAVAILABLE",
            errorMessage: error.message,
            actorUserId: context.userId,
          });
          return json(updated);
        }
      }

      const allowed = allowedMethods(url.pathname);
      if (allowed) return methodNotAllowed(allowed);
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return problem(400, "INVALID_REQUEST", "The request is invalid", { errors: error instanceof ZodError ? error.issues : undefined });
      if (error instanceof WorkspacePermissionError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof RequestAuthenticationError) return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof WorkspaceContextRequiredError) return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      if (error instanceof WorkspaceAccessDeniedError) return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (isUniqueViolation(error)) return problem(409, "CONNECTED_ACCOUNT_ALREADY_EXISTS", "This provider account is already connected in the workspace");
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

async function handleWebhook(
  request: Request,
  dependencies: ConnectedAccountHttpDependencies,
  repository: PostgresConnectedAccountRepository,
): Promise<Response> {
  const raw = await request.text();
  const supplied = request.headers.get("x-unipile-signature") ?? request.headers.get("x-webhook-signature");
  if (!supplied || !isValidSignature(raw, supplied, dependencies.webhookSecret)) {
    await recordRejectedUnipileWebhook(dependencies.database, raw, "INVALID_WEBHOOK_SIGNATURE");
    return problem(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature is invalid");
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return problem(400, "INVALID_REQUEST", "Webhook payload is invalid");
  }
  const eventId = stringValue(body.id ?? body.eventId ?? body.event_id);
  const providerAccountId = stringValue(
    body.accountId ?? body.account_id ?? nested(body, "account", "id") ?? nested(body, "data", "accountId") ?? nested(body, "data", "account_id"),
  );
  if (!eventId || !providerAccountId) return problem(400, "INVALID_WEBHOOK", "Webhook event id and account id are required");
  const statusValue = body.status ?? nested(body, "data", "status") ?? nested(body, "account", "status");
  const capabilities = body.capabilities ?? nested(body, "data", "capabilities") ?? nested(body, "account", "capabilities");
  const snapshot = statusValue === undefined && capabilities === undefined ? null : {
    providerAccountId,
    displayName: stringValue(body.displayName ?? nested(body, "account", "name")),
    status: normalizeStatus(statusValue),
    capabilities: asRecord(capabilities),
    quotas: asRecord(body.quotas ?? nested(body, "data", "quotas")),
  } satisfies UnipileAccountSnapshot;
  const result = await repository.processWebhook({
    eventId,
    providerAccountId,
    payload: sanitize(body),
    snapshot,
  });
  return json({ accepted: true, duplicate: result.duplicate }, 202);
}

function isValidSignature(raw: string, supplied: string, secret: string): boolean {
  if (!secret) return false;
  const actual = supplied.startsWith("sha256=") ? supplied.slice(7) : supplied;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|api.?key/i.test(key)) continue;
    result[key] = sanitize(child);
  }
  return result;
}

function nested(value: Record<string, unknown>, parent: string, key: string): unknown {
  const object = value[parent];
  return object && typeof object === "object" && !Array.isArray(object) ? (object as Record<string, unknown>)[key] : undefined;
}

function stringValue(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

class WorkspacePermissionError extends Error {}
function requireViewer(role: string): void { if (!["viewer", "operator", "reviewer", "admin", "owner"].includes(role)) throw new WorkspacePermissionError("Workspace access is required"); }
function requireAdmin(role: string): void { if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Administrator access is required"); }
function requireQuotaReader(role: string): void { if (!["admin", "owner", "operator"].includes(role)) throw new WorkspacePermissionError("Quota access is restricted to operators and administrators"); }
function requireOperatorReader(role: string): void { if (!["admin", "owner", "operator"].includes(role)) throw new WorkspacePermissionError("Account health access is restricted to operators and administrators"); }
function viewForRole(account: import("@outbound/infrastructure/integrations/postgres-connected-account-repository").ConnectedAccountView, role: string) {
  if (role === "viewer" || role === "reviewer") {
    return { ...account, capabilities: {}, quotas: {}, lastErrorCode: null, lastErrorMessage: null };
  }
  return account;
}
function onboardingViewForRole(onboarding: import("@outbound/infrastructure/integrations/postgres-connected-account-repository").ConnectionOnboardingView, role: string) {
  if (role === "viewer" || role === "reviewer") return { id: onboarding.id, channel: onboarding.channel, step: onboarding.step, status: onboarding.status, expiresAt: onboarding.expiresAt, createdAt: onboarding.createdAt, updatedAt: onboarding.updatedAt };
  return onboarding;
}
function alertViewForRole(alert: import("@outbound/infrastructure/integrations/postgres-connected-account-repository").AccountHealthAlertView, role: string) {
  if (role === "viewer" || role === "reviewer") return { id: alert.id, connectedAccountId: alert.connectedAccountId, status: alert.status, createdAt: alert.createdAt, updatedAt: alert.updatedAt };
  return alert;
}
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === "23505") return true;
    if (typeof current === "object" && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
    } else break;
  }
  return /duplicate key|unique constraint/i.test(error instanceof Error ? error.message : String(error));
}

async function resolveContext(resolver: RequestContextResolver, request: Request) {
  try { return contextSchema.parse(await resolver.resolve(request)); }
  catch (error) {
    if (error instanceof RequestAuthenticationError || error instanceof WorkspaceContextRequiredError || error instanceof WorkspaceAccessDeniedError) throw error;
    throw new RequestAuthenticationError("The authenticated request context is invalid");
  }
}
function allowedMethods(pathname: string): string | null {
  if (pathname === "/api/v1/connected-accounts") return "GET, POST";
  if (pathname === "/api/v1/connected-accounts/onboarding") return "POST";
  if (onboardingPath.test(pathname) || onboardingActionPath.test(pathname)) return "GET, POST";
  if (quotasPath.test(pathname) || impactPath.test(pathname)) return "GET";
  if (pathname === "/api/v1/account-health-alerts") return "GET";
  if (alertPath.test(pathname)) return "POST";
  if (accountPath.test(pathname)) return "GET, DELETE";
  if (actionPath.test(pathname)) return "POST";
  if (pathname === "/api/v1/webhooks/unipile") return "POST";
  return null;
}
function methodNotAllowed(allowed: string): Response { return problem(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed for this route", { allowed }); }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function problem(status: number, code: string, detail: string, extensions: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...extensions }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

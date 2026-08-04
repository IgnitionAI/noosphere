import { ZodError, z } from "zod";
import type { PostgresCalendarIntegration } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { CalcomApiError } from "@outbound/infrastructure/calendar/calcom-client";
import { CalendarIntegrationError } from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const route = "/api/v1/calendar-connection";
const configurationSchema = z.object({
  provider: z.literal("calcom"),
  bookingUrl: z.url().max(2_000).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }),
  apiKey: z.string().trim().min(20).max(500).startsWith("cal_").optional(),
}).strict();

export function createCalendarConnectionHttpHandler(input: {
  integration: PostgresCalendarIntegration;
  contextResolver: RequestContextResolver;
  publicWebhookBaseUrl: string;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname !== route) {
        return problem(404, "ROUTE_NOT_FOUND", "Route not found");
      }
      const context = await input.contextResolver.resolve(request);
      requireAdmin(context.role);
      if (request.method === "GET") {
        const connection = await input.integration.getDefaultConnection(context.workspaceId);
        return Response.json(connection
          ? serializeConnection(connection, input.publicWebhookBaseUrl)
          : { connected: false });
      }
      if (request.method === "PUT") {
        const body = configurationSchema.parse(await request.json());
        const connection = await input.integration.configure({
          workspaceId: context.workspaceId,
          provider: body.provider,
          bookingUrl: body.bookingUrl,
          ...(body.apiKey ? { apiKey: body.apiKey } : {}),
          publicWebhookBaseUrl: input.publicWebhookBaseUrl,
          now: new Date(),
        });
        return Response.json(serializeConnection(connection, input.publicWebhookBaseUrl));
      }
      if (request.method === "DELETE") {
        await input.integration.disable({ workspaceId: context.workspaceId, now: new Date() });
        return new Response(null, { status: 204 });
      }
      const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      response.headers.set("allow", "GET, PUT, DELETE");
      return response;
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The calendar configuration is invalid");
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
      if (error instanceof CalendarIntegrationError || error instanceof CalcomApiError) {
        return problem(error.status, error.code, calendarProblemDetail(error.code));
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function serializeConnection(
  connection: Awaited<ReturnType<PostgresCalendarIntegration["getDefaultConnection"]>> & {},
  publicWebhookBaseUrl: string,
) {
  const webhookUrl = new URL("/api/v1/webhooks/calendar/calcom", publicWebhookBaseUrl);
  webhookUrl.searchParams.set("connection", connection.id);
  return {
    connected: connection.status === "active",
    id: connection.id,
    provider: connection.provider,
    bookingUrl: connection.bookingUrl,
    apiConfigured: connection.apiConfigured,
    automationReady: connection.automationReady,
    eventType: connection.eventType,
    username: connection.username,
    timeZone: connection.timeZone,
    webhookRegistered: connection.webhookRegistered,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    status: connection.status,
    webhookUrl: webhookUrl.toString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

function calendarProblemDetail(code: string): string {
  if (code === "CALCOM_AUTHENTICATION_FAILED") return "La clé API Cal.com est invalide ou révoquée.";
  if (code === "CALCOM_EVENT_TYPE_NOT_FOUND") return "Le type de rendez-vous du lien Cal.com est introuvable pour cette clé API.";
  if (code === "CALCOM_RATE_LIMITED") return "Cal.com limite temporairement les requêtes. Réessayez dans un instant.";
  if (code === "CALCOM_TIMEOUT" || code === "CALCOM_UNREACHABLE" || code === "CALCOM_PROVIDER_UNAVAILABLE") {
    return "Cal.com est temporairement indisponible.";
  }
  return "Cal.com a refusé la configuration de l’agenda.";
}

class WorkspacePermissionError extends Error {}

function requireAdmin(role: string): void {
  if (!['admin', 'owner'].includes(role)) {
    throw new WorkspacePermissionError("Admin access is required");
  }
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

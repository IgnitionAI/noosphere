import { deriveCalendarWebhookSecret, verifyCalcomSignature } from "@outbound/infrastructure/calendar/calcom-webhook";
import {
  CalendarIntegrationError,
  type PostgresCalendarIntegration,
} from "@outbound/infrastructure/calendar/postgres-calendar-integration";
import { postgresUuidSchema } from "@outbound/interface/http/http-schemas";

const route = /^\/api\/v1\/webhooks\/calendar\/([^/]+)$/;

export function createCalendarWebhookHttpHandler(input: {
  integration: PostgresCalendarIntegration;
  signingKey: string;
}) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = route.exec(url.pathname);
    if (!match) return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    if (request.method !== "POST") {
      const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      response.headers.set("allow", "POST");
      return response;
    }
    if (match[1] !== "calcom") {
      return problem(404, "CALENDAR_PROVIDER_UNSUPPORTED", "Calendar provider unsupported");
    }
    const parsedConnection = postgresUuidSchema.safeParse(url.searchParams.get("connection"));
    if (!parsedConnection.success) {
      return problem(400, "CALENDAR_CONNECTION_REQUIRED", "A valid calendar connection is required");
    }
    const rawBody = await request.text();
    const secret = deriveCalendarWebhookSecret(input.signingKey, parsedConnection.data);
    const signature = request.headers.get("x-cal-signature-256") ?? "";
    if (!verifyCalcomSignature(rawBody, signature, secret)) {
      return problem(401, "CALENDAR_WEBHOOK_SIGNATURE_INVALID", "Calendar webhook signature invalid");
    }
    try {
      const result = await input.integration.ingestCalcom({
        connectionId: parsedConnection.data,
        rawBody,
      });
      return Response.json(result, { status: result.duplicate ? 200 : 202 });
    } catch (error) {
      if (error instanceof CalendarIntegrationError) {
        return problem(error.status, error.code, error.message);
      }
      return problem(500, "CALENDAR_WEBHOOK_INGESTION_FAILED", "Calendar webhook ingestion failed");
    }
  };
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

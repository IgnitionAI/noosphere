import { timingSafeEqual } from "node:crypto";
import {
  UnipileWebhookError,
  UnipileWebhookIngestor,
} from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";

export function createUnipileWebhookHttpHandler(input: {
  ingestor: UnipileWebhookIngestor;
  secret: string;
}) {
  return async function handle(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/api/v1/webhooks/unipile") {
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    }
    if (request.method !== "POST") {
      const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      response.headers.set("allow", "POST");
      return response;
    }
    if (!secureEqual(request.headers.get("unipile-auth") ?? "", input.secret)) {
      return problem(401, "WEBHOOK_AUTHENTICATION_FAILED", "Webhook authentication failed");
    }
    try {
      const result = await input.ingestor.ingest(await request.text());
      return Response.json(result, { status: result.duplicate ? 200 : 202 });
    } catch (error) {
      if (error instanceof UnipileWebhookError) {
        return problem(error.status, error.code, error.message);
      }
      return problem(500, "WEBHOOK_INGESTION_FAILED", "Webhook ingestion failed");
    }
  };
}
function secureEqual(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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

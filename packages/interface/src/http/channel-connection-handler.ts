import { z, ZodError } from "zod";
import {
  type PostgresUnipileChannelConnections,
  UnipileChannelConnectionError,
} from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const whatsappRoute = "/api/v1/channel-connections/whatsapp";
const selectionSchema = z.object({ providerAccountId: z.string().trim().min(1).max(500) }).strict();

export function createChannelConnectionHttpHandler(input: {
  readonly connections: Pick<
    PostgresUnipileChannelConnections,
    "list" | "selectedAccount" | "select"
  > | null;
  readonly contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname !== whatsappRoute) {
        return problem(404, "ROUTE_NOT_FOUND", "Route not found");
      }
      const context = await input.contextResolver.resolve(request);
      requireAdmin(context.role);
      if (!input.connections) {
        return problem(503, "UNIPILE_NOT_CONFIGURED", "Unipile is not configured");
      }
      if (request.method === "GET") {
        const [accounts, selected] = await Promise.all([
          input.connections.list(context.workspaceId, "whatsapp"),
          input.connections.selectedAccount(context.workspaceId, "whatsapp"),
        ]);
        return Response.json({
          channel: "whatsapp",
          connected: accounts.some((account) => account.healthy),
          selectedAccountId: selected?.providerAccountId ?? null,
          selectedDisplayName: selected?.displayName ?? null,
          accounts,
        });
      }
      if (request.method === "PUT") {
        const body = selectionSchema.parse(await request.json());
        const selected = await input.connections.select({
          workspaceId: context.workspaceId,
          channel: "whatsapp",
          providerAccountId: body.providerAccountId,
          selectedBy: context.userId,
          now: new Date(),
        });
        return Response.json(selected);
      }
      const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      response.headers.set("allow", "GET, PUT");
      return response;
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The WhatsApp account selection is invalid");
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
      if (error instanceof UnipileChannelConnectionError) {
        return problem(error.status, error.code, channelProblemDetail(error.code));
      }
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

function channelProblemDetail(code: string): string {
  if (code === "UNIPILE_ACCOUNT_NOT_FOUND") return "Ce compte WhatsApp Unipile n’existe plus.";
  if (code === "UNIPILE_ACCOUNT_UNHEALTHY") return "Ce compte WhatsApp doit être reconnecté avant sa sélection.";
  if (code === "UNIPILE_AUTHENTICATION_FAILED") return "La connexion serveur à Unipile doit être renouvelée.";
  return "Unipile est temporairement indisponible.";
}

class WorkspacePermissionError extends Error {}

function requireAdmin(role: string): void {
  if (!["admin", "owner"].includes(role)) throw new WorkspacePermissionError("Admin access is required");
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

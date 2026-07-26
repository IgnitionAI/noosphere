import { ZodError, z } from "zod";
import type { WorkspaceAiSettingsApplication } from "@outbound/application/workspaces/workspace-ai-settings";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const route = "/api/v1/workspace-ai-settings";
const modelId = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/);
const settingsInput = z
  .object({
    researchModels: z.array(modelId).min(1).max(8),
    synthesisModels: z.array(modelId).min(1).max(8),
  })
  .strict()
  .transform((value) => ({
    researchModels: [...new Set(value.researchModels)],
    synthesisModels: [...new Set(value.synthesisModels)],
  }));

export function createWorkspaceAiSettingsHttpHandler(input: {
  application: WorkspaceAiSettingsApplication;
  contextResolver: RequestContextResolver;
}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname !== route) {
        return problem(404, "ROUTE_NOT_FOUND", "Route not found");
      }
      const context = await input.contextResolver.resolve(request);
      if (request.method === "GET") {
        return Response.json(serialize(await input.application.get(context.workspaceId)));
      }
      if (request.method === "PUT") {
        requireAdmin(context.role);
        const body = settingsInput.parse(await request.json());
        return Response.json(
          serialize(
            await input.application.update({
              workspaceId: context.workspaceId,
              userId: context.userId,
              ...body,
            }),
          ),
        );
      }
      const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      response.headers.set("allow", "GET, PUT");
      return response;
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return problem(400, "INVALID_REQUEST", "The model policy is invalid");
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
      return problem(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
  };
}

class WorkspacePermissionError extends Error {}

function requireAdmin(role: string): void {
  if (!["admin", "owner"].includes(role)) {
    throw new WorkspacePermissionError("Admin access is required");
  }
}

function serialize(settings: Awaited<ReturnType<WorkspaceAiSettingsApplication["get"]>>) {
  return {
    researchModels: settings.researchModels,
    synthesisModels: settings.synthesisModels,
    source: settings.source,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
  };
}

function problem(status: number, code: string, detail: string): Response {
  return Response.json(
    {
      type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`,
      title: code,
      status,
      detail,
      code,
    },
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}

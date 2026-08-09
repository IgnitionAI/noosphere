import {
  WORKSPACE_ONBOARDING_STEPS,
  WorkspaceOnboardingError,
  type PostgresWorkspaceOnboarding,
  type WorkspaceOnboardingStep,
} from "@outbound/infrastructure/workspaces/postgres-workspace-onboarding";
import type { RequestContextResolver } from "@outbound/interface/http/request-context";

const progressPath = /^\/api\/v1\/workspaces\/([^/]+)\/onboarding$/;
const actionPath = /^\/api\/v1\/workspaces\/([^/]+)\/onboarding\/steps\/([^/]+)\/actions\/(complete|skip)$/;

type WorkspaceOnboardingService = Pick<PostgresWorkspaceOnboarding, "getProgress" | "completeStep" | "skipOptionalStep">;

export function createWorkspaceOnboardingHttpHandler(input: { service: WorkspaceOnboardingService; contextResolver: RequestContextResolver }) {
  return async function handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      const context = await input.contextResolver.resolve(request);
      const progress = progressPath.exec(pathname);
      if (progress) {
        assertWorkspace(context.workspaceId, uuid(progress[1]));
        if (request.method !== "GET") return methodNotAllowed("GET");
        return Response.json(await input.service.getProgress({ workspaceId: context.workspaceId, actorUserId: context.userId, role: context.role }));
      }
      const action = actionPath.exec(pathname);
      if (action) {
        assertWorkspace(context.workspaceId, uuid(action[1]));
        if (request.method !== "POST") return methodNotAllowed("POST");
        const step = onboardingStep(action[2]);
        const command = { workspaceId: context.workspaceId, step, actorUserId: context.userId, role: context.role };
        return Response.json(action[3] === "complete" ? await input.service.completeStep(command) : await input.service.skipOptionalStep(command));
      }
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof WorkspaceOnboardingError) return problem(error.status, error.code, error.message, error.details);
      if (error instanceof Error && error.name === "RequestAuthenticationError") return problem(401, "AUTHENTICATION_REQUIRED", error.message);
      if (error instanceof Error && error.name === "WorkspaceAccessDeniedError") return problem(403, "WORKSPACE_FORBIDDEN", error.message);
      if (error instanceof Error && error.name === "WorkspaceContextRequiredError") return problem(400, "WORKSPACE_CONTEXT_REQUIRED", error.message);
      throw error;
    }
  };
}

export function isWorkspaceOnboardingRoute(pathname: string): boolean {
  return progressPath.test(pathname) || actionPath.test(pathname);
}

function onboardingStep(value: string | undefined): WorkspaceOnboardingStep {
  if (!value || !(WORKSPACE_ONBOARDING_STEPS as readonly string[]).includes(value)) throw new WorkspaceOnboardingError("ONBOARDING_STEP_INVALID", 422);
  return value as WorkspaceOnboardingStep;
}

function assertWorkspace(actual: string, requested: string) {
  if (actual !== requested) throw new WorkspaceOnboardingError("WORKSPACE_FORBIDDEN", 403);
}

function uuid(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new WorkspaceOnboardingError("INVALID_ID", 422);
  return value;
}

function methodNotAllowed(allow: string) {
  const response = problem(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  response.headers.set("allow", allow);
  return response;
}

function problem(status: number, code: string, detail: string, details: Record<string, unknown> = {}) {
  return Response.json({ type: `https://ignition-outbound.local/problems/${code.toLowerCase()}`, title: code, status, detail, code, ...details }, { status, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

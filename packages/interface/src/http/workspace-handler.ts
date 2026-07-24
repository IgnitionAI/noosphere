import type {
  AuthenticatedSessionReader,
  WorkspaceMembershipDirectory,
} from "@outbound/interface/http/authenticated-workspace-context";

export function createWorkspaceHttpHandler(dependencies: {
  readonly sessions: AuthenticatedSessionReader;
  readonly memberships: WorkspaceMembershipDirectory;
}) {
  return async function handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/api/v1/workspaces") {
      return problem(404, "ROUTE_NOT_FOUND", "Route not found");
    }
    if (request.method !== "GET") {
      const response = problem(
        405,
        "METHOD_NOT_ALLOWED",
        "The HTTP method is not allowed for this route",
      );
      response.headers.set("allow", "GET");
      return response;
    }

    const session = await dependencies.sessions.getSession(request.headers);
    if (!session) {
      return problem(401, "AUTHENTICATION_REQUIRED", "Authentication required");
    }
    const memberships = await dependencies.memberships.listActiveMemberships(session.userId);
    return Response.json({
      data: memberships.map((membership) => ({
        id: membership.workspaceId,
        slug: membership.slug,
        name: membership.name,
        role: membership.role,
        lastSelectedAt: membership.lastSelectedAt?.toISOString() ?? null,
      })),
    });
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

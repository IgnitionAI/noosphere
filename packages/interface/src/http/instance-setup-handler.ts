import { InstancePermissionError, type InstanceSetupApplication } from "@outbound/application/ai/instance-setup";
import type { AuthenticatedSessionReader } from "./authenticated-workspace-context";

export function createInstanceSetupHttpHandler(input: {
  application: InstanceSetupApplication;
  sessions: AuthenticatedSessionReader;
}) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (!["/api/v1/instance/setup", "/api/v1/instance/setup/skip"].includes(path)) return problem(404, "ROUTE_NOT_FOUND");
    const session = await input.sessions.getSession(request.headers);
    if (!session) return problem(401, "AUTHENTICATION_REQUIRED");
    try {
      if (path === "/api/v1/instance/setup" && request.method === "GET") {
        return Response.json(await input.application.get(session.userId));
      }
      if (path.endsWith("/skip") && request.method === "POST") {
        return Response.json(await input.application.skip(session.userId));
      }
      return problem(405, "METHOD_NOT_ALLOWED");
    } catch (error) {
      if (error instanceof InstancePermissionError) return problem(403, "INSTANCE_ADMIN_REQUIRED");
      return problem(500, "INTERNAL_ERROR");
    }
  };
}
function problem(status: number, code: string) {
  return Response.json({ status, code, title: code }, { status });
}

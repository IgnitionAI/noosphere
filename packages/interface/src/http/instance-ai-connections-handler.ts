import { z } from "zod";
import { InstanceAiError, type InstanceAiConnectionsApplication } from "@outbound/application/ai/instance-ai-connections";
import { aiReasoningEfforts } from "@outbound/application/ai/model-gateway";
import type { AuthenticatedSessionReader } from "@outbound/interface/http/authenticated-workspace-context";

const model = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9._:/-]+$/);
const selection = z.object({ connectionId: z.string().uuid(), model }).strict();
const connection = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), provider: z.literal("openai-api"),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  baseUrl: z.literal("https://api.openai.com/v1").optional(),
  models: z.array(z.object({ model, reasoningEffort: z.enum(aiReasoningEfforts) }).strict()).min(1).max(64),
}).strict().refine((value) => new Set(value.models.map((item) => item.model)).size === value.models.length);

export function createInstanceAiConnectionsHttpHandler(input: { application: InstanceAiConnectionsApplication; sessions: AuthenticatedSessionReader }) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const session = await input.sessions.getSession(request.headers);
    if (!session) return problem(401, "AUTHENTICATION_REQUIRED");
    try {
      if (path === "/api/v1/instance/ai" && request.method === "GET") return Response.json(await input.application.list(session.userId), { headers: { "cache-control": "no-store" } });
      if (request.method !== "POST") return problem(405, "METHOD_NOT_ALLOWED");
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return problem(415, "JSON_REQUIRED");
      if (path === "/api/v1/instance/ai/connections") return Response.json(await input.application.save(session.userId, connection.parse(await request.json())), { status: 201 });
      if (path === "/api/v1/instance/ai/test") return Response.json(await input.application.test(session.userId, selection.parse(await request.json())));
      if (path === "/api/v1/instance/ai/default") return Response.json(await input.application.setDefault(session.userId, selection.parse(await request.json())));
      return problem(404, "ROUTE_NOT_FOUND");
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return problem(422, "VALIDATION_FAILED");
      if (error instanceof InstanceAiError) return problem(error.code === "INSTANCE_ADMIN_REQUIRED" ? 403 : error.code === "AI_CONNECTION_NOT_FOUND" ? 404 : 409, error.code);
      return problem(500, "AI_CONNECTION_STORAGE_UNAVAILABLE");
    }
  };
}
function problem(status: number, code: string) { return Response.json({ status, code, title: code }, { status, headers: { "cache-control": "no-store" } }); }

import { AiSetupRequiredError } from "@outbound/application/ai/ai-availability";

export function aiSetupProblem(error: unknown): Response | null {
  if (!(error instanceof AiSetupRequiredError)) return null;
  return Response.json({
    type: "https://api.noosphere.local/problems/ai_setup_required",
    title: "AI_SETUP_REQUIRED", status: 409, code: "AI_SETUP_REQUIRED",
    detail: "Configurez une connexion IA avant de lancer une génération. Vous pouvez continuer à explorer Noosphere.",
    setupUrl: "/settings/instance/ai",
  }, { status: 409, headers: { "content-type": "application/problem+json; charset=utf-8" } });
}

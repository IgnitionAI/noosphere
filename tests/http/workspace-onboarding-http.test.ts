import { describe, expect, test } from "bun:test";
import { createWorkspaceOnboardingHttpHandler } from "@outbound/interface/http/workspace-onboarding-handler";
import type { WorkspaceOnboardingProgress } from "@outbound/infrastructure/workspaces/postgres-workspace-onboarding";

const workspaceId = "00000000-0000-4000-8000-000000000601";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000602";
const userId = "00000000-0000-4000-8000-000000000603";

describe("F-052 workspace onboarding HTTP", () => {
  test("lets every member read the shared progression", async () => {
    for (const role of ["owner", "admin", "operator", "reviewer", "viewer"] as const) {
      const response = await handler(role)(request(`/api/v1/workspaces/${workspaceId}/onboarding`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ workspaceId, currentStep: "workspace" });
    }
  });

  test("delegates completion and optional skip with the authenticated role", async () => {
    const calls: unknown[] = [];
    const handle = handler("operator", {
      async completeStep(input: unknown) { calls.push(input); return progress; },
      async skipOptionalStep(input: unknown) { calls.push(input); return progress; },
    });
    expect((await handle(request(`/api/v1/workspaces/${workspaceId}/onboarding/steps/product/actions/complete`, "POST"))).status).toBe(200);
    expect((await handle(request(`/api/v1/workspaces/${workspaceId}/onboarding/steps/calendar/actions/skip`, "POST"))).status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({ workspaceId, step: "product", actorUserId: userId, role: "operator" }),
      expect.objectContaining({ workspaceId, step: "calendar", actorUserId: userId, role: "operator" }),
    ]);
  });

  test("fails closed on another workspace and an invalid step", async () => {
    const handle = handler("owner");
    expect((await handle(request(`/api/v1/workspaces/${otherWorkspaceId}/onboarding`))).status).toBe(403);
    expect((await handle(request(`/api/v1/workspaces/${workspaceId}/onboarding/steps/unknown/actions/complete`, "POST"))).status).toBe(422);
  });
});

const progress: WorkspaceOnboardingProgress = { workspaceId, currentStep: "workspace", completed: false, completedCount: 0, steps: [], nextAction: { label: "Continuer", href: "#workspace" } };
function handler(role: "owner" | "admin" | "operator" | "reviewer" | "viewer", overrides: Record<string, unknown> = {}) {
  const service = {
    async getProgress() { return progress; },
    async completeStep() { return progress; },
    async skipOptionalStep() { return progress; },
    ...overrides,
  };
  return createWorkspaceOnboardingHttpHandler({ service, contextResolver: { async resolve() { return { workspaceId, userId, role }; } } });
}
function request(pathname: string, method = "GET") { return new Request(`http://localhost${pathname}`, { method, headers: { "x-workspace-slug": "workspace", "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }); }

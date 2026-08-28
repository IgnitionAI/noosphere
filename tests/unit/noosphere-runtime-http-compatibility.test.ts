import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createNoosphereRuntime } from "@outbound/bootstrap/create-noosphere-runtime";
import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

const capabilities = (): RuntimeCapabilities => ({
  crm: { productResearch: { get: async () => undefined, list: async () => undefined } },
  prospectMemory: { operations: { status: async () => undefined, view: async () => undefined } },
  pipeline: { available: false },
  campaigns: { available: false },
  conversations: { available: false },
  content: {
    strategies: { find: async () => undefined },
    ideas: { list: async () => undefined },
    generation: { findRun: async () => undefined, findIdea: async () => undefined, findAssetByIdea: async () => undefined },
    publications: { list: async () => undefined, find: async () => undefined },
    socialContent: { list: async () => undefined, status: async () => undefined },
    socialEngagement: { list: async () => undefined, status: async () => undefined },
    attribution: { listJourneys: async () => undefined },
  },
  approvals: { available: false },
  operations: { contentPerformance: { get: async () => undefined } },
  knowledge: { available: false },
});

describe("Noosphere runtime HTTP compatibility", () => {
  test("keeps API transport entrypoint free of infrastructure wiring", async () => {
    const source = await readFile(resolve(import.meta.dir, "../../apps/api/src/index.ts"), "utf8");

    expect(source).toContain("createNoosphereApiRuntime");
    expect(source).not.toContain("@outbound/infrastructure/");
    expect(source).not.toContain("createDatabase(");
    expect(source).toContain("fetch(request)");
    expect(source).toContain("runtime.handle(request)");
  });

  test("dispatches the request and auth adapter in-process", async () => {
    const dispatched: string[] = [];
    const runtime = createNoosphereRuntime({
      capabilities: capabilities(),
      dispatch: async (request) => {
        dispatched.push(new URL(request.url).pathname);
        return Response.json({ route: "application" });
      },
      auth: async () => Response.json({ route: "auth" }),
      health: async () => ({ status: "ready" as const }),
    });

    const applicationResponse = await runtime.handle(new Request("https://example.test/api/v1/content/ideas"));
    const authResponse = await runtime.handleAuth(new Request("https://example.test/api/auth/session"));

    expect(await applicationResponse.json()).toEqual({ route: "application" });
    expect(await authResponse.json()).toEqual({ route: "auth" });
    expect(dispatched).toEqual(["/api/v1/content/ideas"]);
    expect(await runtime.health()).toEqual({ status: "ready" });
  });
});
